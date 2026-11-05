# packages/harness

The bot runtime. All modules are working code with no external deps.

- `guardrails.js` — the Auto/Approve/Never Auto engine. Never classes are
  frozen in code; config can only add restrictions. Unknown actions
  default to Approve.
- `yaml-lite.js` — the small YAML-subset parser bippity config files use.
- `persona-loader.js` — loads a bot folder (persona.md + tools.yaml +
  guardrails.yaml) or a pack (pack.yaml + optional pack.bots.js rich
  definitions: roles, models, routing keywords, offline work).
- `model-router.js` — per-bot provider selection (openai | claude |
  grok | ollama:<model>), key detection, daily spend cap. No key means
  offline mode, never an exception.
- `runtime.js` — `Workspace`: Chief + guardrails + approvals queue +
  counters, persisted to `.data/workspaces/<ws>/state.json`. A brief
  flows Chief.plan() -> specialist work -> GuardrailEngine.decide() ->
  run / queue / refuse. `approve(id)` is the only path that executes a
  queued action; execution goes through the DeliveryService.
  `workspaceId` lets installed workspaces run a pack under their own
  name with fully separate state.
- `pack-installer.js` (v0.4) — `listPacks / validatePack / installPack /
  listInstalled`. Validation refuses packs that try to class a
  Never-Auto action as auto/approve. Install snapshots the pack into
  `.data/workspaces/<name>/pack/`, substitutes BRIEF {{VARS}}, seeds
  routines/watches, creates per-bot memory files, and writes a
  manifest with the pack's content hash. CLI: `scripts/install-pack.js`.
