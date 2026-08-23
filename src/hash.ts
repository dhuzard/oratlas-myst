import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { CLAIM_RECORD_SCHEMA_VERSION } from "./contracts/claims.js";

/**
 * Canonical SHA-256 hex digest over UTF-8 text.
 *
 * Identical to ORAtlas's `sha256` helper: producers and verifiers on both
 * sides must share exactly this function.
 */
export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Inputs to the claim-declaration digest. Nothing positional belongs here. */
export interface ClaimDeclarationDigestInput {
  /** Source-local claim identifier. */
  id: string;
  /** The directive body exactly as written in the source, verbatim. */
  body: string;
  claimType?: string | undefined;
  qualification?: string | undefined;
}

/**
 * SHA-256 over the canonical JSON of a claim declaration.
 *
 * The digest covers the author's declaration and nothing else: the identifier,
 * the verbatim body source, and the declared type and qualification. It
 * deliberately excludes the document path, the line span, the surrounding page
 * and the rest of the publication, so it changes if and only if the
 * declaration itself changes.
 *
 * This digest is a content digest. It is *not* a claim identity: two
 * publications that happen to contain byte-identical declarations are not
 * thereby asserting the same claim, and a changed digest does not mean a
 * different scientific claim. See `SPEC.md` §"Identity".
 */
export function claimDeclarationSha256(input: ClaimDeclarationDigestInput): string {
  return sha256(
    canonicalJson({
      schemaVersion: CLAIM_RECORD_SCHEMA_VERSION,
      id: input.id,
      body: input.body,
      claimType: input.claimType,
      qualification: input.qualification,
    }),
  );
}
