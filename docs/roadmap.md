# Roadmap

Everything below v0.1 is **planned, not implemented**. Nothing in this repository does any of
it today, and no claim in the README, SPEC or generated artifacts implies otherwise.

---

## v0.1 — semantic protocol and deterministic export (this release)

Shipped:

- `oratlas:claim` directive, lowering to standard MyST AST with a stable cross-reference target.
- `oratlas.manifest.json` and `oratlas/claims.jsonl`, schema version `0.1.0`.
- Zod contracts as the single definition; generated JSON Schemas with a CI drift gate.
- `oratlas-myst export`, `validate` and `inspect`. Offline, deterministic, fail-closed.
- Source occurrence binding: document digest, block digest, declaration digest, W3C selectors.
- Interoperability with an existing ORAtlas `review-manifest.json`, with explicit declaration
  authority.
- A working multi-page example, built by a real MyST build in CI and in the test suite.
- Single-file plugin bundle for npm or pinned-release use.

Deliberately not shipped: any mutable or federated state, any live UI, any automatic claim
extraction, any network access.

---

## v0.2 — read-only live ORAtlas UI

**Not implemented.**

Show a reader what ORAtlas knows about a claim — evidence count, assessment presence,
whether a challenge is open — without the publication asserting any of it statically.

Blocked on two things. MyST does not yet support custom renderer plugin hooks, so there is no
supported way to attach a component to the claim node; and any live display means a runtime
fetch, which must stay strictly optional, opt-in, degrade to plain content when unavailable, and
never become a build-time dependency. Whatever it displays remains ORAtlas's state, fetched at
read time, never baked into the publication.

Likely shape: an optional, opt-in client script that resolves claim ids against a configured
ORAtlas instance and progressively enhances the existing anchors. Publications that do not opt
in keep working exactly as they do now.

---

## v0.3 — discussion and participation

**Not implemented.**

Let a reader move from a claim in the publication to the discussion of that claim in ORAtlas —
comments, passage annotations, formal challenges — and back.

The groundwork is already in place: `source.documentSha256` is byte-identical to ORAtlas's
`PassageCommentAnchor.sourceSha256`, and the selectors are in ORAtlas's own strict object
shapes. What is missing is the round trip, and a version-aware link that survives a
publication being rebuilt.

Discussion state stays in ORAtlas. It will not be written into a static artifact.

---

## Beyond: optional automatic extraction

**Not implemented, and a separate layer if it ever exists.**

v0.1's explicitly declared claims are a deterministic, auditable baseline. Automatic extraction
— LLM-assisted or otherwise — could later propose candidate claims, but only as clearly
labelled proposals, with their method and version recorded, never silently promoted into
author-declared claims. The distinction between _the author asserted this_ and _a tool guessed
this_ must survive into the artifact.

---

## Toward a stable 1.0

Before `schemaVersion` `1.0.0`, the format needs:

**Real ingestion.** ORAtlas consuming these artifacts end to end
([integration-oratlas.md §5](integration-oratlas.md#5-what-oratlas-needs-to-add)) is the only
thing that will show which fields are actually load-bearing.

**More than one independent publication.** One example project is not a compatibility test.

**A settled extension policy.** Both objects are closed today, so every addition needs a
version bump. That is right for a young format and probably wrong for a mature one; the
replacement needs to be designed rather than defaulted into.

**A `$schema` URL.** Omitted in v0.1 because it would need a permanent hosting commitment this
project cannot yet make.

**Cross-version identity, deliberately unsolved here.** Relating a claim in v2 of a
publication to the same claim in v1 is a real problem, and it is not a hashing problem. v0.1
refuses to guess, and 1.0 should either carry an explicit author-declared continuity assertion
or continue to refuse. It must not become an inference.

### Known gaps in v0.1

| Gap                                             | Status                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `.ipynb` and `.tex` pages                       | Reported and skipped, not parsed                                   |
| Multi-project MyST sites                        | One project per export                                             |
| `[](#claim-id)` renders as "Div"                | MyST has no reference template for a `div`; use explicit link text |
| Claims in frontmatter parts (abstract, summary) | Not traversed                                                      |
| Relations between claims within a publication   | Out of scope for v0.1                                              |
