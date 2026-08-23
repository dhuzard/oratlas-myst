/**
 * A semantic failure the author can act on.
 *
 * Export and validation fail closed: every condition that would require the
 * adapter to guess is reported as one of these rather than silently repaired.
 */
export class OratlasMystError extends Error {
  readonly code: string;
  readonly detail: string | undefined;

  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = "OratlasMystError";
    this.code = code;
    this.detail = detail;
  }
}

export function isOratlasMystError(value: unknown): value is OratlasMystError {
  return value instanceof OratlasMystError;
}
