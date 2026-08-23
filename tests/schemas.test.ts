import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import { afterAll, describe, expect, it } from "vitest";
import { exportProject } from "../src/export.js";
import { schemaDrift } from "../scripts/generate-schemas.js";
import { cleanupProjects, claim, makeProject } from "./helpers.js";

afterAll(cleanupProjects);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(REPO_ROOT, "schemas", `${name}.schema.json`), "utf8"));
}

function compile(name: string) {
  // `strict: false` because zod-to-json-schema emits draft-07 keywords Ajv's
  // strict mode flags as unknown; the constraints themselves are honoured.
  const ajv = new Ajv({ strict: false, allErrors: true });
  return ajv.compile(loadSchema(name));
}

describe("published JSON Schemas", () => {
  it("stay in step with the Zod contracts", () => {
    // The Zod contracts are the single definition; `pnpm run schemas` renders
    // them. If this fails, regenerate rather than editing schemas/ by hand.
    expect(schemaDrift(REPO_ROOT)).toEqual([]);
  });

  it("declare a draft, an id and a title", () => {
    for (const name of ["oratlas-manifest", "oratlas-claim"]) {
      const schema = loadSchema(name);
      expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
      expect(String(schema.$id)).toContain(name);
      expect(typeof schema.title).toBe("string");
    }
  });

  it("validate a real generated manifest and its claim records", () => {
    const root = makeProject({
      "index.md": `# I\n\n${claim("first", "A statement.", { type: "empirical" })}`,
      "results.md": `# R\n\n${claim("second", "Another statement.", { qualification: "Rodents only." })}`,
      "oratlas.yml": "canonical_url: https://example.org/review/\n",
    });
    const { manifest, claims } = exportProject({ projectRoot: root, write: false });

    const validateManifest = compile("oratlas-manifest");
    expect(validateManifest(manifest), JSON.stringify(validateManifest.errors)).toBe(true);

    const validateClaim = compile("oratlas-claim");
    for (const record of claims) {
      expect(validateClaim(record), JSON.stringify(validateClaim.errors)).toBe(true);
    }
  });

  it("reject the same documents the Zod contracts reject", () => {
    const validateManifest = compile("oratlas-manifest");
    expect(validateManifest({})).toBe(false);
    expect(
      validateManifest({
        schemaVersion: "0.2.0",
        generator: { name: "x", version: "1" },
        publication: {},
        myst: { xref: "myst.xref.json" },
        artifacts: {
          claims: {
            path: "oratlas/claims.jsonl",
            format: "jsonl",
            records: 0,
            sha256: "0".repeat(64),
            declarations: "publication-source",
          },
        },
      }),
    ).toBe(false);

    const validateClaim = compile("oratlas-claim");
    expect(validateClaim({ schemaVersion: "0.1.0", id: "x" })).toBe(false);
    expect(validateClaim({ schemaVersion: "0.1.0", id: "Bad Id" })).toBe(false);
  });

  it("carry no ORAtlas assessment, TRUST or federation vocabulary", () => {
    for (const name of ["oratlas-manifest", "oratlas-claim"]) {
      const serialized = JSON.stringify(loadSchema(name));
      for (const forbidden of ["trustScore", "assessment", "verification", "canonicalId"]) {
        expect(serialized).not.toContain(forbidden);
      }
    }
  });
});

describe("package version", () => {
  it("matches the literal the generator writes into every manifest", () => {
    const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    const root = makeProject({ "index.md": `# I\n\n${claim("c", "A statement.")}` });
    const { manifest } = exportProject({ projectRoot: root, write: false });
    expect(manifest.generator.version).toBe(packageJson.version);
    expect(manifest.generator.name).toBe(packageJson.name);
  });
});
