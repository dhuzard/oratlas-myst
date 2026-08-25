# Protocol 0.3.0 examples

These fixtures show the orthogonal declaration channels introduced by manifest schema
`0.3.0`. All digests are illustrative valid-shape placeholders.

- `human.manifest.json`: two scholarly authors; production is absent.
- `ai-assisted.manifest.json`: human scholarly authors plus explicit AI and human production actors.
- `ars-hybrid.manifest.json`: human scholarly authors plus an ARS workflow and human production actor.
- `agentic-no-contributors.manifest.json`: explicit agentic production; contributors are absent.
- `group-author.manifest.json`: an institutional/group scholarly contributor.
- `malformed/`: declarations a conforming validator must reject.

Array order is meaningful. Contributors use contiguous one-based `position` values. Production
actors retain the order in `oratlas.yml`; each actor's activity order is also retained.
