'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Tn3270Adapter } = require('../lib/tn3270');
const { makeMock } = require('../mock-cics');
const cics = require('../lib/cics');

async function connected() {
  const a = new Tn3270Adapter({ driver: makeMock({ latency: 1 }) });
  await a.connect({ timeoutMs: 2000 });
  return a;
}

test('infoGather scrapes the good-morning banner', async () => {
  const a = await connected();
  const r = await cics.infoGather(a);
  assert.equal(r.ok, true);
  assert.equal(r.data.cics, '73');
  assert.equal(r.data.zos, '2.05');
  assert.equal(r.data.sysid, 'GIB1');
  assert.equal(r.data.applid, 'CICS');
  assert.match(r.data.hlq, /GIBSON\.BANK/);
  assert.match(r.data.esm, /RACF/);
  a.disconnect();
});

test('enumTSQ returns the queue table', async () => {
  const a = await connected();
  const r = await cics.enumTSQ(a, { mask: '*' });
  assert.equal(r.ok, true);
  assert.equal(r.steps[0], 'CEMT INQUIRE TSQUEUE(*)');
  assert.equal(r.data.queues.length, 3);
  const gibson = r.data.queues.find((q) => q.name === 'GIBSON');
  assert.equal(gibson.items, 2);
  assert.equal(gibson.tran, 'CECI');
  a.disconnect();
});

test('readFile flips a closed file then browses it', async () => {
  const a = await connected();
  const r = await cics.readFile(a, { name: 'FILEB' });
  assert.equal(r.ok, true);
  assert.equal(r.data.flipped, true);
  assert.equal(r.data.state, 'OPEN ENA READ');
  assert.equal(r.data.recordCount, 40);
  assert.deepEqual(r.steps, [
    'CEMT INQUIRE FILE(FILEB)',
    'CEMT SET FILE(FILEB) OPEN ENABLE READ',
    "CECI EXEC CICS READ FILE('FILEB')",
  ]);
  a.disconnect();
});

test('readFile on an already-open file skips the SET step', async () => {
  const a = await connected();
  const r = await cics.readFile(a, { name: 'FILEA' });
  assert.equal(r.data.flipped, false);
  assert.deepEqual(r.steps, [
    'CEMT INQUIRE FILE(FILEA)',
    "CECI EXEC CICS READ FILE('FILEA')",
  ]);
  a.disconnect();
});

test('racfBypass copies + installs CSPS and CSPK', async () => {
  const a = await connected();
  const r = await cics.racfBypass(a);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.installed, [
    { from: 'CEMT', to: 'CSPS' },
    { from: 'CECI', to: 'CSPK' },
  ]);
  assert.deepEqual(r.steps, [
    'CEDA COPY TRANSACTION(CEMT) TO(CSPS) GROUP(WEBTSEC)',
    'CEDA INSTALL TRANSACTION(CSPS) GROUP(WEBTSEC)',
    'CEDA COPY TRANSACTION(CECI) TO(CSPK) GROUP(WEBTSEC)',
    'CEDA INSTALL TRANSACTION(CSPK) GROUP(WEBTSEC)',
  ]);
  a.disconnect();
});

test('enableTrans issues CEMT SET TRANSACTION', async () => {
  const a = await connected();
  const r = await cics.enableTrans(a, { id: 'ALL' });
  assert.equal(r.ok, true);
  assert.equal(r.steps[0], 'CEMT SET TRANSACTION(ALL) ENABLED');
  a.disconnect();
});

test('cics.run dispatches by name and reports active flag', async () => {
  assert.equal(cics.PRIMITIVES.racfBypass.active, true);
  assert.equal(cics.PRIMITIVES.enumTSQ.active, false);
  const a = await connected();
  const r = await cics.run('enumTSQ', a, {});
  assert.equal(r.data.queues.length, 3);
  a.disconnect();
});
