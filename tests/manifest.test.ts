import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { canonicalJson } from "../src/canonical-json.js";
import {
  MANIFEST_SCHEMA_VERSION,
  oratlasManifestSchema,
  recognizedReviewManifestSchema,
  type OratlasManifest,
} from "../src/contracts/index.js";
import { MANIFEST_FILE_NAME, exportProject } from "../src/export.js";
import { sha256 } from "../src/hash.js";
import { cleanupProjects, claim, expectOratlasError, makeProject } from "./helpers.js";

afterAll(cleanupProjects);

const minimal: OratlasManifest = {
  schemaVersion: "0.2.0",
  generator: { name: "@oratlas/myst", version: "0.2.0" },
  publication: { version: { sourcesSha256: sha256("") } },
  adapter: { type: "myst", xref: "myst.xref.json" },
  artifacts: {
    claims: {
      path: "oratlas/claims.jsonl",
      format: "jsonl",
      records: 0,
      sha256: sha256(""),
      declarations: "publication-source",
    },
  },
};

describe("oratlas.manifest.json schema", () => {
  it("accepts a valid minimal manifest", () => {
    expect(oratlasManifestSchema.safeParse(minimal).success).toBe(true);
  });

  it("accepts a manifest that references an existing review manifest", () => {
    const withReview = {
      ...minimal,
      artifacts: {
        claims: { ...minimal.artifacts.claims, declarations: "review-manifest" as const },
      },
      oratlas: { reviewManifest: "review-manifest.json" },
    };
    expect(oratlasManifestSchema.safeParse(withReview).success).toBe(true);
  });

  it("rejects an unexpected schema version", () => {
    const result = oratlasManifestSchema.safeParse({ ...minimal, schemaVersion: "0.3.0" });
    expect(result.success).toBe(false);
  });

  it("rejects unknown top-level keys rather than ignoring them", () => {
    const result = oratlasManifestSchema.safeParse({ ...minimal, trust: { score: 0.82 } });
    expect(result.success).toBe(false);
  });

  it.each([
    ["../escape.jsonl", "parent traversal"],
    ["/absolute/claims.jsonl", "absolute path"],
    ["./oratlas/claims.jsonl", "leading ./ segment"],
    ["https://evil.example/claims.jsonl", "URL scheme"],
    ["oratlas\\claims.jsonl", "backslash"],
    ["", "empty"],
  ])("rejects the artifact path %j (%s)", (path) => {
    const result = oratlasManifestSchema.safeParse({
      ...minimal,
      artifacts: { claims: { ...minimal.artifacts.claims, path } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-https canonical URL", () => {
    for (const canonicalUrl of ["http://example.org/", "javascript:alert(1)", "not a url"]) {
      const result = oratlasManifestSchema.safeParse({
        ...minimal,
        publication: { canonicalUrl },
      });
      expect(result.success).toBe(false);
    }
  });

  it("rejects a malformed digest", () => {
    for (const digest of ["", "abc", "A".repeat(64), "0".repeat(63)]) {
      const result = oratlasManifestSchema.safeParse({
        ...minimal,
        artifacts: { claims: { ...minimal.artifacts.claims, sha256: digest } },
      });
      expect(result.success).toBe(false);
    }
  });

  it("serializes deterministically regardless of key insertion order", () => {
    const shuffled = {
      artifacts: minimal.artifacts,
      adapter: minimal.adapter,
      publication: minimal.publication,
      generator: minimal.generator,
      schemaVersion: minimal.schemaVersion,
    };
    expect(canonicalJson(shuffled)).toBe(canonicalJson(minimal));
  });
});

describe("generated manifest", () => {
  it("declares the current schema version and the generator identity", () => {
    const root = makeProject({ "index.md": `# I\n\n${claim("only", "A statement.")}` });
    const { manifest } = exportProject({ projectRoot: root, write: false });
    expect(manifest.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
    expect(manifest.generator).toEqual({ name: "@oratlas/myst", version: "0.2.0" });
  });

  it("points at MyST's own cross-reference inventory without reproducing it", () => {
    const root = makeProject({ "index.md": `# I\n\n${claim("only", "A statement.")}` });
    const { manifest } = exportProject({ projectRoot: root, write: false });
    expect(manifest.adapter).toEqual({ type: "myst", xref: "myst.xref.json" });
    // Nothing in the manifest restates a cross-reference target or a URL.
    expect(JSON.stringify(manifest)).not.toContain("references");
  });

  it("carries the configured canonical URL and title", () => {
    const root = makeProject({
      "index.md": `# I\n\n${claim("only", "A statement.")}`,
      "oratlas.yml": "canonical_url: https://example.org/review/\ntitle: Explicit title\n",
    });
    const { manifest } = exportProject({ projectRoot: root, write: false });
    expect(manifest.publication.canonicalUrl).toBe("https://example.org/review/");
    expect(manifest.publication.title).toBe("Explicit title");
  });

  it("falls back to the MyST project title", () => {
    const root = makeProject({ "index.md": `# I\n\n${claim("only", "A statement.")}` });
    const { manifest } = exportProject({ projectRoot: root, write: false });
    expect(manifest.publication.title).toBe("Test project");
  });

  it("is written with a stable indentation and a trailing newline", () => {
    const root = makeProject({ "index.md": `# I\n\n${claim("only", "A statement.")}` });
    exportProject({ projectRoot: root });
    const content = readFileSync(join(root, ".oratlas", MANIFEST_FILE_NAME), "utf8");
    expect(content.endsWith("}\n")).toBe(true);
    expect(content).toContain('\n  "schemaVersion": "0.2.0",');
  });

  it("carries no mutable or federated ORAtlas state", () => {
    const root = makeProject({ "index.md": `# I\n\n${claim("only", "A statement.")}` });
    const { manifest, claims } = exportProject({ projectRoot: root, write: false });
    const serialized = JSON.stringify({ manifest, claims });
    for (const forbidden of [
      "trustScore",
      "assessment",
      "verification",
      "disagreement",
      "consensus",
      "canonicalId",
      "oratlasId",
      "votes",
      "comments",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("review manifest interoperability", () => {
  const reviewManifest = JSON.stringify({
    schemaVersion: "1.0.0",
    review: { title: "Existing ORAtlas review" },
    repository: { url: "https://github.com/example/review" },
    artifacts: { claims: "knowledge/claims.jsonl" },
  });

  const knowledgeClaims = [
    JSON.stringify({
      id: "shared-claim",
      text: "Owned by the review manifest.",
      claimType: "empirical",
    }),
    JSON.stringify({ id: "prose-only-claim", text: "Declared but not bound in MyST." }),
    "",
  ].join("\n");

  it("delegates claim declarations when the review manifest declares a claims stream", () => {
    const root = makeProject({
      "index.md": `# I\n\n${claim("shared-claim", "The MyST occurrence of the shared claim.")}`,
      "review-manifest.json": reviewManifest,
      "knowledge/claims.jsonl": knowledgeClaims,
      "oratlas.yml": "review_manifest: review-manifest.json\n",
    });
    const result = exportProject({ projectRoot: root, write: false });

    expect(result.manifest.artifacts.claims.declarations).toBe("review-manifest");
    expect(result.manifest.oratlas).toEqual({ reviewManifest: "review-manifest.json" });

    // The occurrence binding is emitted; the declaration fields are not,
    // because the review manifest already owns them.
    const [record] = result.claims;
    expect(record!.id).toBe("shared-claim");
    expect(record!.text).toBeUndefined();
    expect(record!.claimType).toBeUndefined();
    expect(record!.qualification).toBeUndefined();
    expect(record!.source.documentPath).toBe("index.md");
    expect(record!.declarationSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports a review-manifest claim that has no MyST occurrence, without failing", () => {
    const root = makeProject({
      "index.md": `# I\n\n${claim("shared-claim", "Bound.")}`,
      "review-manifest.json": reviewManifest,
      "knowledge/claims.jsonl": knowledgeClaims,
      "oratlas.yml": "review_manifest: review-manifest.json\n",
    });
    const result = exportProject({ projectRoot: root, write: false });
    expect(result.notes.join("\n")).toContain("prose-only-claim");
  });

  it("fails when the MyST source declares a claim the review manifest does not", () => {
    const root = makeProject({
      "index.md": `# I\n\n${claim("shared-claim", "Bound.")}\n\n${claim("rogue-claim", "Unknown upstream.")}`,
      "review-manifest.json": reviewManifest,
      "knowledge/claims.jsonl": knowledgeClaims,
      "oratlas.yml": "review_manifest: review-manifest.json\n",
    });
    expectOratlasError(() => exportProject({ projectRoot: root, write: false }), /rogue-claim/);
  });

  it("keeps the publication source authoritative when the review manifest declares no claims", () => {
    const root = makeProject({
      "index.md": `# I\n\n${claim("local-claim", "Only declared in MyST.")}`,
      "review-manifest.json": JSON.stringify({
        schemaVersion: "1.0.0",
        review: { title: "Metadata only" },
        repository: { url: "https://github.com/example/review" },
      }),
      "oratlas.yml": "review_manifest: review-manifest.json\n",
    });
    const result = exportProject({ projectRoot: root, write: false });
    expect(result.manifest.artifacts.claims.declarations).toBe("publication-source");
    expect(result.claims[0]!.text).toBe("Only declared in MyST.");
  });

  it("does not restate anything the review manifest already declares", () => {
    const root = makeProject({
      "index.md": `# I\n\n${claim("shared-claim", "Bound.")}`,
      "review-manifest.json": reviewManifest,
      "knowledge/claims.jsonl": knowledgeClaims,
      "oratlas.yml": "review_manifest: review-manifest.json\n",
    });
    const { manifest } = exportProject({ projectRoot: root, write: false });
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain("Existing ORAtlas review");
    expect(serialized).not.toContain("github.com/example/review");
    expect(serialized).not.toContain("knowledge/claims.jsonl");
  });

  it("recognises a newer review manifest without rejecting its unknown fields", () => {
    const result = recognizedReviewManifestSchema.safeParse({
      schemaVersion: "2.0.0",
      review: { title: "Future", somethingNew: true },
      artifacts: { claims: "knowledge/claims.jsonl", futureArtifact: "x.jsonl" },
      brandNewSection: { anything: 1 },
    });
    expect(result.success).toBe(true);
  });

  it("fails clearly on a malformed review manifest", () => {
    const root = makeProject({
      "index.md": `# I\n\n${claim("c", "Body.")}`,
      "review-manifest.json": "{ not json",
      "oratlas.yml": "review_manifest: review-manifest.json\n",
    });
    expectOratlasError(() => exportProject({ projectRoot: root, write: false }), /not valid JSON/);
  });

  it("rejects a review manifest path that escapes the project", () => {
    const root = makeProject({
      "index.md": `# I\n\n${claim("c", "Body.")}`,
      "oratlas.yml": "review_manifest: ../../review-manifest.json\n",
    });
    expectOratlasError(
      () => exportProject({ projectRoot: root, write: false }),
      /safe project-relative file path/,
    );
  });
});
