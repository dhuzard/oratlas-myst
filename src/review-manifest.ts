import { compareStrings } from "./canonical-json.js";
import {
  recognizedReviewManifestSchema,
  type RecognizedReviewManifest,
} from "./contracts/index.js";
import { OratlasMystError } from "./errors.js";
import { readProjectFile } from "./project.js";

/** Largest JSONL artifact this adapter will read from a publication. */
export const MAX_ARTIFACT_BYTES = 32_000_000;
/** Largest number of records read from a source JSONL artifact. */
export const MAX_ARTIFACT_RECORDS = 200_000;

export interface RecognizedReviewManifestResult {
  path: string;
  manifest: RecognizedReviewManifest;
  /** Claim ids declared by the review manifest's own claims artifact. */
  declaredClaimIds: Set<string>;
  /** Path of that claims artifact, if the manifest declares one. */
  claimsArtifactPath?: string;
  notes: string[];
}

/**
 * Read an existing ORAtlas `review-manifest.json` shipped by the publication.
 *
 * This is *recognition*, not reinterpretation. The manifest is parsed only far
 * enough to learn which claim ids it already declares, so this adapter can
 * avoid restating facts the richer manifest already owns. Nothing in it is
 * rewritten, upgraded, or copied into the generated artifacts, and an
 * unrecognised newer field is passed over rather than rejected.
 */
export function readReviewManifest(
  projectRoot: string,
  relativePath: string,
): RecognizedReviewManifestResult {
  let text: string;
  try {
    text = readProjectFile(projectRoot, relativePath);
  } catch (error) {
    if (error instanceof OratlasMystError) throw error;
    throw new OratlasMystError(
      "review-manifest-unreadable",
      `Declared review manifest could not be read: ${relativePath}`,
      error instanceof Error ? error.message : String(error),
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new OratlasMystError(
      "review-manifest-unparsable",
      `Declared review manifest is not valid JSON: ${relativePath}`,
      error instanceof Error ? error.message : String(error),
    );
  }

  const result = recognizedReviewManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new OratlasMystError(
      "review-manifest-invalid",
      `Declared review manifest does not look like an ORAtlas review manifest: ${relativePath}`,
      result.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; "),
    );
  }

  const manifest = result.data;
  const notes: string[] = [];
  const claimsArtifactPath = manifest.artifacts?.claims;
  const declaredClaimIds = new Set<string>();

  if (claimsArtifactPath) {
    const records = readJsonlIds(projectRoot, claimsArtifactPath);
    for (const id of records.ids) declaredClaimIds.add(id);
    notes.push(
      `Review manifest declares ${records.ids.length} claim id(s) in ${claimsArtifactPath}; that artifact keeps authority over claim text and attributes.`,
    );
    if (records.skipped > 0) {
      notes.push(
        `${records.skipped} line(s) in ${claimsArtifactPath} carried no usable string "id" and were ignored.`,
      );
    }
  } else {
    notes.push(
      `Review manifest declares no claims artifact; claim declarations stay owned by the MyST source.`,
    );
  }

  return {
    path: relativePath,
    manifest,
    declaredClaimIds,
    ...(claimsArtifactPath ? { claimsArtifactPath } : {}),
    notes,
  };
}

/**
 * Read the `id` field of every record in a source JSONL artifact.
 *
 * Only the identifier is read. This adapter deliberately does not validate,
 * normalise or re-emit the rest of an ORAtlas-owned record: those are source
 * assertions in ORAtlas's own format and reinterpreting them here would create
 * a second, divergent authority.
 */
function readJsonlIds(
  projectRoot: string,
  relativePath: string,
): { ids: string[]; skipped: number } {
  let text: string;
  try {
    text = readProjectFile(projectRoot, relativePath, MAX_ARTIFACT_BYTES);
  } catch (error) {
    if (error instanceof OratlasMystError) throw error;
    throw new OratlasMystError(
      "artifact-unreadable",
      `Declared claims artifact could not be read: ${relativePath}`,
      error instanceof Error ? error.message : String(error),
    );
  }

  const ids: string[] = [];
  let skipped = 0;
  const lines = text.split("\n");
  if (lines.length > MAX_ARTIFACT_RECORDS) {
    throw new OratlasMystError(
      "artifact-too-many-records",
      `Declared claims artifact has more than ${MAX_ARTIFACT_RECORDS} lines: ${relativePath}`,
    );
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let record: unknown;
    try {
      record = JSON.parse(trimmed);
    } catch {
      skipped += 1;
      continue;
    }
    const id = (record as { id?: unknown } | null)?.id;
    if (typeof id === "string" && id.length > 0) ids.push(id);
    else skipped += 1;
  }
  ids.sort(compareStrings);
  return { ids, skipped };
}
