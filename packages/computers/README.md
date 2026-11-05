# packages/computers

Sandbox drivers behind one interface:
`start(bot) / exec(bot, cmd) / writeFile / readFile / stop(bot)`.

- **local** (`sandbox.js`, v0.2) — per-bot directory under
  `.data/sandboxes/`; a workspace sandbox, not an OS security boundary.
- **docker** (`sandbox.js`, v0.2) — one container per bot when Docker
  is present (detected at runtime, never assumed).
- **proxmox** (`proxmox.js`, v0.3) — per-bot VM cloned from a template
  on your Proxmox VE host. Commands and files go through the QEMU guest
  agent, so the template must have `qemu-guest-agent` installed and
  running. `consoleUrl(bot)` returns the noVNC console link — reach the
  host over Tailscale/LAN only, never expose 8006 publicly.
  VMIDs are stable per bot (`PROXMOX_VMID_BASE` + hash). Verified
  against a mock PVE API in `tests/v03.test.js`; real-host pass is
  v0.4 (needs an actual Proxmox install + template).
- Selection: `createSandbox({ preferred })` from
  `BIPPITY_COMPUTER_DRIVER` (`docker` | `local` | `proxmox`). An
  unconfigured preference falls back to local **with `fallbackReason`
  set** — the API surfaces it instead of silently downgrading.
