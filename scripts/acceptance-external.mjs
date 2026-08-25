#!/usr/bin/env node
/**
 * External-consumer acceptance for package 0.3.0 and manifest protocol 0.3.0.
 *
 * Proves the whole chain from the point of view of an author who has never
 * seen this repository:
 *
 *   fresh external MyST repo
 *     → install @neuronautix/myst (from the packed tarball, as npm would deliver it)
 *     → oratlas-myst export      (through the installed `bin`)
 *     → myst build               (plugin resolved from node_modules)
 *     → three public artifacts at the site root
 *     → oratlas-myst validate
 *
 * This exercises what the in-repo example cannot: the published `files` list,
 * the `bin` entry, and the plugin being loaded from `node_modules` rather than
 * from a relative path into `dist/`.
 *
 * Set ORATLAS_ACCEPTANCE_OFFLINE=1 to build with a local site template instead
 * of downloading `book-theme` from api.mystmd.org. The artifacts land in the
 * site's public directory rather than the html root, which is the same
 * `static_files` mechanism; CI runs the online path.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const offline = process.env.ORATLAS_ACCEPTANCE_OFFLINE === "1";
const workspace = mkdtempSync(join(tmpdir(), "oratlas-acceptance-"));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
let failed = false;

function step(label) {
  console.log(`\n=== ${label} ===`);
}

function run(command, args, cwd, quiet = false) {
  const isWindowsShim = process.platform === "win32" && command.endsWith(".cmd");
  const executable = isWindowsShim ? (process.env.ComSpec ?? "cmd.exe") : command;
  const executableArgs = isWindowsShim ? ["/d", "/s", "/c", command, ...args] : args;
  return execFileSync(executable, executableArgs, {
    cwd,
    encoding: "utf8",
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

try {
  step("pack @neuronautix/myst as npm would publish it");
  if (!existsSync(join(repoRoot, "dist", "oratlas-myst.mjs"))) {
    throw new Error("Missing dist/. Run `pnpm run build` first.");
  }
  const packed = run(
    npmCommand,
    ["pack", "--json", "--pack-destination", workspace],
    repoRoot,
    true,
  );
  const tarball = join(workspace, JSON.parse(packed)[0].filename);
  console.log(`packed ${tarball}`);

  step("create a fresh external MyST project");
  const project = join(workspace, "external-review");
  mkdirSync(project, { recursive: true });
  const write = (name, content) => writeFileSync(join(project, name), content, "utf8");

  write(
    "package.json",
    `${JSON.stringify({ name: "an-external-review", private: true, type: "module" }, null, 2)}\n`,
  );
  write(
    "myst.yml",
    [
      "version: 1",
      "project:",
      "  id: external-review",
      "  title: An entirely external review",
      "  authors:",
      "    - id: external-author",
      "      name: External Author",
      "      orcid: 0000-0002-1825-0097",
      "  plugins:",
      "    - node_modules/@neuronautix/myst/dist/oratlas-myst.mjs",
      "  static_files:",
      "    - .oratlas/oratlas.manifest.json",
      "    - .oratlas/oratlas",
      "  toc:",
      "    - file: index.md",
      "site:",
      offline ? "  template: ./_tpl" : "  template: book-theme",
      "",
    ].join("\n"),
  );
  write(
    "oratlas.yml",
    [
      "canonical_url: https://external.example.org/review/",
      "production:",
      "  mode: ai-assisted",
      "  actors:",
      "    - id: assistant",
      "      kind: ai-system",
      "      name: Example Assistant",
      "      model: example-model",
      "      activities: [drafting]",
      "    - id: external-editor",
      "      kind: person",
      "      name: External Author",
      "      activities: [editing, reviewing]",
      "",
    ].join("\n"),
  );
  write(
    "index.md",
    [
      "# An entirely external review",
      "",
      "Framing prose that is not a claim.",
      "",
      ":::{oratlas:claim} external-finding",
      ":type: empirical",
      "",
      "An external publication can declare a claim without this repository being",
      "involved in any way.",
      ":::",
      "",
      "See [the external finding](#external-finding).",
      "",
    ].join("\n"),
  );
  if (offline) {
    mkdirSync(join(project, "_tpl"), { recursive: true });
    write("_tpl/template.yml", 'version: "1"\nkind: site\nmyst: v1\ntitle: Offline template\n');
  }
  console.log(`created ${project}`);

  step("install @neuronautix/myst from the tarball");
  run(npmCommand, ["install", "--no-audit", "--no-fund", tarball, "mystmd@1.10.1"], project);

  step("export through the installed bin");
  run(
    join(
      project,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "oratlas-myst.cmd" : "oratlas-myst",
    ),
    ["export"],
    project,
  );

  step("build the site with MyST");
  run(
    process.execPath,
    [
      join(project, "node_modules", "mystmd", "dist", "myst.cjs"),
      "build",
      offline ? "--site" : "--html",
    ],
    project,
  );

  step("check the three public artifacts at the site root");
  const siteRoot = offline ? join(project, "_build", "site") : join(project, "_build", "html");
  const publicRoot = offline ? join(siteRoot, "public") : siteRoot;
  const artifacts = [
    ["myst.xref.json", join(siteRoot, "myst.xref.json")],
    ["oratlas.manifest.json", join(publicRoot, "oratlas.manifest.json")],
    ["oratlas/claims.jsonl", join(publicRoot, "oratlas", "claims.jsonl")],
  ];
  for (const [label, path] of artifacts) {
    if (existsSync(path)) {
      console.log(`ok: ${label}`);
    } else {
      console.error(`MISSING: ${label} (${path})`);
      failed = true;
    }
  }

  if (!failed) {
    // The claim must be discoverable through MyST's own inventory, joined on
    // the identifier — that is the whole point of the two artifacts.
    const xref = JSON.parse(readFileSync(join(siteRoot, "myst.xref.json"), "utf8"));
    const manifest = JSON.parse(readFileSync(join(publicRoot, "oratlas.manifest.json"), "utf8"));
    const claims = readFileSync(join(publicRoot, "oratlas", "claims.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    const checks = [
      ["manifest schemaVersion is 0.3.0", manifest.schemaVersion === "0.3.0"],
      [
        "generator identifies @neuronautix/myst 0.3.0",
        manifest.generator?.name === "@neuronautix/myst" && manifest.generator?.version === "0.3.0",
      ],
      [
        "standard MyST author maps to a scholarly contributor",
        manifest.contributors?.length === 1 &&
          manifest.contributors[0]?.sourceContributorKey === "external-author" &&
          manifest.contributors[0]?.kind === "person" &&
          manifest.contributors[0]?.roles?.includes("author"),
      ],
      [
        "explicit production remains source-declared and separate",
        manifest.production?.strength === "source-declared" &&
          manifest.production?.mode === "ai-assisted" &&
          manifest.production?.actors?.length === 2,
      ],
      ["adapter type is myst", manifest.adapter?.type === "myst"],
      [
        "publication has an exact version identity",
        /^[0-9a-f]{64}$/.test(manifest.publication?.version?.sourcesSha256 ?? ""),
      ],
      [
        "one claim record was exported",
        claims.length === 1 && manifest.artifacts.claims.records === 1,
      ],
      ["claim target type is myst-xref", claims[0]?.target?.type === "myst-xref"],
      [
        "claim resolves in myst.xref.json",
        xref.references.some((reference) => reference.identifier === claims[0]?.target?.identifier),
      ],
      [
        "no TRUST/assessment/canonical-id leaked",
        !/trustScore|assessment|verification|canonicalId/.test(
          JSON.stringify({ manifest, claims }),
        ),
      ],
    ];
    for (const [label, ok] of checks) {
      console.log(`${ok ? "ok" : "FAILED"}: ${label}`);
      if (!ok) failed = true;
    }
  }

  step("validate");
  run(
    join(
      project,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "oratlas-myst.cmd" : "oratlas-myst",
    ),
    ["validate"],
    project,
  );
} catch (error) {
  console.error(
    `\nAcceptance run failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  failed = true;
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

console.log(`\n${failed ? "ACCEPTANCE FAILED" : "ACCEPTANCE PASSED"}`);
process.exit(failed ? 1 : 0);
