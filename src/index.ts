/**
 * `@neuronautix/myst` — a portable MyST ↔ ORAtlas interoperability adapter.
 *
 * The default export is the MyST plugin. Everything else on this module is the
 * programmatic surface behind the `oratlas-myst` CLI.
 */
import plugin from "./plugin.js";

export default plugin;

export { PACKAGE_NAME, PACKAGE_VERSION } from "./version.js";

export {
  CLAIM_DATA_KEY,
  CLAIM_DIRECTIVE_NAME,
  CLAIM_NODE_CLASS,
  CLAIM_NODE_TYPE,
  buildClaimNode,
  claimDirective,
  readClaimDirectiveOptions,
} from "./directive.js";
export type { ClaimDirectiveOptions, ClaimNodeData } from "./directive.js";

export * from "./contracts/index.js";

export { canonicalJson, compareStrings } from "./canonical-json.js";
export { claimDeclarationSha256, sha256 } from "./hash.js";
export type { ClaimDeclarationDigestInput } from "./hash.js";

export { OratlasMystError, isOratlasMystError } from "./errors.js";

export {
  DEFAULT_OUTPUT_DIR,
  MYST_CONFIG_FILE,
  ORATLAS_CONFIG_FILE,
  loadConfig,
  loadMystConfig,
  loadOratlasConfig,
} from "./config.js";
export type { LoadedConfig, MystProjectConfig, OratlasConfig } from "./config.js";

export { discoverPages, readProjectFile, resolveInsideProject } from "./project.js";
export type { DiscoveredPages, ProjectPage } from "./project.js";

export { claimBodyToText } from "./claim-text.js";
export { contributorsFromMyst } from "./contributors.js";
export { indexLines, parseDocument } from "./parse-claims.js";
export type { ClaimOccurrence, ClaimProblem, ParsedDocument } from "./parse-claims.js";

export { CLAIMS_ARTIFACT_PATH, MANIFEST_FILE_NAME, exportProject } from "./export.js";
export type { ExportOptions, ExportResult } from "./export.js";

export { resolvePublishedUrl } from "./resolve-url.js";

export { validateProject } from "./validate.js";
export type { ValidateOptions, ValidationIssue, ValidationResult } from "./validate.js";

export { inspectProject } from "./inspect.js";
export type { InspectResult, InspectedClaim, InspectedDocument } from "./inspect.js";

export { readReviewManifest } from "./review-manifest.js";
export type { RecognizedReviewManifestResult } from "./review-manifest.js";
