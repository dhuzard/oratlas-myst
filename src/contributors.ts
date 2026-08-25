import { formatName, parseName, type Name } from "myst-frontmatter";
import { contributorsSchema, type Contributor } from "./contracts/manifest.js";
import { OratlasMystError } from "./errors.js";

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function contributorName(value: unknown): {
  displayName?: string;
  givenName?: string;
  familyName?: string;
} {
  if (typeof value === "string" && value.trim()) {
    const displayName = value.trim();
    const parsed = parseName(displayName);
    return {
      displayName,
      ...(parsed.given ? { givenName: parsed.given } : {}),
      ...(parsed.family ? { familyName: parsed.family } : {}),
    };
  }
  const record = asRecord(value);
  if (!record) return {};
  const parsed: Name = {
    ...(nonEmptyString(record.literal) ? { literal: nonEmptyString(record.literal) } : {}),
    ...(nonEmptyString(record.given) ? { given: nonEmptyString(record.given) } : {}),
    ...(nonEmptyString(record.family) ? { family: nonEmptyString(record.family) } : {}),
    ...(nonEmptyString(record.suffix) ? { suffix: nonEmptyString(record.suffix) } : {}),
    ...(nonEmptyString(record.non_dropping_particle)
      ? { non_dropping_particle: nonEmptyString(record.non_dropping_particle) }
      : {}),
    ...(nonEmptyString(record.dropping_particle)
      ? { dropping_particle: nonEmptyString(record.dropping_particle) }
      : {}),
  };
  const displayName =
    parsed.literal ?? (Object.keys(parsed).length > 0 ? formatName(parsed) : undefined);
  return {
    ...(displayName ? { displayName } : {}),
    ...(parsed.given ? { givenName: parsed.given } : {}),
    ...(parsed.family ? { familyName: parsed.family } : {}),
  };
}

function normalizeOrcid(value: string): string {
  return value.replace(/^https?:\/\/(?:www\.)?orcid\.org\//i, "");
}

function affiliationName(value: unknown, declarations: readonly unknown[]): string | undefined {
  if (typeof value === "string") {
    const reference = value.trim();
    if (!reference) return undefined;
    const declared = declarations
      .map(asRecord)
      .find((entry) => entry && nonEmptyString(entry.id) === reference);
    return declared
      ? (nonEmptyString(declared.name) ?? nonEmptyString(declared.institution) ?? reference)
      : reference;
  }
  const record = asRecord(value);
  return record
    ? (nonEmptyString(record.name) ??
        nonEmptyString(record.institution) ??
        nonEmptyString(record.id))
    : undefined;
}

/**
 * Map the documented MyST 1.10 project `authors` contract into 0.3 scholarly
 * credit. No identity lookup, merge, or production inference occurs here.
 */
export function contributorsFromMyst(
  authors: readonly unknown[] | undefined,
  affiliationDeclarations: readonly unknown[] = [],
): Contributor[] | undefined {
  if (authors === undefined || authors.length === 0) return undefined;

  const mapped = authors.map((value, index): unknown => {
    if (typeof value === "string") {
      const name = contributorName(value);
      return {
        sourceContributorKey: `myst-author-${index + 1}`,
        kind: "person",
        ...name,
        roles: ["author"],
        position: index + 1,
      };
    }
    const author = asRecord(value);
    if (!author) return value;
    const organization = author.collaboration === true;
    const name = contributorName(author.name ?? author.institution);
    const id = nonEmptyString(author.id) ?? `myst-author-${index + 1}`;
    const affiliations = Array.isArray(author.affiliations)
      ? author.affiliations
          .map((affiliation) => affiliationName(affiliation, affiliationDeclarations))
          .filter((affiliation): affiliation is string => affiliation !== undefined)
      : author.affiliations === undefined
        ? []
        : [affiliationName(author.affiliations, affiliationDeclarations)].filter(
            (affiliation): affiliation is string => affiliation !== undefined,
          );
    const identifiers: { scheme: "orcid" | "ror" | "isni"; value: string }[] = [];
    const orcid = nonEmptyString(author.orcid);
    const ror = nonEmptyString(author.ror);
    const isni = nonEmptyString(author.isni);
    if (!organization && orcid) {
      identifiers.push({ scheme: "orcid", value: normalizeOrcid(orcid) });
    }
    if (organization && ror) identifiers.push({ scheme: "ror", value: ror });
    if (isni) identifiers.push({ scheme: "isni", value: isni });
    const publicUrl = nonEmptyString(author.url);

    if (organization) {
      return {
        sourceContributorKey: id,
        kind: "organization",
        displayName: name.displayName,
        ...(identifiers.length ? { identifiers } : {}),
        roles: ["group-author"],
        position: index + 1,
        ...(publicUrl ? { publicUrl } : {}),
      };
    }
    return {
      sourceContributorKey: id,
      kind: "person",
      ...name,
      ...(identifiers.length ? { identifiers } : {}),
      ...(affiliations.length ? { affiliations } : {}),
      roles: ["author", ...(author.corresponding === true ? ["corresponding-author"] : [])],
      position: index + 1,
      ...(publicUrl ? { publicUrl } : {}),
    };
  });

  const parsed = contributorsSchema.safeParse(mapped);
  if (!parsed.success) {
    throw new OratlasMystError(
      "myst-authors-invalid",
      "Standard MyST project authors could not be mapped to protocol 0.3.0 contributors.",
      parsed.error.issues
        .map((issue) => `project.authors.${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; "),
    );
  }
  return parsed.data;
}
