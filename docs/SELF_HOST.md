# Self-hosting bippity

1. Clone the repo. Requires Node 18+. No dependencies to install.
2. Optional: `cp .env.example .env.local` and fill in **one** model key
   (OpenAI, Anthropic, xAI, or a local Ollama host). Without keys the
   runtime still works in offline mode. Add Composio / AgentMail /
   AgentPhone keys only when you wire those connectors — every
   workspace's bot accounts are its own. Set `BIPPITY_OWNER` to your
   channel username so only you can assign work via Slack/Telegram/SMS.
3. `npm start` — live UI at http://127.0.0.1:3211 (`BIPPITY_PORT` to
   change). `npm test` runs the runtime test suite.
4. State is created under `.data/` on your machine: per-workspace
   `state.json` (approvals, counters, log), `memory/<bot>.md` files,
   and `routines.json` if you add scheduled briefs
   (`[{ "name": "morning", "at": "07:00", "days": [1,2,3,4,5], "brief": "..." }]`).
5. Keep `BIPPITY_SHADOW_MODE=1` for the first two weeks of any new
   workspace: bots draft everything, humans send, the log shows what
   would have gone out.
6. Optional always-on: run it on a spare machine / Proxmox VM and reach
   it over Tailscale. Nothing in bippity requires a public URL except
   SMS/phone webhooks (use the channel relay for those).
