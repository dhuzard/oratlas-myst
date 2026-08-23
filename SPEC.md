# ORAtlas publication interoperability specification, version 0.2

Status: **frozen candidate integration contract**. Schema version `0.2.0`, released as
[`v0.2.0`](https://github.com/dhuzard/oratlas-myst/releases/tag/v0.2.0).

This version is the pinned contract ORAtlas implements against. It is deliberately closed to
new features while that integration is built: no field is added, removed or repurposed under
`0.2.0`, and anything learned during integration lands in a later `schemaVersion` rather than
mutating this one. A consumer that implements `0.2.0` can rely on it not moving underneath
them. See [`docs/roadmap.md`](docs/roadmap.md).

This document specifies the artifacts a publication exposes so that ORAtlas — or any other
consumer — can discover its explicitly declared scientific claims and bind each one to an
exact source occurrence.

The format is authoring-toolchain-neutral by construction: `adapter.type` and `target.type`
name the toolchain, and a consumer normalises every variant into one generic source-occurrence
representation. This version defines the `myst` adapter and the `myst-xref` target, which
`@oratlas/myst` produces. A JATS or Quarto adapter would add variants without ORAtlas's
ingestion contract changing shape.

The key words MUST, MUST NOT, REQUIRED, SHOULD, SHOULD NOT and MAY are to be interpreted as
described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

---

## 1. Terminology

**Publication** — one built MyST project, served from one canonical base URL.

**Publication version** — the exact byte content of a publication's source at one point in
time, identified by `publication.version.sourcesSha256`. This specification describes one such
version and never relates two of them.

**Source-local publication identifier** — an identifier declared by the author that is stable
across versions of the same publication. Like a claim id it is _not_ an ORAtlas identifier.

**Source-local claim id** — an identifier chosen by the author, unique within one
publication, that names a claim declaration in that publication's source. It is _not_ an
ORAtlas identifier and carries no meaning outside the publication that declares it.

**Claim occurrence** — one `oratlas:claim` declaration at one exact location in one exact
publication version.

**Claim declaration** — the semantic content of a claim: its statement text, its type, its
qualification. A publication has exactly one authority for its claim declarations
(§7).

**Generator** — the software that produced the artifacts. For these artifacts that is
`@oratlas/myst`.

**Consumer** — anything that reads the artifacts: ORAtlas, a validator, a crawler.

**Adapter** — the toolchain-specific producer of these artifacts, named by `adapter.type`.

---

## 2. Artifacts

A conforming publication exposes, relative to its canonical base URL:

| Path                    | Owner     | Content                                       |
| ----------------------- | --------- | --------------------------------------------- |
| `myst.xref.json`        | toolchain | The toolchain's own cross-reference inventory |
| `oratlas.manifest.json` | this spec | Discovery and interoperability manifest       |
| `oratlas/claims.jsonl`  | this spec | One claim occurrence record per line          |

The first row's path is whatever `adapter` declares; for the `myst` adapter it is
`myst.xref.json`, written by MyST itself.

`oratlas.manifest.json` MUST be served at the publication's root. `myst.xref.json` is written
by MyST itself; this specification neither defines nor reproduces it.

A consumer that fetches `oratlas.manifest.json` and follows the paths it declares has
everything it needs. No other entry point is required, and none is defined.

### 2.1 Media types and encoding

All three artifacts are UTF-8. `oratlas.manifest.json` is JSON
(`application/json`). `oratlas/claims.jsonl` is JSON Lines
(`application/jsonl`, `application/x-ndjson`): one JSON object per line, LF-separated, with a
trailing LF after the final record. An empty artifact (zero records) is the empty string.

A consumer MUST NOT assume a BOM. A generator MUST NOT emit one.

---

## 3. Path rules

Every path in these artifacts is **relative to the artifact that declares it** — that is, to
the publication root — and MUST satisfy all of:

- non-empty, at most 512 characters;
- no control characters (U+0000–U+001F, U+007F);
- no `\` and no `:`;
- does not begin with `/` or `~`;
- every `/`-separated segment is non-empty, is neither `.` nor `..`, begins with an ASCII
  letter or digit, and otherwise contains only ASCII letters, digits, `.`, `_` and `-`.

This rule is byte-for-byte the rule ORAtlas applies to `review-manifest.json` artifact paths,
so a path emitted here can be handed to ORAtlas's own validator unchanged. In particular a
leading `./` is **not** permitted, because `.` is not a legal segment.

A consumer MUST re-validate every declared path before opening or fetching it, and MUST NOT
resolve a path that fails this rule.

---

## 4. Identity

### 4.1 What a source-local claim id is

The source-local claim id is the string the author writes as the directive argument. It MUST
match `^[a-z0-9][a-z0-9._-]*$` and be at most 120 characters.

The restriction exists so that one string serves as the author's identifier, the MyST
cross-reference label, the generated HTML `id`, and the `claims.jsonl` record id. A generator
MUST NOT normalise a non-conforming id into a conforming one; it MUST reject the declaration
and report the conforming form the author could use instead.

A source-local claim id MUST be unique within the publication. A generator MUST fail rather
than deduplicate, rename, or pick a winner.

### 4.2 What identity these artifacts do and do not establish

```
publication + exact version + source-local claim id
                     ↓
             exact claim occurrence          ← what this specification describes
                     ↓
          ORAtlas canonical binding          ← what ORAtlas decides, separately
```

A generator MUST NOT emit an ORAtlas canonical identifier, and MUST NOT invent one.
Assigning canonical graph identity is ORAtlas's decision, made against ORAtlas's own
`docs/canonical-graph-identity.md` rules.

A consumer MUST NOT infer that two claim occurrences are the same claim from any of:

- equal or normalised claim text;
- equal `declarationSha256`;
- equal source-local claim id in two different publication versions;
- position, heading, section, or ordering;
- textual or semantic similarity.

Cross-version continuity is a separate, explicit, reviewed identity decision. These artifacts
describe the current occurrence and say nothing about any other.

### 4.3 What the digests establish

A digest here establishes that a byte sequence has not changed. It establishes nothing about
whether a claim is correct, supported, replicated, or accepted. A generator MUST NOT present a
digest as evidence of scientific validity, and a consumer MUST NOT treat it as such.

---

## 5. `oratlas.manifest.json`

JSON Schema: [`schemas/oratlas-manifest.schema.json`](schemas/oratlas-manifest.schema.json).

```json
{
  "schemaVersion": "0.2.0",
  "generator": { "name": "@oratlas/myst", "version": "0.2.0" },
  "publication": {
    "id": "adolescent-stress-review",
    "canonicalUrl": "https://example.org/adolescent-stress/",
    "title": "Adolescent stress and persistent behavioural change",
    "version": { "sourcesSha256": "d9cc…", "label": "v1.0.0" },
    "source": {
      "type": "git",
      "repository": "https://github.com/lab/review",
      "commit": "0123456789abcdef0123456789abcdef01234567"
    }
  },
  "adapter": { "type": "myst", "xref": "myst.xref.json" },
  "artifacts": {
    "claims": {
      "path": "oratlas/claims.jsonl",
      "format": "jsonl",
      "records": 4,
      "sha256": "9f2c…",
      "declarations": "publication-source"
    }
  }
}
```

The object is **closed**: a consumer MUST reject a manifest carrying a key not defined here.
Extension is by a new `schemaVersion`, not by additional keys (§10).

| Field                               | Req. | Meaning                                                             |
| ----------------------------------- | ---- | ------------------------------------------------------------------- |
| `schemaVersion`                     | MUST | Exactly `"0.2.0"` for this specification.                           |
| `generator.name` / `.version`       | MUST | Identity and version of the producing software.                     |
| `publication.id`                    | MAY  | Source-local publication identifier, stable across versions (§5.1). |
| `publication.canonicalUrl`          | MAY  | Absolute `https://` URL the publication is served from.             |
| `publication.title`                 | MAY  | Human-readable title.                                               |
| `publication.version.sourcesSha256` | MUST | Exact version identity for this publication (§5.2).                 |
| `publication.version.label`         | MAY  | Author-declared version label.                                      |
| `publication.source`                | MAY  | Where the exact source bytes can be obtained (§5.3).                |
| `adapter.type`                      | MUST | Authoring toolchain; `"myst"` in this version (§5.4).               |
| `adapter.xref`                      | MUST | For `myst`: path of MyST's cross-reference inventory. See §6.       |
| `artifacts.claims.path`             | MUST | Path of the claims artifact.                                        |
| `artifacts.claims.format`           | MUST | Exactly `"jsonl"`.                                                  |
| `artifacts.claims.records`          | MUST | Number of records in the artifact.                                  |
| `artifacts.claims.sha256`           | MUST | SHA-256 over the artifact's complete UTF-8 bytes, lowercase hex.    |
| `artifacts.claims.declarations`     | MUST | `"publication-source"` or `"review-manifest"`. See §7.              |
| `oratlas.reviewManifest`            | MAY  | Path of an ORAtlas `review-manifest.json` the publication ships.    |

`canonicalUrl` MUST use the `https` scheme. A consumer MUST NOT dereference it as part of
validation.

### 5.1 Publication identity

`publication.id` names the publication across its versions. It is declared by the author — a
generator MUST NOT derive one from the canonical URL, and MUST NOT mint an ORAtlas identifier.

A URL is not identity. A publication can move, be mirrored, or be served from several hosts,
and two publications can occupy the same URL at different times. `publication.id` says _which
publication this is_; `publication.version.sourcesSha256` says _which version of it_.

Neither is an ORAtlas canonical publication identity. ORAtlas keys a publication by its own
rules, using the source descriptor, the canonical URL and the declared identifier as evidence,
never as a decision.

### 5.2 Publication version identity

`publication.version.sourcesSha256` is:

```
SHA-256( canonicalJson({
  "schemaVersion": "0.2.0",
  "documents": [ { "path": …, "sha256": … }, … ]   // every processed document, sorted by path
}) )
```

where each `sha256` is the document digest defined in §8.3 and the array is sorted by `path`
using UTF-16 code-unit comparison.

It always exists. A publication served from a plain website with no repository, no DOI and no
archive still has an exact, recomputable version identity, which is what lets ORAtlas tell
version 1 from version 2 of the same publication without guessing.

It covers the **document set** only. It deliberately does not cover `myst.yml`, `oratlas.yml`
or any other configuration: those configure the build, whereas the claims bind to document
bytes, and that is what this digest identifies.

### 5.3 Source descriptor and the two verification levels

A deployed site serves its rendered pages, its cross-reference inventory and these artifacts.
It does **not** generally serve `results.md`. So a consumer holding only the published site
cannot check `documentSha256`, `blockSha256` or the raw-source selectors — the bytes those
cover are not published.

This specification therefore defines two levels, and a consumer MUST be explicit about which
one it reached:

**Level 1 — published-structure verification.** Available to every consumer, needing only the
published site:

- `artifacts.claims.sha256` matches the fetched artifact bytes;
- `artifacts.claims.records` matches the record count;
- every declared path satisfies §3;
- every `target.identifier` resolves in the toolchain's cross-reference inventory;
- the page data that inventory points at really contains a claim node with that identifier.

This proves the claim exists in the published structure, at a resolvable location. It proves
nothing about source bytes.

**Level 2 — source-byte verification.** Additionally available to a consumer that can obtain
the publication's source, which `publication.source` tells it how to do:

- `source.documentSha256` matches the document's bytes;
- `source.blockSha256` matches the recorded line span;
- `selector.textPosition` locates `selector.textQuote.exact` in the source;
- `declarationSha256` recomputes from the declaration.

`publication.source` is a discriminated union on `type`. This version defines:

| `type`    | Fields                                  | Meaning                           |
| --------- | --------------------------------------- | --------------------------------- |
| `git`     | `repository` (https), `commit`?, `ref`? | Source lives in a git repository. |
| `doi`     | `versionDoi`, `conceptDoi`?             | Source is deposited under a DOI.  |
| `archive` | `url` (https), `sha256`, `format`?      | Source is an immutable bundle.    |

`versionDoi` and `conceptDoi` are distinct fields and MUST NOT be collapsed, matching ORAtlas's
own rule. DOIs MUST be bare (`10.xxxx/suffix`) with no `doi:` or resolver prefix.

`commit` is optional because a commit is usually only knowable at build time — the
configuration file is itself part of the commit. A generator SHOULD accept it from its
invocation (`oratlas-myst export --source-commit <sha>`) rather than detecting it from a
working tree: a detected commit silently disagrees with the published bytes whenever the tree
is dirty, which is precisely when provenance matters most.

A publication that declares no `source` is still a first-class participant; it is simply
limited to level 1. A generator SHOULD say so rather than leaving the author to discover it.

### 5.4 Adapter

`adapter` is a discriminated union on `type` naming the authoring toolchain. This version
defines `"myst"`, whose `xref` field points at MyST's own cross-reference inventory.

The union exists so ORAtlas's ingestion contract never hard-codes a MyST concept. A consumer
switches on `adapter.type`, normalises the result into one generic source-occurrence
representation, and the canonical graph never learns which toolchain a publication was
authored in.

A consumer MUST reject an `adapter.type` it does not implement rather than guessing at the
fields.

### 5.5 What the manifest MUST NOT contain

The manifest is a discovery document for immutable publication-side assertions. It MUST NOT
carry:

- an ORAtlas canonical node, version, edge, or work identifier;
- a TRUST assessment, criterion, aggregate, or score of any kind;
- a verification, confirmation, or editorial status;
- discussion, comments, votes, consensus, disagreement or challenge state;
- any count or summary derived from the above;
- an executable declaration, a script reference, or a command line;
- a mutable server, registry, or API endpoint that a build or a validation is required to
  contact.

Every one of those is federated or mutable state that ORAtlas owns. A publication that
asserts them in a static file is asserting something it cannot keep true.

There is deliberately **no** universal per-claim truth score in this format. ORAtlas's TRUST
model assesses a specific _claim–evidence relation_, not a claim (`docs/trust-model.md`
upstream); a single number attached to a claim would be a different, incompatible, and wrong
thing.

### 5.6 `$schema`

This version deliberately omits a `$schema` member. A `$schema` URL is only useful if it is
permanently resolvable, and this specification does not yet have a hosting commitment to make
one. The JSON Schemas are distributed with the package and the repository instead. A future
version MAY add `$schema` once a stable URL exists.

---

## 6. Relationship to the toolchain's cross-reference inventory

MyST already publishes a cross-reference inventory that maps each target identifier to the URL
and data file that serve it. This specification does not reproduce, mirror, or rewrite it.

```
myst.xref.json         target identifier  →  publication URL and page data
oratlas/claims.jsonl   target identifier  →  scientific claim declaration + source binding
```

A generator MUST make every declared claim a cross-reference target whose identifier equals the
source-local claim id, so the two artifacts join on that identifier. A generator MUST NOT copy
URLs, slugs or page data into the claims artifact: those belong to the build, change when the
site is reorganised, and are already published by the toolchain.

A consumer resolves a claim to its live location by joining `claims.jsonl[].target.identifier`
with `myst.xref.json.references[].identifier`, then resolving that entry's `url` against
`publication.canonicalUrl` under the rule below.

### 6.1 Resolving an inventory URL

`myst.xref.json` `url` values are **site-root-relative absolute paths** (`/`, `/results`), not
paths relative to the publication. Resolving one directly against a canonical URL that has a
path component silently discards that path:

```js
new URL("/results", "https://example.org/review/").href;
// → "https://example.org/results"      ← wrong: the /review/ prefix is gone
```

Every publication deployed under a subpath — a project site, a journal hosting many articles —
hits this. A consumer MUST therefore treat `publication.canonicalUrl` as the site root for that
publication: append a trailing `/` if absent, strip leading `/` characters from the inventory
URL, and resolve the remainder relative to it.

```js
const base = canonicalUrl.endsWith("/") ? canonicalUrl : `${canonicalUrl}/`;
const url = new URL(xrefUrl.replace(/^\/+/, ""), base);
// → "https://example.org/review/results"
```

`target.htmlId` is the fragment identifier within that page. A generator SHOULD declare a
`canonicalUrl` ending in `/`.

---

## 7. Claim declaration authority

Exactly one artifact in a publication is authoritative for claim declarations.

- **`declarations: "publication-source"`** — the MyST source is the only claim declaration.
  Each record MUST carry `text`, and MAY carry `claimType` and `qualification`.

- **`declarations: "review-manifest"`** — the publication also ships an ORAtlas
  `review-manifest.json` that declares claims through its own `artifacts.claims` stream. That
  stream is authoritative for claim text and attributes. Each record here MUST NOT carry
  `text`, `claimType` or `qualification`; it carries only the identifier and the MyST source
  occurrence binding, which the review manifest has no representation for.

A generator MUST set `declarations` to `"review-manifest"` if and only if a review manifest is
declared _and_ it declares a claims artifact. A generator MUST fail if a claim is declared in
the MyST source with an id the review manifest's claims artifact does not declare. A generator
SHOULD report, without failing, a claim the review manifest declares that has no
`oratlas:claim` occurrence: such a claim simply has no MyST source binding.

A generator MUST NOT restate anything a declared review manifest already carries — its review
title, its repository, its DOIs, its contributors, its citation, relation or TRUST artifact
paths. One semantic fact has one authoritative publication-side representation.

A generator MUST NOT reinterpret, rewrite, upgrade, or re-emit records from an ORAtlas-owned
artifact. Reading a source assertion does not make it a verified one.

---

## 8. `oratlas/claims.jsonl`

JSON Schema: [`schemas/oratlas-claim.schema.json`](schemas/oratlas-claim.schema.json).

```json
{
  "schemaVersion": "0.2.0",
  "id": "hpa-axis-mediation",
  "text": "Persistent behavioural change after adolescent stress is mediated in part by lasting alterations in hypothalamic–pituitary–adrenal axis reactivity [@mccormick2010].\n\nThe mediation is partial: HPA reactivity accounts for some, but not all, of the variance in later behaviour.",
  "claimType": "mechanistic",
  "qualification": "Rodent models only; evidence in humans is correlational.",
  "target": {
    "type": "myst-xref",
    "identifier": "hpa-axis-mediation",
    "htmlId": "hpa-axis-mediation"
  },
  "source": {
    "documentPath": "results.md",
    "documentSha256": "5b1f…",
    "startLine": 12,
    "endLine": 23,
    "blockSha256": "a704…"
  },
  "selector": {
    "representation": "oratlas-myst-source-utf8-v1",
    "unit": "body",
    "textQuote": {
      "type": "TextQuoteSelector",
      "exact": "Persistent behavioural…",
      "prefix": "…",
      "suffix": "…"
    },
    "textPosition": { "type": "TextPositionSelector", "start": 217, "end": 505 }
  },
  "declarationSha256": "3c8e…"
}
```

Each record object is **closed**. `target.identifier` MUST equal `id`.

| Field                   | Req. | Meaning                                                             |
| ----------------------- | ---- | ------------------------------------------------------------------- |
| `schemaVersion`         | MUST | Exactly `"0.1.0"`. Present per record so a line is self-describing. |
| `id`                    | MUST | Source-local claim id (§4.1).                                       |
| `text`                  | §7   | Plain-text claim statement (§8.1).                                  |
| `claimType`             | MAY  | One of the ORAtlas claim types (§8.2).                              |
| `qualification`         | MAY  | Author-declared scope the claim is asserted under.                  |
| `target.identifier`     | MUST | MyST cross-reference identifier; equal to `id`.                     |
| `target.htmlId`         | MUST | DOM id MyST generates for that identifier in a web build.           |
| `source.documentPath`   | MUST | Publication-relative path of the declaring MyST document.           |
| `source.documentSha256` | MUST | SHA-256 over that document's complete UTF-8 bytes (§8.3).           |
| `source.startLine`      | MUST | 1-based first line of the directive block, inclusive.               |
| `source.endLine`        | MUST | 1-based last line of the directive block, inclusive.                |
| `source.blockSha256`    | MUST | SHA-256 over that line span (§8.3).                                 |
| `selector`              | MUST | W3C selectors locating the claim in the source (§8.4).              |
| `declarationSha256`     | MUST | SHA-256 over the claim declaration alone (§8.3).                    |

### 8.1 `text`

`text` is the plain-text rendering of the claim body, derived from the parsed MyST AST by
these rules:

1. Each top-level block of the body is rendered separately; the blocks are joined with
   `"\n\n"`. A list or blockquote contributes its own children as blocks.
2. Within a block, runs of whitespace — including the source's hard line wraps, which are an
   authoring artifact rather than content — collapse to a single space, and the result is
   trimmed.
3. A citation renders as its source key: `[@key]` for a parenthetical group, `@key` for a
   narrative citation, `[@a; @b]` for a group of several.
4. Inline maths renders as its source, inline code as its literal value, and a
   cross-reference or link as its own text where it has any.
5. Nothing else is normalised. Case, punctuation, negation, numbers and Unicode are preserved
   exactly as written.

Rule 3 exists because a MyST `cite` node carries no text until the build's citation transform
runs; dropping it would strand the surrounding punctuation and silently change the statement.

`text` is at most 5 000 characters, matching ORAtlas's own claim record limit.

### 8.2 `claimType`

When present, `claimType` MUST be one of ORAtlas's claim types:

`empirical`, `mechanistic`, `methodological`, `theoretical`, `normative`, `summary`, `other`,
`synthesis`, `model-derived`, `translational`.

The list is append-only upstream. A generator MUST reject an unrecognised value rather than
pass it through, so a typo cannot become an unusable graph attribute.

### 8.3 Hashing

All digests are SHA-256 over UTF-8 bytes, lowercase hexadecimal, matching ORAtlas's `sha256`
helper exactly.

Each digest covers a deliberately different unit:

**`source.documentSha256`** covers the **complete bytes of the declaring document**. It is
byte-identical to the `sourceSha256` ORAtlas computes for the same file in its
`PassageCommentAnchor`, so a passage anchor and a claim record agree on which version of a
page they are talking about. Any edit anywhere in the page changes it.

**`source.blockSha256`** covers the **exact source text of lines `startLine` through
`endLine`**, joined with `"\n"` and with no trailing newline. That is the whole directive
block, opening and closing fences included. It changes when the declaration, its options, or
its fencing change, and not when the rest of the page changes.

**`declarationSha256`** covers the **claim declaration alone**, and nothing positional. It is:

```
SHA-256( canonicalJson({
  "schemaVersion": "0.2.0",
  "id":            <source-local claim id>,
  "body":          <the directive body exactly as MyST read it from the source>,
  "claimType":     <if declared>,
  "qualification": <if declared>
}) )
```

where `canonicalJson` serialises with recursively sorted object keys, omits members whose
value is `undefined`, normalises `-0` to `0`, and fails closed on non-finite numbers, circular
references and non-plain objects. It is the same canonicalisation ORAtlas uses.

Because it excludes the document path, the line span and the surrounding page, the same
declaration moved to a different place in the publication keeps the same
`declarationSha256`. Because it includes `id`, two byte-identical statements declared under
different ids get different digests.

**`declarationSha256` is a content digest, not an identity.** Two publications with equal
digests are not thereby asserting the same claim, and a changed digest does not mean a
different scientific claim (§4.2).

**`artifacts.claims.sha256`** in the manifest covers the complete bytes of the claims
artifact, including its trailing newline.

Three separate units are used because they answer three different questions — _did this page
change?_, _did this declaration's source block change?_, _did the author's assertion change?_
— and a single digest cannot answer all three.

### 8.4 Selectors

`selector` locates the claim in the **raw UTF-8 source text of `source.documentPath`, as a
sequence of Unicode code points** — the exact byte sequence `source.documentSha256` covers.
`selector.representation` MUST be `"oratlas-myst-source-utf8-v1"` to say so.

This frame is deliberately **not** ORAtlas's `myst-rendered-text-v1`, which is expressed over
ORAtlas's own rendering of the page. The two are never interchangeable. A consumer MUST NOT
apply offsets from one frame to the other.

`selector.unit` says which span is quoted:

- `"body"` — the directive body exactly as written in the source. Used whenever the body
  appears verbatim inside the directive block, which is the case for every unindented
  directive.
- `"block"` — the complete directive block, fences included. Used when MyST dedented the body
  (a directive nested inside another block), so the quoted span is still byte-exact.

`selector.textQuote` is a W3C Web Annotation `TextQuoteSelector` and `selector.textPosition` a
`TextPositionSelector`, each in exactly the object shape ORAtlas's strict schemas accept: no
extra keys, so either object can be handed to ORAtlas's validator unchanged.

- `textPosition.start` and `.end` are code-point offsets into the document source.
- `end - start` MUST equal the code-point length of `textQuote.exact`.
- `textQuote.prefix` and `.suffix` carry up to 96 code points of surrounding source, matching
  ORAtlas's own context window.
- `textQuote.exact` is capped at 2 000 code points. When the quoted span is longer, the
  leading 2 000 code points are used — still an exact contiguous quote — and `textPosition` is
  narrowed to match.

Offsets are counted in code points, not UTF-16 code units. A consumer that slices a JavaScript
string by these offsets without converting will be wrong by the number of preceding
astral-plane characters.

### 8.5 Ordering

Records MUST be ordered by, in order: `source.documentPath`, then `source.startLine`, then
`id`. String comparison is by UTF-16 code unit. A locale-aware comparison MUST NOT be used:
it would make the artifact depend on the host environment.

---

### 8.6 Target

`target` is a discriminated union on `type`, for the same reason `adapter` is (§5.4): a
consumer normalises every variant into one generic source-occurrence representation.

This version defines `"myst-xref"`, carrying `identifier` and `htmlId`. Every future variant
MUST carry `identifier`, which is the field that joins a claim record to the toolchain's
cross-reference inventory; anything else is variant-specific. A consumer MUST reject a
`target.type` it does not implement.

`target.identifier` MUST equal the record `id`.

---

## 9. Determinism

Given identical source bytes and identical configuration, a generator MUST produce
byte-identical artifacts.

A generator MUST NOT write into these artifacts:

- a timestamp, build number, or run identifier;
- a random or generated identifier;
- an absolute filesystem path or a hostname;
- an OS-dependent path separator (paths are always `/`);
- anything whose value depends on locale, filesystem enumeration order, or environment.

Page order comes from `project.toc` when the MyST project declares one, and otherwise from a
sorted directory walk.

---

## 10. Versioning and extension

`schemaVersion` is `MAJOR.MINOR.PATCH`. Before 1.0, any release MAY break compatibility.

Version `0.1.0` was never released. `0.2.0` is the first published schema version.

A consumer MUST reject a manifest whose `schemaVersion` it does not implement, rather than
attempting a partial read. Both the manifest object and the claim record object are closed:
an unknown key is an error, not something to ignore.

Extension therefore happens by a new `schemaVersion` that defines the new field, not by
smuggling keys into an existing version. This is a deliberate trade: a closed object means a
typo cannot be silently ignored, at the cost of requiring a version bump for every addition.

A generator MUST NOT emit a `schemaVersion` it does not itself implement.

---

## 11. Security

Publication input is untrusted. Both a generator and a consumer:

- MUST validate every path against §3 before opening or fetching it, and MUST refuse to
  resolve outside the publication root, including through a symbolic link;
- MUST NOT follow a symbolic link while _discovering_ files. Discovery walks untrusted
  directory structure, where a link can reach outside the publication or, if it points at an
  ancestor, make the walk unbounded. A generator MUST examine each entry with an lstat-style
  call that reports the link itself, and MUST refuse the link rather than what it points at. A
  link named by an _explicit_ declaration (a table-of-contents entry, a configured path) MAY be
  followed, provided the resolved real path is still inside the publication;
- MUST apply the same discipline to their own configuration files, which are publication input
  like any other;
- MUST NOT execute anything from the publication, and MUST NOT evaluate claim content as
  code;
- MUST NOT dereference a remote URL as part of generating or validating these artifacts;
- SHOULD cap the size and count of the files they read.

Validation MUST be possible entirely offline. A generator MUST NOT require a network service
— ORAtlas included — to be reachable in order to build a publication.

---

## 12. Non-goals

This version deliberately does not specify, and a conforming generator does not perform:

- automatic claim extraction from prose, by an LLM or otherwise;
- automatic extraction of claim–evidence relations;
- evidence assessment, TRUST scoring, or aggregation;
- canonical claim merging or cross-publication identity resolution;
- semantic similarity linking;
- cross-site crawling or discovery;
- synchronisation with an ORAtlas instance;
- any mutable, federated, or assessed state.

Claims are declared explicitly by the author. That is what makes the baseline deterministic
and auditable, and it is a precondition for any of the above being added later as a separate,
clearly labelled layer.
