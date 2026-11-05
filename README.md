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

**v0.4 — pack installer + watches.** Working: everything in v0.3, plus the pack installer (validate -> install a pack as a named workspace in one step, CLI or UI/API; validation is a security gate — a pack that tries to class a Never-Auto action as auto/approve is refused) and watches (file + HTTP monitors whose changes fire briefs through the same Chief/guardrail/approvals path; state persists so restarts don't refire; a watch brief asking to pay gets refused like any other). Two schools can run the same pack as separate workspaces with fully separate state. Still pending: real-host Proxmox pass (needs a Proxmox box + template) and the hosted tier — see `docs/ARCHITECTURE.md`.
