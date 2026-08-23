import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli/args.js";
import { CLAIMS_ARTIFACT_PATH, MANIFEST_FILE_NAME } from "../src/export.js";
import { cleanupProjects, claim, makeProject } from "./helpers.js";

afterAll(cleanupProjects);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(REPO_ROOT, "dist", "lib", "cli", "main.js");

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): RunResult {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

beforeAll(() => {
  if (!existsSync(CLI)) {
    throw new Error(`Missing ${CLI}. Run \`pnpm run build\` before the CLI test.`);
  }
});

describe("argument parsing", () => {
  it("reads commands, flags, --key value and --key=value", () => {
    expect(parseArgs(["export", "--project", "/tmp/x", "--json"])).toEqual({
      command: "export",
      options: { project: "/tmp/x", json: true },
      positionals: [],
    });
    expect(parseArgs(["validate", "--project=/tmp/y"]).options).toEqual({ project: "/tmp/y" });
    expect(parseArgs(["export", "--no-write"]).options).toEqual({ write: false });
  });

  it("rejects a short flag rather than guessing", () => {
    expect(() => parseArgs(["export", "-p"])).toThrowError(/Unknown option/);
  });
});

describe("oratlas-myst CLI", () => {
  it("prints usage and its version", () => {
    expect(runCli(["--version"]).stdout.trim()).toBe("0.2.0");
    const help = runCli(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("oratlas-myst <command>");
    expect(help.stdout).toContain("static_files");
  });

  it("fails on an unknown command and on an unknown flag", () => {
    expect(runCli(["frobnicate"]).status).toBe(1);
    expect(runCli(["export", "--registry", "https://evil.example"]).status).toBe(1);
    expect(runCli(["export", "--registry", "https://evil.example"]).stderr).toContain(
      "Unknown option",
    );
  });

  it("exports, validates and inspects a project", () => {
    const root = makeProject({
      "index.md": `# I\n\n${claim("first", "A statement.")}`,
      "results.md": `# R\n\n${claim("second", "Another statement.")}`,
    });

    const exported = runCli(["export", "--project", root]);
    expect(exported.status).toBe(0);
    expect(exported.stdout).toContain("Wrote 2 claim record(s)");
    expect(existsSync(join(root, ".oratlas", MANIFEST_FILE_NAME))).toBe(true);
    expect(existsSync(join(root, ".oratlas", CLAIMS_ARTIFACT_PATH))).toBe(true);

    const validated = runCli(["validate", "--project", root]);
    expect(validated.status).toBe(0);
    expect(validated.stdout).toContain("OK: 2 claim record(s)");

    const inspected = runCli(["inspect", "--project", root]);
    expect(inspected.status).toBe(0);
    expect(inspected.stdout).toContain("first");
    expect(inspected.stdout).toContain("A statement.");
  });

  it("computes without writing under --no-write", () => {
    const root = makeProject({ "index.md": `# I\n\n${claim("only", "A statement.")}` });
    const result = runCli(["export", "--project", root, "--no-write"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Computed 1 claim record(s)");
    expect(existsSync(join(root, ".oratlas"))).toBe(false);
  });

  it("emits machine-readable JSON under --json", () => {
    const root = makeProject({ "index.md": `# I\n\n${claim("only", "A statement.")}` });
    const result = runCli(["export", "--project", root, "--no-write", "--json"]);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.manifest.schemaVersion).toBe("0.2.0");
    expect(parsed.claims).toHaveLength(1);
    expect(parsed.written).toBe(false);
  });

  it("exits non-zero with an actionable message on a semantic error", () => {
    const root = makeProject({
      "index.md": `# I\n\n${claim("dup", "One.")}`,
      "results.md": `# R\n\n${claim("dup", "Two.")}`,
    });
    const result = runCli(["export", "--project", root]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("claim-declarations-invalid");
    expect(result.stderr).toContain('Duplicate claim id "dup"');
    expect(result.stderr).toContain("index.md");
    expect(result.stderr).toContain("results.md");
  });

  it("exits non-zero when validation fails", () => {
    const root = makeProject({ "index.md": `# I\n\n${claim("only", "A statement.")}` });
    const result = runCli(["validate", "--project", root]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("artifact-missing");
  });

  it("reproduces the artifacts byte-for-byte across two CLI runs", () => {
    const root = makeProject({
      "index.md": `# I\n\n${claim("a", "Alpha.")}\n\n${claim("b", "Beta.")}`,
    });
    runCli(["export", "--project", root]);
    const first = readFileSync(join(root, ".oratlas", CLAIMS_ARTIFACT_PATH), "utf8");
    runCli(["export", "--project", root]);
    expect(readFileSync(join(root, ".oratlas", CLAIMS_ARTIFACT_PATH), "utf8")).toBe(first);
  });
});
