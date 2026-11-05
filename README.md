# bippity

**Business ops, run by a team of bots you define.**

bippity is an open-ended harness for AI bot teams: a Chief that coordinates, and specialist bots — each defined by a folder (`persona.md` + `tools.yaml` + `guardrails.yaml`) — with their own memory, inbox, tools, and a sandboxed computer. Chat with the team, watch what they do, approve what matters.

> Clean-room project. bippity is inspired by the team-of-bots pattern, built entirely from original code. No code from any other harness is included. See `NOTICE.md`.

## Why another harness?

- **Model-pluggable.** Every bot picks its model — OpenAI, Claude, Grok, or a local model via Ollama. No single-provider lock.
- **Guardrails in code, not prompts.** Every action is classed **Auto / Approve / Never Auto**. Payments, contracts, and customer commitments are Never Auto and cannot be promoted — the runtime refuses, it doesn't just ask the model to behave.
- **Cheap computers.** Bots run in Docker sandboxes locally, or on a Proxmox VM on hardware you already own. A cloud computer is an option, not a requirement.
- **Vertical packs are the product.** A bot team for one trade, pre-built — messages, workflows, guardrails — installs in minutes. Two synthetic packs ship as examples: `bots/examples/enrollment` (microschool) and `bots/examples/ops` (job shop).

## Quick start

**Live runtime (v0.4)** — zero dependencies, Node 18+:

```
npm start          # http://127.0.0.1:3211 — live UI
npm test           # 24 tests: routing, approvals, refusals, memory, routines,
                   # real SMTP/webhook delivery, Proxmox vs mock API,
                   # pack validation/install, file + HTTP watches
npm run install-pack -- install enrollment riverside --set SCHOOL_NAME="Riverside Microschool"
                   # ...or install from the UI's "Install a pack" panel
```

Brief Chief in your own words. Specialists draft, every outbound action queues in the Approvals inbox, and state persists under `.data/`. With no model keys, bots run in deterministic **offline mode** (canned pack work, real guardrails) — copy `.env.example` to `.env.local` and add a key to make any bot live; each bot picks its own provider.

**Delivery (v0.3):** shadow mode is on by default — approved actions are logged, not sent. Set `BIPPITY_SHADOW_MODE=0` plus a transport and approvals deliver for real: webhook (any action), SMTP, AgentMail, or Composio Gmail for email, Twilio for SMS. The delivery result (`delivered` / `failed` / `skipped_*` with the reason) is stored on the approval — bippity never reports a send it didn't make.

**Computers (v0.3):** docker, local sandbox, or the **Proxmox driver** — bot VMs cloned from a template on your own Proxmox host (e.g. a ThinkPad server), commands via the QEMU guest agent, noVNC console URL per bot. Set `BIPPITY_COMPUTER_DRIVER=proxmox` + the `PROXMOX_*` vars.

**v0.1 simulation** (no server): open `apps/web/index.html`, or visit `/sim` while the server runs.

## How it works

```
You (web chat / Slack / Telegram / SMS)
  -> Chief — brief, plan, delegate, report, ask for approvals
      -> Specialist bots (persona + memory + tool grants + guardrail tier)
          -> Sandbox computer | Browser | Files
          -> Connectors (email, calendar, CRM, sheets via Composio / MCP)
          -> Inbox (AgentMail) / Phone (AgentPhone / Twilio)
      <- results, artifacts, approval requests
  <- Chief summary in your channel
```

State lives on your machine (`.data/` — workspaces, per-bot memory files, approval queue, activity log). Hosted mode, when it exists, changes where state lives, not how bots work.

## Repo layout

```
apps/web/          Web chat + dashboard + approvals inbox (v0.1: single-file prototype)
packages/chief/    Coordinator loop: delegation, threads, reporting
packages/harness/  Bot runtime: persona loader, tool router, guardrail engine
packages/memory/   Per-bot / per-workspace memory store
packages/computers/ Sandbox drivers: docker (v1), proxmox, cloud (optional)
packages/connectors/ Composio + MCP adapters, vault grants
packages/channels/ Slack / Telegram / Discord / SMS adapters
bots/_template/    Make a bot: persona.md, tools.yaml, guardrails.yaml
bots/examples/     Synthetic demo packs (enrollment, ops)
docs/              SELF_HOST.md, GUARDRAILS.md, ARCHITECTURE.md
```

## Plans (hosted, later)

Self-hosting is free forever — you pay your model/computer providers directly.
A hosted tier, if/when it ships, follows the shape the category proved: free self-host, a modest Pro for always-on computers + hosted keys/webhooks + bot email/phone, and a Max for multiple computers. The code does not phone home and has no feature tier.

## License

Functional Source License 1.1 (FSL-1.1-ALv2) — see `LICENSE`.
In plain terms: use, self-host, modify, and share bippity for free, at work or at home. You may not offer it as a competing hosted product or service. Each release converts to Apache 2.0 two years after it ships. Vertical packs under `bots/examples/` are MIT — copy them freely.

## Status

**v0.14 — Skills + a microschool front door.** Skills are one SKILL.md per kind of job, with a draft/published gate: bots only follow published skills, matched by triggers in a brief and noted in Knowledge — and packs ship seed skills (Penny's invoice match check, Ivy's inquiry first response). At `/school`, a landing page walks a microschool founder through the eight enrollment steps — Inquiry → Tour → Application → Shadow Day → Accepted → Deposit → Enrolled → Re-enrollment — naming the bot that works each step and the one thing the founder does. Earlier releases:

**v0.4 — pack installer + watches.** Working: everything in v0.3, plus the pack installer (validate -> install a pack as a named workspace in one step, CLI or UI/API; validation is a security gate — a pack that tries to class a Never-Auto action as auto/approve is refused) and watches (file + HTTP monitors whose changes fire briefs through the same Chief/guardrail/approvals path; state persists so restarts don't refire; a watch brief asking to pay gets refused like any other). Two schools can run the same pack as separate workspaces with fully separate state. Still pending: real-host Proxmox pass (needs a Proxmox box + template) — see `docs/ARCHITECTURE.md`.

**v0.5 — native Slack/Telegram bots + hosted relay.** Brief the team and approve sends from chat: native Slack and Telegram bots with signature-verified (Slack) / secret-gated (Telegram) ingress, owner gating, and Approve/Hold buttons in the chat itself — buttons call the same `approve()` path as the web UI, so shadow mode and delivery rules apply unchanged. A zero-dependency relay (`apps/relay`, token-in-path) forwards platform webhooks to a home instance with no public port; `docs/HOSTED_RELAY.md` lays out the hosted tier on top (tenant instances, key vault, metering, plans).

**v0.6 — hosted relay R2.** The hosted tier is real code now: a tenant registry with plans (Free/Pro $20/Max $200 sketches) and rotatable tokens, an AES-256-GCM key vault for tenant secrets, count-only usage metering with plan caps enforced at the relay, and one-call tenant provisioning (validate pack → install workspace → vault secrets → webhook URLs) via CLI or an admin API. The relay runs in hosted mode, routing each tenant's webhooks to their instance with per-tenant rate limits. Still designed-only: Stripe billing + signup (R3) and multi-host orchestration.

**v0.7 — R3: metering completion + Stripe billing.** The money loop is closed: the relay meters what it forwards, instances meter approvals/deliveries and can batch-report usage (per-tenant secret auth), and Stripe drives the plans — checkout + portal sessions, signature-verified webhooks, plan sync (upgrade on subscription, past_due keeps access through dunning, cancellation drops to free and cuts the relay). A signup endpoint provisions a workspace and returns a checkout URL in one call. Still ahead: a public signup site, real Stripe keys, and multi-host orchestration.

**v0.12 — Knowledge, Settings, Routines.** The live console learned three things: a Knowledge section (ten types — issues, skills, people, tasks, events, promises, companies, projects, decisions, preferences — that bots stock themselves as they work), a full Apple-style Settings section whose org chart renders You → Chief → specialists with the ask-policy toggle, and a Routines section where one plain sentence ("Every Friday at 5 PM, send me what we did this week", "Watch https://…") becomes a schedule or a watch that still routes through approvals. Before that, **v0.8 — public signup site.** The hosted tier has a front door: a landing + pricing + signup page at `/signup` that creates a real workspace through the public API — free plans live instantly, paid plans pending until Stripe confirms — with the anti-abuse basics done right (per-IP rate limit, honeypot that silently swallows bots, email validation, and a hard rule that the public response never contains the instance secret). Customers can check plan and usage with their tenant token. What remains is deployment and keys: a public host for the site + relay, and a real Stripe account.
