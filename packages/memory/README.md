# packages/memory

Per-bot / per-workspace memory. Default: plain files under `.data/workspaces/<ws>/memory/<bot>.md` loaded at run start, appended by the bot's own log action. Optional adapter: a hosted memory service (BYO key). Memory is scoped — a bot sees its own file plus the workspace brief, never another client's workspace.
