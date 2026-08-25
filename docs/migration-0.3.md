# Migrating manifest schema 0.2.0 to 0.3.0

Package `0.3.0` defaults new exports to manifest schema `0.3.0`. The frozen `0.2.0` manifest
and claim contracts remain accepted. Claims continue to use record schema `0.2.0`; only the
manifest evolves.

## Staying on the frozen manifest

Add this explicit selection to `oratlas.yml`:

```yaml
schema_version: 0.2.0
```

The exporter then emits the closed legacy manifest and rejects `contributors` or `production`
instead of silently dropping them. Validation can still reproduce an existing 0.2 artifact even
when an older project has no `schema_version` setting.

## Moving to 0.3.0

Remove the legacy selection or set `schema_version: 0.3.0`. Standard ordered MyST
`project.authors` become the default scholarly contributors. No network lookup or identity merge
occurs. To override that default—for example for a group author or editor—declare the bounded
`contributors` array in `oratlas.yml`.

Production provenance is opt-in. Add `production` only when the source explicitly declares it.
No package, plugin, git-history, filename, prose, or CI inspection occurs, and a missing declaration
does not become `mode: human`.

## ORAtlas adapter normalization contract

The 0.3 consumer should:

1. Scope the ordered `contributors` snapshot to the captured exact `PublicationVersion`, retain
   declared identifiers as metadata, and bind source-declaration provenance to the captured
   publication manifest. It must not resolve ORCID/ROR or create canonical people.
2. Normalize the single `production` block to a source-declared
   `PublicationProductionAssertion` using `sourceAssertionKey`, `mode`, optional statement/evidence
   URL, and actor metadata. Actor `id` is a source-local uniqueness key, not an ORAtlas ID.
3. Derive the assertion's bounded activity list as the first-seen ordered union of each actor's
   `activities`; strip only the source-local actor `id` and per-actor activity assignment when
   constructing the generic stored actor values.
4. Never turn a production actor into a contributor, never turn a contributor into a production
   actor, and never reinterpret `strength: source-declared` as attested, verified, certified, or
   trusted.

No MyST-specific database fields are required. The adapter performs this pure normalization into
the already generic contributor and production contracts.
