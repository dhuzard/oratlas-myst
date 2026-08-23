import type { DirectiveData, DirectiveSpec, GenericNode } from "myst-common";
import { mystParse } from "myst-parser";
import { claimBodyToText } from "./claim-text.js";
import { VFile } from "vfile";
import {
  CLAIM_DIRECTIVE_NAME,
  buildClaimNode,
  readClaimDirectiveOptions,
  type ClaimDirectiveOptions,
} from "./directive.js";
import {
  MAX_SELECTOR_EXACT_CODE_POINTS,
  SELECTOR_CONTEXT_CODE_POINTS,
  unicodeCodePointLength,
} from "./contracts/primitives.js";
import type { SelectorUnit } from "./contracts/claims.js";
import { OratlasMystError } from "./errors.js";

/** A single `oratlas:claim` declaration, located exactly in its source. */
export interface ClaimOccurrence {
  options: ClaimDirectiveOptions;
  /** The directive body exactly as MyST read it from the source. */
  bodySource: string;
  /** Plain-text rendering of the parsed body. */
  text: string;
  /** 1-based inclusive line span of the whole directive block. */
  startLine: number;
  endLine: number;
  /** Exact source text of lines `startLine`..`endLine`, `\n`-joined. */
  blockSource: string;
  /** Which span the selector quotes, and where it sits in the document. */
  selector: {
    unit: SelectorUnit;
    /** Code-point offsets into the document source. */
    start: number;
    end: number;
    exact: string;
    prefix?: string;
    suffix?: string;
  };
}

/** A declaration this adapter refused to accept, with the author-facing reason. */
export interface ClaimProblem {
  code: string;
  message: string;
  line?: number;
}

export interface ParsedDocument {
  /** The document's mdast, with claims already lowered to standard MyST nodes. */
  tree: GenericNode;
  claims: ClaimOccurrence[];
  problems: ClaimProblem[];
}

/**
 * Split a source document into lines, remembering each line's code-point
 * offset so selector positions can be expressed in the same frame the
 * document digest covers.
 *
 * Offsets are counted in Unicode code points, not UTF-16 code units, matching
 * the W3C selector definitions and ORAtlas's `unicodeCodePointLength`.
 */
interface LineIndex {
  /** Line text, without its terminator. */
  lines: string[];
  /** Code-point offset at which each line starts. */
  starts: number[];
}

export function indexLines(source: string): LineIndex {
  const lines = source.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    // +1 for the "\n" separator; the final entry's separator is never used.
    offset += unicodeCodePointLength(line) + 1;
  }
  return { lines, starts };
}

function sliceCodePoints(source: string, start: number, end: number): string {
  return Array.from(source).slice(start, end).join("");
}

/**
 * Locate `needle` inside `haystack` and return its code-point offset, or -1.
 *
 * The search is done over code-point arrays so the returned offset is directly
 * usable as a `TextPositionSelector` value.
 */
function indexOfCodePoints(haystack: string, needle: string): number {
  const unitIndex = haystack.indexOf(needle);
  if (unitIndex < 0) return -1;
  return unicodeCodePointLength(haystack.slice(0, unitIndex));
}

function buildSelector(
  documentSource: string,
  blockStart: number,
  blockSource: string,
  bodySource: string,
): ClaimOccurrence["selector"] {
  // Prefer quoting the claim body itself. MyST dedents the body of a directive
  // nested inside another block, in which case the body is not a verbatim
  // substring of the block and the whole block is quoted instead, so that the
  // recorded span is always byte-exact against the source the digest covers.
  let unit: SelectorUnit = "body";
  let start = blockStart;
  let passage = blockSource;
  if (bodySource.length > 0) {
    const offsetInBlock = indexOfCodePoints(blockSource, bodySource);
    if (offsetInBlock >= 0) {
      start = blockStart + offsetInBlock;
      passage = bodySource;
    } else {
      unit = "block";
    }
  } else {
    unit = "block";
  }

  const passageLength = unicodeCodePointLength(passage);
  // A `TextQuoteSelector.exact` is capped at 2000 code points. A longer
  // passage is quoted by its leading 2000 code points, which is still an exact
  // contiguous quote, and the position selector is narrowed to match.
  const quotedLength = Math.min(passageLength, MAX_SELECTOR_EXACT_CODE_POINTS);
  const exact =
    quotedLength === passageLength ? passage : sliceCodePoints(passage, 0, quotedLength);
  const end = start + quotedLength;

  const prefix = sliceCodePoints(
    documentSource,
    Math.max(0, start - SELECTOR_CONTEXT_CODE_POINTS),
    start,
  );
  const suffix = sliceCodePoints(documentSource, end, end + SELECTOR_CONTEXT_CODE_POINTS);

  return {
    unit,
    start,
    end,
    exact,
    ...(prefix ? { prefix } : {}),
    ...(suffix ? { suffix } : {}),
  };
}

/**
 * Parse one MyST document and extract its claim declarations.
 *
 * Parsing goes through MyST's own parser with the real `oratlas:claim`
 * directive spec, so what the exporter sees is what MyST sees. No Markdown is
 * matched with hand-written regular expressions.
 */
export function parseDocument(source: string, documentPath: string): ParsedDocument {
  const { lines, starts } = indexLines(source);
  const claims: ClaimOccurrence[] = [];
  const problems: ClaimProblem[] = [];

  const collectingDirective: DirectiveSpec = {
    name: CLAIM_DIRECTIVE_NAME,
    arg: { type: String, required: true },
    options: { type: { type: String }, qualification: { type: String } },
    body: { type: "myst", required: true },
    run(data: DirectiveData): GenericNode[] {
      const position = data.node.position;
      const line = position?.start?.line;
      const parsed = readClaimDirectiveOptions(data.arg, data.options);
      if (!parsed.ok) {
        problems.push({
          code: parsed.problem.code,
          message: parsed.problem.message,
          ...(line ? { line } : {}),
        });
        return (data.body as GenericNode[] | undefined) ?? [];
      }
      const children = (data.body as GenericNode[] | undefined) ?? [];
      const bodySource = typeof data.node.value === "string" ? data.node.value : "";
      const text = claimBodyToText(children);

      if (children.length === 0 || text.length === 0) {
        problems.push({
          code: "claim-body-empty",
          message: `Claim "${parsed.value.id}" has an empty body.`,
          ...(line ? { line } : {}),
        });
        return [];
      }

      if (!position?.start?.line || !position.end?.line) {
        // MyST always attaches a position to a parsed directive; without one
        // the source occurrence cannot be bound, so fail rather than guess.
        problems.push({
          code: "claim-position-missing",
          message: `Claim "${parsed.value.id}" has no source position; its occurrence cannot be recorded.`,
        });
        return [buildClaimNode(parsed.value, children)];
      }

      const startLine = position.start.line;
      const endLine = Math.min(position.end.line, lines.length);
      const blockSource = lines.slice(startLine - 1, endLine).join("\n");
      const blockStart = starts[startLine - 1];
      if (blockStart === undefined) {
        problems.push({
          code: "claim-position-missing",
          message: `Claim "${parsed.value.id}" reports line ${startLine}, which is outside ${documentPath}.`,
        });
        return [buildClaimNode(parsed.value, children)];
      }

      claims.push({
        options: parsed.value,
        bodySource,
        text,
        startLine,
        endLine,
        blockSource,
        selector: buildSelector(source, blockStart, blockSource, bodySource),
      });
      return [buildClaimNode(parsed.value, children)];
    },
  };

  const vfile = new VFile({ path: documentPath });
  let tree: GenericNode;
  try {
    tree = mystParse(source, { directives: [collectingDirective], vfile });
  } catch (error) {
    throw new OratlasMystError(
      "document-unparsable",
      `Failed to parse ${documentPath} as MyST Markdown.`,
      error instanceof Error ? error.message : String(error),
    );
  }

  return { tree, claims, problems };
}
