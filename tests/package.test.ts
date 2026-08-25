import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

interface PackResult {
  name: string;
  version: string;
  files: Array<{ path: string }>;
}

function packDryRun(): PackResult {
  const args = ["pack", "--dry-run", "--json", "--ignore-scripts"];
  const executable = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : npmCommand;
  const executableArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", npmCommand, ...args] : args;
  const output = execFileSync(executable, executableArgs, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return (JSON.parse(output) as PackResult[])[0]!;
}

describe("npm package", () => {
  it("contains every required distribution entry point", () => {
    const packed = packDryRun();
    expect({ name: packed.name, version: packed.version }).toEqual({
      name: "@neuronautix/myst",
      version: "0.3.0",
    });

    const paths = new Set(packed.files.map((file) => file.path));
    for (const expected of [
      "dist/lib/cli/main.js",
      "dist/lib/index.js",
      "dist/lib/plugin.js",
      "dist/oratlas-myst.mjs",
      "schemas/oratlas-manifest.schema.json",
      "schemas/oratlas-claim.schema.json",
      "protocol/examples/human.manifest.json",
      "protocol/examples/agentic-no-contributors.manifest.json",
    ]) {
      expect(paths.has(expected), `${expected} is missing from npm pack`).toBe(true);
    }
  });

  it("publishes the installed CLI from the packed dist directory", () => {
    const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    expect(packageJson.bin).toEqual({ "oratlas-myst": "dist/lib/cli/main.js" });
  });
});
