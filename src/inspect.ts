import { loadConfig } from "./config.js";
import { OratlasMystError } from "./errors.js";
import { sha256 } from "./hash.js";
import { parseDocument } from "./parse-claims.js";
import { discoverPages, readProjectFile } from "./project.js";

export interface InspectedClaim {
  id: string;
  claimType?: string;
  qualification?: string;
  text: string;
  documentPath: string;
  startLine: number;
  endLine: number;
  declarationSha256Preview: string;
}

export interface InspectedDocument {
  path: string;
  sha256: string;
  claims: InspectedClaim[];
  problems: { code: string; message: string; line?: number }[];
}

export interface InspectResult {
  projectRoot: string;
  pageSource: "toc" | "discovery";
  documents: InspectedDocument[];
  skipped: { path: string; reason: string }[];
  duplicateIds: { id: string; occurrences: string[] }[];
}

/**
 * Report what the exporter sees, without writing anything.
 *
 * Unlike `export`, `inspect` does not fail on the first problem: it reports
 * every declaration and every problem so an author can fix them in one pass.
 */
export function inspectProject(options: { projectRoot?: string } = {}): InspectResult {
  const projectRoot = options.projectRoot ?? process.cwd();
  const config = loadConfig(projectRoot);
  const discovered = discoverPages(config);

  const documents: InspectedDocument[] = [];
  const occurrencesById = new Map<string, string[]>();

  for (const page of discovered.pages) {
    let source: string;
    try {
      source = readProjectFile(projectRoot, page.path);
    } catch (error) {
      documents.push({
        path: page.path,
        sha256: "",
        claims: [],
        problems: [
          {
            code: error instanceof OratlasMystError ? error.code : "source-unreadable",
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      });
      continue;
    }
    const parsed = parseDocument(source, page.path);
    const claims: InspectedClaim[] = parsed.claims.map((occurrence) => {
      const where = `${page.path}:${occurrence.startLine}`;
      occurrencesById.set(occurrence.options.id, [
        ...(occurrencesById.get(occurrence.options.id) ?? []),
        where,
      ]);
      return {
        id: occurrence.options.id,
        ...(occurrence.options.claimType ? { claimType: occurrence.options.claimType } : {}),
        ...(occurrence.options.qualification
          ? { qualification: occurrence.options.qualification }
          : {}),
        text: occurrence.text,
        documentPath: page.path,
        startLine: occurrence.startLine,
        endLine: occurrence.endLine,
        declarationSha256Preview: sha256(occurrence.bodySource).slice(0, 12),
      };
    });
    documents.push({ path: page.path, sha256: sha256(source), claims, problems: parsed.problems });
  }

  const duplicateIds = [...occurrencesById.entries()]
    .filter(([, occurrences]) => occurrences.length > 1)
    .map(([id, occurrences]) => ({ id, occurrences }));

  return {
    projectRoot,
    pageSource: discovered.source,
    documents,
    skipped: discovered.skipped,
    duplicateIds,
  };
}
