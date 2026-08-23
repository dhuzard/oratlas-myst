import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHtmlId } from "myst-common";
import { compareStrings } from "./canonical-json.js";
import { loadConfig, type LoadedConfig } from "./config.js";
import {
  CLAIM_RECORD_SCHEMA_VERSION,
  MANIFEST_SCHEMA_VERSION,
  SELECTOR_REPRESENTATION,
  claimRecordSchema,
  oratlasManifestSchema,
  type ClaimDeclarationAuthority,
  type ClaimRecord,
  type OratlasManifest,
} from "./contracts/index.js";
import { OratlasMystError } from "./errors.js";
import { claimDeclarationSha256, sha256 } from "./hash.js";
import { parseDocument, type ClaimProblem } from "./parse-claims.js";
import { discoverPages, readProjectFile, resolveInsideProject } from "./project.js";
import { readReviewManifest, type RecognizedReviewManifestResult } from "./review-manifest.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./version.js";

/** Manifest file name, published at the root of the built site. */
export const MANIFEST_FILE_NAME = "oratlas.manifest.json";
/** Claims artifact path, relative to the manifest. */
export const CLAIMS_ARTIFACT_PATH = "oratlas/claims.jsonl";

export interface ExportOptions {
  /** MyST project root; defaults to the current working directory. */
  projectRoot?: string;
  /** Write the artifacts to disk. When false, everything is computed in memory. */
  write?: boolean;
}

export interface ExportResult {
  config: LoadedConfig;
  manifest: OratlasManifest;
  claims: ClaimRecord[];
  /** Exact bytes written (or that would be written) for each artifact. */
  files: { path: string; content: string }[];
  /** Absolute path of the output directory. */
  outputDir: string;
  /** Non-fatal observations worth showing the author. */
  notes: string[];
  reviewManifest?: RecognizedReviewManifestResult;
}

function formatProblems(documentPath: string, problems: ClaimProblem[]): string {
  return problems
    .map(
      (problem) => `${documentPath}${problem.line ? `:${problem.line}` : ""}: ${problem.message}`,
    )
    .join("\n");
}

/**
 * Serialize records as JSONL.
 *
 * One canonical record per line, LF-terminated including the final line, so
 * the file is append-safe and its digest is stable. Records are written with
 * `JSON.stringify` over an explicitly ordered object rather than through
 * `canonicalJson`, so the field order stays human-readable while remaining
 * fully deterministic.
 */
function serializeJsonl(records: ClaimRecord[]): string {
  if (records.length === 0) return "";
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

/**
 * Build one claim record in a fixed key order.
 *
 * Key order is fixed by construction here rather than by sorting, because the
 * artifact is read by humans as often as by machines. Determinism comes from
 * the order being a constant of this function.
 */
function buildClaimRecord(
  occurrence: ReturnType<typeof parseDocument>["claims"][number],
  documentPath: string,
  documentSha256: string,
  declarations: ClaimDeclarationAuthority,
): ClaimRecord {
  const { options, selector } = occurrence;
  const delegated = declarations === "review-manifest";
  const htmlId = createHtmlId(options.id) ?? options.id;

  const record: ClaimRecord = {
    schemaVersion: CLAIM_RECORD_SCHEMA_VERSION,
    id: options.id,
    ...(delegated ? {} : { text: occurrence.text }),
    ...(delegated || !options.claimType ? {} : { claimType: options.claimType }),
    ...(delegated || !options.qualification ? {} : { qualification: options.qualification }),
    target: { identifier: options.id, htmlId },
    source: {
      documentPath,
      documentSha256,
      startLine: occurrence.startLine,
      endLine: occurrence.endLine,
      blockSha256: sha256(occurrence.blockSource),
    },
    selector: {
      representation: SELECTOR_REPRESENTATION,
      unit: selector.unit,
      textQuote: {
        type: "TextQuoteSelector",
        exact: selector.exact,
        ...(selector.prefix ? { prefix: selector.prefix } : {}),
        ...(selector.suffix ? { suffix: selector.suffix } : {}),
      },
      textPosition: { type: "TextPositionSelector", start: selector.start, end: selector.end },
    },
    declarationSha256: claimDeclarationSha256({
      id: options.id,
      body: occurrence.bodySource,
      claimType: options.claimType,
      qualification: options.qualification,
    }),
  };

  const parsed = claimRecordSchema.safeParse(record);
  if (!parsed.success) {
    throw new OratlasMystError(
      "claim-record-invalid",
      `Generated claim record for "${options.id}" does not satisfy the claim record schema.`,
      parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; "),
    );
  }
  return parsed.data;
}

/**
 * Export a MyST publication's ORAtlas interoperability artifacts.
 *
 * The export is offline and deterministic: identical source bytes and
 * configuration produce identical output bytes. It never contacts ORAtlas,
 * never dereferences a remote URL, and fails on any semantic error rather than
 * guessing.
 */
export function exportProject(options: ExportOptions = {}): ExportResult {
  const projectRoot = options.projectRoot ?? process.cwd();
  const config = loadConfig(projectRoot);
  const notes: string[] = [];

  const discovered = discoverPages(config);
  for (const skip of discovered.skipped) {
    notes.push(`Skipped page ${skip.path}: ${skip.reason}.`);
  }
  if (discovered.source === "discovery") {
    notes.push(
      "myst.yml declares no project.toc; pages were discovered by walking the project directory.",
    );
  }

  let reviewManifest: RecognizedReviewManifestResult | undefined;
  let declarations: ClaimDeclarationAuthority = "publication-source";
  if (config.oratlas.reviewManifest) {
    reviewManifest = readReviewManifest(projectRoot, config.oratlas.reviewManifest);
    notes.push(...reviewManifest.notes);
    if (reviewManifest.claimsArtifactPath) declarations = "review-manifest";
  }

  const records: ClaimRecord[] = [];
  const firstSeen = new Map<string, string>();
  const problems: string[] = [];

  for (const page of discovered.pages) {
    const source = readProjectFile(projectRoot, page.path);
    const documentSha256 = sha256(source);
    const parsed = parseDocument(source, page.path);
    if (parsed.problems.length > 0) {
      problems.push(formatProblems(page.path, parsed.problems));
      continue;
    }
    for (const occurrence of parsed.claims) {
      const id = occurrence.options.id;
      const previous = firstSeen.get(id);
      if (previous !== undefined) {
        problems.push(
          `Duplicate claim id "${id}": declared in ${previous} and again in ${page.path}:${occurrence.startLine}. Source-local claim ids must be unique across the whole publication.`,
        );
        continue;
      }
      firstSeen.set(id, `${page.path}:${occurrence.startLine}`);
      records.push(buildClaimRecord(occurrence, page.path, documentSha256, declarations));
    }
  }

  if (problems.length > 0) {
    throw new OratlasMystError(
      "claim-declarations-invalid",
      `Found ${problems.length} problem(s) in the publication's claim declarations.`,
      problems.join("\n"),
    );
  }

  if (reviewManifest?.claimsArtifactPath) {
    const missing = records
      .map((record) => record.id)
      .filter((id) => !reviewManifest.declaredClaimIds.has(id))
      .sort(compareStrings);
    if (missing.length > 0) {
      throw new OratlasMystError(
        "review-manifest-claim-unknown",
        `${missing.length} claim(s) declared in the MyST source are not declared by ${reviewManifest.claimsArtifactPath}.`,
        `The review manifest owns claim declarations for this publication, so every \`oratlas:claim\` id must exist there. Missing: ${missing.join(", ")}.`,
      );
    }
    const unbound = [...reviewManifest.declaredClaimIds]
      .filter((id) => !firstSeen.has(id))
      .sort(compareStrings);
    if (unbound.length > 0) {
      notes.push(
        `${unbound.length} claim(s) declared by ${reviewManifest.claimsArtifactPath} have no \`oratlas:claim\` occurrence in the MyST source and therefore no source binding: ${unbound.join(", ")}.`,
      );
    }
  }

  // Deterministic order: document path, then position in that document, then
  // id. Reading order is preserved and the ordering never depends on the host
  // locale or on filesystem enumeration order.
  records.sort(
    (left, right) =>
      compareStrings(left.source.documentPath, right.source.documentPath) ||
      left.source.startLine - right.source.startLine ||
      compareStrings(left.id, right.id),
  );

  const claimsContent = serializeJsonl(records);
  const title = config.oratlas.title ?? config.myst.title;

  const manifest: OratlasManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generator: { name: PACKAGE_NAME, version: PACKAGE_VERSION },
    publication: {
      ...(config.oratlas.canonicalUrl ? { canonicalUrl: config.oratlas.canonicalUrl } : {}),
      ...(title ? { title } : {}),
    },
    myst: { xref: "myst.xref.json" },
    artifacts: {
      claims: {
        path: CLAIMS_ARTIFACT_PATH,
        format: "jsonl",
        records: records.length,
        sha256: sha256(claimsContent),
        declarations,
      },
    },
    ...(config.oratlas.reviewManifest
      ? { oratlas: { reviewManifest: config.oratlas.reviewManifest } }
      : {}),
  };

  const validated = oratlasManifestSchema.safeParse(manifest);
  if (!validated.success) {
    throw new OratlasMystError(
      "manifest-invalid",
      "Generated manifest does not satisfy the manifest schema.",
      validated.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; "),
    );
  }

  const files = [
    // Two-space indentation, LF line endings, trailing newline: stable across
    // platforms and reviewable in a diff. No timestamp is written anywhere.
    { path: MANIFEST_FILE_NAME, content: `${JSON.stringify(validated.data, null, 2)}\n` },
    { path: CLAIMS_ARTIFACT_PATH, content: claimsContent },
  ];

  const outputDir = resolveInsideProject(projectRoot, config.oratlas.output);
  if (options.write !== false) {
    for (const file of files) {
      const target = join(outputDir, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content, "utf8");
    }
  }

  return {
    config,
    manifest: validated.data,
    claims: records,
    files,
    outputDir,
    notes,
    ...(reviewManifest ? { reviewManifest } : {}),
  };
}
