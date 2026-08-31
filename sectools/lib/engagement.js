'use strict';

/**
 * EZrecon-2 SecTools — the shared schema.
 *
 * One `Engagement` is the single record every surface reads and writes:
 * Recon findings, Targets, live-session refs, CICS actions, and the timeline.
 * `Finding` deliberately matches eZrecon's own shape (category/key/value/
 * source/severity/meta) so recon output drops in without reshaping.
 */

const crypto = require('crypto');

const rid = (p) => `${p}_${crypto.randomBytes(5).toString('hex')}`;
const now = () => new Date().toISOString();

const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3 };
function sevRank(s) { return SEVERITY_RANK[String(s || 'info').toLowerCase()] ?? 0; }

/** eZrecon-shaped finding, plus an id and an optional link back to a Target. */
function makeFinding(f = {}) {
  return {
    id: f.id || rid('fnd'),
    category: f.category || 'misc',
    key: f.key || '',
    value: f.value == null ? '' : String(f.value),
    source: f.source || '',
    severity: (f.severity || 'info').toLowerCase(),
    meta: f.meta && typeof f.meta === 'object' ? f.meta : {},
    targetId: f.targetId || null,
    ts: f.ts || now(),
  };
}

/** A host / domain / LPAR the engagement cares about. */
function makeTarget(t = {}) {
  return {
    id: t.id || rid('tgt'),
    kind: t.kind || 'host',            // host | domain | lpar
    addr: t.addr || '',
    port: t.port || null,
    applid: t.applid || null,
    label: t.label || t.addr || '',
    provenance: t.provenance || 'manual', // 'manual' | 'recon:<findingId>' | 'import'
    esm: t.esm || null,                // { product, confidence, evidence[], source }
    sessionRef: t.sessionRef || null,  // live session id once connected
    viaBridge: !!t.viaBridge,          // connect through the web3270 bridge, not raw TCP
    authorised: t.authorised || null,  // { by, approver, scope, at } — gates active actions
    tags: Array.isArray(t.tags) ? t.tags : [],
    createdAt: t.createdAt || now(),
  };
}

/** A thing that was run: a recon sweep, a CICS primitive, a session open. */
function makeAction(a = {}) {
  return {
    id: a.id || rid('act'),
    kind: a.kind || 'action',          // recon | cics | session | report
    tool: a.tool || '',
    targetId: a.targetId || null,
    params: a.params && typeof a.params === 'object' ? a.params : {},
    status: a.status || 'pending',     // pending | running | ok | error
    result: a.result ?? null,
    findingIds: Array.isArray(a.findingIds) ? a.findingIds : [],
    recordingRef: a.recordingRef || null,
    active: !!a.active,                // state-changing / needs authorisation
    startedAt: a.startedAt || now(),
    finishedAt: a.finishedAt || null,
  };
}

function makeEngagement(e = {}) {
  return {
    id: e.id || rid('eng'),
    name: e.name || 'Untitled engagement',
    scopeNote: e.scopeNote || 'Authorised targets only. Passive recon by default.',
    createdAt: e.createdAt || now(),
    updatedAt: e.updatedAt || now(),
    targets: [],
    findings: [],
    actions: [],
    recordings: [],   // { id, ref, targetId, actionId, startedAt, path }
    notes: [],
    timeline: [],      // { ts, kind, text, ref }
  };
}

function timelineEntry(kind, text, ref) {
  return { ts: now(), kind, text, ref: ref || null };
}

module.exports = {
  rid, now, sevRank, SEVERITY_RANK,
  makeFinding, makeTarget, makeAction, makeEngagement, timelineEntry,
};
