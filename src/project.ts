import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { compareStrings } from "./canonical-json.js";
import { isOutputPath, MYST_CONFIG_FILE, type LoadedConfig } from "./config.js";
import { isSafeLocalPath, SAFE_LOCAL_PATH_MESSAGE } from "./contracts/paths.js";
import { OratlasMystError } from "./errors.js";

/** MyST source extensions this adapter parses in v0.1. */
export const SUPPORTED_EXTENSIONS = [".md"] as const;

/**
 * Extensions MyST itself can build but this adapter does not parse in v0.1.
 * A page in one of these formats is reported, never silently dropped.
 */
export const UNSUPPORTED_PAGE_EXTENSIONS = [".ipynb", ".tex", ".myst.json"] as const;

/** Directories never walked during discovery. */
const IGNORED_DIRECTORIES = new Set(["node_modules", "_build", "_static", "_templates"]);

/** Largest source document this adapter will read. */
export const MAX_DOCUMENT_BYTES = 8_000_000;
/** Largest number of pages this adapter will process. */
export const MAX_PAGES = 5_000;

export interface ProjectPage {
  /** Project-relative POSIX path, e.g. `results.md`. */
  path: string;
  /** Absolute path on disk. */
  absolutePath: string;
}

export interface DiscoveredPages {
  pages: ProjectPage[];
  /** Pages declared in the TOC that this version cannot parse. */
  skipped: { path: string; reason: string }[];
  /** How the page list was determined. */
  source: "toc" | "discovery";
}

function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

/**
 * Resolve a project-relative path to an absolute path, refusing anything that
 * escapes the project root.
 *
 * Publication input is untrusted: a TOC entry, a configured artifact path or a
 * static-file entry may be adversarial. Resolution is checked twice — once on
 * the lexical path and once on the real path after symlink resolution — so a
 * symlink inside the project cannot be used to read outside it.
 */
export function resolveInsideProject(projectRoot: string, relativePath: string): string {
  if (isAbsolute(relativePath)) {
    throw new OratlasMystError(
      "unsafe-path",
      `Path must be project-relative, not absolute: ${relativePath}`,
    );
  }
  const root = resolve(projectRoot);
  const resolved = resolve(root, relativePath);
  const rel = relative(root, resolved);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new OratlasMystError(
      "unsafe-path",
      `Path escapes the project root: ${relativePath}`,
      `Resolved to ${resolved}, outside ${root}.`,
    );
  }
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    realRoot = root;
  }
  let realResolved: string;
  try {
    realResolved = realpathSync(resolved);
  } catch {
    // The target does not exist yet; the lexical check above already applies.
    return resolved;
  }
  const realRel = relative(realRoot, realResolved);
  if (realRel !== "" && (realRel.startsWith("..") || isAbsolute(realRel))) {
    throw new OratlasMystError(
      "unsafe-path",
      `Path resolves outside the project root through a symlink: ${relativePath}`,
      `Resolved to ${realResolved}, outside ${realRoot}.`,
    );
  }
  return resolved;
}

/** Read a project file with a size cap, rejecting non-regular files. */
export function readProjectFile(
  projectRoot: string,
  relativePath: string,
  maxBytes: number = MAX_DOCUMENT_BYTES,
): string {
  const absolutePath = resolveInsideProject(projectRoot, relativePath);
  const stats = statSync(absolutePath);
  if (!stats.isFile()) {
    throw new OratlasMystError("not-a-file", `Not a regular file: ${relativePath}`);
  }
  if (stats.size > maxBytes) {
    throw new OratlasMystError(
      "file-too-large",
      `File is larger than the ${maxBytes} byte cap: ${relativePath}`,
    );
  }
  return readFileSync(absolutePath, "utf8");
}

function hasSupportedExtension(path: string): boolean {
  return SUPPORTED_EXTENSIONS.some((extension) => path.endsWith(extension));
}

function unsupportedExtension(path: string): string | undefined {
  return UNSUPPORTED_PAGE_EXTENSIONS.find((extension) => path.endsWith(extension));
}

function existsAsFile(projectRoot: string, relativePath: string): boolean {
  try {
    return statSync(resolveInsideProject(projectRoot, relativePath)).isFile();
  } catch {
    return false;
  }
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

function walkForPages(projectRoot: string, outputDir: string): string[] {
  const found: string[] = [];
  const walk = (directory: string, prefix: string): void => {
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
        // lstat semantics: never follow a symlink out of the project.
        stats = statSync(absolute);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        walk(absolute, relativePath);
      } else if (stats.isFile() && hasSupportedExtension(name)) {
        found.push(relativePath);
      }
    }
  };
  walk(resolve(projectRoot), "");
  return found;
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
          reason: `${unsupported} pages are not parsed by @oratlas/myst v0.1`,
        });
        continue;
      }
      let candidate = normalized;
      if (!hasSupportedExtension(candidate)) {
        // MyST allows TOC entries without an extension.
        const withExtension = `${candidate}.md`;
        if (existsAsFile(projectRoot, withExtension)) {
          candidate = withExtension;
        } else {
          skipped.push({ path: normalized, reason: "not a Markdown page" });
          continue;
        }
      }
      if (!existsAsFile(projectRoot, candidate)) {
        throw new OratlasMystError(
          "toc-page-missing",
          `TOC declares a page that does not exist: ${candidate}`,
        );
      }
      ordered.push(candidate);
    }
  } else {
    source = "discovery";
    ordered.push(...walkForPages(projectRoot, oratlas.output));
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
