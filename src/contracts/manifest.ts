import { z } from "zod";
import { safeRelativePathSchema } from "./paths.js";
import { httpsUrlSchema, sha256HexSchema } from "./primitives.js";

/** Schema version of `oratlas.manifest.json`. */
export const MANIFEST_SCHEMA_VERSION = "0.2.0";

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

/**
 * `oratlas.manifest.json` — the portable ORAtlas interoperability and
 * discovery document for one built publication.
 *
 * This manifest is deliberately small. It carries no canonical ORAtlas graph
 * identity, no assessment, no TRUST score, no verification state, no
 * discussion, no aggregate and no executable declaration. Everything mutable
 * or federated belongs to ORAtlas; see `SPEC.md` §"Non-goals".
 */
export const oratlasManifestSchema = z
  .object({
    schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
    generator: generatorSchema,
    publication: publicationSchema,
    adapter: adapterSchema,
    artifacts: artifactsSchema,
    oratlas: oratlasSectionSchema.optional(),
  })
  .strict();
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
