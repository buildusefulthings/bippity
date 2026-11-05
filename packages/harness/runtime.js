/**
 * runtime — a workspace: pack + Chief + guardrail engine + memory +
 * approvals queue (persisted under .data/workspaces/<ws>/).
 *
 * Every specialist action passes GuardrailEngine.decide() BEFORE it can
 * run or queue. Approvals are only released by a human via approve(id).
 * Execution: in shadow mode (default) an approved action is logged as
 * sent; with BIPPITY_SHADOW_MODE=0 it goes through the DeliveryService
 * (webhook / SMTP / AgentMail / Composio / Twilio) and the delivery
 * result is stored on the approval. Nothing sends without a human tap
 * either way, and Never-Auto classes never reach this code at all.
 */
const fs = require('fs');
const path = require('path');
const { GuardrailEngine } = require('./guardrails');
const { FileMemory } = require('../memory/file-memory');
const { ModelRouter } = require('./model-router');
const { Chief } = require('../chief/chief');
const { DeliveryService } = require('../connectors/delivery');
const { KnowledgeStore } = require('./knowledge');
const { WorkspaceSettings } = require('./settings');
const { SkillStore } = require('./skills');

class Workspace {
  constructor({ pack, dataRoot, env = process.env, delivery = null, workspaceId = null }) {
    this.pack = pack; this.bots = pack.bots;
    // workspaceId differs from pack.id for installed workspaces: two
    // schools can run the same pack with fully separate state/memory.
    this.id = workspaceId || pack.id;
    this.dataRoot = dataRoot;
    this.memory = new FileMemory(dataRoot);
    this.knowledge = new KnowledgeStore(dataRoot);
    this.settings = new WorkspaceSettings(dataRoot);
    this.skills = new SkillStore(dataRoot);
    this.models = new ModelRouter(env);
    this.delivery = delivery || new DeliveryService(env);
    this.shadow = env.BIPPITY_SHADOW_MODE !== '0';
    const tiers = {}; for (const b of pack.bots) tiers[b.name] = pack.tiers;
    this.guard = new GuardrailEngine(tiers);
    this.chief = new Chief(this);
    this.dir = path.join(dataRoot, 'workspaces', this.id);
    fs.mkdirSync(this.dir, { recursive: true });
    this.stateFile = path.join(this.dir, 'state.json');
    this.state = this._load();
  }
  _load() {
    if (fs.existsSync(this.stateFile)) { try { return JSON.parse(fs.readFileSync(this.stateFile, 'utf8')); } catch { /* fall through */ } }
    return { approvals: [], log: [], counters: { done: 0, approved: 0, refused: 0 }, seq: 0 };
  }
  _save() { fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2)); }
  _log(entry) { this.state.log.unshift({ at: new Date().toISOString(), ...entry }); this.state.log = this.state.log.slice(0, 200); }

  /** Human brief -> plan -> specialist work -> guardrail decision. */
  async brief(text, channel = 'web') {
    const plan = this.chief.plan(text);
    this._log({ kind: 'brief', channel, text });
    if (plan.kind === 'refuse') {
      const d = this.guard.decide('Chief', plan.action, { via: 'brief' });
      this.state.counters.refused++;
      this._log({ kind: 'refused', bot: 'Chief', action: plan.action, tier: d.tier });
      this._save();
      return { type: 'refused', action: plan.action, message: plan.reason, counters: this.state.counters };
    }
    if (plan.kind === 'brief') { this._save(); return { type: 'message', from: 'Chief', message: this.chief.morningBrief(), counters: this.state.counters }; }
    if (plan.kind === 'answer') { this._save(); return { type: 'message', from: 'Chief', message: `I have ${this.bots.length - 1} specialists on this pack (${this.bots.filter(b => b.id !== 'chief').map(b => b.name).join(', ')}). Give me a brief with their work in it — e.g. "${this.bots.find(b => b.work)?.work('').title || 'a task'}" — and I'll delegate it.`, counters: this.state.counters }; }

    const bot = plan.bot;
    // Specialist does its (offline or live-model) work: produces a summary + a proposed action.
    let work = bot.work ? bot.work(text) : { summary: 'Completed the brief.', action: 'draft_message', title: 'Draft ready', body: text };
    const live = await this.models.complete(bot.model, `You are ${bot.name}, ${bot.role}. Workspace: ${this.pack.fiction}. Persona: ${bot.persona || ''}\nMemory:\n${this.memory.load(this.id, bot.id)}`, `Brief: ${text}\nRespond with a short summary and a proposed outbound message.`);
    if (live) work = { ...work, summary: live.slice(0, 400), liveModel: true };

    this.memory.remember(this.id, bot.id, `Brief: ${text} -> proposed ${work.action}: ${work.title}`);
    const d = this.guard.decide(bot.name, work.action, { title: work.title });
    if (d.decision === 'refuse') {
      this.state.counters.refused++;
      this._log({ kind: 'refused', bot: bot.name, action: work.action });
      this._save();
      return { type: 'refused', action: work.action, message: `${bot.name} proposed "${work.action}", which is Never Auto. Refused in code; nothing queued.`, counters: this.state.counters };
    }
    // Knowledge: whatever the specialist learned while working is filed
    // (reference only — it can never widen guardrails). Refused work
    // teaches nothing.
    let learned = 0;
    if (Array.isArray(work.learns)) for (const l of work.learns) { try { this.knowledge.add(this.id, { ...l, source: bot.name }); learned++; } catch { /* bad entry skipped */ } }
    // Skills: published skills assigned to this bot whose triggers appear
    // in the brief are followed (drafts never are) and noted in Knowledge.
    const followed = this.skills.matchFor(this.id, bot.id, text).map((s) => s.name);
    for (const name of followed) { try { this.knowledge.add(this.id, { type: 'skills', title: `Skill followed: ${name}`, detail: `Followed during: ${work.title}`, source: bot.name }); } catch { /* skip */ } }
    if (d.decision === 'run') {
      this.state.counters.done++;
      this._log({ kind: 'auto', bot: bot.name, action: work.action, title: work.title });
      this._save();
      return { type: 'done', from: bot.name, message: work.summary, learned, skills: followed, counters: this.state.counters };
    }
    const approval = { id: 'a' + (++this.state.seq), bot: bot.name, botId: bot.id, action: work.action, title: work.title, body: work.body, summary: work.summary, deliver: work.deliver || null, at: new Date().toISOString(), status: 'waiting' };
    this.state.approvals.unshift(approval);
    this._log({ kind: 'queued', bot: bot.name, action: work.action, title: work.title });
    this._save();
    return { type: 'queued', from: bot.name, message: work.summary, approval, learned, skills: followed, counters: this.state.counters };
  }

  /**
   * Human releases an approval. The ONLY path that executes a queued
   * action. Async since v0.3: with shadow OFF, execution is a real
   * delivery attempt through packages/connectors/delivery, and the
   * result (delivered / failed / skipped_*) is stored on the approval.
   */
  async approve(id) {
    const a = this.state.approvals.find((x) => x.id === id && x.status === 'waiting');
    if (!a) return null;
    a.status = 'approved'; a.decidedAt = new Date().toISOString();
    a.delivery = await this.delivery.deliver(a, { shadow: this.shadow });
    this.state.counters.approved++; this.state.counters.done++;
    this.memory.remember(this.id, a.botId, `Approved: ${a.title} — delivery: ${a.delivery.status}${a.delivery.via ? ' via ' + a.delivery.via : ''}`);
    this._log({ kind: 'approved', bot: a.bot, action: a.action, title: a.title, shadow: this.shadow, delivery: a.delivery.status });
    this._save();
    return a;
  }
  hold(id) {
    const a = this.state.approvals.find((x) => x.id === id && x.status === 'waiting');
    if (!a) return null;
    a.status = 'held'; a.decidedAt = new Date().toISOString();
    this._log({ kind: 'held', bot: a.bot, action: a.action, title: a.title });
    this._save();
    return a;
  }
  status() {
    return {
      workspace: this.id, pack: this.pack.name, packId: this.pack.id, fiction: this.pack.fiction, shadow: this.shadow,
      team: this.bots.map((b) => ({ id: b.id, name: b.name, emoji: b.emoji, role: b.role, model: b.model, modelStatus: this.models.available(b.model) })),
      approvals: this.state.approvals, log: this.state.log.slice(0, 50),
      counters: { ...this.state.counters, waiting: this.state.approvals.filter((a) => a.status === 'waiting').length, neverExecuted: 0 },
      models: this.models.status(this.bots.map((b) => b.model)),
      delivery: this.delivery.status(),
      knowledge: { total: this.knowledge.list(this.id).length, counts: this.knowledge.counts(this.id) },
      skills: { total: this.skills.list(this.id).length, published: this.skills.list(this.id).filter((s) => s.status === 'published').length },
    };
  }
}
module.exports = { Workspace };
