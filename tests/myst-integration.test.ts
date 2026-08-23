import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLAIMS_ARTIFACT_PATH, MANIFEST_FILE_NAME, exportProject } from "../src/export.js";
import { validateProject } from "../src/validate.js";

const require_ = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const EXAMPLE = join(REPO_ROOT, "examples", "basic");
const PLUGIN_BUNDLE = join(REPO_ROOT, "dist", "oratlas-myst.mjs");

/**
 * Build the real `examples/basic` project with the real MyST CLI.
 *
 * The example is copied into a temporary directory first, for two reasons:
 * the build writes into `_build/`, and the copy's `myst.yml` is repointed at a
 * local site template so the build never has to download a theme from
 * api.mystmd.org. Everything else — the plugin bundle, the sources, the
 * claims, MyST's own site build — is exactly what a reader would get.
 */
let workspace: string;
let siteDir: string;
let built = false;

interface XrefReference {
  identifier?: string;
  kind: string;
  data: string;
  url: string;
  html_id?: string;
}

function readXref(): { version: string; myst: string; references: XrefReference[] } {
  return JSON.parse(readFileSync(join(siteDir, "myst.xref.json"), "utf8"));
}

beforeAll(() => {
  if (!existsSync(PLUGIN_BUNDLE)) {
    throw new Error(
      `Missing ${PLUGIN_BUNDLE}. Run \`pnpm run build\` before the integration test.`,
    );
  }

  workspace = mkdtempSync(join(tmpdir(), "oratlas-myst-integration-"));
  cpSync(EXAMPLE, workspace, {
    recursive: true,
    filter: (source) => !source.includes("_build") && !source.includes("node_modules"),
  });
  rmSync(join(workspace, ".oratlas"), { recursive: true, force: true });

  // Vendor the plugin bundle beside the project so the copy's relative plugin
  // path resolves, and swap the theme for the offline template.
  cpSync(PLUGIN_BUNDLE, join(workspace, "oratlas-myst.mjs"));
  cpSync(join(HERE, "fixtures", "site-template"), join(workspace, "_site_template"), {
    recursive: true,
  });
  const config = readFileSync(join(workspace, "myst.yml"), "utf8")
    .replace("../../dist/oratlas-myst.mjs", "oratlas-myst.mjs")
    .replace("template: book-theme", "template: ./_site_template");
  writeFileSync(join(workspace, "myst.yml"), config, "utf8");

  // 1. Export the ORAtlas artifacts, exactly as `oratlas-myst export` does.
  exportProject({ projectRoot: workspace });

  // 2. Run the real MyST site build.
  execFileSync("node", [require_.resolve("mystmd/dist/myst.cjs"), "build", "--site"], {
    cwd: workspace,
    stdio: "pipe",
    encoding: "utf8",
  });

  siteDir = join(workspace, "_build", "site");
  built = true;
}, 300_000);

afterAll(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
});

describe("real MyST build", () => {
  it("completes and writes MyST's own cross-reference inventory", () => {
    expect(built).toBe(true);
    expect(existsSync(join(siteDir, "myst.xref.json"))).toBe(true);
    expect(readXref().version).toBe("1");
  });

  it("registers every ORAtlas claim as a discoverable MyST cross-reference target", () => {
    const { references } = readXref();
    const byIdentifier = new Map(
      references.filter((reference) => reference.identifier).map((r) => [r.identifier!, r]),
    );

    for (const id of [
      "adolescent-window",
      "hpa-axis-mediation",
      "timing-not-dose",
      "no-single-critical-period",
    ]) {
      const reference = byIdentifier.get(id);
      expect(reference, `claim "${id}" is missing from myst.xref.json`).toBeDefined();
      // A `div` target: a standard MyST node, no custom renderer involved.
      expect(reference!.kind).toBe("div");
      // The publication location MyST resolves the target to.
      expect(reference!.url).toMatch(/^\//);
      expect(reference!.data).toMatch(/\.json$/);
    }

    // The claims are spread across both pages of the example.
    expect(byIdentifier.get("adolescent-window")!.url).toBe("/");
    expect(byIdentifier.get("hpa-axis-mediation")!.url).toBe("/results");
  });

  it("resolves every claim cross-reference written in the example", () => {
    for (const page of ["index", "results"]) {
      const content = JSON.parse(readFileSync(join(siteDir, "content", `${page}.json`), "utf8"));
      const crossReferences: { identifier?: string; resolved?: boolean; url?: string }[] = [];
      const walk = (node: { type?: string; children?: unknown[] } & Record<string, unknown>) => {
        if (node.type === "crossReference" || (node.type === "link" && node.internal)) {
          crossReferences.push(node as (typeof crossReferences)[number]);
        }
        for (const child of (node.children ?? []) as (typeof node)[]) walk(child);
      };
      walk(content.mdast);
      const claimReferences = crossReferences.filter((reference) =>
        [
          "adolescent-window",
          "hpa-axis-mediation",
          "timing-not-dose",
          "no-single-critical-period",
        ].includes(reference.identifier ?? ""),
      );
      expect(claimReferences.length).toBeGreaterThan(0);
      for (const reference of claimReferences) {
        expect(reference.resolved, `unresolved reference to ${reference.identifier}`).toBe(true);
      }
    }
  });

  it("renders the claim text as ordinary MyST content with a stable anchor", () => {
    const content = JSON.parse(readFileSync(join(siteDir, "content", "results.json"), "utf8"));
    const found: Record<string, unknown>[] = [];
    const walk = (node: Record<string, unknown>) => {
      if (node.type === "div" && node.identifier === "hpa-axis-mediation") found.push(node);
      for (const child of (node.children ?? []) as Record<string, unknown>[]) walk(child);
    };
    walk(content.mdast);

    expect(found).toHaveLength(1);
    const node = found[0]!;
    // MyST generated the DOM id, so the claim is addressable in the built page.
    expect(node.html_id).toBe("hpa-axis-mediation");
    expect(node.class).toBe("oratlas-claim");
    expect(node.data).toMatchObject({ oratlas: { kind: "claim", id: "hpa-axis-mediation" } });

    // The body is standard MyST: two paragraphs of plain content, and the
    // citation resolved through MyST's normal bibliography machinery.
    const children = node.children as { type: string }[];
    expect(children.map((child) => child.type)).toEqual(["paragraph", "paragraph"]);
    const serialized = JSON.stringify(node);
    expect(serialized).toContain("hypothalamic");
    expect(serialized).toContain("cite");
  });

  it("reports no MyST errors for the claim directives", () => {
    const log = JSON.parse(
      readFileSync(join(workspace, "_build", "logs", "myst.build.json"), "utf8"),
    );
    const serialized = JSON.stringify(log);
    expect(serialized).not.toContain("oratlas:claim");
    expect(serialized).not.toContain("Duplicate identifier");
  });

  it("publishes the ORAtlas artifacts at the root of the built site", () => {
    // MyST copies `project.static_files` into the site's public root, which is
    // what a deployed site serves at `/`.
    const publicDir = join(siteDir, "public");
    const manifestPath = join(publicDir, MANIFEST_FILE_NAME);
    const claimsPath = join(publicDir, CLAIMS_ARTIFACT_PATH);
    expect(existsSync(manifestPath)).toBe(true);
    expect(existsSync(claimsPath)).toBe(true);

    // The published bytes are exactly the exported bytes.
    expect(readFileSync(manifestPath, "utf8")).toBe(
      readFileSync(join(workspace, ".oratlas", MANIFEST_FILE_NAME), "utf8"),
    );
    expect(readFileSync(claimsPath, "utf8")).toBe(
      readFileSync(join(workspace, ".oratlas", CLAIMS_ARTIFACT_PATH), "utf8"),
    );
  });

  it("lets a consumer resolve a claim to its publication location through myst.xref.json", () => {
    // This is the whole point of the split: `claims.jsonl` says what the claim
    // is and where it is declared in the source; `myst.xref.json` says where
    // the built site serves it. Neither reproduces the other.
    const manifest = JSON.parse(readFileSync(join(siteDir, "public", MANIFEST_FILE_NAME), "utf8"));
    const claims = readFileSync(join(siteDir, "public", CLAIMS_ARTIFACT_PATH), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const xref = readXref();

    expect(manifest.adapter).toEqual({ type: "myst", xref: "myst.xref.json" });
    for (const record of claims) {
      const reference = xref.references.find(
        (candidate) => candidate.identifier === record.target.identifier,
      );
      expect(reference, `no xref entry for ${record.id}`).toBeDefined();
      const canonical = new URL(reference!.url, manifest.publication.canonicalUrl);
      expect(canonical.protocol).toBe("https:");
    }
  });

  it("still validates after the build", () => {
    const result = validateProject({ projectRoot: workspace });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.records).toBe(4);
  });

  it("re-exports byte-identically after a full build", () => {
    const before = readFileSync(join(workspace, ".oratlas", CLAIMS_ARTIFACT_PATH), "utf8");
    exportProject({ projectRoot: workspace });
    expect(readFileSync(join(workspace, ".oratlas", CLAIMS_ARTIFACT_PATH), "utf8")).toBe(before);
  });
});
