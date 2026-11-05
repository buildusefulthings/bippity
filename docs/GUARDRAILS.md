# Guardrails — Auto / Approve / Never Auto

| Tier | Meaning | Examples |
|---|---|---|
| **Auto** | Runs without asking | Read inbox/calendar, lookups, internal drafts, update internal records, log activity |
| **Approve** | Queued; a human taps before it runs | Send a message/email, book an appointment, create an external record, offer a waitlist spot |
| **Never Auto** | Refused by the runtime, always | Pay, sign a contract, commit price/terms/dates, promise a seat, change tuition, delete data, share credentials |

Rules:
1. Never classes are frozen in `packages/harness/guardrails.js`
   (`NEVER_CLASSES`). No bot file, workspace setting, or flag promotes them.
2. Unknown actions default to **Approve**, never to Auto.
3. Shadow mode (default for a new workspace): Approve-tier actions log
   what they *would* have done for the first two weeks, so the human can
   audit drafts before anything sends.
4. Every decision is logged (bot, action, tier, timestamp). The
   Approvals inbox and the daily report both read that log.
5. A bot asking nicely is not an approval. Only a human tap in the
   Approvals inbox (or an explicit chat confirmation routed there)
   releases an Approve-tier action.
