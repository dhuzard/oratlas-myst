import { parse as parseYaml } from "yaml";
import { OratlasMystError } from "./errors.js";
import {
  isSafeLocalPath,
  isSafeRelativePath,
  SAFE_LOCAL_PATH_MESSAGE,
  SAFE_RELATIVE_PATH_MESSAGE,
} from "./contracts/paths.js";
import {
  contributorsSchema,
  LEGACY_MANIFEST_SCHEMA_VERSION,
  MANIFEST_SCHEMA_VERSION,
  productionSchema,
  publicationSourceSchema,
  type Contributor,
  type Production,
  type PublicationSource,
} from "./contracts/manifest.js";
import { httpsUrlSchema } from "./contracts/primitives.js";
import { projectFileExists, readProjectFile } from "./fs-safe.js";

export const MYST_CONFIG_FILE = "myst.yml";
export const ORATLAS_CONFIG_FILE = "oratlas.yml";
export const DEFAULT_OUTPUT_DIR = ".oratlas";

/** Largest configuration file this adapter will read. */
export const MAX_CONFIG_BYTES = 1_000_000;

export interface OratlasConfig {
  /** Explicit export protocol. Omitted means the package's current protocol. */
  schemaVersion?: typeof LEGACY_MANIFEST_SCHEMA_VERSION | typeof MANIFEST_SCHEMA_VERSION;
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
  /** Explicit scholarly-credit declarations; overrides MyST project authors when present. */
  contributors?: Contributor[];
  /** Explicit source-declared production provenance. Never inferred. */
  production?: Production;
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
  /** Standard MyST project-level author metadata, retained raw for deterministic mapping. */
  authors?: unknown[];
  /** Standard MyST affiliation declarations used by author references. */
  affiliations?: unknown[];
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
    ...(Array.isArray(project.authors) ? { authors: project.authors } : {}),
    ...(Array.isArray(project.affiliations) ? { affiliations: project.affiliations } : {}),
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

function assertKnownKeys(
  record: Record<string, unknown>,
  known: readonly string[],
  where: string,
): void {
  const allowed = new Set(known);
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw invalid(`${where} contains unknown key(s): ${unknown.sort().join(", ")}.`);
  }
}

function readContributors(raw: Record<string, unknown>): Contributor[] | undefined {
  if (raw.contributors === undefined) return undefined;
  if (!Array.isArray(raw.contributors)) {
    throw invalid("'contributors' must be an array.");
  }
  const mapped = raw.contributors.map((entry, index) => {
    const where = `contributors[${index}]`;
    const contributor = asRecord(entry);
    if (!contributor) throw invalid(`${where} must be a mapping.`);
    assertKnownKeys(
      contributor,
      [
        "key",
        "kind",
        "name",
        "given_name",
        "family_name",
        "orcid",
        "ror",
        "identifiers",
        "affiliations",
        "roles",
        "position",
        "url",
      ],
      where,
    );
    const identifiers = Array.isArray(contributor.identifiers)
      ? [...contributor.identifiers]
      : contributor.identifiers === undefined
        ? []
        : contributor.identifiers;
    if (!Array.isArray(identifiers)) {
      throw invalid(`${where}.identifiers must be an array.`);
    }
    if (contributor.orcid !== undefined) {
      identifiers.push({ scheme: "orcid", value: contributor.orcid });
    }
    if (contributor.ror !== undefined) {
      identifiers.push({ scheme: "ror", value: contributor.ror });
    }
    return {
      sourceContributorKey: contributor.key,
      kind: contributor.kind,
      displayName: contributor.name,
      ...(contributor.given_name === undefined ? {} : { givenName: contributor.given_name }),
      ...(contributor.family_name === undefined ? {} : { familyName: contributor.family_name }),
      ...(identifiers.length === 0 ? {} : { identifiers }),
      ...(contributor.affiliations === undefined ? {} : { affiliations: contributor.affiliations }),
      roles: contributor.roles,
      position: contributor.position ?? index + 1,
      ...(contributor.url === undefined ? {} : { publicUrl: contributor.url }),
    };
  });
  const parsed = contributorsSchema.safeParse(mapped);
  if (!parsed.success) {
    throw invalid(
      "'contributors' is not a valid scholarly contributor declaration.",
      parsed.error.issues
        .map((issue) => `contributors.${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; "),
    );
  }
  return parsed.data;
}

function readProduction(raw: Record<string, unknown>): Production | undefined {
  if (raw.production === undefined) return undefined;
  const value = asRecord(raw.production);
  if (!value) throw invalid("'production' must be a mapping.");
  assertKnownKeys(
    value,
    ["source_assertion_key", "mode", "actors", "statement", "public_evidence_url"],
    "production",
  );
  if (!Array.isArray(value.actors)) throw invalid("'production.actors' must be an array.");
  const actors = value.actors.map((entry, index) => {
    const actor = asRecord(entry);
    const where = `production.actors[${index}]`;
    if (!actor) throw invalid(`${where} must be a mapping.`);
    assertKnownKeys(
      actor,
      [
        "id",
        "kind",
        "name",
        "identifier",
        "version",
        "provider",
        "model",
        "model_version",
        "url",
        "activities",
      ],
      where,
    );
    return {
      id: actor.id,
      kind: actor.kind,
      ...(actor.name === undefined ? {} : { name: actor.name }),
      ...(actor.identifier === undefined ? {} : { identifier: actor.identifier }),
      ...(actor.version === undefined ? {} : { version: actor.version }),
      ...(actor.provider === undefined ? {} : { provider: actor.provider }),
      ...(actor.model === undefined ? {} : { model: actor.model }),
      ...(actor.model_version === undefined ? {} : { modelVersion: actor.model_version }),
      ...(actor.url === undefined ? {} : { publicUrl: actor.url }),
      activities: actor.activities,
    };
  });
  const parsed = productionSchema.safeParse({
    sourceAssertionKey: value.source_assertion_key ?? "publication-production",
    strength: "source-declared",
    mode: value.mode,
    actors,
    ...(value.statement === undefined ? {} : { statement: value.statement }),
    ...(value.public_evidence_url === undefined
      ? {}
      : { publicEvidenceUrl: value.public_evidence_url }),
  });
  if (!parsed.success) {
    throw invalid(
      "'production' is not a valid source declaration.",
      parsed.error.issues
        .map((issue) => `production.${issue.path.join(".") || "(root)"}: ${issue.message}`)
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
    "schema_version",
    "id",
    "canonical_url",
    "output",
    "review_manifest",
    "title",
    "version_label",
    "source",
    "contributors",
    "production",
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

  if (raw.schema_version !== undefined) {
    if (
      raw.schema_version !== LEGACY_MANIFEST_SCHEMA_VERSION &&
      raw.schema_version !== MANIFEST_SCHEMA_VERSION
    ) {
      throw invalid(
        `'schema_version' must be '${LEGACY_MANIFEST_SCHEMA_VERSION}' or '${MANIFEST_SCHEMA_VERSION}'.`,
      );
    }
    config.schemaVersion = raw.schema_version;
  }

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

  const contributors = readContributors(raw);
  if (contributors !== undefined) config.contributors = contributors;

  const production = readProduction(raw);
  if (production) config.production = production;

  if (
    config.schemaVersion === LEGACY_MANIFEST_SCHEMA_VERSION &&
    (config.contributors !== undefined || config.production !== undefined)
  ) {
    throw invalid(
      `'schema_version: ${LEGACY_MANIFEST_SCHEMA_VERSION}' cannot declare contributors or production.`,
      `Use schema_version: ${MANIFEST_SCHEMA_VERSION} for the additive declarations.`,
    );
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
