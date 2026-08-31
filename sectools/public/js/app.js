'use strict';
/*
 * EZrecon-2 SecTools — client shell.
 * One file for the MVP; splits cleanly into app/engagement/recon/session/cics/evidence
 * modules when this ports into web3270's public/js/.
 */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---- operator identity (X-User-Id on every API call) ------------------
const UKEY = 'sectools-user';
function operator() {
  let u = null;
  try { u = localStorage.getItem(UKEY); } catch (e) {}
  if (!u) {
    u = (window.prompt('Operator id for the audit log (e.g. your username):', '') || '').trim() || 'anonymous';
    try { localStorage.setItem(UKEY, u); } catch (e) {}
  }
  return u;
}
function setOperator() {
  const cur = operator();
  const u = (window.prompt('Operator id:', cur) || '').trim();
  if (u) { try { localStorage.setItem(UKEY, u); } catch (e) {} renderTop(); }
}
const H = () => ({ 'Content-Type': 'application/json', 'X-User-Id': operator() });
const api = (p, opt = {}) => fetch('/api' + p, { ...opt, headers: { ...H(), ...(opt.headers || {}) } }).then((r) => r.json());
const apiPost = (p, body) => api(p, { method: 'POST', body: JSON.stringify(body || {}) });
// audit endpoint is newer than some running servers — never let a non-array break boot
const getAudit = () => api('/audit').then((a) => (Array.isArray(a) ? a : [])).catch(() => []);

const state = { eng: null, view: 'session', sessionId: null, cicsTarget: null, audit: [] };
let ws;

// ---------------------------------------------------------------- boot
(function boot() {
  initTheme();
  initConsole();              // sync, no await — the console is always wired
  // wire navigation + inputs FIRST so a later data error can't disable the tabs
  wireTabs(); wireRecon(); wireSession(); wireRail();
  setView('recon');
  window.addEventListener('error', (e) => cprint('js error: ' + (e.message || e), 'e'));
  window.addEventListener('unhandledrejection', (e) => cprint('promise rejected: ' + ((e.reason && e.reason.message) || e.reason), 'e'));

  (async () => {
    try {
      operator();
      let list = await api('/engagements');
      if (!list.length) {
        await apiPost('/engagements', { name: 'Red Hat Training — ' + new Date().toISOString().slice(0, 10), scopeNote: 'Lab targets only. Passive recon by default.' });
        list = await api('/engagements');
      }
      let want = null;
      try { want = localStorage.getItem('sectools-eng'); } catch (e) {}
      const pick = list.find((x) => x.id === want) || list[0];
      await load(pick.id);
      openWs();
      cprint(`ready — engagement "${state.eng.name}" (${state.eng.id})`, 'k');
      if (list.length > 1) cprint(`  ${list.length} engagements — \`engagement list\` / \`engagement use <id>\` / \`engagement rename <name>\``, 'm');
    } catch (e) {
      cprint('boot failed: ' + (e.message || e) + ' — check the server is running', 'e');
    }
  })();
}());

const ENGKEY = 'sectools-eng';
async function load(id) {
  state.eng = await api('/engagement/' + id);
  try { localStorage.setItem(ENGKEY, id); } catch (e) {}
  state.audit = (await getAudit()).filter((x) => x.engagementId === id);
  renderTop(); renderRail(); renderFindings(); renderCics(); renderEvidence();
}
const reload = () => load(state.eng.id);

// ---------------------------------------------------------------- ws
function openWs() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', engagementId: state.eng.id }));
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'store.change') {
      if (m.kind === 'recon:stage') { $('#reconStage').textContent = '· ' + m.payload; cprint('  ' + m.payload, 's'); return; }
      cprint('» ' + m.kind, 'm');
      reload();
    }
    if (m.type === 'session.screen' && m.sessionId === state.sessionId) $('#crt').textContent = m.text;
    if (m.type === 'session.closed' && m.sessionId === state.sessionId) {
      state.sessionId = null; $('#sessionLive').hidden = true; $('#sessionEmpty').hidden = false;
      cprint('» session closed', 'm');
    }
  };
  ws.onclose = () => setTimeout(openWs, 1500);
}

// ---------------------------------------------------------------- top bar
async function renameEngagement() {
  const name = window.prompt('Engagement name:', state.eng.name);
  if (name == null || !name.trim()) return;
  await apiPost('/engagement/' + state.eng.id + '/rename', { name: name.trim() });
  await reload();
}
function renderTop() {
  const e = state.eng;
  const en = $('#engName');
  en.textContent = e.name;
  en.title = 'click to rename · ' + e.id;
  en.style.cursor = 'pointer';
  en.onclick = renameEngagement;
  $('#scope').textContent = 'Scope · ' + e.scopeNote.slice(0, 44);
  $('#operator').textContent = 'operator: ' + operator();
  const rep = expo(e);
  $('#exposure').textContent = 'exposure ' + rep.score + '/100 · ' + rep.band;
  $('#repHtml').href = '/api/engagement/' + e.id + '/report.html';
  $('#repMd').href = '/api/engagement/' + e.id + '/report.md';
  $('#repJson').href = '/api/engagement/' + e.id + '/report.json';
}
function expo(e) {
  let p = 0;
  for (const f of e.findings) p += { info: 0, low: 4, medium: 10, high: 20 }[f.severity] || 0;
  for (const a of e.actions) if (a.kind === 'cics' && a.status === 'ok') p += a.active ? 18 : 8;
  p = Math.min(100, p);
  return { score: p, band: p >= 70 ? 'critical' : p >= 40 ? 'elevated' : p >= 15 ? 'moderate' : 'low' };
}

// ---------------------------------------------------------------- tabs
function wireTabs() { $$('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view))); }
function setView(v) {
  state.view = v;
  $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === v)));
  $$('.view').forEach((s) => { s.hidden = s.dataset.view !== v; });
}

// ---------------------------------------------------------------- recon
function wireRecon() {
  $('#reconAuto').addEventListener('click', () => runRecon(['auto', $('#reconDomain').value.trim()]));
  $('#reconDns').addEventListener('click', () => runRecon(['dns', $('#reconDomain').value.trim()]));
  $('#reconActive').addEventListener('click', () => runRecon(['ports', $('#reconDomain').value.trim()]));
  $('#reconClear').addEventListener('click', clearRecon);
}
async function clearRecon() {
  const n = state.eng.findings.filter((f) => !String(f.source || '').startsWith('cics:')).length;
  if (!n) { $('#reconStage').textContent = '· nothing to clear'; return; }
  if (!window.confirm(`Clear ${n} recon finding(s)? (targets, CICS results and the audit log stay)`)) return;
  await fetch('/api/engagement/' + state.eng.id + '/findings?scope=recon',
    { method: 'DELETE', headers: { 'X-User-Id': operator() } });
  state._candidates = [];
  $('#reconStage').textContent = '· cleared';
  await reload();
}
function authorisedTargetFor(domain) {
  return (state.eng.targets || []).find((t) => t.addr === domain && t.authorised);
}
async function runRecon(argv) {
  if (!argv[1]) return;
  $('#reconStage').textContent = '· starting…';
  $$('#reconAuto,#reconDns,#reconActive').forEach((b) => { b.disabled = true; });
  try {
    const r = await apiPost('/engagement/' + state.eng.id + '/recon', { argv });
    if (r.error) $('#reconStage').textContent = 'blocked: ' + r.error;
    else { $('#reconStage').textContent = '· done — ' + (r.findings ? r.findings.length : 0) + ' findings'; state._candidates = r.candidates || []; }
    await reload();
  } finally { renderReconButtons(); }
}
function renderReconButtons() {
  const dom = $('#reconDomain').value.trim();
  $$('#reconAuto,#reconDns').forEach((b) => { b.disabled = false; });
  const okT = authorisedTargetFor(dom);
  const ab = $('#reconActive');
  ab.disabled = !okT;
  ab.title = okT ? 'authorised: ' + okT.authorised.approver : 'needs an authorised target for ' + (dom || 'this domain');
}
// Pull a host/IP out of a finding so any FQDN or IP row can become a target.
const IP_RE = /(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)/;
const FQDN_RE = /(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}/i;
const FILE_EXT = /\.(jcl|cob|cbl|asm|rex|js|ts|py|txt|pdf|json|html?|xml|zip|gz|tar|log|md|sh|csv|ya?ml|cfg|ini|bak|old|env|pem|key|crt|png|jpe?g|gif|svg)$/i;
function looksHost(s) {
  if (!s) return null;
  s = String(s).trim().replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '').toLowerCase();
  if (!s) return null;
  const ip = s.match(IP_RE);
  if (ip && ip[0] === s) return { addr: s, port: 23, kind: 'host' };
  const fq = s.match(FQDN_RE);
  if (fq && fq[0] === s && !FILE_EXT.test(s)) return { addr: s, port: 23, kind: 'host' };
  return null;
}
function hostInText(s) {
  const t = String(s || '').replace(/^[a-z]+:\/\//i, '');
  const ip = t.match(IP_RE);
  if (ip) return { addr: ip[0], port: 23, kind: 'host' };
  const fq = t.match(FQDN_RE);
  if (fq && !FILE_EXT.test(fq[0])) return { addr: fq[0].toLowerCase().replace(/\.$/, ''), port: 23, kind: 'host' };
  return null;
}
function hostFromFinding(f) {
  if (f.category === 'port' && f.meta && f.meta.host && /^\d+$/.test(f.key)) {
    return { addr: f.meta.host, port: Number(f.key), kind: 'host' };
  }
  // key first (subdomain / fingerprint findings put the host there), then value
  return looksHost(f.key) || hostInText(f.value);
}
function renderFindings() {
  renderReconButtons();
  const tb = $('#findTable tbody'); tb.innerHTML = '';
  const cands = new Map((state._candidates || []).map((c) => [c.provenanceKey, c]));
  const have = new Set(state.eng.targets.map((t) => t.addr));
  for (const f of state.eng.findings.slice().sort((a, b) => rank(b.severity) - rank(a.severity))) {
    const tr = document.createElement('tr');
    const cand = cands.get(f.key);
    tr.innerHTML = `<td><span class="sev ${f.severity}">${f.severity}</span></td>
      <td>${esc(f.category)}/${esc(f.key)}</td><td>${esc(f.value)}</td><td>${esc(f.source)}</td><td></td>`;
    const host = cand
      ? { kind: cand.kind, addr: cand.addr, port: cand.port }
      : hostFromFinding(f);
    if (host && !have.has(host.addr)) {
      const b = document.createElement('button');
      b.className = cand ? 'send' : 'send subtle';
      b.textContent = cand ? 'Add as target ▸' : '＋ target';
      b.title = `add ${host.addr}:${host.port} to the rail`;
      b.onclick = () => addTarget({
        kind: host.kind, addr: host.addr, port: host.port, label: host.addr,
        provenance: cand && cand.provenance ? cand.provenance : ('recon:' + f.id),
      });
      tr.lastElementChild.appendChild(b);
    }
    tb.appendChild(tr);
  }
}
const rank = (s) => ({ info: 0, low: 1, medium: 2, high: 3 }[s] || 0);

// ---------------------------------------------------------------- targets rail
function wireRail() {
  $('#manualAdd').addEventListener('click', () => {
    const addr = $('#manualAddr').value.trim(); if (!addr) return;
    addTarget({
      kind: 'lpar', addr, port: Number($('#manualPort').value) || 23,
      provenance: 'manual', label: addr, viaBridge: $('#manualBridge').checked,
    });
    $('#manualAddr').value = '';
  });
}
async function addTarget(t) { await apiPost('/engagement/' + state.eng.id + '/targets', t); await reload(); }
async function removeTarget(t) {
  if (!window.confirm('Remove target ' + t.addr + ' from the panel? (findings and audit log stay)')) return;
  await fetch('/api/engagement/' + state.eng.id + '/target/' + t.id, { method: 'DELETE', headers: { 'X-User-Id': operator() } });
  if (state.cicsTarget === t.id) state.cicsTarget = null;
  if (state.sessionId && state.eng.targets.find((x) => x.id === t.id && x.sessionRef === state.sessionId)) state.sessionId = null;
  await reload();
}

async function authorise(t) {
  const scope = window.prompt('Authorisation scope for ' + t.addr + ' (what are you cleared to test?):', state.eng.scopeNote);
  if (scope == null) return;
  const approver = (window.prompt('Approver (who signed off? defaults to operator):', operator()) || operator()).trim();
  const r = await apiPost('/engagement/' + state.eng.id + '/target/' + t.id + '/authorise', { scope, approver });
  if (r.error) alert(r.error);
  await reload();
}
async function revoke(t) {
  if (!confirm('Revoke authorisation for ' + t.addr + '?')) return;
  await apiPost('/engagement/' + state.eng.id + '/target/' + t.id + '/revoke', {});
  await reload();
}

function renderRail() {
  const box = $('#targets'); box.innerHTML = '';
  $('#tgtCount').textContent = state.eng.targets.length;
  for (const t of state.eng.targets) {
    const d = document.createElement('div'); d.className = 'tgt' + (t.authorised ? ' authd' : '');
    const esm = t.esm ? `ESM ${t.esm.product} ${t.esm.confidence}${t.esm.reconcile ? ' ✓recon' : ''}` : (t.sessionRef ? 'connected' : 'not connected');
    d.innerHTML = `<span class="prov">${esc(t.provenance)}</span>${t.viaBridge ? `<span class="prov bridge">via bridge${t.bridgeWsId != null ? ' · ws ' + esc(t.bridgeWsId) : ''}</span>` : ''}
      <div class="addr">${esc(t.addr)}${t.port ? ':' + t.port : ''}</div>
      <div class="meta">${esc(esm)}</div>
      ${t.viaBridge && t.bridgeWsId != null ? `<div class="meta bridgehint">web3270 session <b>${esc(t.bridgeWsId)}</b> — open its Session Viewer / Proxy Viewer and filter to this session; Traffic Recorder is auto-started.</div>` : ''}
      <div class="authline"></div>
      <div class="acts"></div>`;
    const authline = d.querySelector('.authline');
    if (t.authorised) {
      authline.innerHTML = `<span class="authok">✓ authorised · ${esc(t.authorised.approver)}</span>`;
      authline.appendChild(mkBtn('revoke', 'link', () => revoke(t)));
    } else {
      authline.innerHTML = '<span class="authno">passive only — not authorised for active/CICS</span>';
    }
    const acts = d.querySelector('.acts');
    acts.appendChild(mkBtn('Connect', 'btn pri', () => connect(t)));
    acts.appendChild(mkBtn('Assess CICS', 'btn', () => { state.cicsTarget = t.id; renderCics(); setView('cics'); }));
    acts.appendChild(mkBtn(t.authorised ? 'Re-authorise' : 'Authorise', 'btn act', () => authorise(t)));
    acts.appendChild(mkBtn('Remove', 'link rm', () => removeTarget(t)));
    box.appendChild(d);
  }
}
function mkBtn(label, cls, fn) { const b = document.createElement('button'); b.className = cls; b.textContent = label; b.onclick = fn; return b; }

// ---------------------------------------------------------------- session
function wireSession() {
  $$('[data-aid]').forEach((b) => b.addEventListener('click', () => sendAid(b.dataset.aid)));
  $('#cmdLine').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendAid('ENTER'); });
  $('#sessDisc').addEventListener('click', () => { if (state.sessionId) ws.send(JSON.stringify({ type: 'session.disconnect', sessionId: state.sessionId })); });
}
async function connect(t) {
  const r = await apiPost('/engagement/' + state.eng.id + '/target/' + t.id + '/connect', {});
  if (r.error) return alert(r.error);
  state.sessionId = r.sessionId;
  $('#sessionEmpty').hidden = true; $('#sessionLive').hidden = false;
  ws.send(JSON.stringify({ type: 'session.attach', sessionId: r.sessionId }));
  setView('session'); reload();
}
function sendAid(key) {
  if (!state.sessionId) return;
  const line = $('#cmdLine').value;
  ws.send(JSON.stringify({ type: 'session.aid', sessionId: state.sessionId, key, fields: line ? [{ row: 0, col: 0, text: line }] : [] }));
  $('#cmdLine').value = '';
}

// ---------------------------------------------------------------- cics
const PRIMS = [
  { id: 'infoGather', nm: 'Information gathering (-i)', ds: 'Reachable txns, z/OS + CICS levels, sysid, HLQs, users, spool, ESM.', active: false },
  { id: 'enumTSQ', nm: 'Enumerate TS queues (-e)', ds: 'CEMT INQUIRE TSQUEUE — depth and owning transaction.', active: false },
  { id: 'readFile', nm: 'Read a VSAM file (--get-file)', ds: 'Open + enable + browse a file, flipping attributes if needed.', active: true, arg: 'name', ph: 'FILEB' },
  { id: 'racfBypass', nm: 'RACF bypass via CEDA', ds: 'Copy CEMT→CSPS and CECI→CSPK into a group, then INSTALL.', active: true },
  { id: 'enableTrans', nm: 'Enable transactions', ds: 'CEMT SET TRANSACTION(id) ENABLED.', active: true, arg: 'id', ph: 'ALL' },
];
function renderCics() {
  const t = state.eng && state.eng.targets.find((x) => x.id === state.cicsTarget);
  $('#cicsNoTarget').hidden = !!t;
  $('#cicsPanel').hidden = !t;
  if (!t) return;
  $('#cicsCtx').textContent = `Target ${t.addr}:${t.port || 23}  ·  APPLID ${t.applid || 'CICS'}  ·  `
    + (t.viaBridge ? 'via web3270 bridge  ·  ' : '')
    + (t.authorised ? `authorised by ${t.authorised.approver}` : 'NOT authorised — active primitives disabled');
  $('#cicsCtx').className = 'ctx mono' + (t.authorised ? '' : ' warn');
  const box = $('#cicsPrims'); box.innerHTML = '';
  for (const p of PRIMS) {
    const d = document.createElement('div'); d.className = 'prim' + (p.active ? ' act' : '');
    d.innerHTML = `<div class="nm">${p.nm}${p.active ? '<span class="badge">active</span>' : ''}</div><div class="ds">${p.ds}</div>`;
    const bar = document.createElement('div'); bar.className = 'bar'; bar.style.margin = '0';
    let input;
    if (p.arg) { input = document.createElement('input'); input.type = 'text'; input.placeholder = p.ph; input.value = p.ph; bar.appendChild(input); }
    const btn = mkBtn('Run', p.active ? 'btn act' : 'btn pri', () => runPrim(t, p, input));
    if (p.active && !t.authorised) { btn.disabled = true; btn.title = 'authorise this target first'; }
    bar.appendChild(btn);
    if (p.active && !t.authorised) { const h = document.createElement('span'); h.className = 'hint'; h.textContent = 'authorise target →'; bar.appendChild(h); }
    d.appendChild(bar); box.appendChild(d);
  }
}
async function runPrim(t, p, input) {
  const opts = {};
  if (p.arg && input) opts[p.arg] = input.value.trim();
  $('#cicsOut').textContent = 'running ' + p.id + '…';
  const r = await apiPost('/engagement/' + state.eng.id + '/target/' + t.id + '/cics', { primitive: p.id, opts });
  if (r.error) { $('#cicsOut').textContent = 'blocked: ' + r.error; return; }
  const res = r.result;
  $('#cicsOut').textContent = `${p.id} — ${res.ok ? 'OK' : 'no result'}\n\nsteps:\n  ${(res.steps || []).join('\n  ')}\n\ndata:\n${JSON.stringify(res.data, null, 2)}`;
  reload();
}

// ---------------------------------------------------------------- evidence
function renderEvidence() {
  const e = state.eng;
  $('#timeline').innerHTML = e.timeline.map((x) => `<li><code>${x.ts.slice(11, 19)}</code> ${esc(x.text)}</li>`).join('');
  $('#counts').innerHTML = [
    ['Targets', e.targets.length], ['Findings', e.findings.length],
    ['Actions', e.actions.length], ['Recordings', e.recordings.length],
    ['CICS actions', e.actions.filter((a) => a.kind === 'cics').length],
    ['Audit lines', state.audit.length],
  ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  $('#auditLog').innerHTML = state.audit.slice().reverse().map((a) =>
    `<li><code>${a.ts.slice(11, 19)}</code> <b>${esc(a.event)}</b> user=<b>${esc(a.userId)}</b> target=<code>${esc(a.target || '-')}</code>` +
    (a.detail && a.detail.primitive ? ` <span class="dim">${esc(a.detail.primitive)}</span>` : '') +
    (a.detail && a.detail.approver ? ` <span class="dim">appr:${esc(a.detail.approver)}</span>` : '') + '</li>').join('')
    || '<li class="dim">no audit entries yet</li>';
}

// ---------------------------------------------------------------- theme
function initTheme() {
  const KEY = 'sectools-theme';
  try { const s = localStorage.getItem(KEY); if (s) document.documentElement.dataset.theme = s; } catch (e) {}
  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const nx = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = nx;
    try { localStorage.setItem(KEY, nx); } catch (e) {}
  });
  $('#operator').addEventListener('click', setOperator);
}

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ---------------------------------------------------------------- console drawer
// A command console over the same audited API. NOT a system shell.
const conHist = []; let conHi = 0; let lastAuditLen = 0;

function cprint(text, cls) {
  const out = $('#conOut'); if (!out) return;
  const span = document.createElement('span');
  span.className = cls || '';
  span.textContent = (text == null ? '' : String(text)) + '\n';
  out.appendChild(span);
  out.scrollTop = out.scrollHeight;
}

function initConsole() {
  const KEY = 'sectools-console-open';
  const box = $('#console'); const tog = $('#conToggle'); const inp = $('#conIn');
  let open = true;
  try { open = localStorage.getItem(KEY) !== '0'; } catch (e) {}
  const apply = () => { box.classList.toggle('collapsed', !open); tog.textContent = (open ? '▾' : '▸') + ' console'; tog.setAttribute('aria-expanded', String(open)); };
  apply();
  tog.addEventListener('click', () => { open = !open; try { localStorage.setItem(KEY, open ? '1' : '0'); } catch (e) {} apply(); if (open) inp.focus(); });
  // click anywhere in the drawer focuses the input
  box.addEventListener('click', (e) => { if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'A') inp.focus(); });

  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const v = inp.value.trim(); inp.value = ''; if (v) { conHist.push(v); conHi = conHist.length; cprint('sectools$ ' + v); runConsole(v); } }
    else if (e.key === 'ArrowUp') { if (conHi > 0) { conHi--; inp.value = conHist[conHi] || ''; e.preventDefault(); } }
    else if (e.key === 'ArrowDown') { if (conHi < conHist.length) { conHi++; inp.value = conHist[conHi] || ''; e.preventDefault(); } }
  });

  cprint('EZrecon-2 SecTools console — type `help` and press Enter. Operator: ' + operator(), 'm');
  if (open) setTimeout(() => inp.focus(), 0);
  // tail new audit lines into the console
  setInterval(async () => {
    const a = await getAudit();
    if (a.length > lastAuditLen) {
      for (const x of a.slice(lastAuditLen)) {
        cprint(`  audit ${x.event} user=${x.userId} target=${x.target || '-'}` + (x.detail && x.detail.primitive ? ` ${x.detail.primitive}` : ''), x.event === 'denied' ? 'e' : 'k');
      }
    }
    lastAuditLen = a.length;
  }, 2500);
}

function findTarget(s) {
  if (!s || !state.eng) return null;
  return state.eng.targets.find((t) => t.id === s || t.addr === s || `${t.addr}:${t.port}` === s);
}
function kv(args) { // parse  name=FILEB  --approver X  --scope "a b"
  const o = {};
  const joined = args.join(' ');
  const re = /(?:--?([a-z]+)\s+"([^"]*)"|--?([a-z]+)\s+(\S+)|([a-z]+)=(\S+))/gi;
  let m;
  while ((m = re.exec(joined))) {
    if (m[1]) o[m[1]] = m[2];
    else if (m[3]) o[m[3]] = m[4];
    else if (m[5]) o[m[5]] = m[6];
  }
  return o;
}

async function runConsole(line) {
  const [cmd, ...rest] = line.split(/\s+/);
  const eid = state.eng && state.eng.id;
  try {
    switch ((cmd || '').toLowerCase()) {
      case 'help':
        cprint([
          'commands (all routed through the audited API):',
          '  ezrecon <subcommand> [args…]        run any eZrecon command, output here, logged',
          '  engagement list|new <name>|use <id>|rename <name>|delete <id>',
          '  recon auto|dns|active <domain>      eZrecon into the engagement (folds findings in)',
          '  targets                             list targets',
          '  target add <addr> [port] [--bridge] | target rm <addr|id> | target clear',
          '  authorise <addr|id> --approver X --scope "…"   grant active/CICS authorisation',
          '  revoke <addr|id>',
          '  connect <addr|id>                   open a live 3270 session',
          '  cics <primitive> <addr|id> [name=FILEB|id=ALL]   infoGather|enumTSQ|readFile|racfBypass|enableTrans',
          '  audit [n]                           last n audit lines (default 10)',
          '  report [md|json|html]               open the report in a new tab',
          '  whoami | operator <id> | clear | tab <recon|session|cics|evidence>',
        ].join('\n'), 'm');
        break;
      case 'clear': $('#conOut').innerHTML = ''; break;
      case 'whoami': cprint(operator()); break;
      case 'ezrecon': case 'ezrecon2': case 'ez': {
        if (!rest.length) { cprint('  usage: ezrecon <subcommand> [args…]   e.g. ezrecon dns example.com', 'e'); break; }
        cprint('  $ ezrecon ' + rest.join(' ') + ' …', 'm');
        const r = await apiPost('/ez', { argv: rest, engagementId: eid });
        if (r.error) { cprint('  ' + r.error, 'e'); break; }
        const text = String(r.stdout || '').replace(/\x1b\[[0-9;]*m/g, '').replace(/\s+$/, '');
        if (text) for (const l of text.split('\n')) cprint('  ' + l);
        if (r.stderr && r.stderr.trim()) cprint('  [stderr] ' + r.stderr.trim().slice(0, 800), 'e');
        cprint(`  (exit ${r.exit}, ${r.ms}ms) — logged`, r.exit === 0 ? 'k' : 'e');
        break;
      }
      case 'engagement': case 'eng': {
        const s2 = (rest[0] || '').toLowerCase();
        if (s2 === 'list' || !s2) {
          const l = await api('/engagements');
          for (const x of l) cprint(`  ${x.id === eid ? '*' : ' '} ${x.id}  ${JSON.stringify(x.name)}  tgt=${x.counts.targets} fnd=${x.counts.findings}`);
        } else if (s2 === 'rename') {
          const nm = rest.slice(1).join(' ').trim(); if (!nm) { cprint('  usage: engagement rename <name>', 'e'); break; }
          await apiPost('/engagement/' + eid + '/rename', { name: nm }); cprint('  renamed → ' + nm, 'k'); reload();
        } else if (s2 === 'new') {
          const nm = rest.slice(1).join(' ').trim() || 'Engagement ' + new Date().toISOString().slice(0, 10);
          const e2 = await apiPost('/engagements', { name: nm, scopeNote: state.eng.scopeNote });
          await load(e2.id); cprint('  created + switched → ' + nm + ' (' + e2.id + ')', 'k');
        } else if (s2 === 'use') {
          if (!rest[1]) { cprint('  usage: engagement use <id>', 'e'); break; }
          await load(rest[1]); cprint('  switched → ' + state.eng.name, 'k');
        } else if (s2 === 'delete') {
          const did = rest[1]; if (!did) { cprint('  usage: engagement delete <id>', 'e'); break; }
          await fetch('/api/engagement/' + did, { method: 'DELETE', headers: { 'X-User-Id': operator() } });
          cprint('  deleted ' + did, 'k');
          if (did === eid) { const l = await api('/engagements'); if (l[0]) await load(l[0].id); }
        } else cprint('  engagement list|new <name>|use <id>|rename <name>|delete <id>', 'e');
        break;
      }
      case 'operator': if (rest[0]) { try { localStorage.setItem('sectools-user', rest[0]); } catch (e) {} renderTop(); cprint('operator → ' + rest[0], 'k'); } break;
      case 'tab': if (rest[0]) setView(rest[0]); break;
      case 'targets':
        if (!state.eng.targets.length) { cprint('  (none)'); break; }
        for (const t of state.eng.targets) cprint(`  ${t.id}  ${t.addr}:${t.port || 23}  ${t.authorised ? 'AUTHORISED(' + t.authorised.approver + ')' : 'passive'}${t.sessionRef ? '  live' : ''}`);
        break;
      case 'target': {
        const s3 = (rest[0] || '').toLowerCase();
        if (s3 === 'add' && rest[1]) {
          const viaBridge = rest.includes('--bridge');
          const portArg = rest.slice(2).find((x) => /^\d+$/.test(x));
          await addTarget({ kind: 'lpar', addr: rest[1], port: Number(portArg) || 23, provenance: 'console', label: rest[1], viaBridge });
          cprint('  added ' + rest[1] + (viaBridge ? ' (via web3270 bridge)' : ''), 'k');
        } else if ((s3 === 'rm' || s3 === 'remove' || s3 === 'del' || s3 === 'delete') && rest[1]) {
          const t = findTarget(rest[1]); if (!t) { cprint('  no such target: ' + rest[1], 'e'); break; }
          await fetch('/api/engagement/' + eid + '/target/' + t.id, { method: 'DELETE', headers: { 'X-User-Id': operator() } });
          if (state.cicsTarget === t.id) state.cicsTarget = null;
          cprint('  removed ' + t.addr, 'k'); reload();
        } else if (s3 === 'clear') {
          const n = state.eng.targets.length;
          for (const t of [...state.eng.targets]) {
            await fetch('/api/engagement/' + eid + '/target/' + t.id, { method: 'DELETE', headers: { 'X-User-Id': operator() } });
          }
          state.cicsTarget = null;
          cprint('  removed ' + n + ' target(s)', 'k'); reload();
        } else {
          cprint('  usage: target add <addr> [port] | target rm <addr|id> | target clear', 'e');
        }
        break;
      }
      case 'recon': {
        const sub = rest[0]; const dom = rest[1];
        if (!dom) { cprint('  usage: recon auto|dns|active <domain>', 'e'); break; }
        const argv = sub === 'active' ? ['ports', dom] : [sub || 'auto', dom];
        cprint('  running ezrecon ' + argv.join(' ') + ' …', 's');
        const r = await apiPost('/engagement/' + eid + '/recon', { argv });
        if (r.error) cprint('  ' + r.error, 'e');
        else cprint(`  ${r.findings.length} findings, ${(r.candidates || []).length} candidate target(s)`, 'k');
        reload();
        break;
      }
      case 'authorise': {
        const t = findTarget(rest[0]); if (!t) { cprint('  no such target: ' + rest[0], 'e'); break; }
        const o = kv(rest.slice(1));
        const r = await apiPost('/engagement/' + eid + '/target/' + t.id + '/authorise', { approver: o.approver || operator(), scope: o.scope || state.eng.scopeNote });
        cprint(r.error ? '  ' + r.error : `  authorised ${t.addr} (approver ${r.authorised.approver})`, r.error ? 'e' : 'k');
        reload();
        break;
      }
      case 'revoke': {
        const t = findTarget(rest[0]); if (!t) { cprint('  no such target', 'e'); break; }
        await apiPost('/engagement/' + eid + '/target/' + t.id + '/revoke', {});
        cprint('  revoked ' + t.addr, 'k'); reload();
        break;
      }
      case 'connect': {
        const t = findTarget(rest[0]); if (!t) { cprint('  no such target', 'e'); break; }
        const r = await apiPost('/engagement/' + eid + '/target/' + t.id + '/connect', {});
        if (r.error) { cprint('  ' + r.error, 'e'); break; }
        state.sessionId = r.sessionId; $('#sessionEmpty').hidden = true; $('#sessionLive').hidden = false;
        ws.send(JSON.stringify({ type: 'session.attach', sessionId: r.sessionId }));
        cprint('  session ' + r.sessionId + ' → Session tab', 'k'); setView('session'); reload();
        break;
      }
      case 'cics': {
        const prim = rest[0]; const t = findTarget(rest[1]);
        if (!prim || !t) { cprint('  usage: cics <primitive> <addr|id> [name=FILEB|id=ALL]', 'e'); break; }
        const r = await apiPost('/engagement/' + eid + '/target/' + t.id + '/cics', { primitive: prim, opts: kv(rest.slice(2)) });
        if (r.error) { cprint('  ' + r.error, 'e'); break; }
        cprint('  ' + prim + (r.result.ok ? ' OK' : ' (no result)') + '  steps: ' + (r.result.steps || []).join(' ; '), 'k');
        cprint('  ' + JSON.stringify(r.result.data), 's');
        reload();
        break;
      }
      case 'audit': {
        const n = Number(rest[0]) || 10;
        const a = (await getAudit()).filter((x) => x.engagementId === eid).slice(-n);
        for (const x of a) cprint(`  ${x.ts.slice(11, 19)} ${x.event} user=${x.userId} target=${x.target || '-'}`, x.event === 'denied' ? 'e' : 'k');
        break;
      }
      case 'report': {
        const f = (rest[0] || 'html').toLowerCase();
        window.open('/api/engagement/' + eid + '/report.' + f, '_blank');
        break;
      }
      default:
        cprint('  unknown command: ' + cmd + '  (type `help`; this is not a system shell)', 'e');
    }
  } catch (e) {
    cprint('  error: ' + (e.message || e), 'e');
  }
}
