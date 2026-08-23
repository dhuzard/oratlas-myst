#!/usr/bin/env tsx
/**
 * Generate the published JSON Schemas from the Zod contracts.
 *
 * The Zod contracts in `src/contracts` are the single definition; the JSON
 * Schemas in `schemas/` are generated from them and are never hand-edited. CI
 * runs this with `--check` so the two can never drift silently.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { claimRecordSchema } from "../src/contracts/claims.js";
import { oratlasManifestSchema } from "../src/contracts/manifest.js";

export const SCHEMA_DIR = "schemas";

const targets = [
  {
    file: "oratlas-manifest.schema.json",
    schema: oratlasManifestSchema,
    id: "https://github.com/dhuzard/oratlas-myst/schemas/oratlas-manifest.schema.json",
    title: "ORAtlas MyST interoperability manifest",
    description:
      "oratlas.manifest.json — the portable ORAtlas interoperability and discovery document for one built MyST publication.",
  },
  {
    file: "oratlas-claim.schema.json",
    schema: claimRecordSchema,
    id: "https://github.com/dhuzard/oratlas-myst/schemas/oratlas-claim.schema.json",
    title: "ORAtlas MyST claim record",
    description:
      "One record of oratlas/claims.jsonl — an explicit claim declaration in one exact version of one MyST publication.",
  },
] as const;

/** Sort object keys recursively so the generated files are byte-stable. */
function stabilize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stabilize);
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) output[key] = stabilize(input[key]);
    return output;
  }
  return value;
}

export interface GeneratedSchema {
  file: string;
  content: string;
}

/** Render every published schema as the exact bytes that belong on disk. */
export function generateSchemaDocuments(): GeneratedSchema[] {
  return targets.map((target) => {
    const generated = zodToJsonSchema(target.schema, {
      name: undefined,
      target: "jsonSchema7",
      $refStrategy: "none",
    }) as Record<string, unknown>;

    const document = stabilize({
      ...generated,
      $schema: "http://json-schema.org/draft-07/schema#",
      $id: target.id,
      title: target.title,
      description: target.description,
    });

    return { file: target.file, content: `${JSON.stringify(document, null, 2)}\n` };
  });
}

/** Files whose on-disk content differs from what the contracts generate. */
export function schemaDrift(repoRoot: string): string[] {
  return generateSchemaDocuments()
    .filter((generated) => {
      const path = join(repoRoot, SCHEMA_DIR, generated.file);
      let existing: string | undefined;
      try {
        existing = readFileSync(path, "utf8");
      } catch {
        existing = undefined;
      }
      return existing !== generated.content;
    })
    .map((generated) => join(SCHEMA_DIR, generated.file));
}

function main(): number {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const check = process.argv.includes("--check");
  mkdirSync(join(repoRoot, SCHEMA_DIR), { recursive: true });

  if (check) {
    const drift = schemaDrift(repoRoot);
    for (const generated of generateSchemaDocuments()) {
      const path = join(SCHEMA_DIR, generated.file);
      if (drift.includes(path)) {
        console.error(
          `drift: ${path} is out of date with the Zod contract. Run \`pnpm run schemas\`.`,
        );
      } else {
        console.log(`ok: ${path}`);
      }
    }
    return drift.length > 0 ? 1 : 0;
  }

  for (const generated of generateSchemaDocuments()) {
    writeFileSync(join(repoRoot, SCHEMA_DIR, generated.file), generated.content, "utf8");
    console.log(`wrote ${join(SCHEMA_DIR, generated.file)}`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
