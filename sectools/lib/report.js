'use strict';

/**
 * Report generator — one Engagement in, { json, md, html } out.
 * The engagement record is the single source; nothing else is consulted.
 */

const { sevRank } = require('./engagement');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function exposureScore(eng) {
  let pts = 0;
  for (const f of eng.findings) pts += [0, 4, 10, 20][sevRank(f.severity)] || 0;
  for (const a of eng.actions) {
    if (a.kind === 'cics' && a.status === 'ok') pts += a.active ? 18 : 8;
  }
  return Math.min(100, pts);
}

function band(score) {
  if (score >= 70) return 'critical';
  if (score >= 40) return 'elevated';
  if (score >= 15) return 'moderate';
  return 'low';
}

function bySeverity(findings) {
  const g = { high: [], medium: [], low: [], info: [] };
  for (const f of findings) (g[f.severity] || g.info).push(f);
  return g;
}

function toJSON(eng) {
  return { ...eng, exposure: { score: exposureScore(eng), band: band(exposureScore(eng)) } };
}

function toMarkdown(eng) {
  const score = exposureScore(eng);
  const g = bySeverity(eng.findings);
  const L = [];
  L.push(`# ${eng.name}`, '');
  L.push(`_${eng.scopeNote}_`, '');
  L.push(`**Exposure:** ${score}/100 (${band(score)})  ·  ` +
    `${eng.targets.length} targets · ${eng.findings.length} findings · ` +
    `${eng.actions.filter((a) => a.kind === 'cics').length} CICS actions`, '');

  L.push('## Targets', '');
  for (const t of eng.targets) {
    const esm = t.esm ? ` · ESM ${t.esm.product} ${t.esm.confidence}` +
      (t.esm.reconcile ? ` (recon: ${t.esm.reconcile})` : '') : '';
    L.push(`- \`${t.addr}${t.port ? ':' + t.port : ''}\` — ${t.kind}${t.applid ? ' · APPLID ' + t.applid : ''}${esm}  _(${t.provenance})_`);
  }
  L.push('');

  for (const sev of ['high', 'medium', 'low']) {
    if (!g[sev].length) continue;
    L.push(`## ${sev[0].toUpperCase() + sev.slice(1)} findings`, '');
    for (const f of g[sev]) L.push(`- **${f.category}/${f.key}** — ${f.value}  _(${f.source})_`);
    L.push('');
  }

  const cicsActions = eng.actions.filter((a) => a.kind === 'cics');
  if (cicsActions.length) {
    L.push('## CICS actions', '');
    for (const a of cicsActions) {
      L.push(`- **${a.tool}** [${a.status}]${a.active ? ' · active' : ''} — ` +
        (a.result ? '`' + JSON.stringify(a.result).slice(0, 300) + '`' : '(no result)'));
    }
    L.push('');
  }

  L.push('## Timeline', '');
  for (const e of eng.timeline) L.push(`- \`${e.ts.slice(11, 19)}\` ${e.text}`);
  L.push('');
  L.push('---', '');
  L.push('_Recon by eZrecon (Kev Milne, Phil Young). CICS technique from CICSpwn ' +
    '(Ayoub Elaassal), reimplemented clean-room. Authorised targets only._');
  return L.join('\n');
}

function toHTML(eng) {
  const score = exposureScore(eng);
  const g = bySeverity(eng.findings);
  const row = (f) => `<tr class="s-${f.severity}"><td>${esc(f.severity)}</td>` +
    `<td>${esc(f.category)}/${esc(f.key)}</td><td>${esc(f.value)}</td><td>${esc(f.source)}</td></tr>`;
  const tgt = (t) => `<li><code>${esc(t.addr)}${t.port ? ':' + t.port : ''}</code> — ${esc(t.kind)}` +
    (t.esm ? ` · <b>ESM ${esc(t.esm.product)}</b> ${esc(t.esm.confidence)}` +
      (t.esm.reconcile ? ` <span class="dim">(recon: ${esc(t.esm.reconcile)})</span>` : '') : '') +
    ` <span class="dim">(${esc(t.provenance)})</span></li>`;
  const act = (a) => `<li><b>${esc(a.tool)}</b> <span class="pill ${a.status}">${esc(a.status)}</span>` +
    (a.active ? ' <span class="pill active">active</span>' : '') +
    (a.result ? ` <code class="r">${esc(JSON.stringify(a.result)).slice(0, 400)}</code>` : '') + '</li>';

  return `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(eng.name)} — engagement report</title>
<style>
  :root{--bg:#0b100d;--fg:#dfe9e2;--dim:#8ba295;--line:#233029;--accent:#4bd583;--amber:#ffb000;--red:#ff6f61}
  @media(prefers-color-scheme:light){:root{--bg:#f4f6f1;--fg:#1b241f;--dim:#5b6a5f;--line:#d7ddce;--accent:#1f8b50;--amber:#8a5c12;--red:#b23a2c}}
  body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 'IBM Plex Sans',system-ui,sans-serif;padding:2.5rem 1.25rem}
  main{max-width:60rem;margin:0 auto}
  h1{font-size:1.7rem;margin:0 0 .3rem} h2{font-size:1.05rem;margin:2rem 0 .6rem;border-top:1px solid var(--line);padding-top:1rem}
  .dim{color:var(--dim)} code{font-family:'IBM Plex Mono',ui-monospace,Menlo,monospace;font-size:.86em}
  .score{font-family:'IBM Plex Mono',monospace;font-size:2rem;font-weight:600;color:var(--accent)}
  .b-critical{color:var(--red)} .b-elevated{color:var(--amber)}
  table{border-collapse:collapse;width:100%;font-size:.85rem} td{border-bottom:1px solid var(--line);padding:.4rem .5rem;vertical-align:top}
  tr.s-high td:first-child{color:var(--red);font-weight:600} tr.s-medium td:first-child{color:var(--amber)}
  ul{padding-left:1.1rem} li{margin:.25rem 0}
  .pill{font-size:.62rem;text-transform:uppercase;letter-spacing:.06em;border:1px solid var(--line);border-radius:2px;padding:.05rem .35rem}
  .pill.ok{color:var(--accent)} .pill.error{color:var(--red)} .pill.active{color:var(--amber)}
  code.r{display:block;color:var(--dim);margin-top:.2rem;white-space:pre-wrap;word-break:break-word}
  footer{margin-top:2.5rem;border-top:1px solid var(--line);padding-top:1rem;color:var(--dim);font-size:.8rem}
</style>
<main>
  <h1>${esc(eng.name)}</h1>
  <p class="dim">${esc(eng.scopeNote)}</p>
  <p><span class="score b-${band(score)}">${score}</span> <span class="dim">/100 exposure · ${band(score)}</span>
     &nbsp;·&nbsp; ${eng.targets.length} targets · ${eng.findings.length} findings ·
     ${eng.actions.filter((a) => a.kind === 'cics').length} CICS actions</p>

  <h2>Targets</h2><ul>${eng.targets.map(tgt).join('') || '<li class="dim">none</li>'}</ul>

  ${['high', 'medium', 'low'].filter((s) => g[s].length).map((s) => `
  <h2>${s[0].toUpperCase() + s.slice(1)} findings</h2>
  <table><tbody>${g[s].map(row).join('')}</tbody></table>`).join('')}

  ${eng.actions.filter((a) => a.kind === 'cics').length ? `
  <h2>CICS actions</h2><ul>${eng.actions.filter((a) => a.kind === 'cics').map(act).join('')}</ul>` : ''}

  <h2>Timeline</h2>
  <ul>${eng.timeline.map((e) => `<li><code>${esc(e.ts.slice(11, 19))}</code> ${esc(e.text)}</li>`).join('')}</ul>

  <footer>Recon by <b>eZrecon</b> (Kev Milne, Phil Young). CICS technique from
    <b>CICSpwn</b> (Ayoub Elaassal, @Ayoul3), reimplemented clean-room in EZrecon-2 SecTools.
    Authorised targets only.</footer>
</main></html>`;
}

function generate(eng) {
  return { json: toJSON(eng), md: toMarkdown(eng), html: toHTML(eng) };
}

module.exports = { generate, toJSON, toMarkdown, toHTML, exposureScore, band };
