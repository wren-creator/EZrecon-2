'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

// isolate persistence + force the mock so no network / ezrecon is touched
process.env.SECTOOLS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'sectools-it-'));
process.env.SECTOOLS_PORT = '0';

const { server } = require('../server');

let base;
test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const j = (p, method = 'GET', body) => fetch(base + p, {
  method,
  headers: body ? { 'Content-Type': 'application/json' } : undefined,
  body: body ? JSON.stringify(body) : undefined,
}).then((r) => r.json());

test('engagement + target + full CICS chain + report', async () => {
  const eng = await j('/api/engagements', 'POST', { name: 'IT' });
  assert.match(eng.id, /^eng_/);

  const t = await j(`/api/engagement/${eng.id}/targets`, 'POST',
    { addr: 'mock', port: 23, kind: 'lpar', applid: 'CICS', provenance: 'manual' });
  assert.match(t.id, /^tgt_/);

  // read-only primitives run without authorisation
  const info = await j(`/api/engagement/${eng.id}/target/${t.id}/cics`, 'POST', { primitive: 'infoGather' });
  assert.equal(info.result.data.cics, '73');
  assert.equal(info.result.data.esm, 'RACF');

  const tsq = await j(`/api/engagement/${eng.id}/target/${t.id}/cics`, 'POST', { primitive: 'enumTSQ' });
  assert.equal(tsq.result.data.queues.length, 3);

  // state-changing primitives are gated: 403 without an authorised target
  const blocked = await fetch(`${base}/api/engagement/${eng.id}/target/${t.id}/cics`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': 'britley' },
    body: JSON.stringify({ primitive: 'racfBypass' }),
  });
  assert.equal(blocked.status, 403);

  // authorise the target (records user id + target domain to the audit log)
  const at = await fetch(`${base}/api/engagement/${eng.id}/target/${t.id}/authorise`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': 'britley' },
    body: JSON.stringify({ approver: 'ciso', scope: 'mock LPAR, CICS only' }),
  }).then((r) => r.json());
  assert.equal(at.authorised.by, 'britley');

  const rf = await fetch(`${base}/api/engagement/${eng.id}/target/${t.id}/cics`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': 'britley' },
    body: JSON.stringify({ primitive: 'readFile', opts: { name: 'FILEB' } }),
  }).then((r) => r.json());
  assert.equal(rf.result.data.recordCount, 40);
  assert.equal(rf.result.steps.length, 3);

  const bypass = await fetch(`${base}/api/engagement/${eng.id}/target/${t.id}/cics`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': 'britley' },
    body: JSON.stringify({ primitive: 'racfBypass' }),
  }).then((r) => r.json());
  assert.equal(bypass.result.data.installed.length, 2);

  // audit log carries user id + target domain for the authorise + active CICS runs
  const alog = await j('/api/audit');
  const forThis = alog.filter((x) => x.engagementId === eng.id);
  assert.ok(forThis.some((x) => x.event === 'authorise' && x.userId === 'britley' && x.target === 'mock:23'));
  assert.ok(forThis.some((x) => x.event === 'cics-active' && x.userId === 'britley' && x.detail.primitive === 'racfBypass'));

  const full = await j(`/api/engagement/${eng.id}`);
  assert.equal(full.targets.length, 1);
  assert.ok(full.findings.length >= 5, 'CICS results folded back as findings');
  assert.equal(full.actions.filter((a) => a.kind === 'cics').length, 4);
  assert.equal(full.recordings.length, 4);

  const rep = await j(`/api/engagement/${eng.id}/report.json`);
  assert.ok(rep.exposure.score > 0);
  const md = await fetch(base + `/api/engagement/${eng.id}/report.md`).then((r) => r.text());
  assert.match(md, /## CICS actions/);
  assert.match(md, /Ayoub Elaassal/);
});

test('unknown primitive is rejected', async () => {
  const eng = await j('/api/engagements', 'POST', { name: 'X' });
  const t = await j(`/api/engagement/${eng.id}/targets`, 'POST', { addr: 'mock' });
  const res = await fetch(base + `/api/engagement/${eng.id}/target/${t.id}/cics`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ primitive: 'nope' }),
  });
  assert.equal(res.status, 400);
});

test('static client is served', async () => {
  const html = await fetch(base + '/').then((r) => r.text());
  assert.match(html, /EZrecon-2 SecTools/);
});
