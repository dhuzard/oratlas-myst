import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CLAIMS_ARTIFACT_PATH, MANIFEST_FILE_NAME, exportProject } from "../src/export.js";
import { validateProject } from "../src/validate.js";
import { cleanupProjects, claim, makeProject } from "./helpers.js";

afterAll(cleanupProjects);

function fixture(): string {
  return makeProject({
    "index.md": `# Intro\n\n${claim("first-claim", "The first statement.", { type: "empirical" })}`,
    "results.md": `# Results\n\n${claim("second-claim", "The second statement.")}`,
    "oratlas.yml": "canonical_url: https://example.org/review/\n",
  });
}

function manifestPath(root: string): string {
  return join(root, ".oratlas", MANIFEST_FILE_NAME);
}
function claimsPath(root: string): string {
  return join(root, ".oratlas", CLAIMS_ARTIFACT_PATH);
}

function codes(result: ReturnType<typeof validateProject>): string[] {
  return result.errors.map((error) => error.code);
}

describe("validate", () => {
  it("accepts a freshly exported publication", () => {
    const root = fixture();
    exportProject({ projectRoot: root });
    const result = validateProject({ projectRoot: root });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.records).toBe(2);
  });

  it("needs no network access", () => {
    // Nothing in validation dereferences a URL; the canonical URL configured
    // by the fixture is treated as metadata only.
    const root = fixture();
    exportProject({ projectRoot: root });
    const result = validateProject({ projectRoot: root });
    expect(result.ok).toBe(true);
    expect(result.manifest!.publication.canonicalUrl).toBe("https://example.org/review/");
  });

  it("reports a missing artifact", () => {
    const root = fixture();
    exportProject({ projectRoot: root });
    rmSync(claimsPath(root));
    expect(codes(validateProject({ projectRoot: root }))).toContain("artifact-missing");
  });

  it("reports a missing manifest", () => {
    const root = fixture();
    exportProject({ projectRoot: root });
    rmSync(manifestPath(root));
    expect(codes(validateProject({ projectRoot: root }))).toContain("artifact-missing");
  });

  it("reports a tampered source document", () => {
    const root = fixture();
    exportProject({ projectRoot: root });
    // Change the claim's own wording without re-exporting.
    const source = readFileSync(join(root, "index.md"), "utf8");
    writeFileSync(
      join(root, "index.md"),
      source.replace("The first statement.", "A silently rewritten statement."),
      "utf8",
    );
    const result = validateProject({ projectRoot: root });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("source-digest-mismatch");
  });

  it("reports a source edit that leaves the claim itself untouched", () => {
    const root = fixture();
    exportProject({ projectRoot: root });
    const source = readFileSync(join(root, "index.md"), "utf8");
    writeFileSync(join(root, "index.md"), `${source}\nAn appended paragraph.\n`, "utf8");
    // The page digest covers the whole file, so any edit to the page is
    // detected even when the claim block is unchanged.
    expect(codes(validateProject({ projectRoot: root }))).toContain("source-digest-mismatch");
  });

  it("reports a tampered claim digest", () => {
    const root = fixture();
    exportProject({ projectRoot: root });
    const lines = readFileSync(claimsPath(root), "utf8").trim().split("\n");
    const record = JSON.parse(lines[0]!);
    record.declarationSha256 = "0".repeat(64);
    writeFileSync(claimsPath(root), `${[JSON.stringify(record), ...lines.slice(1)].join("\n")}\n`);
    const result = validateProject({ projectRoot: root });
    expect(result.ok).toBe(false);
    // The artifact digest in the manifest catches the edit first.
    expect(codes(result)).toContain("artifact-digest-mismatch");
  });

  it("reports a claim digest tampered together with the manifest digest", () => {
    const root = fixture();
    exportProject({ projectRoot: root });
    const lines = readFileSync(claimsPath(root), "utf8").trim().split("\n");
    const record = JSON.parse(lines[0]!);
    record.declarationSha256 = "0".repeat(64);
    const rewritten = `${[JSON.stringify(record), ...lines.slice(1)].join("\n")}\n`;
    writeFileSync(claimsPath(root), rewritten);
    // Re-point the manifest at the tampered bytes, so only the source binding
    // can still detect the change.
    const manifest = JSON.parse(readFileSync(manifestPath(root), "utf8"));
    manifest.artifacts.claims.sha256 = createHash("sha256").update(rewritten, "utf8").digest("hex");
    writeFileSync(manifestPath(root), `${JSON.stringify(manifest, null, 2)}\n`);
    expect(codes(validateProject({ projectRoot: root }))).toContain("declaration-digest-mismatch");
  });

  it("reports malformed JSONL", () => {
    const root = fixture();
    exportProject({ projectRoot: root });
    writeFileSync(claimsPath(root), '{"schemaVersion":"0.1.0",\nnot json\n');
    const result = validateProject({ projectRoot: root });
    expect(result.ok).toBe(false);
    expect(
      codes(result).some(
        (code) => code.startsWith("jsonl-") || code === "artifact-digest-mismatch",
      ),
    ).toBe(true);
  });

  it("reports a record that does not satisfy the record schema", () => {
    const root = fixture();
    exportProject({ projectRoot: root });
    const lines = readFileSync(claimsPath(root), "utf8").trim().split("\n");
    const record = JSON.parse(lines[0]!);
    delete record.selector;
    writeFileSync(claimsPath(root), `${JSON.stringify(record)}\n`, "utf8");
    const manifest = JSON.parse(readFileSync(manifestPath(root), "utf8"));
    manifest.artifacts.claims.sha256 = "0".repeat(64);
    writeFileSync(manifestPath(root), `${JSON.stringify(manifest, null, 2)}\n`);
    expect(codes(validateProject({ projectRoot: root }))).toContain("claim-record-invalid");
  });

  it("reports a duplicate claim id in the artifact", () => {
    const root = fixture();
    exportProject({ projectRoot: root });
    const lines = readFileSync(claimsPath(root), "utf8").trim().split("\n");
    writeFileSync(claimsPath(root), `${[lines[0], lines[0]].join("\n")}\n`, "utf8");
    expect(codes(validateProject({ projectRoot: root }))).toContain("duplicate-claim-id");
  });

  it("reports an unresolved cross-reference target", () => {
    const root = fixture();
    exportProject({ projectRoot: root });
    const lines = readFileSync(claimsPath(root), "utf8").trim().split("\n");
    const record = JSON.parse(lines[0]!);
    // Point the record at a document that exists but declares no such claim.
    record.id = "missing-claim";
    record.target = { identifier: "missing-claim", htmlId: "missing-claim" };
    writeFileSync(claimsPath(root), `${JSON.stringify(record)}\n`, "utf8");
    const manifest = JSON.parse(readFileSync(manifestPath(root), "utf8"));
    manifest.artifacts.claims.sha256 = "0".repeat(64);
    manifest.artifacts.claims.records = 1;
    writeFileSync(manifestPath(root), `${JSON.stringify(manifest, null, 2)}\n`);
    expect(codes(validateProject({ projectRoot: root }))).toContain("target-unresolved");
  });

  it("reports artifacts that are stale with respect to the source", () => {
    // No TOC, so a newly added page joins the publication. Every existing
    // record still verifies against its own unchanged document, so only the
    // fresh-export comparison can catch that a claim is missing.
    const root = makeProject(
      { "index.md": `# I\n\n${claim("first-claim", "The first statement.")}` },
      { toc: false },
    );
    exportProject({ projectRoot: root });
    writeFileSync(
      join(root, "extra.md"),
      `# Extra\n\n${claim("third-claim", "A new statement.")}`,
      "utf8",
    );
    const result = validateProject({ projectRoot: root });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("artifact-stale");
  });

  it("can skip the fresh-export comparison", () => {
    const root = makeProject(
      { "index.md": `# I\n\n${claim("first-claim", "The first statement.")}` },
      { toc: false },
    );
    exportProject({ projectRoot: root });
    writeFileSync(
      join(root, "extra.md"),
      `# Extra\n\n${claim("third-claim", "A new statement.")}`,
      "utf8",
    );
    expect(codes(validateProject({ projectRoot: root, checkConsistency: false }))).not.toContain(
      "artifact-stale",
    );
  });

  it("reports an edited source before falling through to the staleness check", () => {
    const root = fixture();
    exportProject({ projectRoot: root });
    writeFileSync(
      join(root, "results.md"),
      `${readFileSync(join(root, "results.md"), "utf8")}\n${claim("third-claim", "A new statement.")}`,
      "utf8",
    );
    const result = validateProject({ projectRoot: root });
    expect(result.ok).toBe(false);
    // The precise binding failure is reported, not just "your artifacts are old".
    expect(codes(result)).toContain("source-digest-mismatch");
  });

  it("rejects a manifest that declares an unsafe artifact path", () => {
    const root = fixture();
    exportProject({ projectRoot: root });
    const manifest = JSON.parse(readFileSync(manifestPath(root), "utf8"));
    manifest.artifacts.claims.path = "../../etc/passwd";
    writeFileSync(manifestPath(root), `${JSON.stringify(manifest, null, 2)}\n`);
    const result = validateProject({ projectRoot: root });
    expect(result.ok).toBe(false);
    // The schema refuses the path before anything tries to open it.
    expect(codes(result)).toContain("manifest-invalid");
  });

  it("warns when myst.yml does not publish the artifacts at the site root", () => {
    const root = makeProject({
      "index.md": `# I\n\n${claim("only", "A statement.")}`,
      "myst.yml": [
        "version: 1",
        "project:",
        "  id: no-static",
        "  toc:",
        "    - file: index.md",
        "",
      ].join("\n"),
    });
    exportProject({ projectRoot: root });
    const result = validateProject({ projectRoot: root });
    expect(result.ok).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toContain("static-files-not-declared");
  });

  it("reports a delegated artifact that still carries declaration fields", () => {
    const root = makeProject({
      "index.md": `# I\n\n${claim("shared", "Bound.")}`,
      "review-manifest.json": JSON.stringify({
        schemaVersion: "1.0.0",
        review: { title: "R" },
        repository: { url: "https://github.com/example/r" },
        artifacts: { claims: "knowledge/claims.jsonl" },
      }),
      "knowledge/claims.jsonl": `${JSON.stringify({ id: "shared", text: "Upstream." })}\n`,
      "oratlas.yml": "review_manifest: review-manifest.json\n",
    });
    exportProject({ projectRoot: root });
    const lines = readFileSync(claimsPath(root), "utf8").trim().split("\n");
    const record = JSON.parse(lines[0]!);
    record.text = "A restated claim text that the review manifest already owns.";
    writeFileSync(claimsPath(root), `${JSON.stringify(record)}\n`, "utf8");
    const manifest = JSON.parse(readFileSync(manifestPath(root), "utf8"));
    manifest.artifacts.claims.sha256 = "0".repeat(64);
    writeFileSync(manifestPath(root), `${JSON.stringify(manifest, null, 2)}\n`);
    expect(codes(validateProject({ projectRoot: root }))).toContain(
      "declaration-authority-violation",
    );
  });

  it("fails clearly when there is no MyST project", () => {
    const root = makeProject({ "notes.txt": "not a myst project" });
    rmSync(join(root, "myst.yml"));
    const result = validateProject({ projectRoot: root });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("myst-config-missing");
  });
});
