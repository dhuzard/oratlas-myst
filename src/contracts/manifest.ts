import { z } from "zod";
import { safeRelativePathSchema } from "./paths.js";
import { httpsUrlSchema, sha256HexSchema } from "./primitives.js";

/** Schema version of `oratlas.manifest.json`. */
export const MANIFEST_SCHEMA_VERSION = "0.1.0";

/**
 * Who owns the semantic content of the claim records.
 *
 * - `publication-source` — the MyST source is the only claim declaration in
 *   this publication, so each record carries `text` (and any declared
 *   `claimType`/`qualification`).
 * - `review-manifest` — the publication also ships an ORAtlas
 *   `review-manifest.json` that declares claims through its own
 *   `artifacts.claims` stream. That stream is authoritative for claim text and
 *   attributes; the records here then carry only the MyST source occurrence
 *   binding and omit `text`, `claimType` and `qualification`.
 */
export const claimDeclarationAuthoritySchema = z.enum(["publication-source", "review-manifest"]);
export type ClaimDeclarationAuthority = z.infer<typeof claimDeclarationAuthoritySchema>;

export const generatorSchema = z
  .object({
    name: z.string().min(1).max(120),
    version: z.string().min(1).max(60),
  })
  .strict();

export const publicationSchema = z
  .object({
    /** Absolute https URL the built publication is served from, if declared. */
    canonicalUrl: httpsUrlSchema.optional(),
    /** Publication title, read from the MyST project configuration. */
    title: z.string().min(1).max(500).optional(),
  })
  .strict();

export const mystSectionSchema = z
  .object({
    /**
     * Manifest-relative path of MyST's own cross-reference inventory. This
     * adapter never reproduces or rewrites `myst.xref.json`; it only points at
     * it so a consumer can resolve a claim target to a published location.
     */
    xref: safeRelativePathSchema,
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
 * discovery document for one built MyST publication.
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
    myst: mystSectionSchema,
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
