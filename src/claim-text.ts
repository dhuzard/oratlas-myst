import type { GenericNode } from "myst-common";

/**
 * Derive the plain-text statement of a claim from its parsed MyST body.
 *
 * `myst-common`'s `toText` is not usable directly here: it concatenates only
 * nodes that already carry text, so a citation — which is a `cite` node with
 * no children until MyST's citation transform runs during a build — silently
 * disappears and leaves the surrounding punctuation stranded. The rules below
 * are fixed and documented in `SPEC.md` so a consumer can reproduce them:
 *
 * - Each top-level block of the claim body is rendered separately and the
 *   blocks are joined with a blank line. A list or blockquote contributes its
 *   own children as blocks.
 * - Inside a block, runs of whitespace — including the source's hard line
 *   wraps, which are an authoring artifact rather than content — collapse to a
 *   single space, and the result is trimmed.
 * - A citation renders as its source key: `[@key]` for a parenthetical group,
 *   `@key` for a narrative citation, `[@a; @b]` for a group of several.
 * - Inline maths renders as its source, inline code as its literal value, and
 *   a cross-reference or link as its own text when it has any.
 *
 * Nothing is normalised beyond whitespace: case, punctuation, negation,
 * numbers and Unicode are preserved exactly as written.
 */
export function claimBodyToText(children: GenericNode[]): string {
  const blocks: string[] = [];
  for (const child of children) collectBlocks(child, blocks);
  return blocks.filter((block) => block.length > 0).join("\n\n");
}

const CONTAINER_TYPES = new Set(["list", "listItem", "blockquote", "block", "div", "container"]);

function collectBlocks(node: GenericNode, out: string[]): void {
  if (CONTAINER_TYPES.has(node.type) && Array.isArray(node.children)) {
    for (const child of node.children) collectBlocks(child, out);
    return;
  }
  out.push(collapseWhitespace(inlineText(node)));
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function inlineText(node: GenericNode): string {
  switch (node.type) {
    case "citeGroup": {
      const keys = (node.children ?? []).map((child) => citeKey(child)).filter(Boolean);
      return keys.length > 0 ? `[${keys.join("; ")}]` : "";
    }
    case "cite": {
      const key = citeKey(node);
      return key ? key : "";
    }
    case "inlineMath":
    case "math":
      return typeof node.value === "string" ? node.value : "";
    case "inlineCode":
    case "code":
      return typeof node.value === "string" ? node.value : "";
    case "break":
      return " ";
    case "image":
      return typeof node.alt === "string" ? node.alt : "";
    case "footnoteReference":
    case "comment":
    case "mystComment":
      return "";
    default:
      break;
  }
  if (Array.isArray(node.children) && node.children.length > 0) {
    return node.children.map((child) => inlineText(child)).join("");
  }
  if (typeof node.value === "string") return node.value;
  return "";
}

function citeKey(node: GenericNode): string {
  const label = typeof node.label === "string" ? node.label : node.identifier;
  return typeof label === "string" && label.length > 0 ? `@${label}` : "";
}
