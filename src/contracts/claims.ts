import { z } from "zod";
import { safeRelativePathSchema } from "./paths.js";
import {
  localClaimIdSchema,
  sha256HexSchema,
  textPositionSelectorSchema,
  textQuoteSelectorSchema,
} from "./primitives.js";

/** Schema version of a single `oratlas/claims.jsonl` record. */
export const CLAIM_RECORD_SCHEMA_VERSION = "0.1.0";

/**
 * The frame that `selector.textQuote` and `selector.textPosition` are
 * expressed in: the raw UTF-8 source text of `source.documentPath`, addressed
 * as a sequence of Unicode code points, exactly as covered by
 * `source.documentSha256`.
 *
 * This is *not* ORAtlas's `myst-rendered-text-v1` frame, which is expressed
 * over ORAtlas's own rendering of the page. The two are deliberately distinct
 * and are never interchangeable.
 */
export const SELECTOR_REPRESENTATION = "oratlas-myst-source-utf8-v1";

/**
 * Which span of the source the selector quotes.
 *
 * - `body`  — the directive body exactly as written in the source. Used
 *             whenever the body appears verbatim inside the directive block,
 *             which is the case for every unindented directive.
 * - `block` — the complete directive block, opening and closing fences
 *             included. Used when the body could not be located verbatim
 *             (a directive nested inside another block is dedented by MyST),
 *             so that the quoted span is still byte-exact.
 */
export const selectorUnitSchema = z.enum(["body", "block"]);
export type SelectorUnit = z.infer<typeof selectorUnitSchema>;

/**
 * Claim types recognised by ORAtlas (`CLAIM_TYPES` in `@oratlas/contracts`).
 * The list is append-only upstream; an unrecognised value is rejected here so
 * that a typo does not silently become an unusable graph attribute.
 */
export const CLAIM_TYPES = [
  "empirical",
  "mechanistic",
  "methodological",
  "theoretical",
  "normative",
  "summary",
  "other",
  "synthesis",
  "model-derived",
  "translational",
] as const;
export const claimTypeSchema = z.enum(CLAIM_TYPES);
export type ClaimType = z.infer<typeof claimTypeSchema>;

/** Where in the publication source the claim occurrence lives. */
export const claimSourceSchema = z
  .object({
    /** Publication-relative path of the MyST document declaring the claim. */
    documentPath: safeRelativePathSchema,
    /**
     * SHA-256 over the complete UTF-8 bytes of that document. Byte-identical
     * to ORAtlas's `PassageCommentAnchor.sourceSha256` for the same file.
     */
    documentSha256: sha256HexSchema,
    /** 1-based, inclusive line span of the directive block in that document. */
    startLine: z.number().int().positive().max(10_000_000),
    endLine: z.number().int().positive().max(10_000_000),
    /**
     * SHA-256 over the exact source text of lines `startLine`..`endLine`,
     * joined with `\n` and with no trailing newline.
     */
    blockSha256: sha256HexSchema,
  })
  .strict()
  .refine((source) => source.endLine >= source.startLine, {
    message: "endLine must be greater than or equal to startLine.",
    path: ["endLine"],
  });
export type ClaimSource = z.infer<typeof claimSourceSchema>;

/** The MyST cross-reference target the claim is addressable by. */
export const claimTargetSchema = z
  .object({
    /** MyST target identifier; equal to the record `id`. */
    identifier: localClaimIdSchema,
    /** DOM id MyST generates for that identifier in a web build. */
    htmlId: z.string().min(1).max(300),
  })
  .strict();
export type ClaimTarget = z.infer<typeof claimTargetSchema>;

export const claimSelectorSchema = z
  .object({
    representation: z.literal(SELECTOR_REPRESENTATION),
    unit: selectorUnitSchema,
    textQuote: textQuoteSelectorSchema,
    textPosition: textPositionSelectorSchema,
  })
  .strict();
export type ClaimSelector = z.infer<typeof claimSelectorSchema>;

/**
 * One `oratlas/claims.jsonl` record: a single explicit claim declaration in
 * one exact version of one MyST publication.
 *
 * A record describes an *occurrence*. It carries no ORAtlas canonical
 * identity, no assessment, no verification state and no cross-version
 * continuity. See `SPEC.md` §"Identity".
 */
export const claimRecordSchema = z
  .object({
    schemaVersion: z.literal(CLAIM_RECORD_SCHEMA_VERSION),
    /** Source-local claim identifier written by the author. */
    id: localClaimIdSchema,
    /**
     * Plain-text rendering of the claim body, derived from the parsed MyST
     * AST. Absent when the manifest delegates claim declarations to a
     * `review-manifest.json` (see `artifacts.claims.declarations`).
     */
    text: z.string().min(1).max(5_000).optional(),
    /** Author-declared claim type. Delegated with `text`. */
    claimType: claimTypeSchema.optional(),
    /** Author-declared scope/qualification of the claim. Delegated with `text`. */
    qualification: z.string().min(1).max(2_000).optional(),
    target: claimTargetSchema,
    source: claimSourceSchema,
    selector: claimSelectorSchema,
    /**
     * SHA-256 over the canonical JSON of the claim declaration inputs alone
     * (id, verbatim body source, claim type, qualification). Independent of
     * the document path, the line span and the rest of the page.
     */
    declarationSha256: sha256HexSchema,
  })
  .strict()
  .superRefine((record, ctx) => {
    if (record.target.identifier !== record.id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "target.identifier must equal the record id.",
        path: ["target", "identifier"],
      });
    }
  });
export type ClaimRecord = z.infer<typeof claimRecordSchema>;
