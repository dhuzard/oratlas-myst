import { describe, expect, it } from "vitest";
import { mystParse } from "myst-parser";
import { VFile } from "vfile";
import { toText } from "myst-common";
import type { GenericNode } from "myst-common";
import {
  CLAIM_DATA_KEY,
  CLAIM_NODE_CLASS,
  CLAIM_NODE_TYPE,
  claimDirective,
  readClaimDirectiveOptions,
} from "../src/directive.js";
import { claimBodyToText } from "../src/claim-text.js";
import { parseDocument } from "../src/parse-claims.js";

function parse(source: string): { tree: GenericNode; vfile: VFile } {
  const vfile = new VFile({ path: "test.md" });
  const tree = mystParse(source, { directives: [claimDirective], vfile });
  return { tree, vfile };
}

function findClaimNodes(node: GenericNode, out: GenericNode[] = []): GenericNode[] {
  if (node.type === CLAIM_NODE_TYPE && node.data?.[CLAIM_DATA_KEY]) out.push(node);
  for (const child of node.children ?? []) findClaimNodes(child, out);
  return out;
}

describe("oratlas:claim directive", () => {
  it("lowers a valid claim to a standard, referenceable MyST node", () => {
    const { tree, vfile } = parse(
      [
        ":::{oratlas:claim} treatment-effect",
        ":type: empirical",
        "",
        "Treatment worked.",
        ":::",
      ].join("\n"),
    );
    expect(vfile.messages.map((message) => message.reason)).toEqual([]);

    const [node] = findClaimNodes(tree);
    expect(node).toBeDefined();
    expect(node!.type).toBe("div");
    expect(node!.identifier).toBe("treatment-effect");
    expect(node!.label).toBe("treatment-effect");
    expect(node!.class).toBe(CLAIM_NODE_CLASS);
    expect(node!.data![CLAIM_DATA_KEY]).toEqual({
      kind: "claim",
      id: "treatment-effect",
      claimType: "empirical",
    });
  });

  it("keeps the claim body as ordinary, readable MyST content", () => {
    const { tree } = parse(
      [
        ":::{oratlas:claim} nested",
        "",
        "A claim with **bold**, `code`, $E = mc^2$ and a [link](https://example.org).",
        "",
        "- a list item",
        "- another",
        ":::",
      ].join("\n"),
    );
    const [node] = findClaimNodes(tree);
    const types = (node!.children ?? []).map((child) => child.type);
    expect(types).toEqual(["paragraph", "list"]);
    // The scientific text survives as plain MyST text nodes: no custom
    // renderer is needed to read it.
    expect(toText(node!.children!)).toContain("A claim with bold");
    expect(toText(node!.children!)).toContain("a list item");
  });

  it("reports a missing claim id and still renders the body", () => {
    const { tree, vfile } = parse([":::{oratlas:claim}", "", "Body text.", ":::"].join("\n"));
    // MyST's own required-argument check fires first; either way the failure is
    // reported and the prose survives.
    expect(vfile.messages.length).toBeGreaterThan(0);
    expect(findClaimNodes(tree)).toHaveLength(0);
    expect(toText(tree)).toContain("Body text.");
  });

  it("rejects a malformed claim id and suggests the normalized form", () => {
    const { tree, vfile } = parse(
      [":::{oratlas:claim} Treatment Effect", "", "Body text.", ":::"].join("\n"),
    );
    const reasons = vfile.messages.map((message) => message.reason);
    expect(reasons.join(" ")).toContain("not a valid source-local claim id");
    expect(reasons.join(" ")).toContain('Did you mean "treatment-effect"');
    expect(findClaimNodes(tree)).toHaveLength(0);
    // Degrading to the plain body keeps the article readable.
    expect(toText(tree)).toContain("Body text.");
  });

  it.each([
    ["-leading-dash", "must start with a lowercase letter or digit"],
    ["Upper", "not a valid source-local claim id"],
    ["has space", "not a valid source-local claim id"],
    ["emoji-🧪", "not a valid source-local claim id"],
    ["a/b", "not a valid source-local claim id"],
  ])("rejects the malformed id %j", (id, fragment) => {
    const result = readClaimDirectiveOptions(id, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem.code).toBe("claim-id-malformed");
      expect(result.problem.message.toLowerCase()).toContain(fragment.toLowerCase());
    }
  });

  it("accepts well-formed ids including digits, dots and underscores", () => {
    for (const id of ["claim-1", "a", "0", "a.b_c-d", "x".repeat(120)]) {
      expect(readClaimDirectiveOptions(id, {}).ok).toBe(true);
    }
  });

  it("rejects an id longer than the 120 character limit", () => {
    const result = readClaimDirectiveOptions("x".repeat(121), {});
    expect(result.ok).toBe(false);
  });

  it("rejects a claim type ORAtlas does not recognise", () => {
    const result = readClaimDirectiveOptions("ok-id", { type: "speculative" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.code).toBe("claim-type-unknown");
  });

  it("reports a claim body that carries no statement", () => {
    const { problems } = parseDocument(
      [":::{oratlas:claim} empty", "", "% only a MyST comment", ":::"].join("\n"),
      "test.md",
    );
    expect(problems.map((problem) => problem.code)).toContain("claim-body-empty");
  });

  it("lets MyST reject a directive with no body at all", () => {
    const { vfile } = parse([":::{oratlas:claim} empty", ":::"].join("\n"));
    expect(vfile.messages.map((message) => message.reason).join(" ")).toContain(
      "required body not provided",
    );
  });

  it("detects a duplicate id declared twice in one document", () => {
    const { claims } = parseDocument(
      [
        ":::{oratlas:claim} same-id",
        "",
        "First statement.",
        ":::",
        "",
        ":::{oratlas:claim} same-id",
        "",
        "Second statement.",
        ":::",
      ].join("\n"),
      "test.md",
    );
    // The parser reports both occurrences; uniqueness is enforced by the
    // exporter across the whole publication, not per document.
    expect(claims.map((occurrence) => occurrence.options.id)).toEqual(["same-id", "same-id"]);
  });

  it("carries the declared qualification onto the node", () => {
    const { tree } = parse(
      [
        ":::{oratlas:claim} qualified",
        ":type: mechanistic",
        ":qualification: Rodent models only.",
        "",
        "Body.",
        ":::",
      ].join("\n"),
    );
    const [node] = findClaimNodes(tree);
    expect(node!.data![CLAIM_DATA_KEY]).toMatchObject({
      claimType: "mechanistic",
      qualification: "Rodent models only.",
    });
  });
});

describe("claim text derivation", () => {
  it("renders citations as their source keys instead of dropping them", () => {
    const { claims } = parseDocument(
      [
        ":::{oratlas:claim} cited",
        "",
        "A finding [@smith2020] and another [@a; @b], plus narrative @c.",
        ":::",
      ].join("\n"),
      "test.md",
    );
    expect(claims[0]!.text).toBe("A finding [@smith2020] and another [@a; @b], plus narrative @c.");
  });

  it("collapses the source's hard line wraps but preserves paragraph breaks", () => {
    const { claims } = parseDocument(
      [
        ":::{oratlas:claim} wrapped",
        "",
        "One statement broken",
        "across source lines.",
        "",
        "A second paragraph.",
        ":::",
      ].join("\n"),
      "test.md",
    );
    expect(claims[0]!.text).toBe(
      "One statement broken across source lines.\n\nA second paragraph.",
    );
  });

  it("preserves Unicode, negation and numbers exactly", () => {
    const text = claimBodyToText(
      mystParse("The effect was not observed at 0.5 mg/kg in naïve 🐁 cohorts.").children ?? [],
    );
    expect(text).toBe("The effect was not observed at 0.5 mg/kg in naïve 🐁 cohorts.");
  });

  it("renders inline maths and code as their literal source", () => {
    const text = claimBodyToText(mystParse("Given $x^2$ and `alpha=0.05`.").children ?? []);
    expect(text).toBe("Given x^2 and alpha=0.05.");
  });
});
