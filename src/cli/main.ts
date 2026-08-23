#!/usr/bin/env node
import { relative, resolve } from "node:path";
import { optionBoolean, optionString, parseArgs, rejectUnknownOptions } from "./args.js";
import { CLAIMS_ARTIFACT_PATH, MANIFEST_FILE_NAME, exportProject } from "../export.js";
import { OratlasMystError } from "../errors.js";
import { inspectProject } from "../inspect.js";
import { validateProject } from "../validate.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../version.js";

const USAGE = `${PACKAGE_NAME} ${PACKAGE_VERSION}

Usage: oratlas-myst <command> [options]

Commands:
  export      Parse the MyST project and write the ORAtlas interoperability artifacts.
  validate    Check the generated artifacts against the publication source. No network.
  inspect     Report every \`oratlas:claim\` declaration the exporter can see.

Options:
  --project <dir>   MyST project root (default: current directory)
  --json            Emit machine-readable JSON on stdout
  --no-write        (export) compute everything but write nothing
  --no-consistency  (validate) skip re-running the export to compare byte for byte
  --version         Print the version
  --help            Print this message

Generated artifacts (under the configured output directory, default .oratlas/):
  ${MANIFEST_FILE_NAME}
  ${CLAIMS_ARTIFACT_PATH}

Publish them at the root of the built site with, in myst.yml:

  project:
    static_files:
      - .oratlas/${MANIFEST_FILE_NAME}
      - .oratlas/oratlas
`;

function projectRootFrom(options: Record<string, string | boolean>): string {
  return resolve(optionString(options, "project") ?? process.cwd());
}

function reportError(error: unknown): number {
  if (error instanceof OratlasMystError) {
    process.stderr.write(`error [${error.code}]: ${error.message}\n`);
    if (error.detail) process.stderr.write(`${error.detail}\n`);
    return 1;
  }
  process.stderr.write(
    `error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  return 1;
}

function runExport(options: Record<string, string | boolean>): number {
  rejectUnknownOptions(options, ["project", "json", "write"]);
  const projectRoot = projectRootFrom(options);
  const write = optionBoolean(options, "write") ?? true;
  const result = exportProject({ projectRoot, write });

  if (optionBoolean(options, "json")) {
    process.stdout.write(
      `${JSON.stringify(
        {
          manifest: result.manifest,
          claims: result.claims,
          notes: result.notes,
          outputDir: relative(projectRoot, result.outputDir),
          written: write,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  const outputDir = relative(projectRoot, result.outputDir) || ".";
  process.stdout.write(
    `${write ? "Wrote" : "Computed"} ${result.claims.length} claim record(s) for "${
      result.manifest.publication.title ?? "(untitled publication)"
    }".\n`,
  );
  for (const file of result.files) {
    process.stdout.write(`  ${outputDir}/${file.path}\n`);
  }
  process.stdout.write(`  claim declarations: ${result.manifest.artifacts.claims.declarations}\n`);
  for (const note of result.notes) process.stdout.write(`  note: ${note}\n`);
  return 0;
}

function runValidate(options: Record<string, string | boolean>): number {
  rejectUnknownOptions(options, ["project", "json", "consistency"]);
  const projectRoot = projectRootFrom(options);
  const result = validateProject({
    projectRoot,
    checkConsistency: optionBoolean(options, "consistency") ?? true,
  });

  if (optionBoolean(options, "json")) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 1;
  }

  for (const warning of result.warnings) {
    process.stdout.write(
      `warning [${warning.code}]${warning.where ? ` ${warning.where}` : ""}: ${warning.message}\n`,
    );
  }
  for (const error of result.errors) {
    process.stderr.write(
      `error [${error.code}]${error.where ? ` ${error.where}` : ""}: ${error.message}\n`,
    );
  }
  if (result.ok) {
    process.stdout.write(
      `OK: ${result.records} claim record(s) validate against the publication source.\n`,
    );
    return 0;
  }
  process.stderr.write(`Validation failed with ${result.errors.length} error(s).\n`);
  return 1;
}

function runInspect(options: Record<string, string | boolean>): number {
  rejectUnknownOptions(options, ["project", "json"]);
  const projectRoot = projectRootFrom(options);
  const result = inspectProject({ projectRoot });

  if (optionBoolean(options, "json")) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.duplicateIds.length === 0 &&
      result.documents.every((document) => document.problems.length === 0)
      ? 0
      : 1;
  }

  let problems = 0;
  for (const document of result.documents) {
    process.stdout.write(`${document.path} (${document.claims.length} claim(s))\n`);
    for (const claim of document.claims) {
      const attributes = [
        claim.claimType ? `type=${claim.claimType}` : undefined,
        claim.qualification ? `qualification="${claim.qualification}"` : undefined,
      ]
        .filter(Boolean)
        .join(" ");
      process.stdout.write(
        `  ${claim.id}  lines ${claim.startLine}-${claim.endLine}${attributes ? `  ${attributes}` : ""}\n`,
      );
      process.stdout.write(`    ${claim.text.replaceAll("\n", " ").slice(0, 120)}\n`);
    }
    for (const problem of document.problems) {
      problems += 1;
      process.stderr.write(
        `  error [${problem.code}]${problem.line ? ` line ${problem.line}` : ""}: ${problem.message}\n`,
      );
    }
  }
  for (const skip of result.skipped) {
    process.stdout.write(`skipped ${skip.path}: ${skip.reason}\n`);
  }
  for (const duplicate of result.duplicateIds) {
    problems += 1;
    process.stderr.write(
      `error [duplicate-claim-id]: "${duplicate.id}" declared at ${duplicate.occurrences.join(", ")}\n`,
    );
  }
  return problems === 0 ? 0 : 1;
}

export function run(argv: string[]): number {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    return reportError(error);
  }

  const { command, options } = parsed;

  if (options.version === true || command === "version") {
    process.stdout.write(`${PACKAGE_VERSION}\n`);
    return 0;
  }
  if (options.help === true || command === undefined || command === "help") {
    process.stdout.write(USAGE);
    return command === undefined && options.help !== true ? 1 : 0;
  }

  try {
    switch (command) {
      case "export":
        return runExport(options);
      case "validate":
        return runValidate(options);
      case "inspect":
        return runInspect(options);
      default:
        process.stderr.write(`error: unknown command "${command}"\n\n${USAGE}`);
        return 1;
    }
  } catch (error) {
    return reportError(error);
  }
}

process.exitCode = run(process.argv.slice(2));
