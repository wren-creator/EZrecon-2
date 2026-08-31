'use strict';

/**
 * EngagementStore — in-memory engagements with JSON persistence.
 *
 * Same shape as web3270's `features/*-store.js` modules (a Map keyed by id),
 * so this ports across with the persistence swapped for Postgres later.
 * Emits 'change' with { engagementId, kind, payload } after every mutation
 * so the WS layer can push deltas to the client.
 */

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const E = require('./engagement');
const audit = require('./audit');

/** Throws unless the target has a live authorisation grant. */
function requireAuthorised(eng, targetId) {
  const t = eng.targets.find((x) => x.id === targetId);
  if (!t) throw Object.assign(new Error(`target not found: ${targetId}`), { code: 404 });
  if (!t.authorised) {
    throw Object.assign(
      new Error(`target ${t.label} is not authorised for active / state-changing actions`),
      { code: 403 },
    );
  }
  return t;
}
const targetLabel = (t) => `${t.addr}${t.port ? ':' + t.port : ''}`;

class EngagementStore extends EventEmitter {
  constructor(dataDir) {
    super();
    this.dataDir = dataDir;
    this.map = new Map();
    if (dataDir) {
      fs.mkdirSync(dataDir, { recursive: true });
      this._loadAll();
    }
  }

  _loadAll() {
    for (const f of fs.readdirSync(this.dataDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const eng = JSON.parse(fs.readFileSync(path.join(this.dataDir, f), 'utf8'));
        if (eng && eng.id) this.map.set(eng.id, eng);
      } catch { /* skip unreadable */ }
    }
  }

  _persist(eng) {
    if (!this.dataDir) return;
    eng.updatedAt = E.now();
    try {
      fs.writeFileSync(
        path.join(this.dataDir, `${eng.id}.json`),
        JSON.stringify(eng, null, 2),
      );
    } catch (err) {
      // don't let a write failure roll back the in-memory mutation
      // eslint-disable-next-line no-console
      console.error('[store] persist failed:', err.message);
    }
  }

  _emit(eng, kind, payload) {
    this._persist(eng);
    this.emit('change', { engagementId: eng.id, kind, payload });
  }

  _get(id) {
    const eng = this.map.get(id);
    if (!eng) throw new Error(`engagement not found: ${id}`);
    return eng;
  }

  // ---- engagements --------------------------------------------------------
  list() {
    return [...this.map.values()]
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))) // most recent first
      .map((e) => ({
        id: e.id, name: e.name, scopeNote: e.scopeNote,
        createdAt: e.createdAt, updatedAt: e.updatedAt,
        counts: {
          targets: e.targets.length, findings: e.findings.length,
          actions: e.actions.length, recordings: e.recordings.length,
        },
      }));
  }

  get(id) { return this._get(id); }

  rename(id, name) {
    const eng = this._get(id);
    eng.name = String(name || '').slice(0, 200) || eng.name;
    eng.timeline.push(E.timelineEntry('engagement', `Renamed to "${eng.name}"`));
    this._emit(eng, 'engagement:rename', { name: eng.name });
    return eng;
  }

  remove(id) {
    if (!this.map.has(id)) throw new Error(`engagement not found: ${id}`);
    this.map.delete(id);
    if (this.dataDir) {
      try { fs.unlinkSync(path.join(this.dataDir, `${id}.json`)); } catch { /* already gone */ }
    }
    this.emit('change', { engagementId: id, kind: 'engagement:remove', payload: { id } });
    return { removed: id };
  }

  create(attrs) {
    const eng = E.makeEngagement(attrs);
    eng.timeline.push(E.timelineEntry('engagement', `Engagement created: ${eng.name}`));
    this.map.set(eng.id, eng);
    this._emit(eng, 'engagement:create', eng);
    return eng;
  }

  // ---- findings ---------------------------------------------------------
  addFindings(id, raw) {
    const eng = this._get(id);
    const arr = Array.isArray(raw) ? raw : [raw];
    const made = arr.map(E.makeFinding);
    eng.findings.push(...made);
    eng.timeline.push(E.timelineEntry('recon', `+${made.length} finding(s)`,
      made[0] && made[0].source));
    this._emit(eng, 'findings:add', made);
    return made;
  }

  // ---- targets --------------------------------------------------------
  addTarget(id, attrs) {
    const eng = this._get(id);
    const t = E.makeTarget(attrs);
    // de-dupe on addr+port
    const dup = eng.targets.find((x) => x.addr === t.addr && x.port === t.port);
    if (dup) return dup;
    eng.targets.push(t);
    if (t.provenance && t.provenance.startsWith('recon:')) {
      const f = eng.findings.find((x) => x.id === t.provenance.slice(6));
      if (f) f.targetId = t.id;
    }
    eng.timeline.push(E.timelineEntry('target', `Target added: ${t.label}`, t.provenance));
    this._emit(eng, 'target:add', t);
    return t;
  }

  removeTarget(id, targetId) {
    const eng = this._get(id);
    const idx = eng.targets.findIndex((x) => x.id === targetId);
    if (idx === -1) throw new Error(`target not found: ${targetId}`);
    const [t] = eng.targets.splice(idx, 1);
    // detach findings so the rail count is right, but keep them as history
    for (const f of eng.findings) if (f.targetId === targetId) f.targetId = null;
    eng.timeline.push(E.timelineEntry('target', `Target removed: ${t.label || t.addr}`, targetId));
    this._emit(eng, 'target:remove', { id: targetId, addr: t.addr });
    return { removed: targetId, addr: t.addr };
  }

  updateTarget(id, targetId, patch) {
    const eng = this._get(id);
    const t = eng.targets.find((x) => x.id === targetId);
    if (!t) throw new Error(`target not found: ${targetId}`);
    Object.assign(t, patch);
    this._emit(eng, 'target:update', t);
    return t;
  }

  /**
   * Grant a target authorisation for active / state-changing actions.
   * Records a user id and the target domain to the append-only audit log.
   */
  authoriseTarget(id, targetId, { userId, approver, scope }) {
    const eng = this._get(id);
    const t = eng.targets.find((x) => x.id === targetId);
    if (!t) throw new Error(`target not found: ${targetId}`);
    t.authorised = {
      by: userId || 'anonymous',
      approver: approver || userId || 'anonymous',
      scope: scope || eng.scopeNote,
      at: E.now(),
    };
    eng.timeline.push(E.timelineEntry('authorise',
      `Target ${targetLabel(t)} authorised by ${t.authorised.approver} (operator ${t.authorised.by})`, targetId));
    audit.record({
      event: 'authorise', userId: t.authorised.by, target: targetLabel(t), engagementId: id,
      detail: { approver: t.authorised.approver, scope: t.authorised.scope, targetId },
    });
    this._emit(eng, 'target:update', t);
    return t;
  }

  revokeTarget(id, targetId, { userId }) {
    const eng = this._get(id);
    const t = eng.targets.find((x) => x.id === targetId);
    if (!t) throw new Error(`target not found: ${targetId}`);
    const was = t.authorised;
    t.authorised = null;
    eng.timeline.push(E.timelineEntry('authorise', `Target ${targetLabel(t)} authorisation revoked by ${userId || 'anonymous'}`, targetId));
    audit.record({
      event: 'revoke', userId: userId || 'anonymous', target: targetLabel(t), engagementId: id,
      detail: { previous: was, targetId },
    });
    this._emit(eng, 'target:update', t);
    return t;
  }

  /** Record an ESM verdict on a target and note whether it agrees with recon. */
  setEsm(id, targetId, verdict) {
    const eng = this._get(id);
    const t = eng.targets.find((x) => x.id === targetId);
    if (!t) throw new Error(`target not found: ${targetId}`);
    const reconGuess = eng.findings.find(
      (f) => f.targetId === targetId && f.category === 'fingerprint');
    t.esm = { ...verdict, reconcile: reconGuess ? reconGuess.value : null };
    eng.timeline.push(E.timelineEntry('esm',
      `ESM ${verdict.product} ${verdict.confidence} on ${t.label}`, targetId));
    this._emit(eng, 'target:update', t);
    return t;
  }

  // ---- actions --------------------------------------------------------
  startAction(id, attrs) {
    const eng = this._get(id);
    const a = E.makeAction({ ...attrs, status: 'running' });
    eng.actions.push(a);
    eng.timeline.push(E.timelineEntry(a.kind, `${a.tool} started`, a.targetId));
    this._emit(eng, 'action:start', a);
    return a;
  }

  finishAction(id, actionId, { status, result, findingIds, recordingRef }) {
    const eng = this._get(id);
    const a = eng.actions.find((x) => x.id === actionId);
    if (!a) throw new Error(`action not found: ${actionId}`);
    a.status = status || 'ok';
    a.result = result ?? a.result;
    if (findingIds) a.findingIds = findingIds;
    if (recordingRef) a.recordingRef = recordingRef;
    a.finishedAt = E.now();
    eng.timeline.push(E.timelineEntry(a.kind, `${a.tool} ${a.status}`, a.targetId));
    this._emit(eng, 'action:finish', a);
    return a;
  }

  addRecording(id, rec) {
    const eng = this._get(id);
    const r = { id: E.rid('rec'), startedAt: E.now(), ...rec };
    eng.recordings.push(r);
    this._emit(eng, 'recording:add', r);
    return r;
  }

  addNote(id, text) {
    const eng = this._get(id);
    eng.notes.push({ ts: E.now(), text });
    eng.timeline.push(E.timelineEntry('note', text));
    this._emit(eng, 'note:add', text);
  }
}

module.exports = { EngagementStore, requireAuthorised, targetLabel };
