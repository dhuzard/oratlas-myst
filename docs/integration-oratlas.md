# Integrating with ORAtlas

How these artifacts are meant to be consumed by [ORAtlas](https://github.com/dhuzard/oratlas),
what is deliberately compatible with ORAtlas's existing contracts, and what ORAtlas still has
to add.

**Nothing in this document is implemented in this repository, and nothing here requires
database access or ORAtlas credentials.** This repository is the publication side of the
boundary. It is written from a read of `dhuzard/oratlas` as of August 2026.

---

## 1. The ingestion path

```
external MyST publication
        │
        │  GET  https://example.org/review/oratlas.manifest.json
        ▼
manifest: schema version, generator, canonical URL, declared artifact paths
        │
        │  validate each declared path (SPEC §3), then fetch
        ▼
oratlas/claims.jsonl   +   myst.xref.json
        │
        │  verify: artifact digest, document digest, block digest,
        │  declaration digest, selector position, target existence
        ▼
exact claim occurrence
  (publication, exact version, source-local id, source bytes)
        │
        │  ORAtlas's own decision, ORAtlas's own rules
        ▼
canonical graph binding
  (stable claim node + exact claim-occurrence version)
```

The adapter stops at "exact claim occurrence". Everything below that line is ORAtlas's, and the
adapter neither performs it nor presumes its outcome.

---

## 2. Deliberate compatibility points

These were chosen by reading ORAtlas's contracts, not by coincidence.

### `sourceSha256` is byte-identical

`claims.jsonl[].source.documentSha256` is SHA-256 over the page's complete UTF-8 source bytes —
exactly what `apps/web/src/lib/article-reader.ts` computes as `page.sha256` and stores as
`PassageCommentAnchor.sourceSha256`.

So a claim record and a passage annotation agree, with no translation, on which version of a
page they are discussing. `apps/web/src/lib/comments.ts` already compares
`targetPage.sha256 !== input.anchor.sourceSha256`; a claim record's digest slots into the same
comparison.

### Selector objects are ORAtlas-shaped

`selector.textQuote` and `selector.textPosition` are in exactly the object shape
`textQuoteSelectorSchema` and `textPositionSelectorSchema` accept — both are `.strict()`, so a
single extra key would make them fail. `representation` and `unit` therefore live on the
enclosing `selector` object, never inside those two.

`end - start` equals the code-point length of `exact`, matching the `superRefine` in
`passageCommentAnchorSchema`. Prefix and suffix use 96 code points, matching
`EnrichedMystReader.tsx`.

**One thing ORAtlas must not do:** these offsets are in the
`oratlas-myst-source-utf8-v1` frame — the raw source text — not ORAtlas's
`myst-rendered-text-v1` frame, which is relative to ORAtlas's own rendering of the page. They
are not interchangeable. `selector.representation` exists to make that impossible to get wrong
by accident.

### Paths pass ORAtlas's own validator

Every published path satisfies `isSafeRepoRelativePath` from
`packages/contracts/src/paths.ts`, byte for byte. That is why a leading `./` is rejected: `.`
is not a legal segment under that rule. A path from `oratlas.manifest.json` can be handed to
ORAtlas's path validator unchanged.

### Claim types match the ORAtlas vocabulary

`claimType` is constrained to `CLAIM_TYPES` from `packages/contracts/src/enums.ts`. The list is
append-only upstream; an unrecognised value is rejected at export rather than passed through.

### Canonical JSON matches

`canonicalJson` here reproduces `packages/contracts/src/canonical-json.ts` exactly — recursive
key sort, `undefined` members omitted, `-0` normalised, fail-closed on non-finite numbers,
circular references and non-plain objects. A `declarationSha256` recomputed on the ORAtlas side
matches the one in the artifact.

### `@oratlas/contracts` is not a dependency, on purpose

ORAtlas's contracts package is its internal boundary, not the portable protocol boundary.
Depending on it would couple every independent MyST publication to ORAtlas's internal release
cadence and private types. Three small pieces are re-implemented here with identical behaviour
and marked as such in the source: `canonicalJson`, `sha256`, and the safe-path rule.

If a schema genuinely becomes shared, the right move is a small, independently usable v1
specification — not exporting ORAtlas's internals.

---

## 3. What ORAtlas must decide, and this adapter never does

| Decision                                                                      | Where it belongs                                |
| ----------------------------------------------------------------------------- | ----------------------------------------------- |
| Does this occurrence get a new stable claim node, or bind to an existing one? | ORAtlas, `docs/canonical-graph-identity.md`     |
| Are two occurrences across versions the same claim?                           | ORAtlas, an explicit reviewed identity decision |
| Is the claim supported by the cited evidence?                                 | ORAtlas, a claim–evidence relation              |
| What is its TRUST assessment?                                                 | ORAtlas, `docs/trust-model.md`                  |
| Is a relation editor-confirmed?                                               | ORAtlas, an explicit editorial action           |

ORAtlas's own rules already say it: _"Atlas must not infer stable claim identity across review
versions from a repeated local id, normalized text, anchor, position, or similarity."_ This
adapter is built to hold to that from the publication side. A record describes an occurrence.
It never asserts continuity, and a consumer must not read continuity into it.

Two `declarationSha256` values being equal means two byte-identical declarations exist. It does
not mean they are the same claim.

---

## 4. Source assertion vs. verification

Everything in these artifacts is a **publication source assertion**: what the author declared,
where, and over which bytes.

Nothing in them is an ORAtlas verification. Successfully fetching, parsing, digest-checking and
ingesting a claim record establishes structural provenance and nothing more. In ORAtlas's terms
an imported claim occurrence is `source-assertion` / `imported-from-review`; it must not acquire
`confirmed-by-editor` provenance or `confirmed` status because it parsed cleanly.

The adapter enforces the same distinction in the other direction. A publication may ship its
own `review-manifest.json`, `knowledge/claims.jsonl`, citation, relation and TRUST artifacts.
This adapter _recognises_ them — it reads claim ids to establish declaration authority — and
never reinterprets, rewrites, upgrades or re-emits them. See
[architecture §5](architecture.md#5-decision-d--relationship-to-review-manifestjson).

---

## 5. What ORAtlas needs to add

This repository implements none of the following. It is listed so the work is legible.

### 5.1 The `oratlas:claim` directive in ORAtlas's MyST reader

**This is the one that matters most.** ORAtlas's `apps/web/src/lib/article-reader.ts` reads a
publication's MyST source itself and transforms unknown `mystDirective` nodes into a fallback
admonition:

```js
return {
  type: "admonition", kind: "note",
  children: [{ type: "admonitionTitle", children: [{ type: "text", value: `MyST extension: ${name}` }] }, …]
};
```

So a publication using this adapter currently renders inside ORAtlas as a note titled
_"MyST extension: oratlas:claim"_ wrapped around the claim text. The prose is preserved and
nothing breaks, but the claim is not recognised as one and gets no anchor.

`article-reader.ts` needs a case for `name === "oratlas:claim"` alongside its existing
`trust-claim` case: read the directive argument as the source-local claim id, keep the body as
ordinary rendered content, and emit a node carrying that id so the claim is anchored and
addressable in ORAtlas's reader. The DOM id must be generated by ORAtlas from its own
version/local-id pair, exactly as `docs/evidence-identity.md` already requires — the
publication's `target.htmlId` is retained as source metadata, never as a platform DOM id.

That change belongs in `dhuzard/oratlas` and was deliberately not made here.

### 5.2 An ingestion path for `oratlas.manifest.json`

ORAtlas's extractor currently discovers `review-manifest.json` and `node-manifest.json`. It
needs to also recognise `oratlas.manifest.json` at a publication root, validate it against
`schemas/oratlas-manifest.schema.json`, and read the declared claims artifact — with the same
bounded, path-revalidating, record-capped discipline it already applies to JSONL artifacts.

### 5.3 Reconciliation with `review-manifest.json`

When a publication ships both, `artifacts.claims.declarations` says which is authoritative for
claim declarations. ORAtlas should honour that rather than merging: with
`"review-manifest"`, the review manifest's claim stream supplies text and attributes and the
adapter's records supply only the source occurrence binding.

### 5.4 Storing the source occurrence binding

`documentPath`, `documentSha256`, the line span, `blockSha256`, `declarationSha256` and the
source-frame selector are the evidence that a claim occurrence really is in a given version of
a given page. ORAtlas has a natural place for the first two — its passage-anchor model already
uses exactly that pair. The rest is new, and is what makes a claim occurrence independently
re-verifiable from source bytes alone.

### 5.5 Not required

None of these are needed for ingestion, and none should be inferred from the artifacts:

- cross-version claim continuity;
- automatic evidence extraction;
- a per-claim TRUST score (there is none to read, by design);
- any write path back to the publication.

---

## 6. Ingestion checklist

For an implementer on the ORAtlas side:

- [ ] Reject a `schemaVersion` you do not implement. Do not partially read it.
- [ ] Re-validate every declared path against SPEC §3 before fetching. Do not trust the
      producer.
- [ ] Verify `artifacts.claims.sha256` against the fetched bytes.
- [ ] Cap the bytes and record count you will read.
- [ ] Reject an unknown key: both objects are closed.
- [ ] Verify `source.documentSha256` against the page source you hold.
- [ ] Treat `selector.*` as the `oratlas-myst-source-utf8-v1` frame. Never mix it with
      `myst-rendered-text-v1`.
- [ ] Count selector offsets in code points, not UTF-16 code units.
- [ ] Record every claim as a **source assertion**. Do not mark it confirmed or verified.
- [ ] Mint claim identity by ORAtlas's canonical-graph-identity rules. Do not derive it from
      the source-local id, the text, or any digest in the artifact.
- [ ] Retain `target.htmlId` as source metadata; generate your own DOM ids.
