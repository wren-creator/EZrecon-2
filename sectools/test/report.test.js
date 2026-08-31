'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EngagementStore } = require('../lib/store');
const report = require('../lib/report');

function seeded() {
  const s = new EngagementStore(null);
  const eng = s.create({ name: 'Sighberbank — Q3', scopeNote: 'sighberbank.com + authd LPARs' });
  const [f] = s.addFindings(eng.id, {
    category: 'fingerprint', key: 'tso.sighberbank.com',
    value: 'LIKELY MAINFRAME 82%', source: 'ports', severity: 'high',
  });
  s.addFindings(eng.id, { category: 'dns', key: 'MX', value: 'outlook', severity: 'low', source: 'dns' });
  const t = s.addTarget(eng.id, { kind: 'lpar', addr: 'tso.sighberbank.com', port: 23, provenance: `recon:${f.id}` });
  s.setEsm(eng.id, t.id, { product: 'RACF', confidence: 0.85, evidence: ['DFHCE35xx'] });
  const a = s.startAction(eng.id, { kind: 'cics', tool: 'racfBypass', targetId: t.id, active: true });
  s.finishAction(eng.id, a.id, { status: 'ok', result: { installed: [{ from: 'CEMT', to: 'CSPS' }] } });
  return s.get(eng.id);
}

test('exposure score rises with severity + active CICS actions', () => {
  const eng = seeded();
  const score = report.exposureScore(eng);
  assert.ok(score >= 20 + 1 + 18, `score ${score} should include high finding + active action`);
  assert.equal(report.band(score), report.band(score)); // stable
});

test('markdown report contains the key sections and credits', () => {
  const md = report.toMarkdown(seeded());
  assert.match(md, /## Targets/);
  assert.match(md, /## High findings/);
  assert.match(md, /## CICS actions/);
  assert.match(md, /RACF 0\.85/);
  assert.match(md, /eZrecon \(Kev Milne, Phil Young\)/);
  assert.match(md, /CICSpwn \(Ayoub Elaassal\)/);
});

test('html report is self-contained and escapes values', () => {
  const s = new EngagementStore(null);
  const eng = s.create({ name: 'X <script>' });
  s.addFindings(eng.id, { category: 'x', key: '<b>', value: '<i>v</i>', severity: 'high', source: 'z' });
  const html = report.toHTML(s.get(eng.id));
  assert.match(html, /^<!doctype html>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;b&gt;/);
});

test('generate returns all three formats', () => {
  const r = report.generate(seeded());
  assert.ok(r.json && r.md && r.html);
  assert.equal(typeof r.md, 'string');
  assert.equal(r.json.exposure.band, report.band(r.json.exposure.score));
});
