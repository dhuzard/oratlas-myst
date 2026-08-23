#!/usr/bin/env node
/**
 * Build `examples/basic` with the real MyST CLI, the way an author would.
 *
 * The example uses the real `book-theme`, which MyST resolves by downloading it
 * from api.mystmd.org. This script therefore needs network access. The hermetic
 * counterpart — a real MyST site build against a local template, with no network
 * at all — lives in `tests/myst-integration.test.ts` and covers the same
 * assertions about `myst.xref.json` and the published artifacts.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const example = join(repoRoot, "examples", "basic");
const cli = join(repoRoot, "dist", "lib", "cli", "main.js");
const bundle = join(repoRoot, "dist", "oratlas-myst.mjs");

if (!existsSync(bundle) || !existsSync(cli)) {
  console.error(`Missing build output. Run \`pnpm run build\` first.`);
  process.exit(1);
}

function run(label, args) {
  console.log(`\n=== ${label} ===`);
  try {
    execFileSync(process.execPath, args, { cwd: example, stdio: "inherit" });
  } catch (error) {
    console.error(`\nFailed to ${label}.`);
    if (label === "build the site") {
      console.error(
        "If the failure names api.mystmd.org, the environment cannot reach MyST's\n" +
          "template registry, which `site.template: book-theme` requires. That is a\n" +
          "network restriction, not a problem with the example. `pnpm test` covers the\n" +
          "same ground offline via tests/myst-integration.test.ts.",
      );
    }
    process.exit(typeof error?.status === "number" ? error.status : 1);
  }
}

run("export the ORAtlas artifacts", [cli, "export", "--project", example]);
run("build the site", [require.resolve("mystmd/dist/myst.cjs"), "build", "--html"]);
run("validate the artifacts", [cli, "validate", "--project", example]);

console.log("\n=== check the built site root ===");
let missing = false;
for (const expected of ["myst.xref.json", "oratlas.manifest.json", "oratlas/claims.jsonl"]) {
  const path = join(example, "_build", "html", expected);
  if (existsSync(path)) {
    console.log(`ok: _build/html/${expected}`);
  } else {
    console.error(`missing: _build/html/${expected}`);
    missing = true;
  }
}
if (missing) {
  console.error(
    "\nThe built site does not serve the ORAtlas artifacts at its root. Check that\n" +
      "myst.yml lists them under project.static_files.",
  );
  process.exit(1);
}
