# packages/connectors

External apps + the one module allowed to transmit: delivery.

- `adapters.js` — status adapters (Composio, AgentMail, AgentPhone).
  No key => `configured: false` with the exact env var to set.
- `smtp.js` — a minimal dependency-free SMTP client (plain + AUTH LOGIN
  + implicit TLS; no STARTTLS — use implicit TLS, a local relay, or
  AgentMail/Composio in that case). Verified against a capture server.
- `delivery.js` — **the delivery layer (v0.3).** Called only from
  `Workspace.approve()`, i.e. only after a human tap:
  shadow ON -> `shadow_logged` (nothing transmitted);
  shadow OFF -> webhook first if configured, else SMTP / AgentMail /
  Composio-Gmail for email, Twilio for SMS. Missing recipient or
  transport returns `skipped_no_recipient` / `skipped_no_transport` —
  a send is never reported that didn't happen. The result is stored on
  the approval and shown in the UI.
- Grants stay per-bot in `tools.yaml`; credentials live in `.env.local`,
  are shown only as configured/not, and never reach a model.
