# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html), with the caveat that anything
before `1.0.0` may break.

Two version numbers move together in this repository and are tested to agree: the npm package
version, and the `schemaVersion` of the artifacts the exporter writes. They are not the same
thing — a future patch release may leave `schemaVersion` untouched — but a change to the
artifact format always implies a `schemaVersion` change.

## [Unreleased]

## [0.1.0] — unreleased

First release. Artifact `schemaVersion`: `0.1.0`.

### Added

- `oratlas:claim` MyST directive: an explicit, addressable scientific claim declaration that
  lowers to a standard MyST `div` node and appears in `myst.xref.json` as a cross-reference
  target — no custom renderer required.
- `oratlas.manifest.json`: a small, closed, versioned interoperability and discovery manifest.
- `oratlas/claims.jsonl`: one claim occurrence record per line, carrying the source binding
  (document digest, block digest, declaration digest) and W3C source-frame selectors.
- `oratlas-myst` CLI with `export`, `validate` and `inspect`. Offline, deterministic, and
  fail-closed on semantic errors.
- Zod contracts as the single definition, with generated JSON Schemas and a CI drift gate.
- Interoperability with an existing ORAtlas `review-manifest.json`, including explicit claim
  declaration authority and a duplication rule.
- `examples/basic`, a multi-page example built by a real MyST build in CI and in the tests.
- Single-file plugin bundle at `dist/oratlas-myst.mjs` for npm or pinned-release use.

### Notes

- `dist/` is not committed. It is built by CI and attached to tagged releases; consumers get it
  from npm or from a pinned release asset.
- npm publishing is not wired into CI. Adding it needs an `NPM_TOKEN` secret and an explicit
  decision to publish from CI.
