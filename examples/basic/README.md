# examples/basic

A small, working MyST publication using `@oratlas/myst`. Two pages, four explicitly declared
claims, real citations, and cross-references to the claims from ordinary prose.

## Run it

From the repository root:

```bash
pnpm install
pnpm build          # produces dist/oratlas-myst.mjs, which myst.yml points at
pnpm example:build  # export → myst build --html → validate
```

Or step by step, from this directory (`npx` finds the repository's `mystmd`):

```bash
node ../../dist/lib/cli/main.js export
npx myst build --html
node ../../dist/lib/cli/main.js validate
```

In CI, name the commit being built so the manifest can carry it:

```bash
node ../../dist/lib/cli/main.js export --source-commit "$GITHUB_SHA"
```

`myst build --html` downloads the `book-theme` site template from api.mystmd.org, so it needs
network access. The offline equivalent — a real MyST site build against a local template — runs
as part of `pnpm test`, in `tests/myst-integration.test.ts`.

## What it produces

```
.oratlas/
├── oratlas.manifest.json
└── oratlas/
    └── claims.jsonl

_build/html/                       ← the deployable site
├── myst.xref.json                 (MyST)
├── oratlas.manifest.json          (copied by project.static_files)
├── oratlas/claims.jsonl           (copied by project.static_files)
└── … pages …
```

## What to look at

**`myst.yml`** — the `plugins` entry pointing at the built plugin, and `static_files`, which is
what puts the generated artifacts at the site root.

**`oratlas.yml`** — the configuration surface: publication id, canonical URL, version label,
output directory, and a `source:` descriptor saying where the exact source bytes live. That
last one is what lets a consumer holding only the published site reach source-byte
verification: the deployed site serves the artifacts and the built pages, not `results.md`.

**`index.md`** — one `empirical` claim, and cross-references to claims on both pages.

**`results.md`** — a `mechanistic` claim spanning two paragraphs with a `:qualification:`, an
`empirical` claim, and a `summary` claim stating a negative result. Claims are stated as
explicit declarations precisely so that a limit can be challenged on the same terms as a
positive finding.

A publication that also shipped an ORAtlas `review-manifest.json` would add
`review_manifest: review-manifest.json` to `oratlas.yml`; that manifest would then keep
authority over claim text and attributes, and these records would carry only the source
occurrence binding. See [../../docs/integration-oratlas.md](../../docs/integration-oratlas.md).
