'use strict';

const os = require('os');
const path = require('path');
process.env.SECTOOLS_AUDIT_LOG = path.join(os.tmpdir(), `sectools-audit-${process.pid}.log`);

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { EngagementStore, requireAuthorised } = require('../lib/store');
const audit = require('../lib/audit');

test('engagement lifecycle: findings -> target -> esm reconcile', () => {
  const s = new EngagementStore(null); // in-memory only

  const eng = s.create({ name: 'Test', scopeNote: 'lab only' });
  assert.match(eng.id, /^eng_/);
  assert.equal(s.list().length, 1);

  const [fp] = s.addFindings(eng.id, {
    category: 'fingerprint', key: 'tso.example.com',
    value: 'LIKELY MAINFRAME 82%', source: 'ports', severity: 'high',
  });
  assert.match(fp.id, /^fnd_/);
  assert.equal(fp.severity, 'high');

  const t = s.addTarget(eng.id, {
    kind: 'lpar', addr: 'tso.example.com', port: 23,
    provenance: `recon:${fp.id}`,
  });
  // provenance back-links the finding
  assert.equal(s.get(eng.id).findings[0].targetId, t.id);

  // adding the same addr+port is idempotent
  const again = s.addTarget(eng.id, { addr: 'tso.example.com', port: 23 });
  assert.equal(again.id, t.id);
  assert.equal(s.get(eng.id).targets.length, 1);

  s.setEsm(eng.id, t.id, { product: 'RACF', confidence: 0.85, evidence: ['DFHCE35xx'] });
  const et = s.get(eng.id).targets[0];
  assert.equal(et.esm.product, 'RACF');
  assert.equal(et.esm.reconcile, 'LIKELY MAINFRAME 82%');
});

test('actions: start -> finish updates status and timeline', () => {
  const s = new EngagementStore(null);
  const eng = s.create({ name: 'A' });
  const a = s.startAction(eng.id, { kind: 'cics', tool: 'enumTSQ', active: false });
  assert.equal(a.status, 'running');
  const done = s.finishAction(eng.id, a.id, { status: 'ok', result: { queues: 3 } });
  assert.equal(done.status, 'ok');
  assert.equal(done.result.queues, 3);
  assert.ok(done.finishedAt);
  const kinds = s.get(eng.id).timeline.map((x) => x.kind);
  assert.ok(kinds.includes('cics'));
});

test('authorise / revoke gate active actions and write the audit log', () => {
  const s = new EngagementStore(null);
  const eng = s.create({ name: 'Auth', scopeNote: 'lab LPARs only' });
  const t = s.addTarget(eng.id, { addr: 'tso.acme.com', port: 23 });

  // not authorised -> requireAuthorised throws 403
  assert.throws(() => requireAuthorised(s.get(eng.id), t.id), (e) => e.code === 403);

  const at = s.authoriseTarget(eng.id, t.id, { userId: 'britley', approver: 'ciso', scope: 'tso.acme.com CICS only' });
  assert.equal(at.authorised.by, 'britley');
  assert.equal(at.authorised.approver, 'ciso');
  assert.doesNotThrow(() => requireAuthorised(s.get(eng.id), t.id));

  // audit log has a line with the user id and the target domain
  const lines = audit.readAll();
  const a = lines.find((x) => x.event === 'authorise' && x.target === 'tso.acme.com:23');
  assert.ok(a, 'authorise event logged');
  assert.equal(a.userId, 'britley');
  assert.equal(a.detail.approver, 'ciso');

  s.revokeTarget(eng.id, t.id, { userId: 'britley' });
  assert.equal(s.get(eng.id).targets[0].authorised, null);
  assert.throws(() => requireAuthorised(s.get(eng.id), t.id), (e) => e.code === 403);
  assert.ok(audit.readAll().some((x) => x.event === 'revoke' && x.userId === 'britley'));
});

test.after(() => { try { fs.rmSync(process.env.SECTOOLS_AUDIT_LOG); } catch (e) {} });

test('clearFindings drops recon findings, keeps CICS output + prunes actions', () => {
  const s = new EngagementStore(null);
  const eng = s.create({ name: 'C' });
  const recon = s.addFindings(eng.id, [
    { category: 'dns', key: 'A', value: '1.2.3.4', source: 'dns' },
    { category: 'subdomain', key: 'tso.x', value: '1.2.3.5', source: 'passive' },
  ]);
  const cics = s.addFindings(eng.id, [{ category: 'cics', key: 'levels', value: 'z/OS 2.05', source: 'cics:infoGather' }]);
  const a = s.startAction(eng.id, { kind: 'recon', tool: 'ezrecon dns' });
  s.finishAction(eng.id, a.id, { status: 'ok', findingIds: recon.map((f) => f.id) });

  const r = s.clearFindings(eng.id, { scope: 'recon' });
  assert.equal(r.removed, 2);
  const e = s.get(eng.id);
  assert.equal(e.findings.length, 1);
  assert.equal(e.findings[0].id, cics[0].id);
  assert.equal(e.actions[0].findingIds.length, 0);

  s.addFindings(eng.id, [{ category: 'dns', key: 'MX', value: 'x', source: 'dns' }]);
  assert.equal(s.clearFindings(eng.id, { scope: 'all' }).removed, 2); // MX + the cics one
  assert.equal(s.get(eng.id).findings.length, 0);
});

test('change events fire on mutation', () => {
  const s = new EngagementStore(null);
  const seen = [];
  s.on('change', (e) => seen.push(e.kind));
  const eng = s.create({ name: 'E' });
  s.addFindings(eng.id, { category: 'dns', key: 'MX', value: 'x' });
  s.addTarget(eng.id, { addr: 'h', port: 23 });
  assert.deepEqual(seen, ['engagement:create', 'findings:add', 'target:add']);
});
