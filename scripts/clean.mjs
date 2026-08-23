#!/usr/bin/env node
/**
 * Remove build output.
 *
 * A Node script rather than `rm -rf`, which is not available on a default
 * Windows shell. This package is meant to be installable and buildable by any
 * MyST author, on any platform they happen to author on.
 */
import { rmSync } from "node:fs";

for (const target of ["dist"]) {
  rmSync(target, { recursive: true, force: true });
}
