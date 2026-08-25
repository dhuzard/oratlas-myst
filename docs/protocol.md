# Protocol walkthrough

A worked, non-normative tour of the artifacts. The normative rules are in
[SPEC.md](../SPEC.md); where the two appear to disagree, SPEC.md wins.

---

## The shape of it

```
Author writes                     MyST build produces           oratlas-myst produces
─────────────                     ───────────────────           ─────────────────────
:::{oratlas:claim} my-claim   →   #my-claim anchor          →   claims.jsonl record
  Statement text.                 myst.xref.json entry          oratlas.manifest.json
:::                               readable HTML/PDF/…
```

Two artifacts, joined on one string — the source-local claim id:

```
myst.xref.json                        oratlas/claims.jsonl
{                                     {
  "identifier": "my-claim",  ←──────→   "id": "my-claim",
  "kind": "div",                        "target": { "type": "myst-xref", "identifier": "my-claim", … },
  "url": "/results",                    "text": "Statement text.",
  "data": "/content/results.json"       "source": { "documentPath": "results.md", … }
}                                     }
   where the site serves it              what it says and where it was declared
```

Neither reproduces the other. A consumer that wants a live URL for a claim joins them.

Manifest schema `0.3.0` adds two independent exact-version channels outside `claims.jsonl`:
`contributors` for scholarly credit and optional `production` for explicit source-declared
production provenance. Claim records remain on their frozen `0.2.0` schema. See the complete
examples in [`protocol/examples`](../protocol/examples).

---

## Source → record, end to end

Take `results.md`:

```markdown
1 ---
2 title: Results
3 ---
4
5 # Results
6
7 Across the studies in scope, two findings recur.
8
9 :::{oratlas:claim} hpa-axis-mediation
10 :type: mechanistic
11 :qualification: Rodent models only; evidence in humans is correlational.
12
13 Persistent behavioural change after adolescent stress is mediated in part by
14 lasting alterations in hypothalamic–pituitary–adrenal axis reactivity
15 [@mccormick2010].
16 :::
17
18 See [the HPA-axis account](#hpa-axis-mediation).
```

`oratlas-myst export` produces:

```json
{
  "schemaVersion": "0.2.0",
  "id": "hpa-axis-mediation",
  "text": "Persistent behavioural change after adolescent stress is mediated in part by lasting alterations in hypothalamic–pituitary–adrenal axis reactivity [@mccormick2010].",
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
    "startLine": 9,
    "endLine": 16,
    "blockSha256": "a704…"
  },
  "selector": {
    "representation": "oratlas-myst-source-utf8-v1",
    "unit": "body",
    "textQuote": {
      "type": "TextQuoteSelector",
      "exact": "Persistent behavioural change after adolescent stress is mediated in part by\nlasting alterations in hypothalamic–pituitary–adrenal axis reactivity\n[@mccormick2010].",
      "prefix": ":::{oratlas:claim} hpa-axis-mediation\n:type: mechanistic\n:qualification: Rodent m…",
      "suffix": "\n:::\n\nSee [the HPA-axis account](#hpa-axis-mediation).\n"
    },
    "textPosition": { "type": "TextPositionSelector", "start": 217, "end": 380 }
  },
  "declarationSha256": "3c8e…"
}
```

Field by field:

**`startLine: 9`, `endLine: 16`** — the whole directive block, from the opening `:::` to the
closing `:::` inclusive. `blockSha256` covers exactly those lines, `\n`-joined, no trailing
newline.

**`text`** — derived from the parsed AST. Note two things. The source's hard line wraps
(lines 13–15) collapsed to single spaces, because they are an authoring artifact, not content.
And `[@mccormick2010]` survived: `myst-common`'s `toText` would have dropped it entirely and
left `"…reactivity ."`, so the citation is rendered from its source key instead. Nothing else
is normalised — case, punctuation, negation, numbers and Unicode are exactly as written.

**`selector.textQuote.exact`** — the _raw source_ of the body, hard wraps and citation syntax
included. That is deliberate: `text` is the readable statement, the selector is a verifiable
locator, and they answer different questions. The selector is verifiable precisely because it
is the raw bytes the digest covers.

**`selector.textPosition`** — code-point offsets into `results.md`. So this holds:

```js
Array.from(source).slice(217, 380).join("") === record.selector.textQuote.exact;
```

Note `Array.from`. These are code points, not UTF-16 code units. `source.slice(217, 380)` is
wrong by the number of astral-plane characters before offset 217 — one emoji earlier in the
page is enough to shift it.

**`selector.unit: "body"`** — the body appeared verbatim inside the block. A claim nested
inside another directive gets dedented by MyST, and then `unit` is `"block"` and the quote
covers the whole block including fences. Either way the quoted span is byte-exact.

**`declarationSha256`** — over the declaration alone:

```
SHA-256(canonicalJson({
  schemaVersion: "0.2.0",
  id:            "hpa-axis-mediation",
  body:          "Persistent behavioural change…\n…\n[@mccormick2010].",   ← raw source
  claimType:     "mechanistic",
  qualification: "Rodent models only; evidence in humans is correlational."
}))
```

No path, no line numbers, no surrounding page.

---

## What each digest catches

| Edit                             | `documentSha256` | `blockSha256` | `declarationSha256` |
| -------------------------------- | :--------------: | :-----------: | :-----------------: |
| Fix a typo elsewhere on the page |     changes      |       —       |          —          |
| Move the claim down the page     |     changes      |       —       |          —          |
| Move the claim to another page   |     changes      |       —       |          —          |
| Reword the claim                 |     changes      |    changes    |       changes       |
| Change `:type:`                  |     changes      |    changes    |       changes       |
| Reflow the claim's line wrapping |     changes      |    changes    |       changes       |

The last row is worth dwelling on. Reflowing changes the raw body bytes, so
`declarationSha256` changes, even though `text` is identical — the derived text collapses
whitespace, the digest does not. That is the intended behaviour: the digest binds to what the
author wrote, and the author can see that they rewrapped it.

---

## Verifying a record without any network

Everything a consumer needs is local:

```js
import { createHash } from "node:crypto";
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// 1. The artifact is the one the manifest declares.
sha256(claimsJsonlBytes) === manifest.artifacts.claims.sha256;

// 2. The page is the version the record was written against.
sha256(pageSource) === record.source.documentSha256;

// 3. The declaration block is unchanged.
const lines = pageSource.split("\n");
sha256(lines.slice(record.source.startLine - 1, record.source.endLine).join("\n")) ===
  record.source.blockSha256;

// 4. The quote is where the record says it is.
const { start, end } = record.selector.textPosition;
Array.from(pageSource).slice(start, end).join("") === record.selector.textQuote.exact;
```

`oratlas-myst validate` does all four, plus: re-parses the source and confirms an
`oratlas:claim` with that id really is declared there; recomputes `declarationSha256`; checks
`text` against a fresh parse; checks id uniqueness; checks every declared path is safe; and
re-runs the whole export in memory to confirm the on-disk artifacts are byte-identical to what
the current source produces.

One value is outside that comparison: a `source.commit` supplied at build time is fed back in
from the manifest rather than rediscovered, since a fresh export has no way to know it.
Verifying the commit itself needs the repository, which is level-2 territory.

---

## Verification levels: what a consumer can actually check

This is the part that bites, so it is worth being concrete.

Your deployed site serves this:

```
https://example.org/review/
├── myst.xref.json            ✓ published
├── oratlas.manifest.json     ✓ published
├── oratlas/claims.jsonl      ✓ published
├── index.html, results.html  ✓ published
├── results.json              ✓ published   (the page data)
└── results.md                ✗ NOT published
```

But a claim record says:

```json
"source": { "documentPath": "results.md", "documentSha256": "5b1f…" }
```

A consumer holding only the site cannot check that digest, because it cannot obtain the bytes.
So there are two levels.

**Level 1 — published-structure verification.** Everything below uses only published files:

```js
const manifest = await fetchJson(new URL("oratlas.manifest.json", base));

// The artifact is the one the manifest declares.
const claimsBytes = await fetchText(new URL(manifest.artifacts.claims.path, base));
sha256(claimsBytes) === manifest.artifacts.claims.sha256;

const claims = claimsBytes.trim().split("\n").map(JSON.parse);
claims.length === manifest.artifacts.claims.records;

// The target resolves in the toolchain's own inventory...
const xref = await fetchJson(new URL(manifest.adapter.xref, base));
const ref = xref.references.find((r) => r.identifier === claim.target.identifier);

// ...and the page data it points at really contains the claim.
const page = await fetchJson(new URL(ref.data.replace(/^\//, ""), base));
const node = find(page.mdast, (n) => n.identifier === claim.target.identifier);
node.html_id === claim.target.htmlId;
node.data.oratlas.kind === "claim";
```

That proves the claim exists in the published structure at a resolvable location. It proves
nothing about source bytes.

**Level 2 — source-byte verification.** Needs the source, which the manifest says how to get:

```json
"source": { "type": "git", "repository": "https://github.com/lab/review", "commit": "0123…" }
```

With those bytes in hand, the four checks in the previous section apply. `publication.source`
is a union — `git`, `doi`, `archive` — so a Zenodo deposit and a GitHub repository are
distinguishable rather than both being "a URL".

A publication that declares no source is still a first-class participant; it is simply limited
to level 1, and `oratlas-myst export` says so in its notes.

---

## Which publication, and which version

```json
"publication": {
  "id": "adolescent-stress-review",
  "canonicalUrl": "https://example.org/adolescent-stress/",
  "version": { "sourcesSha256": "d9cc…", "label": "v1.0.0" }
}
```

`id` says _which publication_; `sourcesSha256` says _which version_. Deliberately not derived
from `canonicalUrl`, because a URL is not identity: publications move, get mirrored, and get
replaced by something else at the same address.

`sourcesSha256` is a digest over the document set — every processed page as `{path, sha256}`,
sorted by path — so it always exists, even for a plain website with no repository, DOI or
archive. It changes when any page changes, is added, or is removed:

| Change                           | `sourcesSha256` |
| -------------------------------- | :-------------: |
| Edit any page                    |     changes     |
| Add a page                       |     changes     |
| Remove a page                    |     changes     |
| Edit `myst.yml` or `oratlas.yml` |        —        |

The last row is deliberate: configuration configures the build, whereas claims bind to document
bytes, and that is what this digest identifies.

Neither field is an ORAtlas canonical identity. They are evidence for ORAtlas's own keying
decision, not a substitute for it.

---

## Resolving a claim to a live URL

There is one trap here, and it catches every subpath deploy.

`myst.xref.json` `url` values are **site-root-relative** (`/`, `/results`), not relative to the
publication:

```js
new URL("/results", "https://example.org/review/").href;
// → "https://example.org/results"       ← wrong: the /review/ prefix vanished
```

Treat `canonicalUrl` as the site root instead — strip the leading slash first:

```js
import { resolvePublishedUrl } from "@neuronautix/myst";

resolvePublishedUrl("https://example.org/review/", "/results", "my-claim");
// → "https://example.org/review/results#my-claim"
```

Put together:

```js
const manifest = await fetchJson("https://example.org/review/oratlas.manifest.json");
const base = "https://example.org/review/";
const xref = await fetchJson(new URL(manifest.adapter.xref, base));
const claims = (await fetchText(new URL(manifest.artifacts.claims.path, base)))
  .trim()
  .split("\n")
  .map(JSON.parse);

for (const claim of claims) {
  const ref = xref.references.find((r) => r.identifier === claim.target.identifier);
  if (!ref) continue; // declared but not built
  const url = resolvePublishedUrl(base, ref.url, claim.target.htmlId);
  // → https://example.org/review/results#hpa-axis-mediation
}
```

Validate every declared path against [SPEC.md §3](../SPEC.md#3-path-rules) before resolving it.
A path that fails the rule is not to be fetched.

---

## Two claims, one sentence

Nothing stops a publication from asserting the same sentence twice:

```markdown
:::{oratlas:claim} effect-in-males
The effect was replicated.
:::

:::{oratlas:claim} effect-in-females
The effect was replicated.
:::
```

These are two distinct claims. `text` is identical; `declarationSha256` is not, because the id
is part of the digest input; `selector.textPosition` and `textQuote.prefix` differ, so the two
occurrences are separable in the source.

The inverse also holds: two publications whose `declarationSha256` happens to match are **not**
thereby asserting the same claim. Nothing in this format asserts cross-publication or
cross-version claim identity — see [SPEC.md §4.2](../SPEC.md#42-what-identity-these-artifacts-do-and-do-not-establish).

---

## When a `review-manifest.json` is also present

With `review_manifest: review-manifest.json` in `oratlas.yml`, and that manifest declaring
`artifacts.claims`, the same claim exports differently:

```json
{
  "schemaVersion": "0.2.0",
  "id": "hpa-axis-mediation",
  "target": { "type": "myst-xref", "identifier": "hpa-axis-mediation", "htmlId": "hpa-axis-mediation" },
  "source": { "documentPath": "results.md", "documentSha256": "5b1f…", "startLine": 9, "endLine": 16, "blockSha256": "a704…" },
  "selector": { … },
  "declarationSha256": "3c8e…"
}
```

No `text`, no `claimType`, no `qualification`. Those are declared by
`knowledge/claims.jsonl`, which the review manifest owns, and restating them here would create
a second copy that can drift. The manifest records which is which:

```json
"artifacts": { "claims": { …, "declarations": "review-manifest" } },
"oratlas":   { "reviewManifest": "review-manifest.json" }
```

What remains is the part the review manifest has no representation for: _where in the MyST
source this claim is declared, and against which bytes_.

The export fails if the MyST source declares an id the review manifest's stream does not. It
reports, without failing, a review-manifest claim with no MyST occurrence — that claim simply
has no source binding.

---

## Error behaviour

Everything below is a hard failure, never a silent repair:

| Condition                                                 | Code                                                      |
| --------------------------------------------------------- | --------------------------------------------------------- |
| Claim id not matching `^[a-z0-9][a-z0-9._-]*$`            | `claim-id-malformed` (with the conforming form suggested) |
| Same id declared twice in the publication                 | `claim-declarations-invalid`                              |
| Claim body with no statement                              | `claim-body-empty`                                        |
| `:type:` not an ORAtlas claim type                        | `claim-type-unknown`                                      |
| Path escaping the project, absolute, or through a symlink | `unsafe-path`                                             |
| Unknown key in `oratlas.yml`                              | `oratlas-config-unknown-key`                              |
| `canonical_url` not `https://`                            | `oratlas-config-invalid`                                  |
| Declared review manifest unreadable or not JSON           | `review-manifest-unparsable`                              |
| MyST claim id absent from a delegating review manifest    | `review-manifest-claim-unknown`                           |

`oratlas-myst inspect` reports every problem in one pass rather than stopping at the first, so
a publication with several can be fixed in one edit.
