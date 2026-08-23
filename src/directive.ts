import { fileError, normalizeLabel } from "myst-common";
import type { DirectiveData, DirectiveSpec, GenericNode } from "myst-common";
import type { VFile } from "vfile";
import { CLAIM_TYPES, type ClaimType } from "./contracts/claims.js";
import { LOCAL_CLAIM_ID_RE, MAX_LOCAL_CLAIM_ID_LENGTH } from "./contracts/primitives.js";

/** Directive name authors write: `:::{oratlas:claim} <id>`. */
export const CLAIM_DIRECTIVE_NAME = "oratlas:claim";

/**
 * The mdast node type this directive produces.
 *
 * `div` is a standard MyST node: web themes render it as a plain block
 * wrapper, and the LaTeX/Typst/DOCX exporters pass its children through. It is
 * also a target-identifier node, so MyST's `enumerateTargetsTransform`
 * registers it as a cross-reference target and it appears in `myst.xref.json`
 * with `kind: "div"` — without any custom renderer.
 */
export const CLAIM_NODE_TYPE = "div";

/** CSS class attached to the emitted node, for optional author styling. */
export const CLAIM_NODE_CLASS = "oratlas-claim";

/** Key under which the claim metadata is carried on the emitted node's `data`. */
export const CLAIM_DATA_KEY = "oratlas";

export interface ClaimNodeData {
  /** Marks the node as an ORAtlas claim declaration for downstream consumers. */
  kind: "claim";
  /** Source-local claim identifier, as written by the author. */
  id: string;
  claimType?: ClaimType;
  qualification?: string;
}

export interface ClaimDirectiveOptions {
  id: string;
  claimType?: ClaimType;
  qualification?: string;
}

/** A validation failure in a single `oratlas:claim` declaration. */
export interface ClaimDirectiveProblem {
  code: "claim-id-missing" | "claim-id-malformed" | "claim-type-unknown" | "claim-body-empty";
  message: string;
}

function optionAsString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Validate the author-supplied parts of an `oratlas:claim` directive.
 *
 * Nothing is repaired: a malformed identifier is rejected with the normalized
 * form suggested back, rather than being normalized silently. Author-visible
 * identity must be exactly what ends up in `claims.jsonl` and in
 * `myst.xref.json`.
 */
export function readClaimDirectiveOptions(
  arg: unknown,
  options: Record<string, unknown> | undefined,
): { ok: true; value: ClaimDirectiveOptions } | { ok: false; problem: ClaimDirectiveProblem } {
  const rawId = optionAsString(arg);
  if (!rawId) {
    return {
      ok: false,
      problem: {
        code: "claim-id-missing",
        message: `\`${CLAIM_DIRECTIVE_NAME}\` requires an explicit source-local claim id, for example \`:::{${CLAIM_DIRECTIVE_NAME}} treatment-effect\`.`,
      },
    };
  }
  if (rawId.length > MAX_LOCAL_CLAIM_ID_LENGTH) {
    return {
      ok: false,
      problem: {
        code: "claim-id-malformed",
        message: `Claim id "${rawId}" is longer than ${MAX_LOCAL_CLAIM_ID_LENGTH} characters.`,
      },
    };
  }
  if (!LOCAL_CLAIM_ID_RE.test(rawId)) {
    // `normalizeLabel().identifier` only lowercases and trims; `html_id` is
    // the DOM-safe slug, which is the form this rule actually accepts.
    const suggestion = normalizeLabel(rawId)?.html_id;
    const hint =
      suggestion && LOCAL_CLAIM_ID_RE.test(suggestion) ? ` Did you mean "${suggestion}"?` : "";
    return {
      ok: false,
      problem: {
        code: "claim-id-malformed",
        message: `Claim id "${rawId}" is not a valid source-local claim id: it must start with a lowercase letter or digit and contain only lowercase letters, digits, '.', '_' or '-'.${hint}`,
      },
    };
  }

  const rawType = optionAsString(options?.type);
  if (rawType && !(CLAIM_TYPES as readonly string[]).includes(rawType)) {
    return {
      ok: false,
      problem: {
        code: "claim-type-unknown",
        message: `Claim type "${rawType}" is not recognised by ORAtlas. Expected one of: ${CLAIM_TYPES.join(", ")}.`,
      },
    };
  }

  const qualification = optionAsString(options?.qualification);

  return {
    ok: true,
    value: {
      id: rawId,
      ...(rawType ? { claimType: rawType as ClaimType } : {}),
      ...(qualification ? { qualification } : {}),
    },
  };
}

/**
 * Build the standard MyST node for a validated claim declaration.
 *
 * The claim body is emitted as ordinary MyST content so the scientific text
 * stays readable in every output format. The wrapper only adds the
 * cross-reference target and the semantic metadata the exporter reads.
 */
export function buildClaimNode(
  options: ClaimDirectiveOptions,
  children: GenericNode[],
): GenericNode {
  const data: ClaimNodeData = {
    kind: "claim",
    id: options.id,
    ...(options.claimType ? { claimType: options.claimType } : {}),
    ...(options.qualification ? { qualification: options.qualification } : {}),
  };
  return {
    type: CLAIM_NODE_TYPE,
    label: options.id,
    identifier: options.id,
    class: CLAIM_NODE_CLASS,
    data: { [CLAIM_DATA_KEY]: data },
    children,
  };
}

/**
 * The `oratlas:claim` directive.
 *
 * Parsing is deterministic and offline: it never contacts ORAtlas, never
 * derives an identifier from the claim text, and never fabricates an ORAtlas
 * canonical id.
 */
export const claimDirective: DirectiveSpec = {
  name: CLAIM_DIRECTIVE_NAME,
  doc: "Declare an explicit, addressable scientific claim for ORAtlas interoperability.",
  arg: {
    type: String,
    required: true,
    doc: "Source-local claim id, unique within the publication (e.g. `treatment-effect`).",
  },
  options: {
    type: {
      type: String,
      doc: `Claim type; one of: ${CLAIM_TYPES.join(", ")}.`,
    },
    qualification: {
      type: String,
      doc: "Scope or qualification the claim is asserted under.",
    },
  },
  body: {
    type: "myst",
    required: true,
    doc: "The claim statement, as ordinary MyST content.",
  },
  run(data: DirectiveData, vfile: VFile): GenericNode[] {
    const parsed = readClaimDirectiveOptions(data.arg, data.options);
    if (!parsed.ok) {
      fileError(vfile, parsed.problem.message, {
        node: data.node,
        source: CLAIM_DIRECTIVE_NAME,
        ruleId: parsed.problem.code,
      });
      // Degrade to the plain body so the scientific text still renders.
      return (data.body as GenericNode[] | undefined) ?? [];
    }
    const children = (data.body as GenericNode[] | undefined) ?? [];
    if (children.length === 0) {
      fileError(vfile, `Claim "${parsed.value.id}" has an empty body.`, {
        node: data.node,
        source: CLAIM_DIRECTIVE_NAME,
        ruleId: "claim-body-empty",
      });
      return [];
    }
    return [buildClaimNode(parsed.value, children)];
  },
};
