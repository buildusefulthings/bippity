/**
 * routines — scheduled jobs for a workspace, checked once a minute.
 * A routine is { name, at: "07:00", days: [1,2,3,4,5], brief: "..." } in
 * routines.json beside the pack or in .data/workspaces/<ws>/.
 * When a routine fires, its brief goes through the exact same Chief ->
 * guardrail -> approvals path as a typed brief. Routines never bypass
 * approvals. Watches (screen/inbox monitors) plug in here in v0.3.
 */
class RoutineRunner {
  constructor(workspace, routines = []) { this.ws = workspace; this.routines = routines; this.fired = new Set(); this.timer = null; }
  async tick(now = new Date()) {
    const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const out = [];
    for (const r of this.routines) {
      const key = r.name + '@' + now.toISOString().slice(0, 10) + hhmm;
      if (r.at === hhmm && (!r.days || r.days.includes(now.getDay())) && !this.fired.has(key)) {
        this.fired.add(key);
        out.push(await this.ws.brief(r.brief, 'routine:' + r.name));
      }
    }
    return out;
  }
  start() { this.timer = setInterval(() => this.tick().catch(() => {}), 60000); return this; }
  stop() { if (this.timer) clearInterval(this.timer); }
}
module.exports = { RoutineRunner };
