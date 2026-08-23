import { z } from "zod";

/**
 * Safe publication-relative path validation.
 *
 * Every path that appears in an ORAtlas interoperability artifact addresses a
 * file *inside* the publication. A consumer (ORAtlas, a crawler, a local
 * validator) resolves these paths against a base directory or a base URL, so
 * they must never escape that base or smuggle in a URL scheme.
 *
 * The rule below is intentionally byte-for-byte compatible with ORAtlas's own
 * `isSafeRepoRelativePath` so that a path emitted here can be handed straight
 * to ORAtlas's `review-manifest.json` validator without translation. That
 * compatibility is why a `./` prefix is rejected: `.` is not a legal segment
 * in ORAtlas's rule.
 */
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

export const MAX_RELATIVE_PATH_LENGTH = 512;

export function isSafeRelativePath(path: unknown): path is string {
  if (typeof path !== "string" || path.length === 0 || path.length > MAX_RELATIVE_PATH_LENGTH) {
    return false;
  }
  if (CONTROL_CHARS_RE.test(path)) return false;
  if (path.includes("\\") || path.includes(":")) return false;
  if (path.startsWith("/") || path.startsWith("~")) return false;
  for (const segment of path.split("/")) {
    if (segment === "" || segment === "." || segment === "..") return false;
    if (!SEGMENT_RE.test(segment)) return false;
  }
  return true;
}

export const SAFE_RELATIVE_PATH_MESSAGE =
  "Must be a safe publication-relative path: no absolute paths, no '.' or '..' segments, no leading './', no backslashes, no URL schemes.";

export const safeRelativePathSchema = z
  .string()
  .max(MAX_RELATIVE_PATH_LENGTH)
  .refine(isSafeRelativePath, { message: SAFE_RELATIVE_PATH_MESSAGE });

/**
 * Safe *local* path validation, for paths that stay on the author's machine.
 *
 * Local paths — the output directory, a TOC entry — are never resolved by a
 * consumer, so they only need to be safe to open: they must not escape the
 * project, name a device, or smuggle in a scheme. They may therefore be
 * dot-directories (`.oratlas`), underscore-prefixed (`_pages/intro.md`) or
 * non-ASCII, all of which the published-path rule above deliberately rejects
 * because ORAtlas's own path validator would reject them.
 */
export function isSafeLocalPath(path: unknown): path is string {
  if (typeof path !== "string" || path.length === 0 || path.length > MAX_RELATIVE_PATH_LENGTH) {
    return false;
  }
  if (CONTROL_CHARS_RE.test(path)) return false;
  if (path.includes("\\") || path.includes(":")) return false;
  if (path.startsWith("/") || path.startsWith("~")) return false;
  for (const segment of path.split("/")) {
    if (segment === "" || segment === "." || segment === "..") return false;
  }
  return true;
}

export const SAFE_LOCAL_PATH_MESSAGE =
  "Must be a safe project-relative path: no absolute paths, no '..' segments, no backslashes, no URL schemes.";
