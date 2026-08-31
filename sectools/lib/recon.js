'use strict';

/**
 * Recon integration — a thin wrapper over the eZrecon CLI
 * (eZrecon by Kev Milne / Phil Young). We shell out to `ezrecon <cmd> --report`,
 * read the JSON Session it writes, and normalise it to our Finding shape.
 * No eZrecon code is imported; this is arm's length.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cfg = require('../config');
const log = require('./log').child('recon');

// eZrecon fingerprint findings look like "LIKELY MAINFRAME 82% ..." etc.
const MF_PORT_HINT = { 23: 'tn3270', 992: 'tn3270-tls', 3270: 'tn3270', 50000: 'drda', 446: 'drda', 448: 'drda-tls' };

/** Normalise an eZrecon Session JSON into our finding array. */
function parseReport(json) {
  const findings = (json.findings || []).map((f) => ({
    category: f.category || 'misc',
    key: f.key || '',
    value: f.value == null ? '' : String(f.value),
    source: f.source || '',
    severity: (f.severity || 'info').toLowerCase(),
    meta: f.meta && typeof f.meta === 'object' ? f.meta : {},
    ts: typeof f.ts === 'number' ? new Date(f.ts * 1000).toISOString() : undefined,
  }));
  return {
    target: json.target || '',
    startedIso: json.started_iso || null,
    findings,
    queries: json.queries || [],
    notes: json.notes || [],
  };
}

/**
 * Candidate targets worth connecting to, derived from findings.
 * Returns [{ kind, addr, port, hint, provenanceKey, severity }].
 * provenanceKey is the finding's key so the caller can link a real finding id.
 */
function candidatesFrom(findings) {
  const out = [];
  const seen = new Set();
  for (const f of findings) {
    let addr = null; let port = null; let hint = '';

    if (f.category === 'fingerprint') {
      // key is usually the host; value carries the verdict + %
      addr = f.key || f.meta.host || null;
      port = f.meta.port || (Array.isArray(f.meta.reasons) ? null : null) || 23;
      hint = f.value;
    } else if (f.category === 'port' && f.key === 'fingerprint') {
      addr = f.meta.host || null;
      hint = f.value;
      port = 23;
    } else if (f.category === 'port' && MF_PORT_HINT[Number(f.key)]) {
      addr = f.meta.host || null;
      port = Number(f.key);
      hint = `${MF_PORT_HINT[port]} port open`;
    } else if (f.category === 'subdomain' && /\b(tso|cics|ims|mvs|zos|mainframe|vtam|db2|as400)\b/i.test(f.key)) {
      addr = f.key;
      port = 23;
      hint = 'mainframe-looking subdomain';
    }

    if (!addr) continue;
    const id = `${addr}:${port || ''}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      kind: 'lpar',
      addr,
      port: port || 23,
      hint,
      provenanceKey: f.key,
      severity: f.severity,
    });
  }
  return out;
}

/**
 * Run an eZrecon command that produces a report.
 * @param {object} o
 * @param {string[]} o.argv     e.g. ['auto','example.com'] or ['dns','example.com']
 * @param {function} [o.onStage] called with progress strings
 * @returns {Promise<{report, findings, candidates, stdout}>}
 */
function runRecon(o = {}) {
  const argv = o.argv || [];
  const onStage = o.onStage || (() => {});
  const bin = o.ezreconBin || cfg.ezreconBin;
  const timeoutMs = o.timeoutMs || cfg.ezreconTimeoutMs;

  return new Promise((resolve, reject) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sectools-recon-'));
    const args = [...argv, '--report', outDir];
    log.info('spawn', bin, args.join(' '));

    const child = spawn(bin, args, { env: process.env });
    let stdout = '';
    let stderr = '';
    const killer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`ezrecon timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (b) => {
      const s = b.toString();
      stdout += s;
      for (const line of s.split(/\r?\n/)) {
        const m = line.match(/^\s*[·•▶]\s*(.+?)\s*$/);
        if (m) onStage(m[1]);
      }
    });
    child.stderr.on('data', (b) => { stderr += b.toString(); });

    child.on('error', (err) => { clearTimeout(killer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(killer);
      try {
        const jsonFile = fs.readdirSync(outDir)
          .filter((f) => f.endsWith('.json'))
          .sort((a, b) => a.length - b.length)[0];
        if (!jsonFile) {
          return reject(new Error(`ezrecon wrote no JSON report (exit ${code}). ${stderr.slice(0, 400)}`));
        }
        const json = JSON.parse(fs.readFileSync(path.join(outDir, jsonFile), 'utf8'));
        const report = parseReport(json);
        const candidates = candidatesFrom(report.findings);
        fs.rmSync(outDir, { recursive: true, force: true });
        resolve({ report, findings: report.findings, candidates, stdout, exitCode: code });
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * Run any eZrecon command and capture its output (no --report). For the
 * console's `ezrecon <args>` pass-through. argv is passed as an array, never a
 * shell string, so nothing the user types is interpreted by a shell.
 */
function runRaw(argv, o = {}) {
  const bin = o.ezreconBin || cfg.ezreconBin;
  const timeoutMs = o.timeoutMs || cfg.ezreconTimeoutMs;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, argv, { env: process.env });
    let out = '';
    let err = '';
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`ezrecon ${argv.join(' ')} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(t); reject(e); });
    child.on('close', (code) => { clearTimeout(t); resolve({ stdout: out, stderr: err, exit: code }); });
  });
}

module.exports = { runRecon, runRaw, parseReport, candidatesFrom };
