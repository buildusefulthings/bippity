# packages/channels

Where humans talk to the team.

- **Web (v0.2):** the live UI in `apps/web/live.html`.
- **Channel ingress (v0.2):** `POST /api/channel/<name>` on the server
  accepts Slack/Telegram/Discord-style webhooks `{ user, text, ws }`.
  When `BIPPITY_OWNER` is set, only that user can assign work — anyone
  else gets a take-a-message reply. Verified live.
- **Routines (`routines.js`, working):** `{ name, at: "07:00", days, brief }`
  entries in `.data/workspaces/<ws>/routines.json`, checked every
  minute. A fired routine is just a brief — same Chief, same guardrails,
  same approvals inbox. Nothing a routine does bypasses a human tap.
- **Watches (`watches.js`, v0.4, working):** `{ name, type: file|http,
  target, brief, intervalMin, contains? }` in
  `.data/workspaces/<ws>/watches.json` (packs seed examples). File
  watches fire on new folder files / content-hash change; HTTP watches
  on body change or a newly-present `contains` string. First tick sets
  a silent baseline; state persists in `watches-state.json`. A fired
  watch is just a brief — same Chief plan check (a pay-asking watch
  brief is refused, tested), same guardrails, same approvals inbox.
  The UI has a "Check watches now" button; the runner also ticks
  every minute.
