'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseReport, candidatesFrom } = require('../lib/recon');

const raw = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'recon-dns.json'), 'utf8'),
);

test('parseReport normalises an eZrecon Session', () => {
  const r = parseReport(raw);
  assert.equal(r.target, 'example.com');
  assert.ok(r.findings.length > 0);
  for (const f of r.findings) {
    assert.ok(typeof f.category === 'string');
    assert.ok(['info', 'low', 'medium', 'high'].includes(f.severity));
    assert.ok(typeof f.meta === 'object');
  }
});

test('candidatesFrom pulls mainframe-looking hosts', () => {
  const synthetic = [
    { category: 'fingerprint', key: 'tso.acme.com', value: 'LIKELY MAINFRAME 82%', severity: 'high', meta: { port: 23 } },
    { category: 'subdomain', key: 'cics-gw.acme.com', value: '10.0.0.9', severity: 'medium', meta: {} },
    { category: 'subdomain', key: 'www.acme.com', value: '10.0.0.1', severity: 'info', meta: {} },
    { category: 'port', key: '992', value: 'tn3270-tls', severity: 'medium', meta: { host: 'lpar1.acme.com' } },
  ];
  const c = candidatesFrom(synthetic);
  const addrs = c.map((x) => x.addr).sort();
  assert.deepEqual(addrs, ['cics-gw.acme.com', 'lpar1.acme.com', 'tso.acme.com']);
  assert.ok(c.every((x) => x.port && x.kind === 'lpar'));
  assert.ok(!addrs.includes('www.acme.com'));
});
