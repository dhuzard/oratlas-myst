import { z } from "zod";

/** Lowercase hexadecimal SHA-256 digest. */
export const sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Must be a lowercase hexadecimal SHA-256 digest.");

/**
 * Source-local claim identifier.
 *
 * The identifier is written by the author and is only meaningful inside one
 * publication. It is deliberately restricted to the normalized form MyST uses
 * for cross-reference labels, so that the identifier the author writes, the
 * MyST target identifier, the generated HTML id and the `claims.jsonl` record
 * id are all the same string. Nothing is normalized silently: an identifier
 * that is not already in this form is rejected, with the normalized form
 * suggested back to the author.
 */
export const LOCAL_CLAIM_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
export const MAX_LOCAL_CLAIM_ID_LENGTH = 120;

export const localClaimIdSchema = z
  .string()
  .min(1)
  .max(MAX_LOCAL_CLAIM_ID_LENGTH)
  .regex(
    LOCAL_CLAIM_ID_RE,
    "Must start with a lowercase letter or digit and contain only lowercase letters, digits, '.', '_' or '-'.",
  );

/** Absolute `https://` URL, matching ORAtlas's publication URL rule. */
export const httpsUrlSchema = z
  .string()
  .max(2_000)
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "Must be an absolute https:// URL.");

/** W3C text selectors count Unicode code points, not UTF-16 code units. */
export function unicodeCodePointLength(value: string): number {
  return Array.from(value).length;
}

const selectorTextSchema = (maximum: number) =>
  z.string().refine((value) => unicodeCodePointLength(value) <= maximum, {
    message: `Text must contain at most ${maximum} Unicode code points.`,
  });

export const MAX_SELECTOR_EXACT_CODE_POINTS = 2_000;
export const MAX_SELECTOR_CONTEXT_CODE_POINTS = 256;
/** Context window emitted by this generator; matches ORAtlas's own convention. */
export const SELECTOR_CONTEXT_CODE_POINTS = 96;

/**
 * W3C Web Annotation `TextQuoteSelector`, in exactly the shape ORAtlas's
 * `textQuoteSelectorSchema` accepts (a strict object: no extra keys). Keeping
 * this object shape pure is deliberate — see `docs/integration-oratlas.md`.
 */
export const textQuoteSelectorSchema = z
  .object({
    type: z.literal("TextQuoteSelector"),
    exact: selectorTextSchema(MAX_SELECTOR_EXACT_CODE_POINTS).refine(
      (value) => unicodeCodePointLength(value) > 0,
      { message: "Exact text cannot be empty." },
    ),
    prefix: selectorTextSchema(MAX_SELECTOR_CONTEXT_CODE_POINTS).optional(),
    suffix: selectorTextSchema(MAX_SELECTOR_CONTEXT_CODE_POINTS).optional(),
  })
  .strict();
export type TextQuoteSelector = z.infer<typeof textQuoteSelectorSchema>;

/**
 * W3C Web Annotation `TextPositionSelector`, in exactly the shape ORAtlas's
 * `textPositionSelectorSchema` accepts.
 */
export const textPositionSelectorSchema = z
  .object({
    type: z.literal("TextPositionSelector"),
    start: z.number().int().nonnegative().max(10_000_000),
    end: z.number().int().positive().max(10_000_000),
  })
  .strict()
  .refine((selector) => selector.end > selector.start, {
    message: "Text position end must be greater than start.",
    path: ["end"],
  });
export type TextPositionSelector = z.infer<typeof textPositionSelectorSchema>;
