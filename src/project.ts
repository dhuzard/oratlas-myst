import { lstatSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { compareStrings } from "./canonical-json.js";
import { isOutputPath, MYST_CONFIG_FILE, type LoadedConfig } from "./config.js";
import { isSafeLocalPath, SAFE_LOCAL_PATH_MESSAGE } from "./contracts/paths.js";
import { OratlasMystError } from "./errors.js";
import {
  MAX_DOCUMENT_BYTES,
  projectFileExists,
  readProjectFile,
  resolveInsideProject,
} from "./fs-safe.js";

export { MAX_DOCUMENT_BYTES, readProjectFile, resolveInsideProject };

/** MyST source extensions this adapter parses in v0.2. */
export const SUPPORTED_EXTENSIONS = [".md"] as const;

/**
 * Extensions MyST itself can build but this adapter does not parse.
 * A page in one of these formats is reported, never silently dropped.
 */
export const UNSUPPORTED_PAGE_EXTENSIONS = [".ipynb", ".tex", ".myst.json"] as const;

/** Directories never walked during discovery. */
const IGNORED_DIRECTORIES = new Set(["node_modules", "_build", "_static", "_templates"]);

/** Largest number of pages this adapter will process. */
export const MAX_PAGES = 5_000;

/**
 * Deepest directory nesting the discovery walk will descend.
 *
 * Symbolic links are already refused, which rules out the usual way a walk
 * becomes unbounded, but a cap is cheap insurance against a pathological tree.
 */
export const MAX_WALK_DEPTH = 32;

export interface ProjectPage {
  /** Project-relative POSIX path, e.g. `results.md`. */
  path: string;
  /** Absolute path on disk. */
  absolutePath: string;
}

export interface DiscoveredPages {
  pages: ProjectPage[];
  /** Paths this version deliberately did not process, with the reason. */
  skipped: { path: string; reason: string }[];
  /** How the page list was determined. */
  source: "toc" | "discovery";
}

function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

function hasSupportedExtension(path: string): boolean {
  return SUPPORTED_EXTENSIONS.some((extension) => path.endsWith(extension));
}

function unsupportedExtension(path: string): string | undefined {
  return UNSUPPORTED_PAGE_EXTENSIONS.find((extension) => path.endsWith(extension));
}

/**
 * Collect `file:` entries from a MyST TOC.
 *
 * Both the legacy nested `[{ file, children }]` shape and the current
 * `myst-toc` shape (which also uses `file` and `children`) enumerate pages the
 * same way, so one traversal covers both. Entries that are not pages
 * (`url:`, `pattern:`-only groups) are skipped.
 */
function collectTocFiles(toc: unknown, out: string[], seen: Set<unknown>): void {
  if (!Array.isArray(toc)) return;
  for (const entry of toc) {
    if (!entry || typeof entry !== "object") continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    const record = entry as Record<string, unknown>;
    if (typeof record.file === "string" && record.file.trim().length > 0) {
      out.push(record.file.trim());
    }
    if (record.children) collectTocFiles(record.children, out, seen);
  }
}

/**
 * Walk the project directory for Markdown pages.
 *
 * Every entry is examined with `lstatSync`, never `statSync`: a symbolic link
 * is reported as a link rather than as whatever it points at, and is then
 * skipped outright. Following one would let a link inside the project walk the
 * filesystem outside it, and a link to an ancestor directory would make the
 * walk unbounded. `resolveInsideProject` would still refuse the eventual read,
 * but the traversal itself must not happen in the first place.
 *
 * A symlinked page is not silently dropped: it is reported to the author, who
 * can declare it in `project.toc` if they meant to include it. A TOC entry is
 * an explicit declaration and is resolved with the realpath discipline in
 * `fs-safe.ts`, which permits a link that stays inside the project.
 */
function walkForPages(
  projectRoot: string,
  outputDir: string,
): { found: string[]; skipped: { path: string; reason: string }[] } {
  const found: string[] = [];
  const skipped: { path: string; reason: string }[] = [];

  const walk = (directory: string, prefix: string, depth: number): void => {
    if (depth > MAX_WALK_DEPTH) {
      skipped.push({ path: prefix, reason: `nested deeper than ${MAX_WALK_DEPTH} directories` });
      return;
    }
    let names: string[];
    try {
      names = readdirSync(directory).sort(compareStrings);
    } catch {
      return;
    }
    for (const name of names) {
      if (name.startsWith(".")) continue;
      if (IGNORED_DIRECTORIES.has(name)) continue;
      const relativePath = prefix ? `${prefix}/${name}` : name;
      if (isOutputPath(relativePath, outputDir)) continue;
      const absolute = join(directory, name);

      let stats;
      try {
        stats = lstatSync(absolute);
      } catch {
        continue;
      }

      if (stats.isSymbolicLink()) {
        if (hasSupportedExtension(name)) {
          skipped.push({
            path: relativePath,
            reason:
              "symbolic links are not followed during page discovery; declare it in project.toc to include it",
          });
        }
        continue;
      }

      if (stats.isDirectory()) {
        walk(absolute, relativePath, depth + 1);
      } else if (stats.isFile() && hasSupportedExtension(name)) {
        found.push(relativePath);
      }
    }
  };

  walk(resolve(projectRoot), "", 0);
  return { found, skipped };
}

/**
 * Determine the publication's pages, deterministically.
 *
 * When `myst.yml` declares `project.toc`, that TOC is authoritative and its
 * order is preserved. Otherwise pages are discovered by walking the project
 * directory in sorted order, matching MyST's own default of building every
 * Markdown file it finds.
 */
export function discoverPages(config: LoadedConfig): DiscoveredPages {
  const { projectRoot, myst, oratlas } = config;
  const skipped: { path: string; reason: string }[] = [];
  const ordered: string[] = [];
  let source: "toc" | "discovery";

  if (myst.toc !== undefined && myst.toc !== null) {
    source = "toc";
    const declared: string[] = [];
    collectTocFiles(myst.toc, declared, new Set());
    for (const entry of declared) {
      const normalized = toPosix(entry).replace(/^\.\//, "");
      if (!isSafeLocalPath(normalized)) {
        throw new OratlasMystError(
          "unsafe-path",
          `${MYST_CONFIG_FILE}: TOC entry is not a safe project-relative path: ${entry}`,
          SAFE_LOCAL_PATH_MESSAGE,
        );
      }
      const unsupported = unsupportedExtension(normalized);
      if (unsupported) {
        skipped.push({
          path: normalized,
          reason: `${unsupported} pages are not parsed by @oratlas/myst`,
        });
        continue;
      }
      let candidate = normalized;
      if (!hasSupportedExtension(candidate)) {
        // MyST allows TOC entries without an extension.
        const withExtension = `${candidate}.md`;
        if (projectFileExists(projectRoot, withExtension)) {
          candidate = withExtension;
        } else {
          skipped.push({ path: normalized, reason: "not a Markdown page" });
          continue;
        }
      }
      if (!projectFileExists(projectRoot, candidate)) {
        throw new OratlasMystError(
          "toc-page-missing",
          `TOC declares a page that does not exist: ${candidate}`,
        );
      }
      ordered.push(candidate);
    }
  } else {
    source = "discovery";
    const walked = walkForPages(projectRoot, oratlas.output);
    ordered.push(...walked.found);
    skipped.push(...walked.skipped);
  }

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const path of ordered) {
    if (seen.has(path)) continue;
    seen.add(path);
    unique.push(path);
  }

  if (unique.length > MAX_PAGES) {
    throw new OratlasMystError(
      "too-many-pages",
      `Project declares ${unique.length} pages, more than the ${MAX_PAGES} page cap.`,
    );
  }

  return {
    pages: unique.map((path) => ({
      path,
      absolutePath: resolveInsideProject(projectRoot, path),
    })),
    skipped,
    source,
  };
}
