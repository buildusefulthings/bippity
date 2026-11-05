/**
 * dispatcher — shared brain for the native channel bots.
 * A chat message becomes ONE brief to the chosen workspace; the result
 * is formatted per channel, with approve/hold buttons on queued items.
 * Approvals from chat go through the same Workspace.approve() path as
 * the web UI — delivery, shadow mode and counters apply unchanged.
 * Workspace targeting: prefix a brief with "<workspace>:" (e.g.
 * "ops: chase the FedEx PO") or rely on the channel's default workspace.
 * Owner gating: when an owner id is configured for the channel, only
 * that user can brief or approve; anyone else gets "message taken."
 */
function pickWorkspace(text, workspaces, dflt) {
  const ids = Object.keys(workspaces);
  const m = String(text || '').match(/^([a-z0-9_-]+):\s+([\s\S]+)$/i);
  if (m && workspaces[m[1]]) return { wsId: m[1], text: m[2] };
  return { wsId: workspaces[dflt] ? dflt : ids[0], text };
}
function resultText(result) {
  if (!result) return 'Nothing came back from that brief.';
  if (result.type === 'refused') return `⛔ Refused by guardrails: ${result.message}`;
  if (result.type === 'queued') return `Queued for your approval — ${result.approval.bot}: ${result.approval.title}\n${result.approval.body}`;
  if (result.type === 'message') return result.message;
  if (result.type === 'done') return `✓ ${result.from}: ${result.message}`;
  return result.message || 'Done.';
}
class ChannelDispatcher {
  constructor({ workspaces, defaultWorkspace = 'enrollment' }) { this.workspaces = workspaces; this.defaultWorkspace = defaultWorkspace; }
  async brief({ text, user, ownerId, channel = 'chat' }) {
    if (ownerId && user !== ownerId) return { type: 'message-taken', text: "Got it — I've passed your message to the owner. They'll pick it up from here." };
    const { wsId, text: clean } = pickWorkspace(text, this.workspaces, this.defaultWorkspace);
    const ws = this.workspaces[wsId];
    if (!ws) return { type: 'error', text: `No workspace "${wsId}" is running.` };
    const result = await ws.brief(clean, channel);
    return { ...result, wsId, text: resultText(result) };
  }
  async act({ action, wsId, id, user, ownerId }) {
    if (ownerId && user !== ownerId) return { ok: false, text: 'Only the owner can approve or hold.' };
    const ws = this.workspaces[wsId];
    if (!ws) return { ok: false, text: `No workspace "${wsId}".` };
    const a = action === 'approve' ? await ws.approve(id) : ws.hold(id);
    if (!a) return { ok: false, text: 'That item is no longer waiting.' };
    if (action === 'approve') return { ok: true, text: `✓ Sent via ${a.bot} (delivery: ${a.delivery ? a.delivery.status : 'n/a'}${a.delivery && a.delivery.via ? ' via ' + a.delivery.via : ''}).` };
    return { ok: true, text: `Held — ${a.bot}'s message won't go anywhere.` };
  }
}
module.exports = { ChannelDispatcher, pickWorkspace, resultText };
