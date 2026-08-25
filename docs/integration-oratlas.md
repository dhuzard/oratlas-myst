# Integrating with ORAtlas

How these artifacts are meant to be consumed by [ORAtlas](https://github.com/dhuzard/oratlas),
what is deliberately compatible with ORAtlas's existing contracts, and what ORAtlas still has
to add.

**Nothing in this document is implemented in this repository, and nothing here requires
database access or ORAtlas credentials.** This repository is the publication side of the
boundary. It is written from a read of `dhuzard/oratlas` as of August 2026.

---

## 1. Registration, discovery and ingestion

ORAtlas does not host the publication. The publication is somewhere on the web, and ORAtlas
learns about it because someone registers it:

```
https://lab.org/review/oratlas.manifest.json
                     │
                     │  someone registers this URL with ORAtlas
                     ▼
           fetch + capture the manifest
                     │
                     │  validate declared paths (SPEC §3), then fetch
                     ▼
  published-structure verification         ← level 1, always available
    claims.jsonl + myst.xref.json + page data
                     │
                     │  when publication.source is resolvable
                     ▼
     source-byte verification              ← level 2
    documentSha256, blockSha256, selectors
                     │
                     ▼
      canonical publication version
   (publication.id + version.sourcesSha256)
                     │
                     ▼
           claim occurrences
                     │
                     │  ORAtlas's own decision, ORAtlas's own rules
                     ▼
        canonical ORAtlas graph binding
```

**The registration endpoint is the missing operational piece.** Everything above the
"canonical publication version" line is specified and implemented on the publication side.
Below it is ORAtlas's. But the arrow at the top — _someone registers this URL_ — has no
implementation anywhere yet, and without it "ORAtlas does not need to host the publication"
stays a conceptual claim rather than an operational one. See §5.0.

The adapter stops at "claim occurrences". It neither performs the canonical binding nor
presumes its outcome.

### 1.1 The two verification levels

This distinction is load-bearing, and it is the reason `publication.source` exists.

A deployed MyST site serves rendered pages, page JSON, `myst.xref.json` and the ORAtlas
artifacts. It does **not** generally serve `results.md`. So a claim record can say
`results.md` has digest `abc…` while ORAtlas, holding only the published site, has no way to
obtain those bytes and check it.

|                                     | Level 1 — published structure | Level 2 — source bytes                      |
| ----------------------------------- | ----------------------------- | ------------------------------------------- |
| Needs                               | the published site only       | additionally, `publication.source` resolved |
| Artifact digest                     | ✓                             | ✓                                           |
| Declared paths safe                 | ✓                             | ✓                                           |
| Target resolves in the inventory    | ✓                             | ✓                                           |
| Claim node present in the page data | ✓                             | ✓                                           |
| `documentSha256`                    | —                             | ✓                                           |
| `blockSha256`                       | —                             | ✓                                           |
| `declarationSha256` recomputed      | —                             | ✓                                           |
| Source selectors located            | —                             | ✓                                           |

A journal site with no public Markdown is a first-class participant at level 1. A GitHub-backed
or DOI-deposited publication additionally reaches level 2. ORAtlas MUST record which level it
reached for a given ingestion, and MUST NOT present a level-1 ingestion as though the source
bytes had been verified.

`tests/published-structure.test.ts` in this repository runs level 1 against a real MyST build
using only published bytes, with the Markdown deliberately out of reach, so the level-1 path is
demonstrated rather than assumed.

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

### Publication and version identity are separate fields

`publication.id` is stable across versions; `publication.version.sourcesSha256` identifies the
exact version. Neither is an ORAtlas canonical identity, and the adapter never mints one — they
are evidence for ORAtlas's own keying decision, not a substitute for it.

The version digest always exists, including for a publication with no repository, DOI or
archive, so ORAtlas can distinguish version 1 from version 2 of a plain website without
guessing from a mutable URL.

### The adapter and target types are discriminated unions

`adapter.type` and `target.type` name the authoring toolchain. ORAtlas should switch on them
and normalise into one generic source-occurrence representation, so a JATS or Quarto adapter
later needs no change to the canonical graph. `target.identifier` is the field every variant
carries; everything else is variant-specific.

Do not build the ingestion contract around `myst.xref` or a bare `{identifier, htmlId}`.

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

### 5.0 A registration endpoint for externally hosted manifests

**This is what makes the architecture operational rather than conceptual**, and it is the piece
with no implementation on either side today.

ORAtlas needs a way to be told _this URL is an ORAtlas-compatible publication_, and to keep
that registration alive across the publication's versions. Roughly:

1. **Register** — accept a manifest URL. Fetch it with a bounded, timeout-capped, redirect-
   limited client. Re-validate every declared path against SPEC §3 before fetching anything it
   points at. Never follow a path the manifest declares without re-checking it.
2. **Capture** — store the fetched bytes and their digests, so an ingestion is reproducible and
   auditable after the site changes. The manifest is a snapshot of a moment.
3. **Verify** — level 1 always; level 2 when `publication.source` resolves. Record which.
4. **Key** — bind to a canonical publication using `publication.id`, `canonicalUrl` and
   `source` as evidence. `version.sourcesSha256` distinguishes versions.
5. **Re-check** — a publication is republished, not pushed. Registration implies polling or an
   author-triggered re-ingest; a changed `sourcesSha256` is a new version, not an edit.

Things this endpoint must get right, because they are adversarial inputs: the manifest is
fetched from a host ORAtlas does not control, so its size, its redirect chain, its declared
paths and its declared record counts are all untrusted. Cap them all. A registration must not
be able to make ORAtlas fetch an arbitrary internal URL.

Ownership is a separate question this specification does not answer: proving that whoever
registers `https://lab.org/review/` is entitled to. A `.well-known` challenge, a DNS record or
a repository-based proof are all plausible; none is specified here, and ORAtlas should decide
it before registration is open rather than after.

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

For manifest `0.3.0`, implement the pure normalization contract in
[`migration-0.3.md`](migration-0.3.md): exact-version ordered contributors and one optional
source-declared production assertion. Keep the frozen 0.2 adapter path unchanged.

For an implementer on the ORAtlas side:

- [ ] Reject a `schemaVersion` you do not implement. Do not partially read it.
- [ ] Switch on `adapter.type` and `target.type`; reject a variant you do not implement. Do not
      assume `myst`.
- [ ] Record which verification level you reached (§1.1). Never present a level-1 ingestion as
      source-verified.
- [ ] Resolve an inventory URL by treating `canonicalUrl` as the site root: strip the leading
      `/` first, or a subpath deploy silently loses its prefix (SPEC §6.1).
- [ ] Key the publication from `publication.id`, `canonicalUrl` and `source` as evidence;
      distinguish versions by `version.sourcesSha256`. Never treat a URL as identity.
- [ ] Re-validate every declared path against SPEC §3 before fetching. Do not trust the
      producer.
- [ ] Verify `artifacts.claims.sha256` against the fetched bytes.
- [ ] Cap the bytes and record count you will read.
- [ ] Reject an unknown key: both objects are closed.
- [ ] For 0.3, retain `contributors` in exact array/position order as source-declared
      PublicationVersion snapshots. Do not resolve identities.
- [ ] For 0.3, normalize `production` as a source-declared assertion and keep its actors out of
      scholarly-credit semantics. Never treat its mode as quality, TRUST, or certification.
- [ ] Verify `source.documentSha256` against the page source you hold.
- [ ] Treat `selector.*` as the `oratlas-myst-source-utf8-v1` frame. Never mix it with
      `myst-rendered-text-v1`.
- [ ] Count selector offsets in code points, not UTF-16 code units.
- [ ] Record every claim as a **source assertion**. Do not mark it confirmed or verified.
- [ ] Mint claim identity by ORAtlas's canonical-graph-identity rules. Do not derive it from
      the source-local id, the text, or any digest in the artifact.
- [ ] Retain `target.htmlId` as source metadata; generate your own DOM ids.
