import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { OratlasMystError } from "../src/errors.js";

const created: string[] = [];

/**
 * Create a throwaway MyST project on disk.
 *
 * Files are given as project-relative paths. A `myst.yml` is written for you
 * unless the fixture supplies its own.
 */
export function makeProject(
  files: Record<string, string>,
  options: { toc?: string[] | false } = {},
): string {
  const root = mkdtempSync(join(tmpdir(), "oratlas-myst-test-"));
  created.push(root);

  const all: Record<string, string> = { ...files };
  if (!all["myst.yml"]) {
    const pages =
      options.toc === false
        ? undefined
        : (options.toc ??
          Object.keys(files)
            .filter((path) => path.endsWith(".md"))
            .sort());
    all["myst.yml"] = [
      "version: 1",
      "project:",
      "  id: test-project",
      "  title: Test project",
      "  static_files:",
      "    - .oratlas/oratlas.manifest.json",
      "    - .oratlas/oratlas",
      ...(pages ? ["  toc:", ...pages.map((page) => `    - file: ${page}`)] : []),
      "site:",
      "  template: book-theme",
      "",
    ].join("\n");
  }

  for (const [path, content] of Object.entries(all)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
  }
  return root;
}

export function writeProjectFile(root: string, path: string, content: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

export function cleanupProjects(): void {
  for (const root of created.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Create a symlink inside a throwaway project, for the discovery tests. */
export function linkInProject(root: string, linkPath: string, targetPath: string): void {
  const link = join(root, linkPath);
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(targetPath, link);
}

/** A single well-formed claim declaration, for fixtures that need one. */
export function claim(id: string, body: string, options: Record<string, string> = {}): string {
  const optionLines = Object.entries(options).map(([key, value]) => `:${key}: ${value}`);
  return [`:::{oratlas:claim} ${id}`, ...optionLines, "", body, ":::", ""].join("\n");
}

/**
 * Assert that a call fails with an `OratlasMystError` whose message or detail
 * matches. The summary and the actionable detail are separate fields, so a
 * bare message match would miss the part that names the offending claim.
 */
export function expectOratlasError(run: () => unknown, pattern: RegExp): void {
  try {
    run();
  } catch (error) {
    if (!(error instanceof OratlasMystError)) throw error;
    const combined = [error.code, error.message, error.detail].filter(Boolean).join("\n");
    if (!pattern.test(combined)) {
      throw new Error(`Expected ${pattern} to match:\n${combined}`);
    }
    return;
  }
  throw new Error(`Expected the call to throw an OratlasMystError matching ${pattern}.`);
}
