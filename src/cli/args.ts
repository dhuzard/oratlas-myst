import { OratlasMystError } from "../errors.js";

export interface ParsedArgs {
  command: string | undefined;
  options: Record<string, string | boolean>;
  positionals: string[];
}

/**
 * Minimal argument parser.
 *
 * The CLI has three commands and a handful of flags, so a dedicated parsing
 * dependency would be more surface than the thing it parses. Supported forms
 * are `--flag`, `--key value`, `--key=value` and `--no-flag`.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const options: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  let command: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (token.startsWith("--")) {
      const body = token.slice(2);
      if (body.length === 0) continue;
      const equals = body.indexOf("=");
      if (equals >= 0) {
        options[body.slice(0, equals)] = body.slice(equals + 1);
        continue;
      }
      if (body.startsWith("no-")) {
        options[body.slice(3)] = false;
        continue;
      }
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("-")) {
        options[body] = next;
        index += 1;
      } else {
        options[body] = true;
      }
      continue;
    }
    if (token.startsWith("-") && token.length > 1) {
      throw new OratlasMystError("cli-unknown-flag", `Unknown option: ${token}`);
    }
    if (command === undefined) command = token;
    else positionals.push(token);
  }

  return { command, options, positionals };
}

export function optionString(
  options: Record<string, string | boolean>,
  name: string,
): string | undefined {
  const value = options[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new OratlasMystError("cli-invalid-option", `Option --${name} requires a value.`);
  }
  return value;
}

export function optionBoolean(
  options: Record<string, string | boolean>,
  name: string,
): boolean | undefined {
  const value = options[name];
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new OratlasMystError(
    "cli-invalid-option",
    `Option --${name} expects no value, or true/false.`,
  );
}

export function rejectUnknownOptions(
  options: Record<string, string | boolean>,
  known: readonly string[],
): void {
  const unknown = Object.keys(options).filter((key) => !known.includes(key));
  if (unknown.length > 0) {
    throw new OratlasMystError(
      "cli-unknown-flag",
      `Unknown option(s): ${unknown
        .sort()
        .map((key) => `--${key}`)
        .join(", ")}.`,
      `Known options: ${[...known]
        .sort()
        .map((key) => `--${key}`)
        .join(", ")}.`,
    );
  }
}
