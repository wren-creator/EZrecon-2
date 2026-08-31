#!/usr/bin/env node
'use strict';

/**
 * EZrecon-2 SecTools — standalone shell server.
 *
 * HTTP + WebSocket. Serves the 4-panel client (public/) and a small API that
 * ties the engagement store, the eZrecon recon wrapper, the live TN3270
 * session, and the CICS primitives together. Nothing here is web3270-specific,
 * so the panels + endpoints port across later.
 *
 * Built on: eZrecon (Kev Milne, Phil Young) · CICSpwn technique (Ayoub Elaassal,
 * reimplemented clean-room) · tn3270_library (Britley Wren Hoff).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const cfg = require('./config');
const log = require('./lib/log');
const { EngagementStore, requireAuthorised, targetLabel } = require('./lib/store');
const audit = require('./lib/audit');
const recon = require('./lib/recon');
const cics = require('./lib/cics');
const report = require('./lib/report');
const { Tn3270Adapter } = require('./lib/tn3270');
const { makeMock } = require('./mock-cics');

const store = new EngagementStore(cfg.dataDir);
const liveSessions = new Map(); // sessionId -> { adapter, engagementId, targetId, wss:Set }

// ---------------------------------------------------------------- static files
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

function serveStatic(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(PUBLIC, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------- api helpers
const send = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};
const readBody = (req) => new Promise((resolve) => {
  let b = '';
  req.on('data', (c) => { b += c; });
  req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
});
// operator identity: X-User-Id header, else ?userId=, else 'anonymous'
const userOf = (req, url) => String(req.headers['x-user-id'] || (url && url.searchParams.get('userId')) || 'anonymous').slice(0, 120);
const ACTIVE_RECON = ['ports', 'nse', 'buckets'];

// Node wraps connect failures (IPv4+IPv6) in an AggregateError whose .message is
// just "AggregateError" — unwrap it so the client sees ECONNREFUSED / ENOTFOUND.
function errStr(e) {
  if (e && e.errors && e.errors.length) {
    return e.errors.map((x) => (x && (x.code || x.message)) || String(x)).join('; ');
  }
  return String((e && (e.message || e.code)) || e);
}

// ---------------------------------------------------------------- live session
function openSession(engagementId, target) {
  const useMock = /^mock$/i.test(String(target.addr || '').trim()) || target.mock || process.env.SECTOOLS_FORCE_MOCK;
  const useBridge = !useMock && !!target.viaBridge && !!cfg.bridgeUrl;
  let opts;
  if (useMock) opts = { driver: makeMock() };
  else if (useBridge) opts = { bridge: cfg.bridgeUrl, host: target.addr, port: target.port || 23, model: cfg.model, tls: !!target.tls, tn3270e: target.tn3270e };
  else opts = { host: target.addr, port: target.port || 23, model: cfg.model, tls: !!target.tls };
  const adapter = new Tn3270Adapter(opts);
  const id = 'sess_' + Math.random().toString(16).slice(2, 10);
  const entry = { adapter, engagementId, targetId: target.id, subscribers: new Set(), useMock, useBridge };
  liveSessions.set(id, entry);

  adapter.driver.on('screen', () => {
    const msg = JSON.stringify({ type: 'session.screen', sessionId: id, text: adapter.screen(), fields: adapter.fields() });
    for (const ws of entry.subscribers) { try { ws.send(msg); } catch { /* dropped */ } }
  });
  adapter.driver.on('disconnected', () => {
    for (const ws of entry.subscribers) { try { ws.send(JSON.stringify({ type: 'session.closed', sessionId: id })); } catch { /* */ } }
    liveSessions.delete(id);
  });
  return { id, entry, adapter, useMock, useBridge };
}

// ---------------------------------------------------------------- routes
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const m = req.method;
  const user = userOf(req, url);

  // /api/audit — the append-only log (user id + target per action)
  if (parts.length === 2 && parts[1] === 'audit' && m === 'GET') {
    return send(res, 200, audit.readAll());
  }

  // /api/cli-log — a terminal-run eZrecon command, posted by the ezrecon2 wrapper
  if (parts.length === 2 && parts[1] === 'cli-log' && m === 'POST') {
    const b = await readBody(req);
    const argv = Array.isArray(b.argv) ? b.argv : [];
    audit.record({
      event: 'cli',
      userId: b.userId || user,
      target: b.target || argv[1] || null,
      engagementId: b.engagementId || null,
      detail: { argv, cwd: b.cwd || null, exit: b.exit, ms: b.ms, phase: b.phase || 'run' },
    });
    return send(res, 200, { ok: true });
  }

  // /api/engagements
  if (parts.length === 2 && parts[1] === 'engagements') {
    if (m === 'GET') return send(res, 200, store.list());
    if (m === 'POST') { const b = await readBody(req); return send(res, 201, store.create(b)); }
  }

  // /api/engagement/:id ...
  if (parts[1] === 'engagement' && parts[2]) {
    const id = parts[2];
    let eng; try { eng = store.get(id); } catch { return send(res, 404, { error: 'no such engagement' }); }
    const sub = parts[3];

    if (!sub && m === 'GET') return send(res, 200, eng);
    if (!sub && m === 'DELETE') return send(res, 200, store.remove(id));

    if (sub === 'rename' && m === 'POST') {
      const b = await readBody(req);
      return send(res, 200, store.rename(id, b.name));
    }

    if (sub === 'recon' && m === 'POST') {
      const b = await readBody(req);
      const argv = Array.isArray(b.argv) ? b.argv : ['auto', b.domain].filter(Boolean);
      const domain = argv[1] || b.domain || '';
      const isActive = argv.some((x) => ACTIVE_RECON.includes(x));
      if (isActive) {
        if (cfg.lockActive) return send(res, 403, { error: 'active recon is hard-locked on this server (SECTOOLS_LOCK_ACTIVE)' });
        // active recon requires an authorised target matching the domain
        const t = eng.targets.find((x) => x.addr === domain && x.authorised)
          || (b.targetId && eng.targets.find((x) => x.id === b.targetId && x.authorised));
        if (!t) {
          return send(res, 403, {
            error: `active recon (${argv.filter((x) => ACTIVE_RECON.includes(x)).join(', ')}) needs an authorised target for "${domain}". Authorise it first.`,
          });
        }
        audit.record({ event: 'active-recon', userId: user, target: domain, engagementId: id, detail: { argv, approver: t.authorised.approver } });
      } else {
        audit.record({ event: 'recon', userId: user, target: domain, engagementId: id, detail: { argv } });
      }
      const action = store.startAction(id, { kind: 'recon', tool: `ezrecon ${argv.join(' ')}`, active: isActive, params: { user, domain } });
      try {
        const r = await recon.runRecon({ argv, onStage: (s) => store.emit('change', { engagementId: id, kind: 'recon:stage', payload: s }) });
        const findings = store.addFindings(id, r.findings);
        store.finishAction(id, action.id, { status: 'ok', findingIds: findings.map((f) => f.id), result: { count: findings.length } });
        // attach finding ids to candidates
        const cands = r.candidates.map((c) => {
          const f = findings.find((x) => x.key === c.provenanceKey);
          return { ...c, provenance: f ? `recon:${f.id}` : 'recon' };
        });
        return send(res, 200, { findings, candidates: cands, queries: r.report.queries });
      } catch (e) {
        store.finishAction(id, action.id, { status: 'error', result: { error: errStr(e) } });
        return send(res, 502, { error: errStr(e) });
      }
    }

    if (sub === 'targets' && m === 'POST') {
      const b = await readBody(req);
      return send(res, 201, store.addTarget(id, b));
    }

    if (sub === 'target' && parts[4]) {
      const tid = parts[4];
      const t = eng.targets.find((x) => x.id === tid);
      if (!t) return send(res, 404, { error: 'no such target' });
      const op = parts[5];

      if (!op && m === 'DELETE') {
        if (t.sessionRef && liveSessions.has(t.sessionRef)) {
          try { liveSessions.get(t.sessionRef).adapter.disconnect(); } catch { /* */ }
        }
        audit.record({ event: 'target-remove', userId: user, target: targetLabel(t), engagementId: id });
        return send(res, 200, store.removeTarget(id, tid));
      }

      if (op === 'authorise' && m === 'POST') {
        const b = await readBody(req);
        try {
          const at = store.authoriseTarget(id, tid, { userId: user, approver: b.approver, scope: b.scope });
          return send(res, 200, at);
        } catch (e) { return send(res, e.code || 400, { error: String(e.message || e) }); }
      }
      if (op === 'revoke' && m === 'POST') {
        try { return send(res, 200, store.revokeTarget(id, tid, { userId: user })); }
        catch (e) { return send(res, e.code || 400, { error: String(e.message || e) }); }
      }

      if (op === 'connect' && m === 'POST') {
        const { id: sessionId } = openSession(id, t);
        store.updateTarget(id, tid, { sessionRef: sessionId });
        const a = store.startAction(id, { kind: 'session', tool: 'connect', targetId: tid, params: { user } });
        store.finishAction(id, a.id, { status: 'ok', result: { sessionId } });
        audit.record({ event: 'session.connect', userId: user, target: targetLabel(t), engagementId: id, detail: { sessionId } });
        return send(res, 200, { sessionId });
      }

      if (op === 'cics' && m === 'POST') {
        const b = await readBody(req);
        const primName = b.primitive;
        const spec = cics.PRIMITIVES[primName];
        if (!spec) return send(res, 400, { error: `unknown primitive: ${primName}` });

        // state-changing primitives require an authorised target
        if (spec.active) {
          if (cfg.lockActive) {
            audit.record({ event: 'denied', userId: user, target: targetLabel(t), engagementId: id, detail: { primitive: primName, reason: 'lock-active' } });
            return send(res, 403, { error: 'state-changing CICS primitives are hard-locked on this server (SECTOOLS_LOCK_ACTIVE)' });
          }
          try { requireAuthorised(eng, tid); }
          catch (e) {
            audit.record({ event: 'denied', userId: user, target: targetLabel(t), engagementId: id, detail: { primitive: primName, reason: 'not-authorised' } });
            return send(res, e.code || 403, { error: String(e.message || e) });
          }
          audit.record({ event: 'cics-active', userId: user, target: targetLabel(t), engagementId: id, detail: { primitive: primName, opts: b.opts || {}, approver: t.authorised.approver } });
        } else {
          audit.record({ event: 'cics', userId: user, target: targetLabel(t), engagementId: id, detail: { primitive: primName } });
        }

        // reuse the live session if present, else open one for the run
        let sess = t.sessionRef && liveSessions.get(t.sessionRef);
        let ephemeral = false;
        if (!sess) { const o = openSession(id, t); sess = o.entry; ephemeral = true; }

        const action = store.startAction(id, {
          kind: 'cics', tool: primName, targetId: tid, active: spec.active,
          params: { user, opts: b.opts || {} },
        });
        try {
          if (!sess.adapter.connected) {
            try {
              await sess.adapter.connect({ timeoutMs: 10000 });
            } catch (ce) {
              const detail = errStr(ce);
              let msg;
              if (sess.useMock) msg = `mock session failed: ${detail}`;
              else if (sess.useBridge) {
                msg = `could not reach ${targetLabel(t)} via the web3270 bridge (${cfg.bridgeUrl}): ${detail}. `
                  + `Is the bridge running, and does it have an LPAR profile / route to that host?`;
              } else {
                msg = `could not reach ${targetLabel(t)}: ${detail}. `
                  + `Add a target with address "mock" for the offline CICS mock, or start GIBSON and retry.`;
              }
              throw new Error(msg);
            }
          }
          const result = await cics.run(primName, sess.adapter, b.opts || {});
          // fold notable results back in as findings
          const newFindings = resultToFindings(primName, result, tid);
          const fs2 = newFindings.length ? store.addFindings(id, newFindings) : [];
          const rec = store.addRecording(id, { ref: `transcript:${action.id}`, targetId: tid, actionId: action.id, transcript: result.transcript });
          store.finishAction(id, action.id, {
            status: result.ok ? 'ok' : 'error',
            result: { ...result.data, steps: result.steps },
            findingIds: fs2.map((f) => f.id),
            recordingRef: rec.id,
          });
          if (ephemeral) sess.adapter.disconnect();
          return send(res, 200, { result, findings: fs2, recordingRef: rec.id });
        } catch (e) {
          store.finishAction(id, action.id, { status: 'error', result: { error: errStr(e) } });
          if (ephemeral && sess) sess.adapter.disconnect();
          return send(res, 502, { error: errStr(e) });
        }
      }

      if (op === 'esm' && m === 'POST') {
        const b = await readBody(req);
        return send(res, 200, store.setEsm(id, tid, b));
      }
    }

    if (sub && sub.startsWith('report') && m === 'GET') {
      const fmt = (sub.split('.')[1] || 'json').toLowerCase();
      const r = report.generate(eng);
      if (fmt === 'md') { res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' }); return res.end(r.md); }
      if (fmt === 'html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(r.html); }
      return send(res, 200, r.json);
    }
  }

  return send(res, 404, { error: 'no route' });
}

function resultToFindings(prim, result, targetId) {
  const out = [];
  const d = result.data || {};
  if (prim === 'infoGather' && d.cics) {
    out.push({ category: 'cics', key: 'levels', value: `z/OS ${d.zos} · CICS TS ${d.cics} · SYSID ${d.sysid}`, source: 'cics:infoGather', severity: 'medium', targetId, meta: d });
    if (d.esm) out.push({ category: 'fingerprint', key: 'esm', value: `ESM ${d.esm}`, source: 'cics:infoGather', severity: 'medium', targetId, meta: {} });
  }
  if (prim === 'enumTSQ') {
    for (const q of d.queues || []) out.push({ category: 'cics', key: `tsq:${q.name}`, value: `${q.items} items · owner ${q.tran}`, source: 'cics:enumTSQ', severity: 'low', targetId, meta: q });
  }
  if (prim === 'readFile' && d.file) {
    out.push({ category: 'cics', key: `file:${d.file}`, value: `${d.state} · ${d.recordCount} records${d.flipped ? ' (attributes flipped)' : ''}`, source: 'cics:readFile', severity: d.flipped ? 'high' : 'medium', targetId, meta: d });
  }
  if (prim === 'racfBypass' && result.ok) {
    out.push({ category: 'cics', key: 'racf-bypass', value: `installed ${d.installed.map((x) => x.to).join(', ')} — transaction security bypassed`, source: 'cics:racfBypass', severity: 'high', targetId, meta: d });
  }
  return out;
}

// ---------------------------------------------------------------- http + ws
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) return api(req, res, url).catch((e) => send(res, 500, { error: String(e) }));
  return serveStatic(req, res);
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  ws.subscribedEngagement = null;
  ws.subscribedSessions = new Set();

  const onChange = (e) => {
    if (e.engagementId === ws.subscribedEngagement) {
      try { ws.send(JSON.stringify({ type: 'store.change', ...e })); } catch { /* */ }
    }
  };
  store.on('change', onChange);

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'subscribe') {
      ws.subscribedEngagement = msg.engagementId;
      try { ws.send(JSON.stringify({ type: 'subscribed', engagementId: msg.engagementId })); } catch { /* */ }
    }
    if (msg.type === 'session.attach') {
      const s = liveSessions.get(msg.sessionId);
      if (s) { s.subscribers.add(ws); ws.subscribedSessions.add(msg.sessionId);
        ws.send(JSON.stringify({ type: 'session.screen', sessionId: msg.sessionId, text: s.adapter.screen(), fields: s.adapter.fields() })); }
    }
    if (msg.type === 'session.aid') {
      const s = liveSessions.get(msg.sessionId);
      if (s) {
        (msg.fields || []).forEach((f) => s.adapter.type(f.row, f.col, f.text));
        s.adapter.press(msg.key).catch(() => {});
      }
    }
    if (msg.type === 'session.disconnect') {
      const s = liveSessions.get(msg.sessionId);
      if (s) s.adapter.disconnect();
    }
  });

  ws.on('close', () => {
    store.removeListener('change', onChange);
    for (const sid of ws.subscribedSessions) { const s = liveSessions.get(sid); if (s) s.subscribers.delete(ws); }
  });
});

server.listen(cfg.port, cfg.host, () => {
  log.ok(`SecTools shell on http://${cfg.host}:${cfg.port}  (data: ${cfg.dataDir})`);
  log.info('recon via', cfg.ezreconBin, '· mock CICS available as target addr "mock"');
});

module.exports = { server, store };
