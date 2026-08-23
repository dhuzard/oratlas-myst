import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { OratlasMystError } from "./errors.js";
import {
  isSafeLocalPath,
  isSafeRelativePath,
  SAFE_LOCAL_PATH_MESSAGE,
  SAFE_RELATIVE_PATH_MESSAGE,
} from "./contracts/paths.js";
import { httpsUrlSchema } from "./contracts/primitives.js";

export const MYST_CONFIG_FILE = "myst.yml";
export const ORATLAS_CONFIG_FILE = "oratlas.yml";
export const DEFAULT_OUTPUT_DIR = ".oratlas";

/** Largest configuration file this adapter will read. */
export const MAX_CONFIG_BYTES = 1_000_000;

export interface OratlasConfig {
  /** Absolute https URL the built publication is served from. */
  canonicalUrl?: string;
  /** Project-relative directory the generated artifacts are written to. */
  output: string;
  /**
   * Project-relative path of an existing ORAtlas `review-manifest.json`. When
   * set, that manifest keeps authority over everything it already declares.
   */
  reviewManifest?: string;
  /** Publication title; defaults to the MyST project title. */
  title?: string;
}

export interface MystProjectConfig {
  /** Raw parsed `myst.yml`. */
  raw: Record<string, unknown>;
  title?: string;
  /** `project.toc`, if the project declares one. */
  toc?: unknown;
  /** `project.static_files`, if the project declares any. */
  staticFiles: string[];
}

export interface LoadedConfig {
  /** Absolute path of the MyST project root (the directory holding `myst.yml`). */
  projectRoot: string;
  myst: MystProjectConfig;
  oratlas: OratlasConfig;
  /** True when an `oratlas.yml` was present. */
  hasOratlasConfig: boolean;
}

function readTextFileBounded(path: string, what: string): string {
  const stats = statSync(path);
  if (!stats.isFile()) {
    throw new OratlasMystError("config-not-a-file", `${what} is not a regular file: ${path}`);
  }
  if (stats.size > MAX_CONFIG_BYTES) {
    throw new OratlasMystError(
      "config-too-large",
      `${what} is larger than ${MAX_CONFIG_BYTES} bytes: ${path}`,
    );
  }
  return readFileSync(path, "utf8");
}

function parseYamlObject(text: string, path: string, what: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (error) {
    throw new OratlasMystError(
      "config-unparsable",
      `${what} is not valid YAML: ${path}`,
      error instanceof Error ? error.message : String(error),
    );
  }
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new OratlasMystError(
      "config-not-a-mapping",
      `${what} must contain a YAML mapping at the top level: ${path}`,
    );
  }
  return parsed as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Read and validate `myst.yml` from a project root. */
export function loadMystConfig(projectRoot: string): MystProjectConfig {
  const path = join(projectRoot, MYST_CONFIG_FILE);
  if (!fileExists(path)) {
    throw new OratlasMystError(
      "myst-config-missing",
      `No ${MYST_CONFIG_FILE} found in ${projectRoot}.`,
      "Run oratlas-myst from a MyST project directory, or pass --project <dir>.",
    );
  }
  const raw = parseYamlObject(readTextFileBounded(path, MYST_CONFIG_FILE), path, MYST_CONFIG_FILE);
  const project = asRecord(raw.project) ?? {};
  const title = typeof project.title === "string" ? project.title : undefined;
  return {
    raw,
    ...(title ? { title } : {}),
    toc: project.toc,
    staticFiles: asStringArray(project.static_files),
  };
}

/**
 * Read the optional `oratlas.yml`.
 *
 * Configuration lives in a dedicated file rather than under a namespaced key
 * in `myst.yml`: MyST validates project keys strictly and prints
 * `extra key ignored` for anything it does not know, so a namespaced block
 * would emit a warning on every single build. See `docs/architecture.md`.
 */
export function loadOratlasConfig(projectRoot: string): {
  config: OratlasConfig;
  present: boolean;
} {
  const path = join(projectRoot, ORATLAS_CONFIG_FILE);
  const defaults: OratlasConfig = { output: DEFAULT_OUTPUT_DIR };
  if (!fileExists(path)) {
    return { config: defaults, present: false };
  }
  const raw = parseYamlObject(
    readTextFileBounded(path, ORATLAS_CONFIG_FILE),
    path,
    ORATLAS_CONFIG_FILE,
  );

  const known = new Set(["canonical_url", "output", "review_manifest", "title"]);
  const unknown = Object.keys(raw).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new OratlasMystError(
      "oratlas-config-unknown-key",
      `${ORATLAS_CONFIG_FILE} contains unknown key(s): ${unknown.sort().join(", ")}.`,
      `Known keys: ${[...known].sort().join(", ")}.`,
    );
  }

  const config: OratlasConfig = { ...defaults };

  if (raw.canonical_url !== undefined) {
    if (typeof raw.canonical_url !== "string") {
      throw new OratlasMystError(
        "oratlas-config-invalid",
        `${ORATLAS_CONFIG_FILE}: 'canonical_url' must be a string.`,
      );
    }
    const parsed = httpsUrlSchema.safeParse(raw.canonical_url);
    if (!parsed.success) {
      throw new OratlasMystError(
        "oratlas-config-invalid",
        `${ORATLAS_CONFIG_FILE}: 'canonical_url' must be an absolute https:// URL.`,
        `Received: ${raw.canonical_url}`,
      );
    }
    config.canonicalUrl = parsed.data;
  }

  if (raw.output !== undefined) {
    if (typeof raw.output !== "string" || !isSafeLocalPath(raw.output)) {
      throw new OratlasMystError(
        "oratlas-config-invalid",
        `${ORATLAS_CONFIG_FILE}: 'output' must be a safe project-relative directory path.`,
        SAFE_LOCAL_PATH_MESSAGE,
      );
    }
    config.output = raw.output;
  }

  if (raw.review_manifest !== undefined) {
    if (typeof raw.review_manifest !== "string" || !isSafeRelativePath(raw.review_manifest)) {
      throw new OratlasMystError(
        "oratlas-config-invalid",
        `${ORATLAS_CONFIG_FILE}: 'review_manifest' must be a safe project-relative file path.`,
        SAFE_RELATIVE_PATH_MESSAGE,
      );
    }
    config.reviewManifest = raw.review_manifest;
  }

  if (raw.title !== undefined) {
    if (typeof raw.title !== "string" || raw.title.trim().length === 0) {
      throw new OratlasMystError(
        "oratlas-config-invalid",
        `${ORATLAS_CONFIG_FILE}: 'title' must be a non-empty string.`,
      );
    }
    config.title = raw.title.trim();
  }

  return { config, present: true };
}

/** Load both configuration files for a project root. */
export function loadConfig(projectRoot: string): LoadedConfig {
  const myst = loadMystConfig(projectRoot);
  const { config, present } = loadOratlasConfig(projectRoot);
  return { projectRoot, myst, oratlas: config, hasOratlasConfig: present };
}

/**
 * The `.oratlas` output directory is a build artifact, so it must never be
 * mistaken for publication source. The default is gitignored; this predicate
 * keeps page discovery from walking into it whatever it is named.
 */
export function isOutputPath(relativePath: string, outputDir: string): boolean {
  return relativePath === outputDir || relativePath.startsWith(`${outputDir}/`);
}
