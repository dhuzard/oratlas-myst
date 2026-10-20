# Agent guidance — @oratlas/myst

## Product responsibility
This package is the **publication-side MyST interoperability adapter**. It declares and exports source occurrences and stable scientific-claim identifiers, with deterministic, verifiable files. It does **not** publish to or query ORAtlas, assess a scientific claim, assign TRUST scores, run verification, or own canonical ORAtlas graph identities.

## Source and contract authorities
- `SPEC.md`, `docs/protocol.md`, `schemas/` and `src/contracts/` define manifest/claim-export behavior.
- `README.md` describes the user workflow; `docs/integration-oratlas.md` describes consumer expectations.
- Source bytes, source paths/selectors and digests must match; preserve deterministic output on identical inputs.
- Never silently alter a frozen schema version or reinterpret an existing claim identity. Version protocol changes and provide backward-compatibility fixtures or an explicit migration.

## Safety
Validation is offline and read-only. Do not make network calls to ORAtlas from the adapter, execute MyST source code while validating artifacts, or rewrite author text to satisfy an import. Unresolved source identity or mismatched hashes must fail explicitly, not be repaired invisibly.

## Tests and review
```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm schemas:check
pnpm acceptance
```
For ORAtlas interoperability, freeze a MyST source fixture and emitted manifest/claims, record the exact schema version and source commit, then test ORAtlas ingestion separately against those bytes. A successful local export alone does not demonstrate current ORAtlas consumer compatibility. Avoid editing the default branch configuration here; repository settings belong to the maintainer.
