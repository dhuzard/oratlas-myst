/**
 * Serialize JSON data deterministically: object keys are sorted recursively
 * and unsupported or lossy values fail closed instead of being coerced.
 *
 * This is a deliberate re-implementation of ORAtlas's `canonicalJson` with the
 * same behaviour, so a digest computed here matches a digest recomputed there.
 * It is duplicated rather than imported because `@oratlas/contracts` is an
 * internal ORAtlas package and not the portable protocol boundary.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, new Set<object>(), "$"));
}

function normalize(value: unknown, seen: Set<object>, path: string): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`Non-finite number at ${path}.`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object" || value === undefined) {
    throw new TypeError(`Unsupported JSON value at ${path}.`);
  }
  if (seen.has(value)) throw new TypeError(`Circular JSON value at ${path}.`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry, index) => normalize(entry, seen, `${path}[${index}]`));
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Non-plain object at ${path}.`);
    }
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort(compareStrings)) {
      // JSON.stringify omits undefined object members; do it explicitly so the
      // behaviour is deliberate while arrays stay strict.
      if (input[key] === undefined) continue;
      output[key] = normalize(input[key], seen, `${path}.${key}`);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

/**
 * Compare two strings by UTF-16 code unit.
 *
 * `Array.prototype.sort` without a comparator, and `String.localeCompare`,
 * are both unsuitable here: the former stringifies and the latter is
 * locale-dependent, which would make export output depend on the host's
 * environment. Every ordering decision in this package uses this function.
 */
export function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
