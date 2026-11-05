# hosted — the R2 hosted tier (v0.6)

- `tenants.js` — tenant registry (tenants.json): plan caps (free/pro/max),
  relay token + instance secret per tenant, rotation, masked listing.
- `vault.js` — per-tenant secrets encrypted at rest (AES-256-GCM,
  BIPPITY_VAULT_KEY). The relay never sees these; instances decrypt
  their own entry. Wrong key = loud failure, never garbage.
- `metering.js` — count-only usage events (JSONL), monthly summaries,
  plan-limit checks. No message bodies, ever.
- `provision.js` — one-call provisioning: validate + install the pack as
  the tenant's workspace, vault the secrets, issue webhook URLs,
  optional Proxmox clone plan per bot (dry-run descriptor).

Surfaces: `scripts/provision-tenant.js` (CLI), `/api/hosted/*` on the
server (HOSTED_ADMIN_TOKEN-gated), and the relay's hosted mode
(TENANTS_FILE + USAGE_FILE). Design: docs/HOSTED_RELAY.md.

## R3 (v0.7)
- `billing.js` — Stripe REST client + webhook verification + plan sync
  (checkout/portal sessions; price ids from env; past_due keeps relay
  access, deletion drops to free and cuts it).
- `reporter.js` — count-only usage batches from instance to operator,
  authenticated per-tenant by instanceSecret, sanitize-gated.
- Metering loop is closed: relay appends forwarded briefs to the usage
  file; the instance meters direct briefs/approvals/deliveries; caps
  are enforced at the relay with a friendly 402.

## Public signup (v0.8)
- `apps/web/signup.html` — landing + pricing + signup form + status
  check, served at `/signup` (and `/welcome` for post-checkout landings).
- `POST /api/public/signup` — no admin token; guarded instead by a
  per-IP rate limit (SIGNUP_RATE_PER_HOUR, default 5), a honeypot field
  (bots get a fake success, nothing is created), and email validation.
  Free activates instantly; paid plans stay pending until the Stripe
  subscription lands. The response carries webhook URLs + relay token
  (the customer needs them) and NEVER the instanceSecret.
- `GET /api/public/status?tenant=&token=` — plan/status/usage for the
  customer, token-gated.
