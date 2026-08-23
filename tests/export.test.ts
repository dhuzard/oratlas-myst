import { readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CLAIMS_ARTIFACT_PATH, MANIFEST_FILE_NAME, exportProject } from "../src/export.js";
import { OratlasMystError } from "../src/errors.js";
import { claimDeclarationSha256, sha256 } from "../src/hash.js";
import { discoverPages } from "../src/project.js";
import { loadConfig } from "../src/config.js";
import { parseDocument } from "../src/parse-claims.js";
import { cleanupProjects, claim, expectOratlasError, makeProject } from "./helpers.js";

afterAll(cleanupProjects);

function readArtifacts(root: string): { manifest: string; claims: string } {
  return {
    manifest: readFileSync(join(root, ".oratlas", MANIFEST_FILE_NAME), "utf8"),
    claims: readFileSync(join(root, ".oratlas", CLAIMS_ARTIFACT_PATH), "utf8"),
  };
}

describe("export", () => {
  it("produces one record per declared claim, across pages", () => {
    const root = makeProject({
      "index.md": `# Intro\n\n${claim("first", "The first statement.")}`,
      "results.md": `# Results\n\n${claim("second", "The second statement.", { type: "empirical" })}\n\n${claim("third", "The third statement.")}`,
    });
    const result = exportProject({ projectRoot: root, write: false });
    expect(result.claims.map((record) => record.id)).toEqual(["first", "second", "third"]);
    expect(result.manifest.artifacts.claims.records).toBe(3);
    expect(result.claims[1]!.claimType).toBe("empirical");
  });

  it("is byte-identical across two runs on identical source", () => {
    const root = makeProject({
      "index.md": `# Intro\n\n${claim("b-claim", "Beta.")}\n\n${claim("a-claim", "Alpha.")}`,
      "results.md": `# Results\n\n${claim("c-claim", "Gamma.")}`,
    });
    exportProject({ projectRoot: root });
    const first = readArtifacts(root);
    exportProject({ projectRoot: root });
    const second = readArtifacts(root);
    expect(second.manifest).toBe(first.manifest);
    expect(second.claims).toBe(first.claims);
  });

  it("writes no timestamp, absolute path, or other environment-dependent value", () => {
    const root = makeProject({ "index.md": `# Intro\n\n${claim("only", "A statement.")}` });
    const { manifest, claims } = (() => {
      exportProject({ projectRoot: root });
      return readArtifacts(root);
    })();
    const combined = `${manifest}\n${claims}`;
    expect(combined).not.toContain(root);
    expect(combined).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(combined).not.toContain(process.cwd());
    // No Windows-style separators or drive letters leak into the artifacts.
    expect(manifest).not.toMatch(/[A-Za-z]:\\/);
    expect(JSON.parse(manifest).artifacts.claims.path).not.toContain("\\");
  });

  it("orders records by document, then source position, then id", () => {
    const root = makeProject({
      "zzz.md": `# Z\n\n${claim("z-one", "Z one.")}`,
      "aaa.md": `# A\n\n${claim("a-two", "A two.")}\n\n${claim("a-one", "A one.")}`,
    });
    const result = exportProject({ projectRoot: root, write: false });
    expect(result.claims.map((record) => `${record.source.documentPath}:${record.id}`)).toEqual([
      "aaa.md:a-two",
      "aaa.md:a-one",
      "zzz.md:z-one",
    ]);
  });

  it("does not depend on the host locale for ordering", () => {
    // A locale-aware comparator would order these differently from code-unit
    // order; the export must not use one.
    const root = makeProject({
      "index.md": `# I\n\n${claim("resume", "Plain.")}\n\n${claim("resume-2", "Accented neighbour.")}\n\n${claim("zebra", "Last.")}`,
    });
    const first = exportProject({ projectRoot: root, write: false });
    const originalLocale = process.env.LC_ALL;
    process.env.LC_ALL = "de_DE.UTF-8";
    try {
      const second = exportProject({ projectRoot: root, write: false });
      expect(second.files).toEqual(first.files);
    } finally {
      if (originalLocale === undefined) delete process.env.LC_ALL;
      else process.env.LC_ALL = originalLocale;
    }
  });

  it("binds each record to its source document digest and block digest", () => {
    const source = `# Intro\n\n${claim("bound", "A bound statement.")}`;
    const root = makeProject({ "index.md": source });
    const [record] = exportProject({ projectRoot: root, write: false }).claims;

    expect(record!.source.documentSha256).toBe(sha256(source));

    const lines = source.split("\n");
    const block = lines.slice(record!.source.startLine - 1, record!.source.endLine).join("\n");
    expect(record!.source.blockSha256).toBe(sha256(block));
    expect(block.startsWith(":::{oratlas:claim} bound")).toBe(true);
    expect(block.endsWith(":::")).toBe(true);
  });

  it("computes the declaration digest over the declaration alone", () => {
    // The same declaration in a different document, at a different position,
    // with different surrounding prose, keeps the same declaration digest.
    const body = "An identical statement.";
    const first = makeProject({ "index.md": `# One\n\n${claim("same", body)}` });
    const second = makeProject({
      "index.md": `# Two\n\nA long preamble that shifts every line number.\n\nMore prose.\n\n${claim("same", body)}`,
    });
    const a = exportProject({ projectRoot: first, write: false }).claims[0]!;
    const b = exportProject({ projectRoot: second, write: false }).claims[0]!;

    expect(a.declarationSha256).toBe(b.declarationSha256);
    expect(a.source.documentSha256).not.toBe(b.source.documentSha256);
    const occurrence = parseDocument(readFileSync(join(first, "index.md"), "utf8"), "index.md")
      .claims[0]!;
    expect(a.declarationSha256).toBe(
      claimDeclarationSha256({ id: "same", body: occurrence.bodySource }),
    );
  });

  it("gives different digests to identical text declared under different ids", () => {
    const root = makeProject({
      "index.md": `# I\n\n${claim("id-one", "Exactly the same sentence.")}\n\n${claim("id-two", "Exactly the same sentence.")}`,
    });
    const result = exportProject({ projectRoot: root, write: false });
    expect(result.claims).toHaveLength(2);
    expect(result.claims[0]!.text).toBe(result.claims[1]!.text);
    // Identity comes from the author's explicit id, never from the text.
    expect(result.claims[0]!.declarationSha256).not.toBe(result.claims[1]!.declarationSha256);
  });

  it("distinguishes several occurrences of the same sentence in one document", () => {
    const sentence = "The effect was replicated.";
    const root = makeProject({
      "index.md": [
        "# I",
        "",
        sentence,
        "",
        claim("first-occurrence", sentence),
        "",
        sentence,
        "",
        claim("second-occurrence", sentence),
        "",
        sentence,
      ].join("\n"),
    });
    const result = exportProject({ projectRoot: root, write: false });
    const [first, second] = result.claims;
    // Positions differ even though the quoted text is identical, so the two
    // occurrences are separable.
    expect(first!.selector.textPosition.start).not.toBe(second!.selector.textPosition.start);
    expect(first!.selector.textQuote.prefix).not.toBe(second!.selector.textQuote.prefix);
  });

  it("records selectors that locate the claim exactly in the source", () => {
    const source = `# I\n\n${claim("located", "A precisely located statement.")}`;
    const root = makeProject({ "index.md": source });
    const [record] = exportProject({ projectRoot: root, write: false }).claims;
    const { start, end } = record!.selector.textPosition;
    const quoted = Array.from(source).slice(start, end).join("");
    expect(quoted).toBe(record!.selector.textQuote.exact);
    expect(record!.selector.unit).toBe("body");
    expect(record!.selector.representation).toBe("oratlas-myst-source-utf8-v1");
  });

  it("keeps selector offsets correct in the presence of astral-plane characters", () => {
    const source = [
      "# 🧪🧬 Intro",
      "",
      "Prefix 🐁 text.",
      "",
      claim("unicode", "Effects in naïve 🐁 cohorts were absent."),
    ].join("\n");
    const root = makeProject({ "index.md": source });
    const [record] = exportProject({ projectRoot: root, write: false }).claims;
    const { start, end } = record!.selector.textPosition;
    // Offsets are code points, not UTF-16 code units: slicing the string
    // directly would be off by the number of preceding astral characters.
    expect(Array.from(source).slice(start, end).join("")).toBe(record!.selector.textQuote.exact);
    expect(source.slice(start, end)).not.toBe(record!.selector.textQuote.exact);
    expect(record!.text).toBe("Effects in naïve 🐁 cohorts were absent.");
  });

  it("falls back to quoting the whole block when the body is dedented", () => {
    const root = makeProject({
      "index.md": [
        "# I",
        "",
        "::::{note}",
        "A note containing a claim.",
        "",
        ":::{oratlas:claim} nested-claim",
        "",
        "A nested statement.",
        ":::",
        "::::",
      ].join("\n"),
    });
    const [record] = exportProject({ projectRoot: root, write: false }).claims;
    expect(record).toBeDefined();
    const source = readFileSync(join(root, "index.md"), "utf8");
    const { start, end } = record!.selector.textPosition;
    expect(Array.from(source).slice(start, end).join("")).toBe(record!.selector.textQuote.exact);
  });

  it("rejects a duplicate claim id declared on different pages", () => {
    const root = makeProject({
      "index.md": `# I\n\n${claim("shared", "First.")}`,
      "results.md": `# R\n\n${claim("shared", "Second.")}`,
    });
    expectOratlasError(
      () => exportProject({ projectRoot: root, write: false }),
      /Duplicate claim id "shared"/,
    );
  });

  it("rejects a malformed claim id at export time", () => {
    const root = makeProject({
      "index.md": ["# I", "", ":::{oratlas:claim} Bad Id", "", "Statement.", ":::"].join("\n"),
    });
    expectOratlasError(
      () => exportProject({ projectRoot: root, write: false }),
      /not a valid source-local claim id/,
    );
  });

  it("records the exact bytes it writes", () => {
    const root = makeProject({ "index.md": `# I\n\n${claim("only", "A statement.")}` });
    const result = exportProject({ projectRoot: root });
    const onDisk = readArtifacts(root);
    expect(result.files.find((file) => file.path === MANIFEST_FILE_NAME)!.content).toBe(
      onDisk.manifest,
    );
    expect(result.files.find((file) => file.path === CLAIMS_ARTIFACT_PATH)!.content).toBe(
      onDisk.claims,
    );
    // The declared digest covers exactly those bytes.
    expect(result.manifest.artifacts.claims.sha256).toBe(sha256(onDisk.claims));
  });

  it("writes JSONL with one record per line and a trailing newline", () => {
    const root = makeProject({
      "index.md": `# I\n\n${claim("a", "A.")}\n\n${claim("b", "B.")}`,
    });
    exportProject({ projectRoot: root });
    const { claims } = readArtifacts(root);
    expect(claims.endsWith("\n")).toBe(true);
    const lines = claims.split("\n").filter((line) => line.length > 0);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it("produces an empty claims artifact when the publication declares none", () => {
    const root = makeProject({ "index.md": "# I\n\nNo claims here.\n" });
    const result = exportProject({ projectRoot: root, write: false });
    expect(result.claims).toEqual([]);
    expect(result.manifest.artifacts.claims.records).toBe(0);
    expect(result.manifest.artifacts.claims.sha256).toBe(sha256(""));
  });

  it("emits only safe, ORAtlas-compatible relative paths in the manifest", () => {
    const root = makeProject({ "index.md": `# I\n\n${claim("only", "A statement.")}` });
    const { manifest } = exportProject({ projectRoot: root, write: false });
    for (const path of [manifest.adapter.xref, manifest.artifacts.claims.path]) {
      expect(path.startsWith("./")).toBe(false);
      expect(path.startsWith("/")).toBe(false);
      expect(path).not.toContain("..");
      expect(path).not.toContain("\\");
      expect(path).not.toContain(":");
    }
  });
});

describe("path safety", () => {
  it("rejects a TOC entry that escapes the project root", () => {
    const root = makeProject({
      "index.md": "# I\n",
      "myst.yml": [
        "version: 1",
        "project:",
        "  id: escape",
        "  toc:",
        "    - file: ../../etc/passwd",
        "",
      ].join("\n"),
    });
    expect(() => exportProject({ projectRoot: root, write: false })).toThrowError(OratlasMystError);
  });

  it("rejects an absolute TOC entry", () => {
    const root = makeProject({
      "index.md": "# I\n",
      "myst.yml": [
        "version: 1",
        "project:",
        "  id: abs",
        "  toc:",
        "    - file: /etc/passwd",
        "",
      ].join("\n"),
    });
    expect(() => exportProject({ projectRoot: root, write: false })).toThrowError(OratlasMystError);
  });

  it("does not follow symbolic links during page discovery", () => {
    // No TOC, so discovery walks the directory and meets the symlink. The walk
    // uses lstat and refuses the link outright: following it would let a link
    // inside the project walk the filesystem outside it, and a link to an
    // ancestor would make the walk unbounded.
    const root = makeProject(
      { "index.md": `# I\n\n${claim("real", "A real claim.")}` },
      { toc: false },
    );
    const outside = join(root, "..", `oratlas-outside-${process.pid}.md`);
    writeFileSync(
      outside,
      `# Outside\n\n${claim("smuggled", "Should never be exported.")}`,
      "utf8",
    );
    symlinkSync(outside, join(root, "escape.md"));
    try {
      const discovered = discoverPages(loadConfig(root));
      expect(discovered.pages.map((page) => page.path)).toEqual(["index.md"]);
      expect(discovered.skipped.map((entry) => entry.path)).toContain("escape.md");
      expect(discovered.skipped.find((entry) => entry.path === "escape.md")!.reason).toContain(
        "symbolic links are not followed",
      );

      const result = exportProject({ projectRoot: root, write: false });
      expect(result.claims.map((record) => record.id)).toEqual(["real"]);
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("does not follow a symlinked directory during page discovery", () => {
    // A link to an ancestor directory is the cycle case: statSync would
    // recurse forever, lstatSync sees a link and stops.
    const root = makeProject(
      { "index.md": `# I\n\n${claim("real", "A real claim.")}` },
      { toc: false },
    );
    symlinkSync(root, join(root, "loop"));
    const discovered = discoverPages(loadConfig(root));
    expect(discovered.pages.map((page) => page.path)).toEqual(["index.md"]);
  });

  it("still refuses a TOC entry that reaches outside the project through a symlink", () => {
    // A TOC entry is an explicit author declaration, so a link that stays
    // inside the project is honoured — but one that escapes is refused by the
    // realpath check, not merely skipped.
    const root = makeProject({ "index.md": "# I\n" }, { toc: ["index.md", "escape.md"] });
    const outside = join(root, "..", `oratlas-toc-outside-${process.pid}.md`);
    writeFileSync(outside, "# Outside\n", "utf8");
    symlinkSync(outside, join(root, "escape.md"));
    try {
      expectOratlasError(
        () => exportProject({ projectRoot: root, write: false }),
        /outside the project root/,
      );
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("follows a TOC-declared symlink that stays inside the project", () => {
    const root = makeProject(
      { "pages/real.md": `# R\n\n${claim("linked", "Declared through a link.")}` },
      { toc: ["alias.md"] },
    );
    symlinkSync(join(root, "pages", "real.md"), join(root, "alias.md"));
    const result = exportProject({ projectRoot: root, write: false });
    expect(result.claims.map((record) => record.id)).toEqual(["linked"]);
  });

  it("refuses to read a config file that is a symlink out of the project", () => {
    const root = makeProject({ "index.md": "# I\n" });
    const outside = join(root, "..", `oratlas-config-${process.pid}.yml`);
    writeFileSync(outside, "canonical_url: https://evil.example/\n", "utf8");
    symlinkSync(outside, join(root, "oratlas.yml"));
    try {
      expectOratlasError(
        () => exportProject({ projectRoot: root, write: false }),
        /outside the project root/,
      );
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("rejects an unsafe output directory in oratlas.yml", () => {
    const root = makeProject({
      "index.md": "# I\n",
      "oratlas.yml": "output: ../escape\n",
    });
    expect(() => exportProject({ projectRoot: root, write: false })).toThrowError(
      /'output' must be a safe project-relative directory path/,
    );
  });

  it("rejects an unknown key in oratlas.yml rather than ignoring it", () => {
    const root = makeProject({
      "index.md": "# I\n",
      "oratlas.yml": "canonical_url: https://example.org/\nregistry_url: https://evil.example/\n",
    });
    expect(() => exportProject({ projectRoot: root, write: false })).toThrowError(
      /unknown key\(s\): registry_url/,
    );
  });

  it("rejects a non-https canonical URL", () => {
    const root = makeProject({
      "index.md": "# I\n",
      "oratlas.yml": "canonical_url: http://example.org/\n",
    });
    expect(() => exportProject({ projectRoot: root, write: false })).toThrowError(
      /absolute https:\/\/ URL/,
    );
  });
});
