import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  oratlasManifestSchema,
  oratlasManifestV020Schema,
  oratlasManifestV030Schema,
} from "../src/contracts/index.js";
import { exportProject } from "../src/export.js";
import { validateProject } from "../src/validate.js";
import { cleanupProjects, expectOratlasError, makeProject, writeProjectFile } from "./helpers.js";

afterAll(cleanupProjects);

const mystWithAuthors = [
  "version: 1",
  "project:",
  "  id: authored-paper",
  "  title: Authored paper",
  "  authors:",
  "    - id: alice",
  "      name:",
  "        given: Alice",
  "        family: Smith",
  "      orcid: https://orcid.org/0000-0002-1825-0097",
  "      corresponding: true",
  "      email: alice@example.org",
  "      roles: [Conceptualization, Writing - original draft]",
  "      url: https://example.org/alice",
  "      affiliations:",
  "        - example-university",
  "    - name: Bob Jones",
  "  affiliations:",
  "    - id: example-university",
  "      institution: Example University",
  "  static_files:",
  "    - .oratlas/oratlas.manifest.json",
  "    - .oratlas/oratlas",
  "  toc:",
  "    - file: index.md",
  "site:",
  "  template: book-theme",
  "",
].join("\n");

describe("protocol 0.2.0 compatibility", () => {
  it("keeps the frozen closed 0.2.0 manifest accepted unchanged", () => {
    const fixture = JSON.parse(
      readFileSync(join(import.meta.dirname, "fixtures", "protocol-0.2", "manifest.json"), "utf8"),
    );
    expect(oratlasManifestV020Schema.safeParse(fixture).success).toBe(true);
    expect(oratlasManifestSchema.safeParse(fixture).success).toBe(true);
  });

  it("exports and validates 0.2.0 only when explicitly selected", () => {
    const root = makeProject({
      "index.md": "# Legacy\n",
      "oratlas.yml": "schema_version: 0.2.0\n",
      "myst.yml": mystWithAuthors,
    });
    const result = exportProject({ projectRoot: root });
    expect(result.manifest.schemaVersion).toBe("0.2.0");
    expect(result.manifest).not.toHaveProperty("contributors");
    expect(result.manifest).not.toHaveProperty("production");
    expect(validateProject({ projectRoot: root }).ok).toBe(true);
  });

  it("does not silently add 0.3 declarations to an explicit 0.2 export", () => {
    const root = makeProject({
      "index.md": "# Legacy\n",
      "oratlas.yml": [
        "schema_version: 0.2.0",
        "production:",
        "  mode: human",
        "  actors: []",
        "",
      ].join("\n"),
    });
    expectOratlasError(() => exportProject({ projectRoot: root, write: false }), /cannot declare/);
  });

  it("validates a 0.2 artifact without rewriting its historical generator version", () => {
    const root = makeProject({ "index.md": "# Frozen legacy bytes\n" });
    const legacy = exportProject({
      projectRoot: root,
      write: false,
      protocolVersion: "0.2.0",
    });
    for (const file of legacy.files) {
      const content =
        file.path === "oratlas.manifest.json"
          ? `${JSON.stringify(
              { ...legacy.manifest, generator: { ...legacy.manifest.generator, version: "0.2.1" } },
              null,
              2,
            )}\n`
          : file.content;
      writeProjectFile(root, `.oratlas/${file.path}`, content);
    }
    expect(validateProject({ projectRoot: root }).ok).toBe(true);
  });
});

describe("protocol 0.3.0 scholarly contributors", () => {
  it("maps standard MyST authors deterministically and preserves order", () => {
    const root = makeProject({ "index.md": "# Paper\n", "myst.yml": mystWithAuthors });
    const first = exportProject({ projectRoot: root, write: false });
    const second = exportProject({ projectRoot: root, write: false });
    expect(first.files).toEqual(second.files);
    expect(first.manifest.schemaVersion).toBe("0.3.0");
    expect(first.manifest).toMatchObject({
      contributors: [
        {
          sourceContributorKey: "alice",
          kind: "person",
          displayName: "Alice Smith",
          givenName: "Alice",
          familyName: "Smith",
          identifiers: [{ scheme: "orcid", value: "0000-0002-1825-0097" }],
          affiliations: ["Example University"],
          roles: ["author", "corresponding-author"],
          position: 1,
          publicUrl: "https://example.org/alice",
        },
        {
          sourceContributorKey: "myst-author-2",
          kind: "person",
          displayName: "Bob Jones",
          roles: ["author"],
          position: 2,
        },
      ],
    });
    expect(JSON.stringify(first.manifest)).not.toContain("email");
    expect(first.manifest).not.toHaveProperty("production");
    exportProject({ projectRoot: root });
    expect(validateProject({ projectRoot: root }).ok).toBe(true);
  });

  it("supports an explicit institutional group author", () => {
    const root = makeProject({
      "index.md": "# Group paper\n",
      "oratlas.yml": [
        "contributors:",
        "  - key: consortium",
        "    kind: organization",
        "    name: Example Research Consortium",
        "    ror: https://ror.org/03yrm5c26",
        "    url: https://example.org/consortium",
        "    roles: [group-author]",
        "",
      ].join("\n"),
    });
    const { manifest } = exportProject({ projectRoot: root });
    expect(manifest).toMatchObject({
      contributors: [
        {
          sourceContributorKey: "consortium",
          kind: "organization",
          identifiers: [{ scheme: "ror", value: "https://ror.org/03yrm5c26" }],
          roles: ["group-author"],
          position: 1,
        },
      ],
    });
  });

  it("retains ORCID as a declaration without resolving or minting identity", () => {
    const root = makeProject({ "index.md": "# Paper\n", "myst.yml": mystWithAuthors });
    const serialized = JSON.stringify(exportProject({ projectRoot: root, write: false }).manifest);
    expect(serialized).toContain("0000-0002-1825-0097");
    expect(serialized).not.toMatch(/canonicalId|knowledgeNode|personId/i);
  });
});

describe("protocol 0.3.0 production provenance", () => {
  const production = [
    "production:",
    "  source_assertion_key: workflow-2026",
    "  mode: hybrid",
    "  actors:",
    "    - id: ars",
    "      kind: workflow",
    "      name: Academic Research Skills",
    "      version: 1.2.0",
    "      activities: [evidence-search, evidence-synthesis, drafting]",
    "    - id: alice",
    "      kind: person",
    "      name: Alice Smith",
    "      activities: [editing, reviewing]",
    "",
  ].join("\n");

  it("accepts a production-only agentic publication with no contributor declaration", () => {
    const root = makeProject({
      "index.md": "# Agentic publication\n",
      "oratlas.yml": [
        "production:",
        "  mode: agentic",
        "  actors:",
        "    - id: agent",
        "      kind: ai-system",
        "      name: Research Agent",
        "      model: example-model",
        "      model_version: '2026-08'",
        "      activities: [evidence-search, drafting]",
        "",
      ].join("\n"),
    });
    const { manifest } = exportProject({ projectRoot: root });
    expect(oratlasManifestV030Schema.safeParse(manifest).success).toBe(true);
    expect(manifest).not.toHaveProperty("contributors");
    expect(manifest).toMatchObject({
      production: { strength: "source-declared", mode: "agentic" },
    });
    expect(JSON.stringify(manifest)).not.toMatch(/agentRunId|executionPassportId/);
    expect(validateProject({ projectRoot: root }).ok).toBe(true);
  });

  it("keeps contributors and production independent even when Alice is declared in both", () => {
    const root = makeProject({
      "index.md": "# Hybrid paper\n",
      "myst.yml": mystWithAuthors,
      "oratlas.yml": production,
    });
    const { manifest } = exportProject({ projectRoot: root, write: false });
    if (manifest.schemaVersion !== "0.3.0") throw new Error("Expected protocol 0.3.0.");
    expect(manifest.contributors?.[0]).toMatchObject({
      sourceContributorKey: "alice",
      roles: ["author", "corresponding-author"],
    });
    expect(manifest.production?.actors).toMatchObject([
      { id: "ars", kind: "workflow" },
      { id: "alice", kind: "person", activities: ["editing", "reviewing"] },
    ]);
  });

  it("never infers production or human mode from dependencies, plugins, or authors", () => {
    const root = makeProject({
      "index.md": "# Human paper\n",
      "myst.yml": mystWithAuthors.replace(
        "  static_files:",
        "  plugins:\n    - node_modules/openai/example.mjs\n  static_files:",
      ),
      "package.json": JSON.stringify({
        dependencies: { openai: "latest", "ars-workflow": "1.0.0" },
      }),
    });
    const { manifest } = exportProject({ projectRoot: root, write: false });
    expect(manifest).toHaveProperty("contributors");
    expect(manifest).not.toHaveProperty("production");
  });

  it("emits human mode only when explicitly declared", () => {
    const root = makeProject({
      "index.md": "# Human paper\n",
      "oratlas.yml": "production:\n  mode: human\n  actors: []\n",
    });
    expect(exportProject({ projectRoot: root, write: false }).manifest).toMatchObject({
      production: { mode: "human", actors: [], strength: "source-declared" },
    });
  });
});

describe("protocol 0.3.0 fail-closed validation", () => {
  it("makes oratlas-myst validate reject a malformed 0.3 production declaration", () => {
    const root = makeProject({ "index.md": "# Invalid generated artifact\n" });
    const exported = exportProject({ projectRoot: root });
    if (exported.manifest.schemaVersion !== "0.3.0") {
      throw new Error("Expected protocol 0.3.0.");
    }
    const malformed = {
      ...exported.manifest,
      production: {
        sourceAssertionKey: "bad",
        strength: "source-declared",
        mode: "agentic",
        actors: [
          { id: "same", kind: "workflow", name: "One", activities: ["drafting"] },
          { id: "same", kind: "ai-system", name: "Two", activities: ["drafting"] },
        ],
      },
    };
    writeProjectFile(root, ".oratlas/oratlas.manifest.json", `${JSON.stringify(malformed)}\n`);
    const validation = validateProject({ projectRoot: root, checkConsistency: false });
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((error) => error.code === "manifest-invalid")).toBe(true);
  });

  it("keeps checked-in valid and malformed examples aligned with the contract", () => {
    const examples = join(import.meta.dirname, "..", "protocol", "examples");
    for (const name of [
      "human",
      "ai-assisted",
      "ars-hybrid",
      "agentic-no-contributors",
      "group-author",
    ]) {
      const value = JSON.parse(readFileSync(join(examples, `${name}.manifest.json`), "utf8"));
      expect(oratlasManifestV030Schema.safeParse(value).success, name).toBe(true);
    }
    for (const name of ["duplicate-actor", "software-contributor"]) {
      const value = JSON.parse(
        readFileSync(join(examples, "malformed", `${name}.manifest.json`), "utf8"),
      );
      expect(oratlasManifestSchema.safeParse(value).success, name).toBe(false);
    }
  });

  it.each([
    [
      "software scholarly contributor",
      "contributors:\n  - key: tool\n    kind: software\n    name: Tool\n    roles: [author]\n",
    ],
    [
      "invalid ORCID",
      "contributors:\n  - key: alice\n    kind: person\n    name: Alice\n    orcid: 0000-0002-1825-0098\n    roles: [author]\n",
    ],
    [
      "duplicate contributor key",
      "contributors:\n  - key: same\n    kind: person\n    name: Alice\n    roles: [author]\n  - key: same\n    kind: person\n    name: Bob\n    roles: [author]\n",
    ],
    [
      "duplicate production actor id",
      "production:\n  mode: hybrid\n  actors:\n    - id: same\n      kind: person\n      name: Alice\n      activities: [editing]\n    - id: same\n      kind: ai-system\n      name: Agent\n      activities: [drafting]\n",
    ],
    [
      "unsupported actor kind",
      "production:\n  mode: agentic\n  actors:\n    - id: x\n      kind: author\n      name: X\n      activities: [drafting]\n",
    ],
    [
      "malformed activity",
      "production:\n  mode: agentic\n  actors:\n    - id: x\n      kind: workflow\n      name: X\n      activities: [web-browsing]\n",
    ],
    [
      "unsafe public URL",
      "production:\n  mode: agentic\n  actors:\n    - id: x\n      kind: workflow\n      name: X\n      url: file:///etc/passwd\n      activities: [drafting]\n",
    ],
  ])("rejects %s", (_label, config) => {
    const root = makeProject({ "index.md": "# Invalid\n", "oratlas.yml": config });
    expectOratlasError(
      () => exportProject({ projectRoot: root, write: false }),
      /invalid|valid|unique|unsupported|Must/i,
    );
  });
});
