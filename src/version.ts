/**
 * Package identity, kept as a literal rather than read from `package.json`.
 *
 * The single-file plugin artifact is bundled and may be loaded by MyST from a
 * release URL with no `package.json` beside it, and the generated manifest
 * must not depend on where the code happens to be installed. A drift test
 * (`tests/schemas.test.ts`) keeps these in step with `package.json`.
 */
export const PACKAGE_NAME = "@neuronautix/myst";
export const PACKAGE_VERSION = "0.2.1";
