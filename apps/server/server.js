/**
 * bippity server — zero-dependency Node http server.
 *   node apps/server/server.js        (or: npm start)
 * Serves the live UI at / , the v0.1 simulation at /sim, and the API:
 *   GET  /api/status?ws=enrollment|ops
 *   POST /api/brief    { ws, text }          -> Chief plans + delegates
 *   POST /api/approve  { ws, id }            -> human releases an approval
 *   POST /api/hold     { ws, id }
 *   GET  /api/memory?ws=&bot=
 *   GET  /api/connectors
 *   POST /api/channel/:name { user, text }   -> channel ingress (owner-only work)
 * State persists under .data/. Shadow mode default: approved actions are
 * logged as sent, not transmitted through a real channel.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

// --- tiny .env.local loader (no deps) ---
const envFile = path.join(ROOT, '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const { loadPack } = require(path.join(ROOT, 'packages/harness/persona-loader'));
const { Workspace } = require(path.join(ROOT, 'packages/harness/runtime'));
const { connectorStatus } = require(path.join(ROOT, 'packages/connectors/adapters'));
const { DeliveryService } = require(path.join(ROOT, 'packages/connectors/delivery'));
const { createSandbox } = require(path.join(ROOT, 'packages/computers/sandbox'));
const { ProxmoxDriver } = require(path.join(ROOT, 'packages/computers/proxmox'));
const { RoutineRunner } = require(path.join(ROOT, 'packages/channels/routines'));
const { WatchRunner } = require(path.join(ROOT, 'packages/channels/watches'));
const { listPacks, installPack, listInstalled } = require(path.join(ROOT, 'packages/harness/pack-installer'));
const { TenantRegistry } = require(path.join(ROOT, 'packages/hosted/tenants'));
const { KeyVault } = require(path.join(ROOT, 'packages/hosted/vault'));
const { UsageMeter } = require(path.join(ROOT, 'packages/hosted/metering'));
const { provisionTenant } = require(path.join(ROOT, 'packages/hosted/provision'));
const { BillingService, verifyStripeSignature } = require(path.join(ROOT, 'packages/hosted/billing'));
const { verifyReport, sanitizeEvents } = require(path.join(ROOT, 'packages/hosted/reporter'));
const slackMod = require(path.join(ROOT, 'packages/channels/slack'));
const tgMod = require(path.join(ROOT, 'packages/channels/telegram'));
const { ChannelDispatcher } = require(path.join(ROOT, 'packages/channels/dispatcher'));
const slackBot = new slackMod.SlackBot(process.env);
const telegramBot = new tgMod.TelegramBot(process.env);
const delivery = new DeliveryService(process.env);
const proxmox = new ProxmoxDriver(process.env, { pollMs: 800 });

const { parseRoutineText, describeSchedule } = require(path.join(ROOT, 'packages/channels/routine-parse'));
const routineRunners = {};
const DATA = path.join(ROOT, '.data');
const hostedRegistry = new TenantRegistry(DATA);
const hostedVault = new KeyVault(DATA);
const hostedMeter = new UsageMeter(DATA);
const billing = new BillingService(process.env, globalThis.fetch, hostedRegistry);
function meterWorkspace(wsId, kind, n = 1) { const t = hostedRegistry.byWorkspace(wsId); if (t) hostedMeter.record(t.id, kind, n); }
const PACKS_ROOT = path.join(ROOT, 'bots/examples');
const workspaces = {};
const watchRunners = {};
function readJsonArray(file) { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(j) ? j : []; } catch { return []; } }
function registerWorkspace(id, ws, seedDir) {
  workspaces[id] = ws;
  const wsDir = path.join(DATA, 'workspaces', id);
  const routines = readJsonArray(path.join(wsDir, 'routines.json')).length ? readJsonArray(path.join(wsDir, 'routines.json')) : (seedDir ? readJsonArray(path.join(seedDir, 'routines.json')) : []);
  // Seed the workspace's skills from the pack (first registration only)
  const packSkillsDir = seedDir ? path.join(seedDir, 'skills') : null;
  if (packSkillsDir && fs.existsSync(packSkillsDir)) ws.skills.seed(id, fs.readdirSync(packSkillsDir).filter((f) => f.endsWith('.md')).map((f) => ({ slug: f.replace(/\.md$/, ''), raw: fs.readFileSync(path.join(packSkillsDir, f), 'utf8') })));
  if (routines.length) routineRunners[id] = new RoutineRunner(ws, routines).start();
  const watches = readJsonArray(path.join(wsDir, 'watches.json')).length ? readJsonArray(path.join(wsDir, 'watches.json')) : (seedDir ? readJsonArray(path.join(seedDir, 'watches.json')) : []);
  if (watches.length) { watchRunners[id] = new WatchRunner(ws, watches, { dataRoot: DATA }).start(); }
  return ws;
}
for (const p of ['enrollment', 'ops']) {
  registerWorkspace(p, new Workspace({ pack: loadPack(path.join(PACKS_ROOT, p)), dataRoot: DATA }), path.join(PACKS_ROOT, p));
}
for (const m of listInstalled(DATA)) {
  if (workspaces[m.workspace]) continue;
  const packDir = path.join(DATA, 'workspaces', m.workspace, 'pack');
  if (fs.existsSync(path.join(packDir, 'pack.yaml'))) registerWorkspace(m.workspace, new Workspace({ pack: loadPack(packDir), dataRoot: DATA, workspaceId: m.workspace }), packDir);
}

function send(res, code, body, type = 'application/json') {
  const data = type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(code, { 'content-type': type + '; charset=utf-8' }); res.end(data);
}
function body(req) { return new Promise((res) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => { try { res(JSON.parse(b || '{}')); } catch { res({}); } }); }); }
function rawBody(req) { return new Promise((res) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => res(Buffer.concat(chunks).toString('utf8'))); }); }
const dispatcher = new ChannelDispatcher({ workspaces, defaultWorkspace: process.env.BIPPITY_CHANNEL_WORKSPACE || 'enrollment' });

async function handleSlackPayload(raw, res, wsHint = null) {
  let payload; try { payload = JSON.parse(raw || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
  const ev = slackMod.parseEvent(payload);
  if (!ev) return send(res, 200, { ok: true });
  if (ev.kind === 'challenge') return send(res, 200, { challenge: ev.challenge });
  if (ev.kind === 'brief' && ev.text) {
    const r = await dispatcher.brief({ text: ev.text, user: ev.user, ownerId: slackBot.owner, channel: 'slack', workspace: wsHint });
    if (r.type === 'queued') await slackBot.sendMessage({ channel: ev.channel, text: r.text, blocks: slackMod.approvalBlocks(r, r.wsId), threadTs: ev.threadTs });
    else await slackBot.sendMessage({ channel: ev.channel, text: r.text, threadTs: ev.threadTs });
    return send(res, 200, { ok: true, result: r.type });
  }
  return send(res, 200, { ok: true });
}
async function handleTelegramUpdate(update, res, wsHint = null) {
  const ev = tgMod.parseUpdate(update);
  if (!ev || ev.kind === 'ignore') return send(res, 200, { ok: true });
  if (ev.kind === 'brief') {
    const r = await dispatcher.brief({ text: ev.text, user: ev.user, ownerId: telegramBot.owner, channel: 'telegram', workspace: wsHint });
    await telegramBot.sendMessage({ chatId: ev.chatId, text: r.text, replyMarkup: r.type === 'queued' ? tgMod.approvalKeyboard(r, r.wsId) : undefined });
    return send(res, 200, { ok: true, result: r.type });
  }
  if (ev.kind === 'callback') {
    const r = await dispatcher.act({ action: ev.action, wsId: ev.ws, id: ev.id, user: ev.user, ownerId: telegramBot.owner });
    await telegramBot.answerCallback(ev.callbackId, r.text);
    await telegramBot.sendMessage({ chatId: ev.chatId, text: r.text });
    return send(res, 200, { ok: true });
  }
  return send(res, 200, { ok: true });
}
const wsOf = (q) => workspaces[q.ws] || workspaces.enrollment;
const signupHits = {}; // ip -> [timestamps] for the public signup rate limit

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const q = Object.fromEntries(u.searchParams);
  try {
    if (u.pathname === '/' || u.pathname === '/live') return send(res, 200, fs.readFileSync(path.join(ROOT, 'apps/web/live.html'), 'utf8'), 'text/html');
    if (u.pathname === '/sim') return send(res, 200, fs.readFileSync(path.join(ROOT, 'apps/web/index.html'), 'utf8'), 'text/html');
    if (u.pathname === '/signup' || u.pathname === '/welcome') return send(res, 200, fs.readFileSync(path.join(ROOT, 'apps/web/signup.html'), 'utf8'), 'text/html');
    if (u.pathname === '/school' || u.pathname === '/microschools') return send(res, 200, fs.readFileSync(path.join(ROOT, 'apps/web/school.html'), 'utf8'), 'text/html');
    if (u.pathname === '/configure' || u.pathname === '/setup') return send(res, 200, fs.readFileSync(path.join(ROOT, 'apps/web/configure.html'), 'utf8'), 'text/html');
    if (u.pathname === '/api/public/signup' && req.method === 'POST') {
      const b = await body(req);
      // Honeypot: real humans never fill the hidden "company_website" field.
      // Bots get a cheerful fake success and nothing is created.
      if (b.company_website) return send(res, 200, { ok: true, note: 'Check your email to finish setting up.' });
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local').split(',')[0].trim();
      const now = Date.now();
      signupHits[ip] = (signupHits[ip] || []).filter((t) => now - t < 3600000);
      const limit = Number(process.env.SIGNUP_RATE_PER_HOUR || 5);
      if (signupHits[ip].length >= limit) return send(res, 429, { error: 'Too many signups from here — try again in a bit.' });
      const email = String(b.email || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(res, 400, { error: 'A valid email is required.' });
      if (!b.name || !b.pack) return send(res, 400, { error: 'Name and pack are required.' });
      signupHits[ip].push(now);
      // Microschool setup wizard (/configure): a structured school profile
      // that becomes the tenant's context — written into the workspace as
      // SCHOOL.md + Knowledge, so the bots genuinely work from it.
      let profile = null;
      if (b.school && typeof b.school === 'object') {
        const S = (v, n) => String(v == null ? '' : v).slice(0, n);
        const L = (v, n) => (Array.isArray(v) ? v.map((x) => S(x, 40)).filter(Boolean).slice(0, n) : []);
        profile = { kind: 'microschool', schoolName: S(b.school.schoolName, 90), city: S(b.school.city, 60), ages: L(b.school.ages, 6), seats: S(b.school.seats, 6), seatsOpen: S(b.school.seatsOpen, 6), tuition: S(b.school.tuition, 40), tourDays: L(b.school.tourDays, 7), tourTimes: S(b.school.tourTimes, 120), approach: L(b.school.approach, 6), about: S(b.school.about, 1200), faqs: S(b.school.faqs, 1200), neverPromise: L(b.school.neverPromise, 8), neverNotes: S(b.school.neverNotes, 400), channels: L(b.school.channels, 6), founderName: S(b.school.founderName, 80) };
        if (!profile.schoolName) profile = null;
      }
      const wantPlan = ['free', 'pro', 'max'].includes(b.plan) ? b.plan : 'free';
      const base = process.env.PUBLIC_BASE_URL || `http://${req.headers.host || '127.0.0.1:' + PORT}`;
      const r = provisionTenant({ registry: hostedRegistry, vault: hostedVault, meter: hostedMeter, dataRoot: DATA, packsRoot: PACKS_ROOT, relayBase: process.env.PUBLIC_RELAY_BASE || base, name: String(b.name).slice(0, 80), email, plan: 'free', pack: String(b.pack), vars: b.vars || {}, workspaceName: b.workspace, targetUrl: b.targetUrl || '', status: wantPlan === 'free' ? 'active' : 'pending', profile });
      if (!r.ok) return send(res, 400, r);
      const packDir = path.join(DATA, 'workspaces', r.tenant.workspace, 'pack');
      if (!workspaces[r.tenant.workspace] && fs.existsSync(path.join(packDir, 'pack.yaml'))) registerWorkspace(r.tenant.workspace, new Workspace({ pack: loadPack(packDir), dataRoot: DATA, workspaceId: r.tenant.workspace }), packDir);
      if (profile && workspaces[r.tenant.workspace]) {
        const wsx = workspaces[r.tenant.workspace];
        const md = ['# ' + profile.schoolName, '', `Location: ${profile.city || '—'} · Ages: ${profile.ages.join(', ') || '—'} · Seats: ${profile.seats || '—'} (${profile.seatsOpen || '—'} open) · Tuition: ${profile.tuition || '—'}`, `Tours: ${profile.tourDays.join(', ') || '—'} — ${profile.tourTimes || '—'}`, `Approach: ${profile.approach.join(', ') || '—'}`, '', '## What makes this school special', profile.about || '—', '', '## Questions families always ask', profile.faqs || '—', '', '## Never promise', (profile.neverPromise.join(', ') || '—') + (profile.neverNotes ? ' — ' + profile.neverNotes : ''), '', `Inquiries arrive via: ${profile.channels.join(', ') || '—'}`].join('\n');
        try { fs.writeFileSync(path.join(DATA, 'workspaces', wsx.id, 'SCHOOL.md'), md); } catch { /* non-fatal */ }
        try {
          wsx.knowledge.add(wsx.id, { type: 'companies', title: profile.schoolName, detail: `${profile.city} · ${profile.seats} seats, ${profile.seatsOpen} open · tuition ${profile.tuition}`, source: 'Setup wizard' });
          if (profile.about) wsx.knowledge.add(wsx.id, { type: 'preferences', title: 'What makes the school special', detail: profile.about.slice(0, 600), source: 'Setup wizard' });
          for (const np of profile.neverPromise) wsx.knowledge.add(wsx.id, { type: 'decisions', title: 'Never promise: ' + np, detail: 'Set by the founder in the setup wizard. Bots must not commit to this; escalate to the founder.', source: 'Setup wizard' });
          wsx.settings.update(wsx.id, { profile: { name: profile.founderName || String(b.name), email } });
        } catch { /* non-fatal */ }
      }
      let checkout = null;
      if (wantPlan !== 'free') { const t = hostedRegistry.byId(r.tenant.id); try { checkout = await billing.createCheckout({ tenant: t, plan: wantPlan, successUrl: base + '/welcome?tenant=' + t.id, cancelUrl: base + '/signup' }); } catch (e) { checkout = { error: e.message }; } }
      const full = hostedRegistry.byId(r.tenant.id);
      // Public response: webhook URLs + relay token (the customer needs
      // them to configure Slack/Telegram) — never the instanceSecret.
      return send(res, 200, { ok: true, tenant: r.tenant, webhooks: r.webhooks, relayToken: full.relayToken, checkout, status: full.status, note: wantPlan === 'free' ? 'Your workspace is live. Paste a webhook URL into Slack or Telegram to start briefing your bots.' : 'Your workspace is reserved. It activates as soon as checkout completes.' });
    }
    if (u.pathname === '/api/public/status') {
      const t = hostedRegistry.byId(q.tenant);
      if (!t || !q.token || q.token !== t.relayToken) return send(res, 401, { error: 'tenant + token required' });
      return send(res, 200, { tenant: t.id, name: t.name, plan: t.plan, status: t.status, workspaces: t.workspaces, usage: hostedMeter.summary(t.id), profile: t.profile || null });
    }
    if (u.pathname === '/api/status') return send(res, 200, wsOf(q).status());
    if (u.pathname === '/api/workspaces') return send(res, 200, { workspaces: Object.values(workspaces).map((w) => ({ id: w.id, pack: w.pack.id, name: w.pack.name, installed: !!listInstalled(DATA).find((m) => m.workspace === w.id) })) });
    if (u.pathname === '/api/packs') return send(res, 200, { available: listPacks(PACKS_ROOT), installed: listInstalled(DATA) });
    if (u.pathname === '/api/packs/install' && req.method === 'POST') { const b = await body(req); const packDir = path.join(PACKS_ROOT, String(b.pack || '')); const r = installPack({ packDir, dataRoot: DATA, workspaceName: b.name, vars: b.vars || {}, force: !!b.force }); if (!r.ok) return send(res, 400, r); registerWorkspace(r.workspace, new Workspace({ pack: loadPack(path.join(DATA, 'workspaces', r.workspace, 'pack')), dataRoot: DATA, workspaceId: r.workspace }), path.join(DATA, 'workspaces', r.workspace, 'pack')); return send(res, 200, { installed: r, status: workspaces[r.workspace].status() }); }
    if (u.pathname === '/api/routines' && req.method === 'GET') { const r = routineRunners[q.ws]; return send(res, 200, { routines: r ? r.routines.map((x) => ({ ...x, describe: describeSchedule(x) })) : [], watches: watchRunners[q.ws] ? watchRunners[q.ws].status() : [] }); }
    if (u.pathname === '/api/routines' && req.method === 'POST') {
      const b = await body(req); const w = wsOf(b);
      const parsed = parseRoutineText(b.text);
      if (!parsed) return send(res, 400, { error: 'I couldn’t read that as a routine. Try “Every weekday at 8:30, summarize my inbox” or “Watch https://… and tell me when it changes”.' });
      const wsDir = path.join(DATA, 'workspaces', w.id);
      if (parsed.kind === 'schedule') {
        const runner = routineRunners[w.id] || (routineRunners[w.id] = new RoutineRunner(w, []).start());
        if (runner.routines.some((x) => x.name === parsed.routine.name)) return send(res, 400, { error: 'A routine with that name already exists here.' });
        runner.routines.push(parsed.routine);
        fs.writeFileSync(path.join(wsDir, 'routines.json'), JSON.stringify(runner.routines, null, 2));
        return send(res, 200, { added: { ...parsed.routine, describe: describeSchedule(parsed.routine) } });
      }
      const wr = watchRunners[w.id] || (watchRunners[w.id] = new WatchRunner(w, [], { dataRoot: DATA }).start());
      wr.watches.push(parsed.watch);
      const wf = path.join(wsDir, 'watches.json');
      fs.writeFileSync(wf, JSON.stringify(wr.watches.map((x) => ({ name: x.name, type: x.type, target: x.target, intervalMin: x.intervalMin, brief: x.brief, contains: x.contains })), null, 2));
      return send(res, 200, { addedWatch: parsed.watch });
    }
    if (u.pathname === '/api/routines/remove' && req.method === 'POST') { const b = await body(req); const w = wsOf(b); const r = routineRunners[w.id]; if (!r) return send(res, 200, { removed: false }); const before = r.routines.length; r.routines = r.routines.filter((x) => x.name !== b.name); fs.writeFileSync(path.join(DATA, 'workspaces', w.id, 'routines.json'), JSON.stringify(r.routines, null, 2)); return send(res, 200, { removed: r.routines.length < before }); }
    if (u.pathname === '/api/watches') return send(res, 200, { watches: watchRunners[q.ws] ? watchRunners[q.ws].status() : [] });
    if (u.pathname === '/api/watches/tick' && req.method === 'POST') { const b = await body(req); const runner = watchRunners[b.ws]; if (!runner) return send(res, 200, { fired: [], note: 'no watches for this workspace' }); return send(res, 200, { fired: await runner.tick(), status: wsOf(b).status() }); }
    if (u.pathname === '/api/connectors') { const sb = await createSandbox({ dataRoot: DATA, preferred: process.env.BIPPITY_COMPUTER_DRIVER || 'docker' }); return send(res, 200, { connectors: connectorStatus(), delivery: delivery.status(), shadow: process.env.BIPPITY_SHADOW_MODE !== '0', sandbox: sb.constructor.name, sandboxFallback: sb.fallbackReason || null }); }
    if (u.pathname === '/api/proxmox') return send(res, 200, await proxmox.overview());
    if (u.pathname === '/api/sandbox/exec' && req.method === 'POST') { const b = await body(req); const sb = await createSandbox({ dataRoot: DATA, preferred: process.env.BIPPITY_COMPUTER_DRIVER || 'docker' }); if (sb.constructor.name === 'ProxmoxDriver') await sb.start(b.bot || 'chief'); return send(res, 200, await sb.exec(b.bot || 'chief', String(b.cmd || 'echo ok'))); }
    if (u.pathname === '/api/channels') return send(res, 200, { channels: [slackBot.status(), telegramBot.status()], relay: { secretSet: !!process.env.RELAY_SECRET, webhookBase: '/api/relay/<slack|telegram> via apps/relay (see docs/HOSTED_RELAY.md)' }, defaultWorkspace: dispatcher.defaultWorkspace });
    if (u.pathname === '/api/slack/events' && req.method === 'POST') {
      const raw = await rawBody(req);
      if (slackBot.signingSecret && !slackMod.verifySignature({ signingSecret: slackBot.signingSecret, timestamp: req.headers['x-slack-request-timestamp'], rawBody: raw, signature: req.headers['x-slack-signature'] })) return send(res, 401, { error: 'bad slack signature' });
      return handleSlackPayload(raw, res);
    }
    if (u.pathname === '/api/slack/commands' && req.method === 'POST') {
      const form = new URLSearchParams(await rawBody(req));
      const text = form.get('text') || '';
      const r = await dispatcher.brief({ text, user: form.get('user_id'), ownerId: slackBot.owner, channel: 'slack' });
      return send(res, 200, { response_type: 'ephemeral', text: r.text, blocks: r.type === 'queued' ? slackMod.approvalBlocks(r, r.wsId) : undefined });
    }
    if (u.pathname === '/api/slack/interactions' && req.method === 'POST') {
      const form = new URLSearchParams(await rawBody(req));
      const ix = slackMod.parseInteraction(form.get('payload'));
      if (!ix || !ix.action) return send(res, 400, { error: 'unknown interaction' });
      const r = await dispatcher.act({ action: ix.action, wsId: ix.ws, id: ix.id, user: ix.user, ownerId: slackBot.owner });
      return send(res, 200, { replace_original: false, text: r.text });
    }
    if (u.pathname === '/api/telegram/webhook' && req.method === 'POST') {
      if (telegramBot.webhookSecret && req.headers['x-telegram-bot-api-secret-token'] !== telegramBot.webhookSecret) return send(res, 401, { error: 'bad telegram secret' });
      return handleTelegramUpdate(await body(req), res);
    }
    const relay = u.pathname.match(/^\/api\/relay\/(slack|telegram)$/);
    if (relay && req.method === 'POST') {
      // Accept either the single-tenant RELAY_SECRET or a hosted tenant's
      // instanceSecret (v0.6): the relay forwards the tenant's secret.
      const given = req.headers['x-bippity-relay-secret'] || '';
      const tenant = req.headers['x-bippity-tenant'] && req.headers['x-bippity-tenant'] !== 'single' ? hostedRegistry.byId(req.headers['x-bippity-tenant']) : null;
      const secretOk = (process.env.RELAY_SECRET && given === process.env.RELAY_SECRET) || (tenant && given === tenant.instanceSecret);
      if (!secretOk) return send(res, 401, { error: 'bad relay secret' });
      // Briefs arriving via the hosted relay are metered BY the relay
      // (it appends to the shared usage file) — not double-counted here.
      const wsHint = req.headers['x-bippity-workspace'] || null;
      const raw = await rawBody(req);
      if (relay[1] === 'slack') {
        if (slackBot.signingSecret && !slackMod.verifySignature({ signingSecret: slackBot.signingSecret, timestamp: req.headers['x-slack-request-timestamp'], rawBody: raw, signature: req.headers['x-slack-signature'] })) return send(res, 401, { error: 'bad slack signature' });
        return handleSlackPayload(raw, res, wsHint);
      }
      if (telegramBot.webhookSecret && req.headers['x-telegram-bot-api-secret-token'] !== telegramBot.webhookSecret) return send(res, 401, { error: 'bad telegram secret' });
      let upd; try { upd = JSON.parse(raw || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
      return handleTelegramUpdate(upd, res, wsHint);
    }
    if (u.pathname.startsWith('/api/hosted/')) {
      // Usage reports authenticate with the tenant's instanceSecret, not the admin token.
      if (u.pathname === '/api/hosted/usage/report' && req.method === 'POST') {
        const b = await body(req);
        const v = verifyReport(hostedRegistry, b.tenant, req.headers['x-bippity-relay-secret']);
        if (!v.ok) return send(res, 401, { error: v.error });
        const clean = sanitizeEvents(b.events);
        for (const e of clean) hostedMeter.record(v.tenant.id, e.kind, e.n);
        return send(res, 200, { ok: true, recorded: clean.length });
      }
      const admin = process.env.HOSTED_ADMIN_TOKEN || '';
      if (!admin || req.headers['x-bippity-admin'] !== admin) return send(res, 401, { error: 'hosted admin token required (HOSTED_ADMIN_TOKEN)' });
      if (u.pathname === '/api/hosted/tenants' && req.method === 'GET') return send(res, 200, { tenants: hostedRegistry.list(), vault: hostedVault.status() });
      if (u.pathname === '/api/hosted/tenants' && req.method === 'POST') {
        const b = await body(req);
        const r = provisionTenant({ registry: hostedRegistry, vault: hostedVault, meter: hostedMeter, dataRoot: DATA, packsRoot: PACKS_ROOT, relayBase: b.relayBase || '', name: b.name, plan: b.plan || 'pro', pack: b.pack, vars: b.vars || {}, workspaceName: b.workspace, targetUrl: b.targetUrl || '', secrets: b.secrets || null, computer: b.computer || null });
        if (!r.ok) return send(res, 400, r);
        const packDir = path.join(DATA, 'workspaces', r.tenant.workspace, 'pack');
        if (!workspaces[r.tenant.workspace] && fs.existsSync(path.join(packDir, 'pack.yaml'))) registerWorkspace(r.tenant.workspace, new Workspace({ pack: loadPack(packDir), dataRoot: DATA, workspaceId: r.tenant.workspace }), packDir);
        const full = hostedRegistry.byId(r.tenant.id);
        return send(res, 200, { ...r, relayToken: full.relayToken, instanceSecret: full.instanceSecret });
      }
      if (u.pathname === '/api/hosted/usage') { const t = hostedRegistry.byId(q.tenant); if (!t) return send(res, 404, { error: 'unknown tenant' }); return send(res, 200, { summary: hostedMeter.summary(t.id), briefAllowed: hostedMeter.briefAllowed(t) }); }
      if (u.pathname === '/api/hosted/rotate' && req.method === 'POST') { const b = await body(req); const t = hostedRegistry.rotate(b.tenant); return t ? send(res, 200, { rotated: t.id, relayToken: t.relayToken, instanceSecret: t.instanceSecret }) : send(res, 404, { error: 'unknown tenant' }); }
      if (u.pathname === '/api/hosted/billing') { const t = hostedRegistry.byId(q.tenant); if (!t) return send(res, 404, { error: 'unknown tenant' }); const { PLANS } = require(path.join(ROOT, 'packages/hosted/tenants')); return send(res, 200, { billing: billing.status(), tenant: { id: t.id, plan: t.plan, status: t.status, billing: t.billing || null }, usage: hostedMeter.summary(t.id), planPriceCents: PLANS[t.plan].priceCents }); }
      if (u.pathname === '/api/hosted/billing/checkout' && req.method === 'POST') { const b = await body(req); const t = hostedRegistry.byId(b.tenant); if (!t) return send(res, 404, { error: 'unknown tenant' }); try { const s = await billing.createCheckout({ tenant: t, plan: b.plan || t.plan, successUrl: b.successUrl || 'https://example.com/billing/success', cancelUrl: b.cancelUrl || 'https://example.com/billing/cancel' }); return send(res, 200, { checkout: s }); } catch (e) { return send(res, 400, { error: e.message }); } }
      if (u.pathname === '/api/hosted/billing/portal' && req.method === 'POST') { const b = await body(req); const t = hostedRegistry.byId(b.tenant); if (!t) return send(res, 404, { error: 'unknown tenant' }); try { return send(res, 200, { portal: await billing.createPortal({ tenant: t, returnUrl: b.returnUrl || 'https://example.com/account' }) }); } catch (e) { return send(res, 400, { error: e.message }); } }
      if (u.pathname === '/api/hosted/signup' && req.method === 'POST') {
        const b = await body(req);
        const wantPlan = b.plan || 'free';
        const r = provisionTenant({ registry: hostedRegistry, vault: hostedVault, meter: hostedMeter, dataRoot: DATA, packsRoot: PACKS_ROOT, relayBase: b.relayBase || '', name: b.name, plan: 'free', pack: b.pack, vars: b.vars || {}, workspaceName: b.workspace, targetUrl: b.targetUrl || '', secrets: b.secrets || null, status: wantPlan === 'free' ? 'active' : 'pending' });
        if (!r.ok) return send(res, 400, r);
        const packDir = path.join(DATA, 'workspaces', r.tenant.workspace, 'pack');
        if (!workspaces[r.tenant.workspace] && fs.existsSync(path.join(packDir, 'pack.yaml'))) registerWorkspace(r.tenant.workspace, new Workspace({ pack: loadPack(packDir), dataRoot: DATA, workspaceId: r.tenant.workspace }), packDir);
        let checkout = null;
        if (wantPlan !== 'free') { const t = hostedRegistry.byId(r.tenant.id); try { checkout = await billing.createCheckout({ tenant: t, plan: wantPlan, successUrl: b.successUrl || 'https://example.com/welcome', cancelUrl: b.cancelUrl || 'https://example.com/pricing' }); } catch (e) { checkout = { error: e.message }; } }
        const full = hostedRegistry.byId(r.tenant.id);
        return send(res, 200, { signup: r, checkout, relayToken: full.relayToken, instanceSecret: full.instanceSecret, note: wantPlan === 'free' ? 'Active immediately.' : 'Workspace activates when the Stripe subscription lands (checkout.session.completed / subscription events).' });
      }
      return send(res, 404, { error: 'unknown hosted route' });
    }
    if (u.pathname === '/api/stripe/webhook' && req.method === 'POST') {
      const raw = await rawBody(req);
      if (billing.webhookSecret && !verifyStripeSignature({ secret: billing.webhookSecret, header: req.headers['stripe-signature'], rawBody: raw })) return send(res, 400, { error: 'bad stripe signature' });
      let event; try { event = JSON.parse(raw || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
      try { return send(res, 200, { received: true, result: billing.handleEvent(event) }); } catch (e) { return send(res, 500, { error: e.message }); }
    }
    if (u.pathname === '/api/skills' && req.method === 'GET') { const w = wsOf(q); return send(res, 200, { skills: w.skills.list(w.id) }); }
    if (u.pathname === '/api/skills' && req.method === 'POST') { const b = await body(req); const w = wsOf(b); try { return send(res, 200, { created: w.skills.create(w.id, b) }); } catch (err) { return send(res, 400, { error: err.message }); } }
    if (u.pathname === '/api/skills/update' && req.method === 'POST') { const b = await body(req); const w = wsOf(b); try { return send(res, 200, { updated: w.skills.update(w.id, b.slug, b) }); } catch (err) { return send(res, 400, { error: err.message }); } }
    if (u.pathname === '/api/skills/status' && req.method === 'POST') { const b = await body(req); const w = wsOf(b); try { return send(res, 200, { updated: w.skills.setStatus(w.id, b.slug, b.status) }); } catch (err) { return send(res, 400, { error: err.message }); } }
    if (u.pathname === '/api/skills/remove' && req.method === 'POST') { const b = await body(req); const w = wsOf(b); return send(res, 200, { removed: w.skills.remove(w.id, b.slug) }); }
    if (u.pathname === '/api/settings' && req.method === 'GET') { const w = wsOf(q); return send(res, 200, { settings: w.settings.get(w.id) }); }
    if (u.pathname === '/api/settings' && req.method === 'POST') { const b = await body(req); const w = wsOf(b); try { return send(res, 200, { settings: w.settings.update(w.id, b) }); } catch (err) { return send(res, 400, { error: err.message }); } }
    if (u.pathname === '/api/knowledge' && req.method === 'GET') { const w = wsOf(q); return send(res, 200, { entries: w.knowledge.list(w.id, q.type || null), counts: w.knowledge.counts(w.id) }); }
    if (u.pathname === '/api/knowledge' && req.method === 'POST') { const b = await body(req); const w = wsOf(b); try { const e = w.knowledge.add(w.id, { type: b.type, title: b.title, detail: b.detail || '', source: b.source || 'You' }); return send(res, 200, { added: e, counts: w.knowledge.counts(w.id) }); } catch (err) { return send(res, 400, { error: err.message }); } }
    if (u.pathname === '/api/knowledge/remove' && req.method === 'POST') { const b = await body(req); const w = wsOf(b); return send(res, 200, { removed: w.knowledge.remove(w.id, b.id), counts: w.knowledge.counts(w.id) }); }
    if (u.pathname === '/api/memory') { const w = wsOf(q); return send(res, 200, { bot: q.bot, memory: w.memory.load(w.id, q.bot || 'chief') }); }
    if (u.pathname === '/api/brief' && req.method === 'POST') { const b = await body(req); if (!b.text) return send(res, 400, { error: 'text required' }); meterWorkspace(wsOf(b).id, 'brief', 1); return send(res, 200, await wsOf(b).brief(String(b.text), 'web')); }
    if (u.pathname === '/api/approve' && req.method === 'POST') { const b = await body(req); const a = await wsOf(b).approve(b.id); if (a) { meterWorkspace(wsOf(b).id, 'approval', 1); if (a.delivery) meterWorkspace(wsOf(b).id, 'delivery', 1); } return a ? send(res, 200, { approved: a, delivery: a.delivery, status: wsOf(b).status() }) : send(res, 404, { error: 'no waiting approval with that id' }); }
    if (u.pathname === '/api/hold' && req.method === 'POST') { const b = await body(req); const a = wsOf(b).hold(b.id); return a ? send(res, 200, { held: a, status: wsOf(b).status() }) : send(res, 404, { error: 'no waiting approval with that id' }); }
    const ch = u.pathname.match(/^\/api\/channel\/(\w+)$/);
    if (ch && req.method === 'POST') {
      const b = await body(req);
      const owner = process.env.BIPPITY_OWNER || '';
      if (owner && b.user !== owner) return send(res, 200, { type: 'message-taken', message: `Thanks — I've taken a message for the workspace owner. Only they can assign work here.` });
      return send(res, 200, await wsOf(b).brief(String(b.text || ''), ch[1]));
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) { return send(res, 500, { error: e.message }); }
});

const PORT = Number(process.env.BIPPITY_PORT || 3211);
if (require.main === module) server.listen(PORT, '127.0.0.1', () => console.log(`bippity live on http://127.0.0.1:${PORT}  (shadow=${process.env.BIPPITY_SHADOW_MODE !== '0'})`));
module.exports = { server, workspaces };
