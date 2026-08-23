# @oratlas/myst

[![schema 0.2.0 — frozen](https://img.shields.io/badge/schema-0.2.0%20frozen-informational)](SPEC.md)

**A portable MyST ↔ ORAtlas interoperability adapter.** Declare scientific claims explicitly in
your MyST source; publish deterministic, machine-readable artifacts that let
[ORAtlas](https://github.com/dhuzard/oratlas) — or anything else — discover them and bind each
one to an exact source occurrence.

```
MyST            = structured publication
@oratlas/myst   = publication-side scientific identity adapter   ← this package
ORAtlas         = federation, knowledge graph, assessment, discussion
```

Your publication owns its static scientific source and its own semantic declarations. ORAtlas
owns everything mutable and federated: canonical graph identity, evidence relations across
publications, TRUST assessments, verification, disagreements, discussion, curation. This
adapter is the boundary between them, and it deliberately keeps that boundary thin.

An ORAtlas server is never contacted. Not during a build, not during validation, not ever.

---

## Why

MyST gives you a real structured document with real cross-references. What it has no notion of
is _this sentence is a scientific claim I am asserting, and here is its stable identity_.

Without that, anything downstream — a knowledge graph, a reviewer, a replication tracker — has
to guess which prose is a claim, and guessing is exactly what makes claim graphs untrustworthy.
So the author marks claims explicitly, and everything downstream reads a declaration rather
than a guess.

## Install

```bash
npm install --save-dev @oratlas/myst     # or: pnpm add -D @oratlas/myst
```

Add the plugin and publish the generated artifacts, in `myst.yml`:

```yaml
version: 1
project:
  id: my-review
  title: My review
  plugins:
    - node_modules/@oratlas/myst/dist/oratlas-myst.mjs
  static_files:
    # Serves them at /oratlas.manifest.json and /oratlas/claims.jsonl
    - .oratlas/oratlas.manifest.json
    - .oratlas/oratlas
  toc:
    - file: index.md
    - file: results.md
site:
  template: book-theme
```

Optionally, in `oratlas.yml` beside `myst.yml`:

```yaml
# Stable across versions of this publication. Defaults to myst.yml's project.id.
id: my-review
canonical_url: https://example.org/my-review/
version_label: v1.2.0
output: .oratlas

# Where the exact source bytes live. Without this, a consumer holding only your
# published site cannot verify the source digests — see "Verification levels".
source:
  type: git
  repository: https://github.com/lab/my-review
```

<details>
<summary>Pinning a release artifact instead of an npm dependency</summary>

For a reproducible scholarly build you can point MyST at a pinned release asset:

```yaml
project:
  plugins:
    - https://github.com/dhuzard/oratlas-myst/releases/download/v0.1.0/oratlas-myst.mjs
```

Always pin an exact tag. Never use a `latest` URL in a publication you intend to be
reproducible — the plugin would change under you between builds. You still need the package
installed to run the `oratlas-myst` CLI.

</details>

## Annotate a claim

```markdown
:::{oratlas:claim} hpa-axis-mediation
:type: mechanistic
:qualification: Rodent models only; evidence in humans is correlational.

Persistent behavioural change after adolescent stress is mediated in part by lasting
alterations in hypothalamic–pituitary–adrenal axis reactivity [@mccormick2010].
:::
```

The argument is a **source-local claim id** you choose. It must be unique in your publication
and match `^[a-z0-9][a-z0-9._-]*$` — the same form MyST uses for cross-reference labels, so
that one string is your id, the MyST target, the HTML anchor, and the exported record id.

Both options are optional. `:type:` must be one of ORAtlas's claim types (`empirical`,
`mechanistic`, `methodological`, `theoretical`, `normative`, `summary`, `other`, `synthesis`,
`model-derived`, `translational`).

The body is ordinary MyST. Citations, maths, emphasis, lists and cross-references all work, and
the claim becomes a normal cross-reference target:

```markdown
See [the HPA-axis account](#hpa-axis-mediation).
```

## Export and build

```bash
npx oratlas-myst export     # writes .oratlas/
npx myst build --html       # normal MyST build; copies the artifacts to the site root
```

In CI, pass the commit being built so the manifest can name it — the config file naming a
commit is itself part of that commit, so it cannot be hard-coded:

```bash
npx oratlas-myst export --source-commit "$GITHUB_SHA"
```

Then, any time — in CI, in a pre-commit hook, before a release:

```bash
npx oratlas-myst validate
```

Validation is entirely offline. It re-parses your source and checks that every record still
matches it: digests, selectors, cross-reference targets, unique ids, safe paths, and that a
fresh export would reproduce the artifacts on disk byte for byte.

```
oratlas-myst export      write the artifacts
oratlas-myst validate    check them against the source (no network)
oratlas-myst inspect     list every claim declaration the exporter can see
```

Add `--project <dir>` to run against another directory, `--json` for machine-readable output.

## Generated files

```
https://example.org/my-review/myst.xref.json          ← MyST's own cross-reference inventory
https://example.org/my-review/oratlas.manifest.json   ← discovery manifest
https://example.org/my-review/oratlas/claims.jsonl    ← one claim occurrence per line
```

`oratlas.manifest.json`:

```json
{
  "schemaVersion": "0.2.0",
  "generator": { "name": "@oratlas/myst", "version": "0.2.0" },
  "publication": {
    "id": "my-review",
    "canonicalUrl": "https://example.org/my-review/",
    "title": "My review",
    "version": { "sourcesSha256": "d9cc…", "label": "v1.2.0" },
    "source": { "type": "git", "repository": "https://github.com/lab/my-review" }
  },
  "adapter": { "type": "myst", "xref": "myst.xref.json" },
  "artifacts": {
    "claims": {
      "path": "oratlas/claims.jsonl",
      "format": "jsonl",
      "records": 4,
      "sha256": "1c7f…",
      "declarations": "publication-source"
    }
  }
}
```

One line of `oratlas/claims.jsonl`, expanded:

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

Three digests, three questions: `documentSha256` — did this page change? `blockSha256` — did
this declaration's source block change? `declarationSha256` — did the author's assertion
change, wherever it now lives? See [SPEC.md §8.3](SPEC.md#83-hashing).

## Verification levels

Your deployed site serves HTML, page data, `myst.xref.json` and the ORAtlas artifacts. It does
**not** serve `results.md`. So there are two levels of verification, and which one a consumer
reaches depends on whether you declare a `source`:

```
Level 1 — published structure          every consumer, from the site alone
    the claim exists, at a resolvable location, with the digest the manifest declares

Level 2 — source bytes                 needs publication.source
    + documentSha256, blockSha256, declarationSha256, source selectors
```

A site with no public source is still a first-class participant at level 1. Declaring
`source:` in `oratlas.yml` — a git repository, a DOI deposit or an archived bundle — is what
lets a consumer reach level 2.

## How ORAtlas uses them

```
external MyST publication
        ↓  fetch oratlas.manifest.json
declared artifacts
        ↓  verify digests, re-check the source binding
exact claim occurrence   (publication + exact version + source-local id)
        ↓  ORAtlas's own decision
canonical ORAtlas graph binding
```

The adapter stops at "exact claim occurrence". It never mints an ORAtlas canonical id, and it
never claims two occurrences are the same claim. That decision belongs to ORAtlas and follows
ORAtlas's own canonical-graph-identity rules.

`publication.id` says which publication this is; `publication.version.sourcesSha256` says which
version. A URL is not identity — publications move, get mirrored, and get replaced — so neither
is derived from `canonicalUrl`.

`myst.xref.json` resolves an identifier to where the built site serves it. `claims.jsonl` says
what the claim is and where it is declared in the source. Neither reproduces the other; they
join on the identifier.

If your publication already ships an ORAtlas `review-manifest.json`, point at it:

```yaml
# oratlas.yml
review_manifest: review-manifest.json
```

The richer manifest then keeps authority over everything it already declares. See
[docs/integration-oratlas.md](docs/integration-oratlas.md).

## Current limitations

- **v0.1 parses `.md` pages only.** A `.ipynb` or `.tex` page in the TOC is reported and
  skipped rather than silently dropped.
- **`[](#claim-id)` with no link text renders as "Div"**, because a claim lowers to a MyST
  `div` node and MyST has no reference template for one. Write explicit link text —
  `[the HPA-axis account](#hpa-axis-mediation)` — which reads better anyway.
- **No live UI.** No badges, no trust panels, no comment widgets. MyST does not yet support
  custom renderer plugin hooks, and v0.1 does not pretend otherwise. See
  [docs/roadmap.md](docs/roadmap.md).
- **No automatic claim extraction.** Claims are declared by the author, deliberately. No LLM
  is involved anywhere in this package.
- **No TRUST, assessment, or discussion state.** Those are mutable and federated; they belong
  to ORAtlas. This package will not emit a per-claim truth score, because ORAtlas's TRUST
  model does not have one to emit.
- **One MyST project per export.** Multi-project sites are not yet handled.
- **Symlinked pages are skipped by discovery.** Following them would let a link walk outside
  the project. Declare one in `project.toc` to include it deliberately.
- **No ORAtlas ingestion yet.** Registering a published manifest with an ORAtlas instance is
  not implemented on either side. See
  [docs/integration-oratlas.md §5.0](docs/integration-oratlas.md#50-a-registration-endpoint-for-externally-hosted-manifests).

## Documentation

|                                                            |                                                                 |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| [SPEC.md](SPEC.md)                                         | Normative v0.1 interoperability specification                   |
| [docs/protocol.md](docs/protocol.md)                       | Field-by-field walkthrough with worked examples                 |
| [docs/architecture.md](docs/architecture.md)               | Design decisions, trust boundaries, MyST compatibility findings |
| [docs/integration-oratlas.md](docs/integration-oratlas.md) | How ORAtlas ingests these artifacts, and what it still needs    |
| [docs/roadmap.md](docs/roadmap.md)                         | What is in v0.1 and what is not                                 |
| [examples/basic](examples/basic)                           | A working multi-page example                                    |

## Development

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test         # includes a real `myst build` against examples/basic
pnpm build
```

`pnpm test` runs the MyST integration suite, which requires `pnpm build` to have produced
`dist/oratlas-myst.mjs` first.

## License

MIT
