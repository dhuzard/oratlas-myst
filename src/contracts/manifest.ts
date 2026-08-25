import { z } from "zod";
import { safeRelativePathSchema } from "./paths.js";
import { httpsUrlSchema, sha256HexSchema } from "./primitives.js";

/** Current schema version of `oratlas.manifest.json`. */
export const MANIFEST_SCHEMA_VERSION = "0.3.0";
/** Frozen legacy manifest schema, retained as an acceptance contract. */
export const LEGACY_MANIFEST_SCHEMA_VERSION = "0.2.0";
export const SUPPORTED_MANIFEST_SCHEMA_VERSIONS = [
  LEGACY_MANIFEST_SCHEMA_VERSION,
  MANIFEST_SCHEMA_VERSION,
] as const;

/**
 * Who owns the semantic content of the claim records.
 *
 * - `publication-source` — the MyST source is the only claim declaration in
 *   this publication, so each record carries `text` (and any declared
 *   `claimType`/`qualification`).
 * - `review-manifest` — the publication also ships an ORAtlas
 *   `review-manifest.json` that declares claims through its own
 *   `artifacts.claims` stream. That stream is authoritative for claim text and
 *   attributes; the records here then carry only the source occurrence binding
 *   and omit `text`, `claimType` and `qualification`.
 */
export const claimDeclarationAuthoritySchema = z.enum(["publication-source", "review-manifest"]);
export type ClaimDeclarationAuthority = z.infer<typeof claimDeclarationAuthoritySchema>;

export const generatorSchema = z
  .object({
    name: z.string().min(1).max(120),
    version: z.string().min(1).max(60),
  })
  .strict();

/**
 * Which authoring toolchain produced this publication, and where its native
 * cross-reference machinery lives.
 *
 * This is a discriminated union so the same manifest shape can describe a
 * JATS, Quarto or other adapter later without ORAtlas's ingestion contract
 * hard-coding a MyST concept. ORAtlas normalises every variant into one
 * generic source-occurrence representation; the canonical graph never learns
 * which toolchain a publication was authored in.
 */
export const mystAdapterSchema = z
  .object({
    type: z.literal("myst"),
    /**
     * Manifest-relative path of MyST's own cross-reference inventory. This
     * adapter never reproduces or rewrites `myst.xref.json`; it only points at
     * it so a consumer can resolve a claim target to a published location.
     */
    xref: safeRelativePathSchema,
  })
  .strict();

export const adapterSchema = z.discriminatedUnion("type", [mystAdapterSchema]);
export type Adapter = z.infer<typeof adapterSchema>;

/**
 * Where the publication's exact source bytes can be obtained.
 *
 * A consumer that can resolve this descriptor reaches **source-byte
 * verification**: it can check `documentSha256`, `blockSha256` and the
 * raw-source selectors in each claim record. A consumer that cannot is limited
 * to **published-structure verification**. See `SPEC.md` §"Verification
 * levels".
 *
 * A discriminated union, so a DOI deposit, an archived bundle and a git
 * repository are distinguishable rather than being flattened into a URL that a
 * consumer has to guess the meaning of.
 */
export const gitSourceSchema = z
  .object({
    type: z.literal("git"),
    repository: httpsUrlSchema,
    /**
     * Exact commit the published bytes came from, as a full SHA-1 or SHA-256
     * object id. Optional because it is usually only knowable at build time;
     * `oratlas-myst export --source-commit <sha>` supplies it in CI.
     */
    commit: z
      .string()
      .regex(/^[0-9a-f]{40}$|^[0-9a-f]{64}$/, "Must be a full lowercase git object id.")
      .optional(),
    /** Human-readable ref the commit was built from, e.g. a tag. */
    ref: z.string().min(1).max(200).optional(),
  })
  .strict();

export const doiSourceSchema = z
  .object({
    type: z.literal("doi"),
    /**
     * DOI of this exact version. Bare form (`10.xxxx/suffix`), no `doi:` or
     * resolver prefix, matching ORAtlas's normalisation rule.
     */
    versionDoi: z.string().regex(/^10\.\d{4,9}\/\S+$/, "Must be a bare DOI (10.xxxx/suffix)."),
    /**
     * DOI of the publication across versions. ORAtlas requires version and
     * concept DOIs to stay distinct; they are never collapsed here either.
     */
    conceptDoi: z
      .string()
      .regex(/^10\.\d{4,9}\/\S+$/, "Must be a bare DOI (10.xxxx/suffix).")
      .optional(),
  })
  .strict();

export const archiveSourceSchema = z
  .object({
    type: z.literal("archive"),
    /** Immutable https URL of a source bundle. */
    url: httpsUrlSchema,
    /** SHA-256 over the bundle's bytes. */
    sha256: sha256HexSchema,
    /** Bundle format, e.g. `zip` or `tar.gz`. */
    format: z.string().min(1).max(40).optional(),
  })
  .strict();

export const publicationSourceSchema = z.discriminatedUnion("type", [
  gitSourceSchema,
  doiSourceSchema,
  archiveSourceSchema,
]);
export type PublicationSource = z.infer<typeof publicationSourceSchema>;

/**
 * Identity of this exact publication version.
 *
 * `sourcesSha256` is always present and is computed from the publication's own
 * bytes, so an exact version identity exists even for a web-only publication
 * with no repository, no DOI and no archive.
 */
export const publicationVersionSchema = z
  .object({
    /**
     * SHA-256 over the canonical JSON of the publication's document set:
     * every processed page as `{ path, sha256 }`, sorted by path. It changes
     * when any page changes, is added, or is removed. See `SPEC.md` §5.1.
     */
    sourcesSha256: sha256HexSchema,
    /** Author-declared version label, e.g. `v1.2.0` or `2026-08-23`. */
    label: z.string().min(1).max(120).optional(),
  })
  .strict();
export type PublicationVersion = z.infer<typeof publicationVersionSchema>;

export const publicationSchema = z
  .object({
    /**
     * Source-local publication identifier, stable across versions of the same
     * publication. Like a claim id, it is declared by the author and is *not*
     * an ORAtlas canonical identifier: the adapter never mints one.
     */
    id: z.string().min(1).max(200).optional(),
    /** Absolute https URL the built publication is served from, if declared. */
    canonicalUrl: httpsUrlSchema.optional(),
    /** Publication title, read from the MyST project configuration. */
    title: z.string().min(1).max(500).optional(),
    version: publicationVersionSchema,
    source: publicationSourceSchema.optional(),
  })
  .strict();

export const claimsArtifactSchema = z
  .object({
    path: safeRelativePathSchema,
    format: z.literal("jsonl"),
    /** Number of records in the artifact. */
    records: z.number().int().nonnegative().max(1_000_000),
    /** SHA-256 over the complete UTF-8 bytes of the artifact file. */
    sha256: sha256HexSchema,
    declarations: claimDeclarationAuthoritySchema,
  })
  .strict();
export type ClaimsArtifact = z.infer<typeof claimsArtifactSchema>;

export const artifactsSchema = z
  .object({
    claims: claimsArtifactSchema,
  })
  .strict();

export const oratlasSectionSchema = z
  .object({
    /**
     * Manifest-relative path of an existing ORAtlas `review-manifest.json`
     * shipped by this publication. Declaring it means the richer manifest is
     * authoritative for everything it already covers; nothing it declares is
     * restated here.
     */
    reviewManifest: safeRelativePathSchema,
  })
  .strict();

export const CONTRIBUTOR_KINDS = ["person", "organization"] as const;
export const contributorKindSchema = z.enum(CONTRIBUTOR_KINDS);

export const CONTRIBUTOR_ROLES = [
  "author",
  "corresponding-author",
  "editor",
  "group-author",
  "contributor",
  "other",
] as const;
export const contributorRoleSchema = z.enum(CONTRIBUTOR_ROLES);

export const CONTRIBUTOR_IDENTIFIER_SCHEMES = ["orcid", "ror", "isni", "other"] as const;
export const contributorIdentifierSchemeSchema = z.enum(CONTRIBUTOR_IDENTIFIER_SCHEMES);

export const contributorSourceKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, {
    message:
      "Must start with an alphanumeric character and contain only letters, digits, '.', '_', ':' or '-'.",
  });

/** ISO 7064 MOD 11-2 check used by ORCID; validation is entirely offline. */
export function isValidOrcid(value: string): boolean {
  if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(value)) return false;
  const compact = value.replaceAll("-", "");
  let total = 0;
  for (const digit of compact.slice(0, 15)) total = (total + Number(digit)) * 2;
  const result = (12 - (total % 11)) % 11;
  return compact.at(-1) === (result === 10 ? "X" : String(result));
}

export const contributorIdentifierSchema = z
  .object({
    scheme: contributorIdentifierSchemeSchema,
    value: z.string().trim().min(1).max(300),
  })
  .strict()
  .superRefine((identifier, context) => {
    if (identifier.scheme === "orcid" && !isValidOrcid(identifier.value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Must be a valid bare ORCID (0000-0000-0000-0000) with a valid check digit.",
      });
    }
  });

const contributorCommonShape = {
  sourceContributorKey: contributorSourceKeySchema,
  displayName: z.string().trim().min(1).max(300),
  identifiers: z.array(contributorIdentifierSchema).max(20).optional(),
  affiliations: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
  roles: z.array(contributorRoleSchema).min(1).max(6),
  position: z.number().int().positive().max(500),
  publicUrl: httpsUrlSchema.optional(),
} as const;

const personContributorSchema = z
  .object({
    kind: z.literal("person"),
    ...contributorCommonShape,
    givenName: z.string().trim().min(1).max(200).optional(),
    familyName: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

const organizationContributorSchema = z
  .object({
    kind: z.literal("organization"),
    ...contributorCommonShape,
  })
  .strict();

export const contributorSchema = z
  .discriminatedUnion("kind", [personContributorSchema, organizationContributorSchema])
  .superRefine((contributor, context) => {
    const invalidIdentifierScheme = contributor.identifiers?.find(
      (identifier) =>
        (contributor.kind === "person" && identifier.scheme === "ror") ||
        (contributor.kind === "organization" && identifier.scheme === "orcid"),
    );
    if (invalidIdentifierScheme) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["identifiers"],
        message:
          contributor.kind === "person"
            ? "ROR identifies an organization, not a person contributor."
            : "ORCID identifies a person, not an organization contributor.",
      });
    }
    for (const [path, values] of [
      [
        "identifiers",
        (contributor.identifiers ?? []).map(
          (identifier) => `${identifier.scheme}:${identifier.value}`,
        ),
      ],
      ["affiliations", contributor.affiliations ?? []],
      ["roles", contributor.roles],
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [path],
          message: `${path} must not contain duplicates.`,
        });
      }
    }
  });
export type Contributor = z.infer<typeof contributorSchema>;

/** Ordered exact-version scholarly-credit declarations. */
export const contributorsSchema = z
  .array(contributorSchema)
  .max(500)
  .superRefine((contributors, context) => {
    const keys = new Set<string>();
    contributors.forEach((contributor, index) => {
      if (keys.has(contributor.sourceContributorKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "sourceContributorKey"],
          message: "Source contributor keys must be unique within a publication version.",
        });
      }
      if (contributor.position !== index + 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "position"],
          message: "Contributor positions must be contiguous and match declared array order.",
        });
      }
      keys.add(contributor.sourceContributorKey);
    });
  });

export const PRODUCTION_MODES = [
  "human",
  "ai-assisted",
  "agentic",
  "hybrid",
  "unspecified",
] as const;
export const productionModeSchema = z.enum(PRODUCTION_MODES);

export const PRODUCTION_ACTOR_KINDS = [
  "person",
  "organization",
  "software",
  "workflow",
  "ai-system",
] as const;
export const productionActorKindSchema = z.enum(PRODUCTION_ACTOR_KINDS);

export const PRODUCTION_ACTIVITIES = [
  "study-design",
  "evidence-search",
  "evidence-synthesis",
  "data-analysis",
  "drafting",
  "authoring",
  "editing",
  "reviewing",
  "figure-generation",
  "code-generation",
  "other",
] as const;
export const productionActivitySchema = z.enum(PRODUCTION_ACTIVITIES);

export const productionActorSchema = z
  .object({
    id: contributorSourceKeySchema,
    kind: productionActorKindSchema,
    name: z.string().trim().min(1).max(300).optional(),
    identifier: z.string().trim().min(1).max(500).optional(),
    version: z.string().trim().min(1).max(120).optional(),
    provider: z.string().trim().min(1).max(200).optional(),
    model: z.string().trim().min(1).max(200).optional(),
    modelVersion: z.string().trim().min(1).max(120).optional(),
    publicUrl: httpsUrlSchema.optional(),
    activities: z.array(productionActivitySchema).min(1).max(11),
  })
  .strict()
  .superRefine((actor, context) => {
    if (actor.name === undefined && actor.identifier === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["name"],
        message: "A production actor requires a declared name or identifier.",
      });
    }
    if (new Set(actor.activities).size !== actor.activities.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activities"],
        message: "activities must not contain duplicates.",
      });
    }
  });
export type ProductionActor = z.infer<typeof productionActorSchema>;

export const productionSchema = z
  .object({
    sourceAssertionKey: contributorSourceKeySchema,
    strength: z.literal("source-declared"),
    mode: productionModeSchema,
    actors: z.array(productionActorSchema).max(64),
    statement: z.string().trim().min(1).max(5_000).optional(),
    publicEvidenceUrl: httpsUrlSchema.optional(),
  })
  .strict()
  .superRefine((production, context) => {
    const ids = new Set<string>();
    production.actors.forEach((actor, index) => {
      if (ids.has(actor.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["actors", index, "id"],
          message: "Production actor ids must be unique within an assertion.",
        });
      }
      ids.add(actor.id);
    });
  });
export type Production = z.infer<typeof productionSchema>;

/**
 * `oratlas.manifest.json` — the portable ORAtlas interoperability and
 * discovery document for one built publication.
 *
 * This manifest is deliberately small. It carries no canonical ORAtlas graph
 * identity, no assessment, no TRUST score, no verification state, no
 * discussion, no aggregate and no executable declaration. Everything mutable
 * or federated belongs to ORAtlas; see `SPEC.md` §"Non-goals".
 */
export const oratlasManifestV020Schema = z
  .object({
    schemaVersion: z.literal(LEGACY_MANIFEST_SCHEMA_VERSION),
    generator: generatorSchema,
    publication: publicationSchema,
    adapter: adapterSchema,
    artifacts: artifactsSchema,
    oratlas: oratlasSectionSchema.optional(),
  })
  .strict();
export type OratlasManifestV020 = z.infer<typeof oratlasManifestV020Schema>;

export const oratlasManifestV030Schema = z
  .object({
    schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
    generator: generatorSchema,
    publication: publicationSchema,
    adapter: adapterSchema,
    artifacts: artifactsSchema,
    oratlas: oratlasSectionSchema.optional(),
    contributors: contributorsSchema.optional(),
    production: productionSchema.optional(),
  })
  .strict();
export type OratlasManifestV030 = z.infer<typeof oratlasManifestV030Schema>;

/** Closed, version-discriminated acceptance contract for 0.2.0 and 0.3.0. */
export const oratlasManifestSchema = z.discriminatedUnion("schemaVersion", [
  oratlasManifestV020Schema,
  oratlasManifestV030Schema,
]);
export type OratlasManifest = z.infer<typeof oratlasManifestSchema>;

/**
 * Minimal *recognition* schema for an existing ORAtlas `review-manifest.json`.
 *
 * This is intentionally not a reimplementation of ORAtlas's
 * `reviewManifestSchema`: the authoritative contract lives in ORAtlas and is
 * not the portable protocol boundary. Only the fields this adapter actually
 * reads are described, and unknown keys pass through untouched so a newer
 * review manifest is never rejected here.
 */
export const recognizedReviewManifestSchema = z
  .object({
    schemaVersion: z.string().min(1).max(40),
    review: z
      .object({ title: z.string().min(1).max(500).optional() })
      .passthrough()
      .optional(),
    artifacts: z
      .object({
        claims: safeRelativePathSchema.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type RecognizedReviewManifest = z.infer<typeof recognizedReviewManifestSchema>;
