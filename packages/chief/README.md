# packages/chief

The coordinator (`chief.js`, working). Chief owns the conversation with
the human, not the work:

- **Plan check first:** a brief that itself asks for a Never-Auto act
  (pay/collect a deposit, sign, promise a seat, commit price) is refused
  as a plan, before delegation. The guardrail engine still independently
  refuses at action time — two layers, on purpose.
- **Routing:** keyword match against each specialist's pack keywords;
  morning/status briefs get the team report; anything else gets a
  plain-language steer toward a delegable brief.
- **Approvals routing:** Approve-tier work goes to the workspace
  approvals queue with title + body, never buried inside chat.
- **Reporting:** counters come from workspace state (done / approved /
  refused / waiting / neverExecuted — the last is structurally 0).
