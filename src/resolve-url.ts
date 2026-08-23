/**
 * Resolve a published claim location from the manifest and MyST's inventory.
 *
 * The subtlety this exists to remove: `myst.xref.json` `url` values are
 * **site-root-relative absolute paths** (`/`, `/results`), not paths relative
 * to the publication. Resolving one directly against a canonical URL that has
 * a path component silently discards that path:
 *
 * ```js
 * new URL("/results", "https://example.org/review/").href
 * // → "https://example.org/results"    ← wrong, the /review/ prefix is gone
 * ```
 *
 * Every publication deployed under a subpath — a GitHub Pages project site, a
 * journal hosting many articles — hits this. The canonical URL is the site
 * root for that publication, so the leading slash has to be stripped first.
 */
export function resolvePublishedUrl(
  canonicalUrl: string,
  xrefUrl: string,
  htmlId?: string,
): string {
  // A canonical URL naming a directory must end in "/", or the last segment is
  // treated as a file name and replaced during resolution.
  const base = canonicalUrl.endsWith("/") ? canonicalUrl : `${canonicalUrl}/`;
  const relative = xrefUrl.replace(/^\/+/, "");
  const url = new URL(relative, base);
  if (htmlId) url.hash = htmlId;
  return url.href;
}
