import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { canonicalJson } from "../src/canonical-json.js";
import { publicationSourceSchema } from "../src/contracts/index.js";
import { exportProject, publicationSourcesSha256 } from "../src/export.js";
import { sha256 } from "../src/hash.js";
import { validateProject } from "../src/validate.js";
import { cleanupProjects, claim, expectOratlasError, makeProject } from "./helpers.js";

afterAll(cleanupProjects);

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

describe("publication identity", () => {
  it("defaults the source-local publication id to myst.yml's project.id", () => {
    const root = makeProject({ "index.md": `# I\n\n${claim("c", "A statement.")}` });
    const { manifest } = exportProject({ projectRoot: root, write: false });
    expect(manifest.publication.id).toBe("test-project");
  });

  it("lets oratlas.yml override the publication id", () => {
    const root = makeProject({
      "index.md": `# I\n\n${claim("c", "A statement.")}`,
      "oratlas.yml": "id: lab-review-2026\n",
    });
    const { manifest } = exportProject({ projectRoot: root, write: false });
    expect(manifest.publication.id).toBe("lab-review-2026");
  });

  it("omits the publication id rather than inventing one", () => {
    const root = makeProject({
      "index.md": `# I\n\n${claim("c", "A statement.")}`,
      "myst.yml": ["version: 1", "project:", "  toc:", "    - file: index.md", ""].join("\n"),
    });
    const { manifest } = exportProject({ projectRoot: root, write: false });
    expect(manifest.publication.id).toBeUndefined();
  });
});

describe("publication version", () => {
  it("is always present, even with no repository, DOI or archive", () => {
    const root = makeProject({ "index.md": `# I\n\n${claim("c", "A statement.")}` });
    const { manifest } = exportProject({ projectRoot: root, write: false });
    expect(manifest.publication.source).toBeUndefined();
    expect(manifest.publication.version.sourcesSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("covers the document set, so it distinguishes versions of one publication", () => {
    const root = makeProject({
      "index.md": `# I\n\n${claim("c", "Version one of the statement.")}`,
    });
    const first = exportProject({ projectRoot: root, write: false }).manifest.publication.version;

    writeFileSync(
      join(root, "index.md"),
      `# I\n\n${claim("c", "Version two of the statement.")}`,
      "utf8",
    );
    const second = exportProject({ projectRoot: root, write: false }).manifest.publication.version;

    expect(second.sourcesSha256).not.toBe(first.sourcesSha256);
  });

  it("changes when a page is added or removed, not only when one is edited", () => {
    const base = { "index.md": `# I\n\n${claim("c", "A statement.")}` };
    const one = makeProject(base, { toc: false });
    const before = exportProject({ projectRoot: one, write: false }).manifest.publication.version;

    writeFileSync(join(one, "extra.md"), "# Extra\n\nNo claims here.\n", "utf8");
    const after = exportProject({ projectRoot: one, write: false }).manifest.publication.version;

    expect(after.sourcesSha256).not.toBe(before.sourcesSha256);
  });

  it("is computed from the document set alone, independently of page order", () => {
    const documents = [
      { path: "results.md", sha256: sha256("b") },
      { path: "index.md", sha256: sha256("a") },
    ];
    const reversed = [...documents].reverse();
    expect(publicationSourcesSha256(documents)).toBe(publicationSourcesSha256(reversed));
  });

  it("has a definition a consumer can reproduce", () => {
    const documents = [{ path: "index.md", sha256: sha256("x") }];
    expect(publicationSourcesSha256(documents)).toBe(
      sha256(
        canonicalJson({
          schemaVersion: "0.3.0",
          documents: [{ path: "index.md", sha256: sha256("x") }],
        }),
      ),
    );
  });

  it("carries an author-declared version label when one is configured", () => {
    const root = makeProject({
      "index.md": `# I\n\n${claim("c", "A statement.")}`,
      "oratlas.yml": "version_label: 2026-08-23\n",
    });
    const { manifest } = exportProject({ projectRoot: root, write: false });
    expect(manifest.publication.version.label).toBe("2026-08-23");
  });

  it("is checked by validate against the current document set", () => {
    const root = makeProject(
      { "index.md": `# I\n\n${claim("c", "A statement.")}` },
      { toc: false },
    );
    exportProject({ projectRoot: root });
    expect(validateProject({ projectRoot: root }).ok).toBe(true);

    // A new page changes the document set without touching any existing
    // record, so only the version digest can catch it.
    writeFileSync(join(root, "extra.md"), "# Extra\n\nNo claims.\n", "utf8");
    const result = validateProject({ projectRoot: root });
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("publication-version-mismatch");
  });
});

describe("publication source descriptor", () => {
  it("accepts a git source", () => {
    const root = makeProject({
      "index.md": `# I\n\n${claim("c", "A statement.")}`,
      "oratlas.yml": [
        "source:",
        "  type: git",
        "  repository: https://github.com/lab/review",
        "  ref: v1.0.0",
        "",
      ].join("\n"),
    });
    const { manifest } = exportProject({ projectRoot: root, write: false });
    expect(manifest.publication.source).toEqual({
      type: "git",
      repository: "https://github.com/lab/review",
      ref: "v1.0.0",
    });
  });

  it("accepts a DOI source and keeps version and concept DOIs distinct", () => {
    const root = makeProject({
      "index.md": `# I\n\n${claim("c", "A statement.")}`,
      "oratlas.yml": [
        "source:",
        "  type: doi",
        "  versionDoi: 10.5281/zenodo.1234567",
        "  conceptDoi: 10.5281/zenodo.1234566",
        "",
      ].join("\n"),
    });
    const { manifest } = exportProject({ projectRoot: root, write: false });
    // ORAtlas requires these to never be collapsed into one field.
    expect(manifest.publication.source).toEqual({
      type: "doi",
      versionDoi: "10.5281/zenodo.1234567",
      conceptDoi: "10.5281/zenodo.1234566",
    });
  });

  it("accepts an archive source with an integrity digest", () => {
    const digest = sha256("bundle");
    const root = makeProject({
      "index.md": `# I\n\n${claim("c", "A statement.")}`,
      "oratlas.yml": [
        "source:",
        "  type: archive",
        "  url: https://archive.example.org/review-v1.zip",
        `  sha256: ${digest}`,
        "  format: zip",
        "",
      ].join("\n"),
    });
    const { manifest } = exportProject({ projectRoot: root, write: false });
    expect(manifest.publication.source).toMatchObject({ type: "archive", sha256: digest });
  });

  it("rejects an unknown source type rather than passing it through", () => {
    const root = makeProject({
      "index.md": `# I\n\n${claim("c", "A statement.")}`,
      "oratlas.yml": "source:\n  type: ftp\n  url: ftp://example.org/x\n",
    });
    expectOratlasError(
      () => exportProject({ projectRoot: root, write: false }),
      /not a valid ftp source descriptor|source\.type/,
    );
  });

  it("rejects a bare DOI written with a resolver prefix", () => {
    // ORAtlas normalises DOIs to the bare form; accepting a resolver URL here
    // would push that cleanup onto every consumer.
    expect(
      publicationSourceSchema.safeParse({
        type: "doi",
        versionDoi: "https://doi.org/10.5281/zenodo.1",
      }).success,
    ).toBe(false);
  });

  it("rejects a non-https repository", () => {
    const root = makeProject({
      "index.md": `# I\n\n${claim("c", "A statement.")}`,
      "oratlas.yml": "source:\n  type: git\n  repository: git@github.com:lab/review.git\n",
    });
    expectOratlasError(
      () => exportProject({ projectRoot: root, write: false }),
      /not a valid git source descriptor/,
    );
  });

  it("notes when no source is declared, because that limits verification", () => {
    const root = makeProject({ "index.md": `# I\n\n${claim("c", "A statement.")}` });
    const { notes } = exportProject({ projectRoot: root, write: false });
    expect(notes.join("\n")).toContain("cannot verify the source-byte digests");
  });
});

describe("--source-commit", () => {
  const gitProject = () =>
    makeProject({
      "index.md": `# I\n\n${claim("c", "A statement.")}`,
      "oratlas.yml": "source:\n  type: git\n  repository: https://github.com/lab/review\n",
    });

  it("fills in the commit a git-backed publication was built from", () => {
    const root = gitProject();
    const { manifest } = exportProject({
      projectRoot: root,
      write: false,
      sourceCommit: COMMIT,
    });
    expect(manifest.publication.source).toEqual({
      type: "git",
      repository: "https://github.com/lab/review",
      commit: COMMIT,
    });
  });

  it("accepts a SHA-256 object id as well as a SHA-1 one", () => {
    const root = gitProject();
    const sha256Commit = "a".repeat(64);
    const { manifest } = exportProject({
      projectRoot: root,
      write: false,
      sourceCommit: sha256Commit,
    });
    expect(manifest.publication.source).toMatchObject({ commit: sha256Commit });
  });

  it("rejects anything that is not a full lowercase object id", () => {
    for (const bad of ["HEAD", "abc123", COMMIT.toUpperCase(), `${COMMIT}0`]) {
      expectOratlasError(
        () => exportProject({ projectRoot: gitProject(), write: false, sourceCommit: bad }),
        /not a full lowercase git object id/,
      );
    }
  });

  it("refuses a commit when no source is declared", () => {
    const root = makeProject({ "index.md": `# I\n\n${claim("c", "A statement.")}` });
    expectOratlasError(
      () => exportProject({ projectRoot: root, write: false, sourceCommit: COMMIT }),
      /declares no `source:` block/,
    );
  });

  it("refuses a commit for a non-git source", () => {
    const root = makeProject({
      "index.md": `# I\n\n${claim("c", "A statement.")}`,
      "oratlas.yml": "source:\n  type: doi\n  versionDoi: 10.5281/zenodo.1\n",
    });
    expectOratlasError(
      () => exportProject({ projectRoot: root, write: false, sourceCommit: COMMIT }),
      /the declared source is of type "doi"/,
    );
  });

  it("does not make a git-backed publication validate as stale", () => {
    // The commit is a build-time input that a fresh export cannot rediscover,
    // so validate feeds the recorded one back in. Without that, every
    // git-backed publication would report its own artifacts as stale.
    const root = gitProject();
    exportProject({ projectRoot: root, sourceCommit: COMMIT });
    const result = validateProject({ projectRoot: root });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("still catches a genuinely stale artifact on a git-backed publication", () => {
    const root = makeProject(
      {
        "index.md": `# I\n\n${claim("c", "A statement.")}`,
        "oratlas.yml": "source:\n  type: git\n  repository: https://github.com/lab/review\n",
      },
      { toc: false },
    );
    exportProject({ projectRoot: root, sourceCommit: COMMIT });
    writeFileSync(join(root, "extra.md"), `# Extra\n\n${claim("d", "Another.")}`, "utf8");
    expect(validateProject({ projectRoot: root }).ok).toBe(false);
  });

  it("keeps the export deterministic for a given commit", () => {
    const root = gitProject();
    const first = exportProject({ projectRoot: root, write: false, sourceCommit: COMMIT });
    const second = exportProject({ projectRoot: root, write: false, sourceCommit: COMMIT });
    expect(second.files).toEqual(first.files);
  });

  it("never reads a commit from the working tree", () => {
    // Detecting the commit would make the manifest disagree with the bytes
    // whenever the tree is dirty — exactly when provenance matters most.
    const root = gitProject();
    const { manifest } = exportProject({ projectRoot: root, write: false });
    expect(manifest.publication.source).toEqual({
      type: "git",
      repository: "https://github.com/lab/review",
    });
  });
});
