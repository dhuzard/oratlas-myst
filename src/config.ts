import { parse as parseYaml } from "yaml";
import { OratlasMystError } from "./errors.js";
import {
  isSafeLocalPath,
  isSafeRelativePath,
  SAFE_LOCAL_PATH_MESSAGE,
  SAFE_RELATIVE_PATH_MESSAGE,
} from "./contracts/paths.js";
import { publicationSourceSchema, type PublicationSource } from "./contracts/manifest.js";
import { httpsUrlSchema } from "./contracts/primitives.js";
import { projectFileExists, readProjectFile } from "./fs-safe.js";

export const MYST_CONFIG_FILE = "myst.yml";
export const ORATLAS_CONFIG_FILE = "oratlas.yml";
export const DEFAULT_OUTPUT_DIR = ".oratlas";

/** Largest configuration file this adapter will read. */
export const MAX_CONFIG_BYTES = 1_000_000;

export interface OratlasConfig {
  /** Source-local publication identifier, stable across versions. */
  id?: string;
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
  /** Author-declared version label for this publication version. */
  versionLabel?: string;
  /** Where this publication's exact source bytes can be obtained. */
  source?: PublicationSource;
}

export interface MystProjectConfig {
  /** Raw parsed `myst.yml`. */
  raw: Record<string, unknown>;
  title?: string;
  /** `project.id`, used as the default source-local publication identifier. */
  id?: string;
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

/**
 * Read a configuration file through the same safe-path discipline as every
 * other publication file.
 *
 * `myst.yml` and `oratlas.yml` are publication input like any other: if the
 * security model says publication input is untrusted, a symlinked config file
 * pointing outside the project must be refused rather than read.
 */
function readConfigFile(projectRoot: string, fileName: string): string {
  return readProjectFile(projectRoot, fileName, MAX_CONFIG_BYTES);
}

function parseYamlObject(text: string, what: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (error) {
    throw new OratlasMystError(
      "config-unparsable",
      `${what} is not valid YAML.`,
      error instanceof Error ? error.message : String(error),
    );
  }
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new OratlasMystError(
      "config-not-a-mapping",
      `${what} must contain a YAML mapping at the top level.`,
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

/** Read and validate `myst.yml` from a project root. */
export function loadMystConfig(projectRoot: string): MystProjectConfig {
  if (!projectFileExists(projectRoot, MYST_CONFIG_FILE)) {
    throw new OratlasMystError(
      "myst-config-missing",
      `No ${MYST_CONFIG_FILE} found in ${projectRoot}.`,
      "Run oratlas-myst from a MyST project directory, or pass --project <dir>.",
    );
  }
  const raw = parseYamlObject(readConfigFile(projectRoot, MYST_CONFIG_FILE), MYST_CONFIG_FILE);
  const project = asRecord(raw.project) ?? {};
  const title = typeof project.title === "string" ? project.title : undefined;
  const id = typeof project.id === "string" && project.id.trim() ? project.id.trim() : undefined;
  return {
    raw,
    ...(title ? { title } : {}),
    ...(id ? { id } : {}),
    toc: project.toc,
    staticFiles: asStringArray(project.static_files),
  };
}

function invalid(message: string, detail?: string): OratlasMystError {
  return new OratlasMystError(
    "oratlas-config-invalid",
    `${ORATLAS_CONFIG_FILE}: ${message}`,
    detail,
  );
}

function readString(raw: Record<string, unknown>, key: string, max: number): string | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid(`'${key}' must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw invalid(`'${key}' must be at most ${max} characters.`);
  }
  return trimmed;
}

/**
 * Validate the `source:` block.
 *
 * The block is passed to the contract's discriminated union rather than being
 * re-validated by hand, so the config surface and the emitted manifest can
 * never disagree about what a valid source descriptor is.
 */
function readSource(raw: Record<string, unknown>): PublicationSource | undefined {
  if (raw.source === undefined) return undefined;
  const record = asRecord(raw.source);
  if (!record) {
    throw invalid("'source' must be a mapping.");
  }
  if (typeof record.type !== "string") {
    throw invalid("'source.type' is required.", "Expected one of: git, doi, archive.");
  }
  const parsed = publicationSourceSchema.safeParse(record);
  if (!parsed.success) {
    throw invalid(
      `'source' is not a valid ${String(record.type)} source descriptor.`,
      parsed.error.issues
        .map((issue) => `source.${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; "),
    );
  }
  return parsed.data;
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
  const defaults: OratlasConfig = { output: DEFAULT_OUTPUT_DIR };
  if (!projectFileExists(projectRoot, ORATLAS_CONFIG_FILE)) {
    return { config: defaults, present: false };
  }
  const raw = parseYamlObject(
    readConfigFile(projectRoot, ORATLAS_CONFIG_FILE),
    ORATLAS_CONFIG_FILE,
  );

  const known = new Set([
    "id",
    "canonical_url",
    "output",
    "review_manifest",
    "title",
    "version_label",
    "source",
  ]);
  const unknown = Object.keys(raw).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new OratlasMystError(
      "oratlas-config-unknown-key",
      `${ORATLAS_CONFIG_FILE} contains unknown key(s): ${unknown.sort().join(", ")}.`,
      `Known keys: ${[...known].sort().join(", ")}.`,
    );
  }

  const config: OratlasConfig = { ...defaults };

  const id = readString(raw, "id", 200);
  if (id) config.id = id;

  const title = readString(raw, "title", 500);
  if (title) config.title = title;

  const versionLabel = readString(raw, "version_label", 120);
  if (versionLabel) config.versionLabel = versionLabel;

  const canonicalUrl = readString(raw, "canonical_url", 2_000);
  if (canonicalUrl) {
    const parsed = httpsUrlSchema.safeParse(canonicalUrl);
    if (!parsed.success) {
      throw invalid(
        "'canonical_url' must be an absolute https:// URL.",
        `Received: ${canonicalUrl}`,
      );
    }
    config.canonicalUrl = parsed.data;
  }

  if (raw.output !== undefined) {
    if (typeof raw.output !== "string" || !isSafeLocalPath(raw.output)) {
      throw invalid(
        "'output' must be a safe project-relative directory path.",
        SAFE_LOCAL_PATH_MESSAGE,
      );
    }
    config.output = raw.output;
  }

  if (raw.review_manifest !== undefined) {
    if (typeof raw.review_manifest !== "string" || !isSafeRelativePath(raw.review_manifest)) {
      throw invalid(
        "'review_manifest' must be a safe project-relative file path.",
        SAFE_RELATIVE_PATH_MESSAGE,
      );
    }
    config.reviewManifest = raw.review_manifest;
  }

  const source = readSource(raw);
  if (source) config.source = source;

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
