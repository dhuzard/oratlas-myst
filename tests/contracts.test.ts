import { describe, expect, it } from "vitest";
import { canonicalJson, compareStrings } from "../src/canonical-json.js";
import { claimDeclarationSha256, sha256 } from "../src/hash.js";
import {
  CLAIM_TYPES,
  isSafeLocalPath,
  isSafeRelativePath,
  localClaimIdSchema,
  unicodeCodePointLength,
} from "../src/contracts/index.js";

describe("canonicalJson", () => {
  it("sorts keys recursively so serialization is order-independent", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalJson({ a: { c: 3, d: 2 }, b: 1 })).toBe(
      canonicalJson({ b: 1, a: { d: 2, c: 3 } }),
    );
  });

  it("preserves array order", () => {
    expect(canonicalJson({ list: ["b", "a"] })).toBe('{"list":["b","a"]}');
  });

  it("omits undefined members but keeps null", () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it("normalizes negative zero", () => {
    expect(canonicalJson({ n: -0 })).toBe('{"n":0}');
  });

  it("fails closed on values JSON cannot represent faithfully", () => {
    expect(() => canonicalJson({ n: Number.NaN })).toThrowError(TypeError);
    expect(() => canonicalJson({ n: Number.POSITIVE_INFINITY })).toThrowError(TypeError);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => canonicalJson(circular)).toThrowError(TypeError);
    expect(() => canonicalJson({ when: new Map() })).toThrowError(TypeError);
  });

  it("sorts keys by code unit, not by locale", () => {
    // A locale collator would sort "a" before "Z"; code-unit order does not.
    expect(canonicalJson({ Z: 1, a: 2 })).toBe('{"Z":1,"a":2}');
    expect(compareStrings("Z", "a")).toBeLessThan(0);
  });
});

describe("sha256", () => {
  it("hashes UTF-8 bytes, matching ORAtlas's helper", () => {
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    // Non-ASCII is hashed as UTF-8, not UTF-16.
    expect(sha256("naïve 🐁")).toBe(sha256(Buffer.from("naïve 🐁", "utf8").toString("utf8")));
  });
});

describe("claimDeclarationSha256", () => {
  it("changes when any part of the declaration changes", () => {
    const base = { id: "c", body: "A statement." };
    const digest = claimDeclarationSha256(base);
    expect(claimDeclarationSha256({ ...base, id: "d" })).not.toBe(digest);
    expect(claimDeclarationSha256({ ...base, body: "A statement" })).not.toBe(digest);
    expect(claimDeclarationSha256({ ...base, claimType: "empirical" })).not.toBe(digest);
    expect(claimDeclarationSha256({ ...base, qualification: "Rodents." })).not.toBe(digest);
  });

  it("treats an absent attribute and an explicitly undefined one identically", () => {
    expect(claimDeclarationSha256({ id: "c", body: "B." })).toBe(
      claimDeclarationSha256({ id: "c", body: "B.", claimType: undefined }),
    );
  });

  it("is stable for the same declaration", () => {
    const input = { id: "c", body: "Naïve 🐁 cohorts.", claimType: "empirical" };
    expect(claimDeclarationSha256(input)).toBe(claimDeclarationSha256({ ...input }));
  });
});

describe("path rules", () => {
  it.each([
    "myst.xref.json",
    "oratlas/claims.jsonl",
    "knowledge/claims.jsonl",
    "a/b/c/d.json",
    "file-1.0.jsonl",
  ])("accepts the publication path %j", (path) => {
    expect(isSafeRelativePath(path)).toBe(true);
  });

  it.each([
    "",
    "/absolute",
    "~/home",
    "../escape",
    "a/../b",
    "./here",
    "a//b",
    "back\\slash",
    "https://example.org/x",
    "c:/windows",
    "with\u0000null",
    ".hidden/file.json",
    "_underscore/file.json",
    "x".repeat(513),
  ])("rejects the publication path %j", (path) => {
    expect(isSafeRelativePath(path)).toBe(false);
  });

  it("accepts dot- and underscore-prefixed local paths that publication paths reject", () => {
    for (const path of [".oratlas", "_pages/intro.md", "build/out", "chapître.md"]) {
      expect(isSafeLocalPath(path)).toBe(true);
    }
  });

  it.each(["", "/etc/passwd", "../../etc/passwd", "a/../b", "~/x", "c:/x", "back\\slash"])(
    "rejects the local path %j",
    (path) => {
      expect(isSafeLocalPath(path)).toBe(false);
    },
  );

  it("rejects non-strings", () => {
    for (const value of [undefined, null, 1, {}, []]) {
      expect(isSafeRelativePath(value)).toBe(false);
      expect(isSafeLocalPath(value)).toBe(false);
    }
  });
});

describe("claim identifiers", () => {
  it("accepts only already-normalized identifiers", () => {
    for (const id of ["a", "0", "claim-1", "a.b_c-d"]) {
      expect(localClaimIdSchema.safeParse(id).success).toBe(true);
    }
    for (const id of ["", "A", "a b", "-a", ".a", "_a", "a/b", "🧪", "x".repeat(121)]) {
      expect(localClaimIdSchema.safeParse(id).success).toBe(false);
    }
  });
});

describe("claim types", () => {
  it("matches the ORAtlas claim type vocabulary", () => {
    // Kept in step with `CLAIM_TYPES` in ORAtlas's `@oratlas/contracts`, which
    // is append-only upstream.
    expect([...CLAIM_TYPES]).toEqual([
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
    ]);
  });
});

describe("unicodeCodePointLength", () => {
  it("counts code points, not UTF-16 code units", () => {
    expect(unicodeCodePointLength("abc")).toBe(3);
    expect(unicodeCodePointLength("🐁")).toBe(1);
    expect("🐁".length).toBe(2);
    expect(unicodeCodePointLength("naïve 🐁")).toBe(7);
  });
});
