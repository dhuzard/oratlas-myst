import type { MystPlugin } from "myst-common";
import { claimDirective } from "./directive.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./version.js";

/**
 * The `@oratlas/myst` MyST plugin.
 *
 * v0.1 uses only extension points current MyST actually supports: a directive
 * that rewrites itself into standard MyST AST. It registers no custom renderer
 * (MyST does not yet support renderer plugin hooks), injects no remote
 * JavaScript, and performs no network access during a build.
 */
const plugin: MystPlugin = {
  name: PACKAGE_NAME,
  author: "ORAtlas contributors",
  license: "MIT",
  directives: [claimDirective],
  roles: [],
  transforms: [],
};

export { PACKAGE_NAME, PACKAGE_VERSION };
export default plugin;
