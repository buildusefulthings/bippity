# Hosted relay — design

**Status:** R1 + R2 built (v0.6); R3 built (v0.7) — metering completion, Stripe billing, signup endpoint. Remaining: a real Stripe account's keys/prices, a public deployment of the site+relay, and multi-host orchestration. The public signup site itself shipped in v0.8 (`apps/web/signup.html` at `/signup`, backed by `/api/public/signup` + `/api/public/status`).
**Why:** the bippity code is free and self-hosted, but three things are genuinely hard to self-host: (1) a public HTTPS endpoint for Slack/Telegram webhooks, (2) always-on machines for the bots' computers, (3) API keys with sane spend limits. Bops' lesson: the code is the lead magnet; the cloud around it is the business. The relay is where bippity's paid tier lives — without ever forking the free core.

## Principles
- **Self-host stays whole.** Everything in the open repo works without the relay: Slack/Telegram webhooks can point straight at a self-hosted instance that has any public URL (tunnel, VPS, home server with port forwarding). The relay is convenience + uptime, never a gate.
- **Verify end-to-end.** The relay is a dumb pipe on purpose: Slack signatures and Telegram secrets are checked by the *instance*, not the relay, so a compromised relay can't forge briefs — it can only drop them. The relay-to-instance leg has its own shared secret.
- **Never Auto survives hosting.** Approvals still release only from a human (web UI, Slack button, Telegram button). Hosting changes transport, never guardrails.

## R1 — Forwarding relay (built)
- Operator runs `apps/relay/relay.js` anywhere public (Fly/Render/$5 VPS) with `RELAY_SECRET` + `BIPPITY_TARGET_URL` pointing at their instance (itself reached via Tailscale, a tunnel, or a private network — the target never needs a public port).
- Webhook URLs given to Slack/Telegram: `https://<relay>/hook/<channel>/<workspace>/<RELAY_SECRET>`. The token is in the path because platforms won't send custom headers.
- Relay forwards the raw body + platform verification headers to `<target>/api/relay/<channel>` with `x-bippity-relay-secret`. Instance re-checks the secret, verifies the platform signature, dispatches.
- 1 MB body cap, `/health` endpoint, no storage, no logging of bodies.

## R2 — Hosted instances (built in v0.6, except multi-host orchestration)
- One tenant = one bippity workspace (pack install), run as an isolated container/VM per tenant on Proxmox-style hosts (the v0.3 driver is the seed: clone-per-bot becomes clone-per-tenant).
- Tenant registry: tenant id, pack + vars, workspace data dir, bot tokens (Slack/Telegram) stored encrypted at rest, per-tenant relay token.
  *Built:* `packages/hosted/tenants.js` (registry + plan caps + token rotation), `packages/hosted/vault.js` (AES-256-GCM per-tenant secrets), `packages/hosted/provision.js` + `scripts/provision-tenant.js` + admin API (`/api/hosted/*`, HOSTED_ADMIN_TOKEN-gated) — provision = validate pack → install workspace → vault secrets → webhook URLs. The relay runs hosted mode from the same tenants.json (`TENANTS_FILE`), resolving token → tenant → target, per-tenant rate limit, plan brief cap with a friendly 402.
- Ingress: the R1 relay generalizes to `https://hooks.bippity.host/<tenant>/<channel>`; a tenant table maps token → instance route. Signature verification still happens in the tenant's instance.
- Key vault: tenants either bring their own model keys or use house keys issued per-tenant with the model-router's daily cap enforced per bot (v0.2 already caps at $25/day/workspace; the vault adds per-tenant budgets + kill switches).
- Data: tenant data stays in the tenant instance's `.data/` — state, memory files, approvals. The relay keeps NO message bodies; metering (below) keeps counts and token sizes only.

## R3 — Metering, plans, billing (built in v0.7)
- Usage events (instance → relay, signed, batched): briefs count, approvals count, model tokens by provider, deliveries by transport, sandbox minutes. No content.
  *Built:* `packages/hosted/metering.js` — count-only JSONL events + monthly summaries + `briefAllowed()`; the instance meters relayed briefs per tenant, and the relay enforces the cap at ingress when `USAGE_FILE` is set.
- Plans (sketch, mirroring the category): **Free** = self-host, everything in the repo. **Pro $20/mo** = hosted relay + 1 hosted workspace + BYO model keys. **Max $200/mo** = hosted computers (per-bot sandboxes always on), house model keys with a monthly credit, multiple workspaces.
- Billing: Stripe subscriptions; the relay enforces plan limits (workspaces, monthly briefs) at ingress with friendly 402-style responses in-channel ("this workspace is over its Pro plan brief limit — upgrade or wait for reset"), never silent drops.
  *Built:* `packages/hosted/billing.js` — thin Stripe REST client (checkout + portal sessions, form-encoded), webhook signature verification (HMAC, 5-min tolerance), and event handlers syncing tenant plans (checkout completed → linked/active; subscription updated → plan follows price; payment failed → past_due, relay keeps serving through dunning; deleted → free + relay off). Server: `/api/stripe/webhook`, `/api/hosted/billing[/checkout|/portal]`, `/api/hosted/signup` (provision on free, pending until the subscription lands, checkout URL returned). Metering completed: the relay appends forwarded briefs to the shared usage file, instances meter direct briefs/approvals/deliveries per workspace, and instances can batch-report usage to `/api/hosted/usage/report` authenticated by their instanceSecret (`packages/hosted/reporter.js`, sanitize-gated).

## Threat model (short)
- Relay compromise → attacker can drop/delay webhooks, cannot forge (no signing secrets at the relay; model keys never pass through it).
- Stolen relay token → rotate `RELAY_SECRET` on both ends; old webhook URLs die. Per-tenant tokens in R2 limit blast radius to one tenant.
- Malicious brief text → same posture as direct channels: owner-gated ingress, prompt content is data to Chief, guardrails in code decide what executes, money actions are Never Auto regardless of who asks.
- Instance compromise → tenant-scoped in R2 (container isolation, per-tenant keys, caps).

## Build order from here
1. R1 hardening: rate limit per token, structured health/metrics. (small)
2. R2 tenant registry + token routing in the relay. (medium)
3. R2 instance provisioning from the Proxmox driver + pack installer. (medium — both pieces exist)
4. R3 metering events + plan checks. (medium)
5. Stripe + signup site. (separate project; the ai-ready-style email-first pattern applies)
