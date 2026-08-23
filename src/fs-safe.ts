import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { OratlasMystError } from "./errors.js";

/** Largest source document this adapter will read. */
export const MAX_DOCUMENT_BYTES = 8_000_000;

/**
 * Resolve a project-relative path to an absolute path, refusing anything that
 * escapes the project root.
 *
 * Publication input is untrusted: a TOC entry, a configuration value, a
 * declared artifact path or even `myst.yml` itself may be adversarial.
 * Resolution is checked twice — once on the lexical path, and again on the
 * real path after symlink resolution — so a symlink cannot be used to read
 * outside the project.
 *
 * A symlink that stays *inside* the project is allowed here, because every
 * caller of this function is acting on an explicit author declaration (a TOC
 * entry, a configured path). Directory *discovery* is different and refuses
 * symlinks outright; see `walkForPages` in `project.ts`.
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

/**
 * Read a project file with a size cap, rejecting anything that is not a
 * regular file and anything that resolves outside the project.
 */
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

/**
 * True when a project-relative path exists and is a regular file.
 *
 * A path that escapes the project is *not* reported as "absent": that would
 * turn a refused traversal into a confusing "file not found", and would let a
 * symlinked config file be silently ignored rather than refused. Only a
 * genuine absence returns false; an unsafe path still throws.
 */
export function projectFileExists(projectRoot: string, relativePath: string): boolean {
  const absolutePath = resolveInsideProject(projectRoot, relativePath);
  try {
    return statSync(absolutePath).isFile();
  } catch {
    return false;
  }
}

/**
 * True when the path is a symbolic link.
 *
 * `lstatSync`, not `statSync`: the whole point is to see the link itself
 * rather than what it points at.
 */
export function isSymbolicLink(absolutePath: string): boolean {
  try {
    return lstatSync(absolutePath).isSymbolicLink();
  } catch {
    return false;
  }
}
