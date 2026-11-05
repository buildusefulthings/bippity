# Architecture & build order

## Shape
Web app (chat + dashboard + approvals) -> Chief -> specialist bots ->
guardrail engine -> tools (sandbox computer, connectors, channels).
Memory is per-bot files under `.data/` by default; a hosted memory
service is an optional adapter. Computers are drivers: docker first,
Proxmox second, cloud third — a bot doesn't know which one it got.

## Build order
- **v0.1 (this repo):** repo scaffold, guardrail engine, bot template,
  two synthetic packs, self-contained browser prototype of the full
  loop (brief -> delegate -> approve -> report).
- **v0.2 (done):** live runtime — persona loader, model router (OpenAI/
  Claude/Grok/Ollama, spend cap, offline fallback), docker + local
  sandbox drivers, zero-dep server + API + live web UI with free-text
  briefs, persisted approvals, file memory, routines, owner-gated
  channel ingress, connector adapters (Composio/AgentMail/AgentPhone)
  that report `not_configured` until workspace keys exist. Real sends
  through those connectors land in v0.3 behind the same approvals path.
- **v0.3 (done):** real connector sends — DeliveryService behind
  approve() (webhook, SMTP, AgentMail, Composio Gmail, Twilio SMS),
  shadow mode still the default; Proxmox driver (template clone per
  bot, guest-agent exec/files, noVNC console URL) with local/docker
  fallback and a stated reason when unconfigured. Verified: 7 v0.3
  tests (SMTP capture server, webhook E2E, mock PVE API) + live server
  run delivering Penny's approval to a real HTTP receiver.
  Caveat: Proxmox wire format is implemented to the documented API and
  mock-verified; a real-host pass waits on a real Proxmox install.
- **v0.4 (done):** pack installer (validate/install/list, CLI +
  UI/API; BRIEF {{VAR}} substitution, manifest with pack hash, seeded
  routines/watches/messages, per-workspace state isolation) and
  watches (file + HTTP, persisted baselines, fired as briefs through
  the approvals path). Verified: 8 v0.4 tests incl. guardrail-abuse
  pack refusal and watch-refusal, plus a live API install + watch
  fire (inbox file -> Ivy queued).
- **v0.5:** real-host Proxmox pass (needs a Proxmox install + guest-
  agent template), AgentPhone as an alternative SMS transport,
  Slack/Telegram native bots on the channel ingress, hosted relay
  design (the paid tier) if installs justify it.
- **v1.0 (only if v0.2 lands paying installs):** hosted relay
  (webhooks, spend-capped keys, usage metering) as the paid tier,
  native wrapper, signed releases, multi-workspace.

## Explicit non-goals for v1
Chasing a connector count, multi-screen VMs, voice calls, a template
marketplace. The wedge is vertical depth + guardrails + model choice,
not breadth.


v0.6 implementation status (2026-11-04) — hosted R2 built: packages/hosted (tenants, vault, metering, provision) + relay hosted mode. See docs/HOSTED_RELAY.md.
