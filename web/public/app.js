// ProofRun UI. Six shallow screens, hash-routed, no framework and no build step.
// Every number rendered here comes from the API; nothing is computed in the
// browser except formatting.

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');

const state = { meta: null, prospects: [], activeRun: null, es: null };

const api = async (path, opts) => {
  const res = await fetch(path, opts);
  const json = await res.json().catch(() => ({ ok: false, error: `${res.status} ${res.statusText}` }));
  if (!json.ok) throw new Error(json.error || 'request failed');
  return json;
};

function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5200);
}

// --------------------------------------------------------------------------
// Small renderers
// --------------------------------------------------------------------------

const statusPill = (status) => {
  const map = {
    discovered: 'plain', audited: 'plain', redesigned: 'accent',
    drafted: 'warn', approved: 'pass', rejected: 'skip', failed: 'fail',
  };
  return `<span class="pill ${map[status] || 'plain'}"><i></i>${esc(status)}</span>`;
};

const checkPill = (s) => `<span class="pill ${s === 'pass' ? 'pass' : s === 'fail' ? 'fail' : 'skip'}"><i></i>${s}</span>`;

const deltaEl = (n) => {
  if (n === null || n === undefined) return '<span class="delta flat">n/a</span>';
  const cls = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
  return `<span class="delta ${cls}">${n > 0 ? '+' : ''}${n}</span>`;
};

/** A figure: the number loud, its limit always beside it. */
const figure = (n, label, limit, { hero = false, color = null } = {}) => `
  <div class="figure">
    <div class="label">${esc(label)}</div>
    <div class="n${hero ? ' hero' : ''}"${color ? ` style="color:${color}"` : ''}>${n}</div>
    ${limit ? `<div class="limit">${esc(limit)}</div>` : ''}
  </div>`;

const checkRow = (c, compare = null) => `
  <div class="check">
    <div>${checkPill(c.status)}${compare ? `<div class="check-compare">${checkPill(compare.before)}<span class="arrow">&rarr;</span>${checkPill(compare.after)}</div>` : ''}</div>
    <div>
      <div class="title">${esc(c.title)}${c.gate ? ' <span class="pill accent"><i></i>gate</span>' : ''}${c.automated === false ? ' <span class="pill skip"><i></i>not automated</span>' : ''}</div>
      <div class="ev">${esc(c.evidence)}</div>
      <div class="lim">Limit: ${esc(c.limit)}</div>
    </div>
  </div>`;

/** Minimal markdown: enough for memory files written by this app. */
function md(src) {
  const lines = String(src || '').split('\n');
  let html = '';
  let inCode = false;
  let inList = false;
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" rel="noopener">$1</a>');

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^```/.test(line)) {
      if (inList) { html += '</ul>'; inList = false; }
      html += inCode ? '</code></pre>' : '<pre><code>';
      inCode = !inCode;
      continue;
    }
    if (inCode) { html += `${esc(raw)}\n`; continue; }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(li[1])}</li>`;
      continue;
    }
    if (inList) { html += '</ul>'; inList = false; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; continue; }
    if (/^---+$/.test(line)) { html += '<hr>'; continue; }
    if (!line.trim()) continue;
    html += `<p>${inline(line)}</p>`;
  }
  if (inList) html += '</ul>';
  if (inCode) html += '</code></pre>';
  return html;
}

// The trust strip. Shown on the hero screen and the brief, because these are
// claims the UI has to keep making.
const trustStrip = () => {
  const s = state.meta?.sandbox;
  return `
  <div class="trust">
    <div>
      <div class="t"><span class="pill pass"><i></i>gate</span> Nothing is ever sent</div>
      <div class="d">ProofRun has no send transport. Approved drafts are exported to a file for you. <code>agent/send-adapter.js</code> throws if called.</div>
    </div>
    <div>
      <div class="t"><span class="pill accent"><i></i>cited</span> Confidence on every finding</div>
      <div class="d">Each audit finding names its evidence source and why its confidence is not higher. Inferred findings cannot claim high confidence; the schema rejects it.</div>
    </div>
    <div>
      <div class="t"><span class="pill warn"><i></i>logged</span> Full audit trail</div>
      <div class="d">Every model call, retry and blocked request is recorded, including the attempts that failed.</div>
    </div>
    <div>
      <div class="t"><span class="pill fail"><i></i>open</span> Verification fails open</div>
      <div class="d">If the rebuild still fails checks at the retry cap, the run is reported as failed and no draft is written. There is no fake pass.</div>
    </div>
    <div>
      <div class="t"><span class="pill plain"><i></i>sandbox</span> Generated code is contained</div>
      <div class="d">${esc((s?.layers || []).join('. '))}</div>
    </div>
  </div>`;
};

// --------------------------------------------------------------------------
// Screen: Morning Brief
// --------------------------------------------------------------------------

async function screenBrief() {
  view.innerHTML = `<div class="empty"><div class="big">Writing the brief…</div><div class="small">The numbers are counted from disk; the model only narrates them.</div></div>`;
  let brief;
  try {
    ({ brief } = await api('/api/brief'));
  } catch (err) {
    view.innerHTML = `
      <div class="screen-head"><h1>Morning Brief</h1></div>
      <div class="banner fail"><div><b>Could not write the brief.</b><br>${esc(err.message)}</div></div>`;
    return;
  }

  const s = brief.stats;
  view.innerHTML = `
    <div class="screen-head">
      <h1>Morning Brief</h1>
      <div class="note">${esc(brief.date)} · generated ${esc(brief.generated_at.slice(11, 16))} UTC · ${esc(state.meta.routing.find((r) => r.role === 'brief')?.model || '')}</div>
    </div>

    <p class="voice">You were asleep. It kept working, and it wrote down what it got wrong.</p>

    <div class="grid three">
      <div class="card">${figure(s.awaiting_approval, 'awaiting your decision', 'Drafts written and verified. None sent.', { color: s.awaiting_approval ? 'var(--warn)' : null })}</div>
      <div class="card">${figure(s.passed_verification, 'passed verification', `of ${s.passed_verification + s.failed_verification} rebuilt. ${s.failed_verification} failed and were not pitched.`, { color: 'var(--pass)' })}</div>
      <div class="card">${figure(s.learnings_total, 'learnings in memory', 'Rules the next draft will read before writing.')}</div>
    </div>

    <h2 class="sec">What ran</h2>
    <div class="card"><div class="md">${md(brief.what_ran)}</div></div>

    <h2 class="sec">What needs you</h2>
    <div class="card"><div class="md">${md(brief.needs_you)}</div></div>

    <h2 class="sec">What it learned</h2>
    <div class="card"><div class="md">${md(brief.what_i_learned)}</div></div>

    <h2 class="sec">Counted from disk, not narrated</h2>
    <div class="card flush">
      <table>
        <thead><tr><th>Business</th><th>Status</th><th class="num">Before</th><th class="num">After</th><th>Verification</th><th class="num">Repairs</th></tr></thead>
        <tbody>${brief.prospects.map((p) => `
          <tr>
            <td>${esc(p.business)}</td>
            <td>${statusPill(p.status)}</td>
            <td class="num">${p.before ?? '—'}</td>
            <td class="num">${p.after ?? '—'}</td>
            <td>${p.verification ? `<span class="pill ${p.verification === 'passed' ? 'pass' : 'fail'}"><i></i>${esc(p.verification)}</span>` : '<span class="muted">—</span>'}</td>
            <td class="num">${p.repair_attempts ?? '—'}</td>
          </tr>`).join('') || '<tr><td colspan="6" class="muted">Nothing has run yet. Press Run now.</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="small muted" style="margin-top:8px">Scores are percentages of weighted automated checks at two viewports. Before and after are not always scored over the same check set; the Proof screen shows the comparable basis.</div>

    <h2 class="sec">Trust mechanisms</h2>
    ${trustStrip()}
    <div class="row" style="margin-top:14px">
      <button class="sm" id="refresh-brief">Rewrite the brief</button>
      <button class="sm" id="export">Export approved drafts</button>
    </div>`;

  $('#refresh-brief').onclick = async (e) => {
    e.target.disabled = true;
    try { await api('/api/brief?refresh=1'); await screenBrief(); } catch (err) { toast(err.message, 'bad'); e.target.disabled = false; }
  };
  $('#export').onclick = async (e) => {
    e.target.disabled = true;
    try {
      const out = await api('/api/export', { method: 'POST' });
      toast(`${out.count} approved draft(s) written to ${out.files[1]}. Nothing was sent.`, 'good');
    } catch (err) { toast(err.message, 'bad'); }
    e.target.disabled = false;
  };
}

// --------------------------------------------------------------------------
// Screen: Queue
// --------------------------------------------------------------------------

async function screenQueue() {
  const { prospects, statuses } = await api('/api/prospects');
  state.prospects = prospects;

  const counts = statuses.map((s) => ({ s, n: prospects.filter((p) => p.status === s).length }));

  view.innerHTML = `
    <div class="screen-head">
      <h1>Queue</h1>
      <div class="note">${prospects.length} prospect(s) · file-backed in <span class="mono">memory/prospects/</span></div>
    </div>

    <p class="voice">Every row here is a business that has no idea it was audited. Nothing leaves this machine.</p>

    <div class="row" style="margin-bottom:16px">
      ${counts.filter((c) => c.n).map((c) => `<span class="pill plain"><i></i>${esc(c.s)} ${c.n}</span>`).join('')}
    </div>

    <div class="card flush">
      <table>
        <thead>
          <tr>
            <th>Business</th><th>Status</th>
            <th class="num">Before</th><th class="num">After</th><th class="num">Δ</th>
            <th class="num">Findings</th><th class="num">Repairs</th><th>Updated</th>
          </tr>
        </thead>
        <tbody>
          ${prospects.map((p) => {
    const delta = p.scores?.before && p.scores?.after ? p.scores.after.score - p.scores.before.score : null;
    return `
            <tr class="clickable" data-id="${esc(p.id)}">
              <td>
                <div style="font-weight:550">${esc(p.business_name || p.id)}${p.demo ? ' <span class="pill plain"><i></i>demo</span>' : ''}</div>
                <div class="small muted mono">${esc(p.url)}</div>
              </td>
              <td>${statusPill(p.status)}${p.verification && p.verification.outcome !== 'passed' ? `<div class="small" style="color:var(--fail);margin-top:3px">${esc(p.verification.outcome)}</div>` : ''}</td>
              <td class="num">${p.scores?.before?.score ?? '—'}</td>
              <td class="num">${p.scores?.after?.score ?? '—'}</td>
              <td class="num">${deltaEl(delta)}</td>
              <td class="num">${p.findings || '—'}${p.high_severity ? `<div class="small" style="color:var(--fail)">${p.high_severity} high</div>` : ''}</td>
              <td class="num">${p.verification ? `${p.verification.attempts}/${p.verification.cap}` : '—'}</td>
              <td class="small muted nowrap">${esc((p.updated_at || '').slice(0, 10))}</td>
            </tr>`;
  }).join('') || '<tr><td colspan="8"><div class="empty"><div class="big">The queue is empty.</div><div class="small">Press Run now to audit and rebuild one site.</div></div></td></tr>'}
        </tbody>
      </table>
    </div>`;

  for (const tr of view.querySelectorAll('tr.clickable')) {
    tr.onclick = () => { location.hash = `#/proof?p=${tr.dataset.id}`; };
  }
}

// --------------------------------------------------------------------------
// Screen: Live Run
// --------------------------------------------------------------------------

function renderRunShell(runId) {
  const steps = state.meta.steps;
  view.innerHTML = `
    <div class="screen-head">
      <h1>Live Run</h1>
      <div class="note" id="run-note">${runId ? `run <span class="mono">${esc(runId)}</span>` : 'no run selected'}</div>
    </div>

    <p class="voice">Watch it fail a test, then fix what it broke. That part is not staged.</p>

    <div class="steps" id="steps">
      ${steps.map((s) => `<span class="st" data-step="${esc(s)}">${esc(s.replace(/_/g, ' '))}</span>`).join('')}
    </div>

    <div class="grid two" id="run-figures"></div>

    <h2 class="sec">Tool calls, model calls and retries</h2>
    <div class="feed" id="feed"></div>

    <div class="row" style="margin-top:14px">
      <button class="sm" id="to-proof" disabled>Open the proof</button>
      <div class="small muted" id="run-state">connecting…</div>
    </div>`;
}

function feedLine(e) {
  const feed = $('#feed');
  if (!feed) return;
  const el = document.createElement('div');

  if (e.type === 'step') {
    el.className = 'ln step-line';
    el.innerHTML = `<span class="lv">${esc(e.status)}</span><span class="msg">${esc(e.step.replace(/_/g, ' ').toUpperCase())}${e.detail ? ` — ${esc(e.detail)}` : ''}</span>`;
    const chip = $(`#steps .st[data-step="${e.step}"]`);
    if (chip) chip.className = `st ${e.status}`;
  } else if (e.type === 'trace') {
    const t = e.trace;
    el.className = 'ln trace';
    const body = t.truncated
      ? `${t.role}: ${t.note}`
      : t.failed
        ? `${t.role} ${t.model} failed ${t.status || ''} ${String(t.error || '').slice(0, 160)}`
        : `${t.role} → ${t.model} · ${t.ms}ms · ${t.usage?.total_tokens || 0} tokens${t.reasoning_chars ? ` · ${t.reasoning_chars} reasoning chars` : ''}${t.substituted_for ? ` · SUBSTITUTED for ${t.substituted_for}` : ''}`;
    el.innerHTML = `<span class="lv">${t.failed ? 'model err' : t.truncated ? 'escalate' : 'model'}</span><span class="msg">${esc(body)}</span>`;
  } else if (e.type === 'log') {
    el.className = `ln ${esc(e.level)}`;
    el.innerHTML = `<span class="lv">${esc(e.level)}</span><span class="msg">${esc(e.message)}</span>`;
  } else if (e.type === 'error') {
    el.className = 'ln error';
    el.innerHTML = `<span class="lv">error</span><span class="msg">${esc(e.message)}</span>`;
  } else if (e.type === 'run-done') {
    el.className = 'ln result';
    el.innerHTML = `<span class="lv">done</span><span class="msg">${esc(e.result.outcome)} — ${e.result.before} → ${e.result.after ?? 'n/a'}, ${e.result.attemptsUsed} repair attempt(s), ${e.result.modelCalls} model calls, ${e.result.tokens} tokens</span>`;
  } else {
    return;
  }

  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60;
  feed.appendChild(el);
  if (atBottom) feed.scrollTop = feed.scrollHeight;
}

function runFigures(result) {
  const box = $('#run-figures');
  if (!box || !result) return;
  box.innerHTML = `
    <div class="card">${figure(`${result.before} <span class="muted" style="font-size:0.5em">→</span> ${result.after ?? 'n/a'}`, 'score, before and after', `Raw scores over each run's own scored checks. Comparable basis on the Proof screen.`)}</div>
    <div class="card">${figure(`${result.attemptsUsed}<span class="muted" style="font-size:0.45em">/${result.cap}</span>`, 'repair attempts used', result.outcome === 'passed' ? 'Verification passed.' : 'Retry cap reached without passing. Reported as failed.', { color: result.outcome === 'passed' ? 'var(--pass)' : 'var(--fail)' })}</div>`;
}

async function screenRun(params) {
  const runId = params.get('r') || state.activeRun;
  renderRunShell(runId);

  if (state.es) { state.es.close(); state.es = null; }

  if (!runId) {
    $('#run-state').textContent = 'Press Run now to start one.';
    const { runs } = await api('/api/runs');
    if (runs.length) {
      $('#feed').innerHTML = `<div class="ln"><span class="lv">runs</span><span class="msg">${runs.map((r) => `<a href="#/run?r=${esc(r.id)}">${esc(r.id)}</a> ${esc(r.state)}`).join('<br>')}</span></div>`;
    }
    return;
  }

  state.activeRun = runId;
  const es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/stream`);
  state.es = es;
  let result = null;

  es.onmessage = (msg) => {
    const e = JSON.parse(msg.data);
    if (e.type === 'run-start') {
      $('#run-note').innerHTML = `run <span class="mono">${esc(runId)}</span> · ${esc(e.mode)} mode · sandbox ${esc(e.sandbox.mode)}`;
    }
    if (e.type === 'run-done') {
      result = e.result;
      runFigures(result);
      $('#run-state').textContent = `finished: ${result.outcome}`;
      const btn = $('#to-proof');
      btn.disabled = false;
      btn.onclick = () => { location.hash = `#/proof?p=${result.prospectId}`; };
      refreshCounts();
    }
    if (e.type === 'closed') $('#run-state').textContent = `run ${e.state}`;
    if (e.type === 'error') {
      $('#run-state').textContent = 'run errored';
      refreshCounts();
    }
    feedLine(e);
  };
  es.onerror = () => { $('#run-state').textContent = 'stream closed'; es.close(); };
}

// --------------------------------------------------------------------------
// Screen: Proof — the hero
// --------------------------------------------------------------------------

async function screenProof(params) {
  const id = params.get('p') || state.prospects[0]?.id;
  if (!id) {
    const { prospects } = await api('/api/prospects');
    state.prospects = prospects;
    if (!prospects.length) {
      view.innerHTML = `<div class="screen-head"><h1>Proof</h1></div><div class="empty"><div class="big">Nothing has been rebuilt yet.</div><div class="small">Press Run now.</div></div>`;
      return;
    }
    location.hash = `#/proof?p=${prospects[0].id}`;
    return;
  }

  const { prospect: p } = await api(`/api/prospects/${encodeURIComponent(id)}`);
  const cmp = p.verification?.comparison || null;
  const runId = p.last_run_id;
  const passed = p.verification?.outcome === 'passed';
  const lastAttempt = (p.attempts || []).filter((a) => a.screenshots).pop();

  const shot = (label, file) => (runId && file ? `/api/runs/${encodeURIComponent(runId)}/shot/${encodeURIComponent(file)}` : null);
  const beforeShot = shot('before', 'before-mobile.png');
  const afterShot = lastAttempt?.screenshots?.mobile ? shot('after', lastAttempt.screenshots.mobile) : null;

  view.innerHTML = `
    <div class="screen-head">
      <div class="row between">
        <div>
          <h1>${esc(p.business_name || p.id)}</h1>
          <div class="note"><span class="mono">${esc(p.url)}</span> · ${statusPill(p.status)}${p.demo ? ' <span class="pill plain"><i></i>seeded demo, fictional business</span>' : ''}</div>
        </div>
        <div class="row">
          ${p.draft ? `<a class="btn" href="#/approve?p=${esc(p.id)}">Review the draft</a>` : ''}
          ${passed ? `<a class="btn" href="/mockup/${esc(p.id)}" target="_blank" rel="noopener">Open the mockup</a>` : ''}
        </div>
      </div>
    </div>

    ${passed ? '' : `
      <div class="banner fail" style="margin-bottom:20px">
        <div>
          <b>Verification did not pass.</b> ${esc(p.verification?.outcome || 'unknown outcome')} after
          ${p.verification?.attempts ?? 0} of ${p.verification?.cap ?? 0} repair attempts.
          ${p.verification?.summary ? `<br>${esc(p.verification.summary)}` : ''}
          <br>No outreach draft was written. ProofRun does not pitch a rebuild that failed its own checks.
        </div>
      </div>`}

    <div class="grid three" style="margin-bottom:8px">
      <div class="card">
        ${figure(cmp ? `${cmp.before}<span class="muted" style="font-size:0.42em"> → </span>${cmp.after}` : '—', 'comparable score', cmp ? cmp.basis : 'No comparable basis yet.', { hero: true, color: passed ? 'var(--pass)' : 'var(--fail)' })}
      </div>
      <div class="card">
        ${figure(cmp ? deltaEl(cmp.delta) : '—', 'delta', cmp ? `${cmp.fixed.length} check(s) fixed, ${cmp.held} already passing and held, ${cmp.still_failing.length} still failing.` : '')}
      </div>
      <div class="card">
        ${figure(`${p.verification?.attempts ?? 0}<span class="muted" style="font-size:0.42em">/${p.verification?.cap ?? 0}</span>`, 'repair attempts', 'Each attempt re-ran the full check suite in a sandbox. Every attempt is logged below, including the ones that failed.')}
      </div>
    </div>

    ${p.verification?.summary ? `<div class="banner ${passed ? 'pass' : 'warn'}" style="margin-bottom:22px"><div>${esc(p.verification.summary)}</div></div>` : ''}

    <p class="voice">Before and after, measured by the same code at the same two widths.</p>

    <div class="shots">
      <div class="shot">
        <div class="cap"><b>Before — their site</b> <span class="pill plain"><i></i>390px</span></div>
        ${beforeShot ? `<img src="${beforeShot}" alt="The prospect's current site at 390px wide">` : '<div class="empty small">No screenshot</div>'}
        <div class="meta">${p.scores?.before ? `score ${p.scores.before.score} · ${p.scores.before.passed} passed / ${p.scores.before.failed} failed / ${p.scores.before.skipped} skipped of ${p.scores.before.automated_total} automated checks` : ''}</div>
      </div>
      <div class="shot">
        <div class="cap"><b>After — the rebuild</b> <span class="pill ${passed ? 'pass' : 'fail'}"><i></i>${passed ? 'verified' : 'failed'}</span></div>
        ${afterShot ? `<img src="${afterShot}" alt="The generated replacement page at 390px wide">` : '<div class="empty small">No screenshot</div>'}
        <div class="meta">${p.scores?.after ? `score ${p.scores.after.score} · ${p.scores.after.passed} passed / ${p.scores.after.failed} failed / ${p.scores.after.skipped} skipped of ${p.scores.after.automated_total} automated checks` : 'not verified'}</div>
      </div>
    </div>
    <div class="small muted" style="margin-top:8px">
      The rebuild is a concept mockup, not affiliated with this business. It carries that label on the page itself.
    </div>

    <h2 class="sec">Retry trace</h2>
    <div class="card">
      <div class="attempt-trace">
        ${(p.attempts || []).map((a) => `
          <div class="attempt ${a.ok ? 'ok' : 'bad'}">
            <div class="idx">${a.attempt}</div>
            <div>
              <div style="font-weight:550">${a.attempt === 1 ? 'First build' : `Repair attempt ${a.attempt - 1}`}</div>
              <div class="small muted">
                ${a.error ? esc(a.error)
    : a.ok ? 'All automated checks passed. No further repair needed.'
      : `Failed: ${esc((a.failing || []).join(', ') || 'unknown')}. Those failures, with their measurements, were fed back to the repair model.`}
              </div>
              ${a.file ? `<div class="small muted mono">${esc(a.file)}</div>` : ''}
            </div>
            <div class="num" style="font-variant-numeric:tabular-nums;font-weight:600;font-size:18px;color:${a.ok ? 'var(--pass)' : 'var(--fail)'}">${a.score ?? '—'}</div>
          </div>`).join('') || '<div class="muted small">No attempts recorded.</div>'}
      </div>
    </div>

    <h2 class="sec">Test log — after</h2>
    <div class="card">
      ${(p.after_checks || []).map((c) => {
    const row = cmp?.comparable_count ? null : null;
    const bc = (p.before_checks || []).find((x) => x.id === c.id);
    const compare = bc && bc.status !== 'skipped' && c.status !== 'skipped' ? { before: bc.status, after: c.status } : null;
    return checkRow(c, compare);
  }).join('') || '<div class="muted small">No verification run completed.</div>'}
    </div>

    ${cmp?.excluded?.length ? `
      <div class="banner info" style="margin-top:14px">
        <div>
          <b>Excluded from the delta:</b> ${cmp.excluded.length} check(s) did not produce a result on both runs, so they are not counted.
          <ul style="margin:6px 0 0;padding-left:18px">${cmp.excluded.map((x) => `<li class="small">${esc(x.title)} — ${esc(x.reason)}</li>`).join('')}</ul>
        </div>
      </div>` : ''}

    <h2 class="sec">Test log — before</h2>
    <div class="card">${(p.before_checks || []).map((c) => checkRow(c)).join('') || '<div class="muted small">No capture recorded.</div>'}</div>

    <h2 class="sec">Audit findings</h2>
    <div class="stack">
      ${(p.audit?.findings || []).map((f) => `
        <div class="card">
          <div class="row between" style="margin-bottom:6px">
            <div style="font-weight:600">${esc(f.title)}</div>
            <div class="row">
              <span class="pill ${f.severity === 'high' ? 'fail' : f.severity === 'medium' ? 'warn' : 'skip'}"><i></i>${esc(f.severity)}</span>
              <span class="conf ${esc(f.confidence)}">confidence ${esc(f.confidence)}</span>
            </div>
          </div>
          <div class="small" style="color:var(--text-2)"><b>Evidence</b> <span class="pill plain"><i></i>${esc(f.evidence_source.replace(/_/g, ' '))}</span><br>${esc(f.evidence)}</div>
          <div class="small muted" style="margin-top:6px"><b>Why not higher confidence:</b> ${esc(f.confidence_reason)}</div>
          <details class="ex">
            <summary>Impact and fix</summary>
            <div class="body small">
              <div style="color:var(--text-2)"><b>Impact</b> ${esc(f.business_impact)}</div>
              <div style="color:var(--text-2);margin-top:6px"><b>Fix</b> ${esc(f.fix)}</div>
            </div>
          </details>
        </div>`).join('') || '<div class="card muted small">No audit recorded.</div>'}
    </div>

    <h2 class="sec">Model routing for this run</h2>
    <div class="card flush">
      <table>
        <thead><tr><th>Step</th><th>Model</th><th>Region</th><th class="num">Temp</th><th>Why this model</th></tr></thead>
        <tbody>${state.meta.routing.map((r) => `
          <tr>
            <td class="mono small">${esc(r.role)}</td>
            <td class="mono small">${esc(r.model)}</td>
            <td class="small muted">${esc(r.region || 'global')}</td>
            <td class="num small">${r.temperature}</td>
            <td class="small muted">${esc(r.why)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>

    ${p.plan?.must_not_claim?.length ? `
      <h2 class="sec">Claims the rebuild was forbidden to make</h2>
      <div class="card">
        <div class="small muted" style="margin-bottom:8px">Facts the planner could not verify from the source site. The builder was given this list as a constraint.</div>
        <ul class="md">${p.plan.must_not_claim.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
      </div>` : ''}

    <h2 class="sec">Trust mechanisms</h2>
    ${trustStrip()}`;
}

// --------------------------------------------------------------------------
// Screen: Approve and edit
// --------------------------------------------------------------------------

async function screenApprove(params) {
  const { prospects } = await api('/api/prospects');
  state.prospects = prospects;
  const waiting = prospects.filter((p) => p.has_draft);
  const id = params.get('p') || waiting.find((p) => p.status === 'drafted')?.id || waiting[0]?.id;

  if (!id) {
    view.innerHTML = `
      <div class="screen-head"><h1>Approve</h1></div>
      <div class="empty"><div class="big">No drafts are waiting.</div><div class="small">A draft is only written when the rebuild passes verification.</div></div>`;
    return;
  }

  const { prospect: p } = await api(`/api/prospects/${encodeURIComponent(id)}`);
  const d = p.draft;
  const decided = p.status === 'approved' || p.status === 'rejected';
  const previousDraft = (p.draft_history || []).slice(-1)[0] || null;

  view.innerHTML = `
    <div class="screen-head">
      <div class="row between">
        <div>
          <h1>Approve or edit</h1>
          <div class="note">${esc(p.business_name)} · ${statusPill(p.status)} · <a href="#/proof?p=${esc(p.id)}">see the proof</a></div>
        </div>
        ${waiting.length > 1 ? `<label class="field" style="min-width:240px"><span>Draft</span><select id="pick">${waiting.map((w) => `<option value="${esc(w.id)}"${w.id === id ? ' selected' : ''}>${esc(w.business_name)} — ${esc(w.status)}</option>`).join('')}</select></label>` : ''}
      </div>
    </div>

    <p class="voice">It wrote the email. It does not get to send it.</p>

    <div class="banner info" style="margin-bottom:18px">
      <div><b>Nothing is sent from here.</b> Approving writes the decision to <span class="mono">memory/learnings.md</span> and marks the draft exportable. ProofRun has no send transport.</div>
    </div>

    <div class="grid two">
      <div class="stack">
        <div class="card">
          <h2 class="sec">The draft</h2>
          <label class="field"><span>Subject</span><input type="text" id="subject" value="${esc(d.subject)}" ${decided ? 'disabled' : ''}></label>
          <label class="field" style="margin-top:12px"><span>Body — edit it, and the edit becomes a learning</span><textarea id="body" ${decided ? 'disabled' : ''}>${esc(d.body)}</textarea></label>
          <div class="row small muted" style="margin-top:10px">
            <span>${d.word_count} words</span>
            <span>·</span>
            <span>cites ${(d.cited_finding_ids || []).length} finding(s): <span class="mono">${esc((d.cited_finding_ids || []).join(', ') || 'none')}</span></span>
          </div>
        </div>

        ${previousDraft ? `
        <div class="card">
          <h2 class="sec">What changed after you corrected it</h2>
          <div class="small muted" style="margin-bottom:12px">
            Same audit, same proof numbers, same model, same prompt. The only thing that changed between these two
            drafts is <span class="mono">memory/learnings.md</span>, which held ${previousDraft.learnings_available || 0}
            rule(s) when v${previousDraft.version || 1} was written and ${d.learnings_available} when v${d.version || 2} was.
          </div>
          <div class="grid two">
            <div>
              <div class="small muted" style="margin-bottom:5px"><b>v${previousDraft.version || 1}</b> — before your correction</div>
              <div class="card" style="background:var(--void)">
                <div class="small" style="font-weight:600;margin-bottom:7px">${esc(previousDraft.subject)}</div>
                <div class="email small">${esc(previousDraft.body)}</div>
              </div>
            </div>
            <div>
              <div class="small" style="margin-bottom:5px;color:var(--accent)"><b>v${d.version || 2}</b> — after reading memory</div>
              <div class="card" style="background:var(--accent-wash);border-color:var(--accent-dim)">
                <div class="small" style="font-weight:600;margin-bottom:7px">${esc(d.subject)}</div>
                <div class="email small">${esc(d.body)}</div>
              </div>
            </div>
          </div>
          ${(d.applied_learnings || []).length ? `
            <div class="banner pass" style="margin-top:14px">
              <div><b>Rules the model reports applying:</b>
                <ul style="margin:5px 0 0;padding-left:18px">${d.applied_learnings.map((l) => `<li class="small">${esc(l)}</li>`).join('')}</ul>
              </div>
            </div>` : ''}
        </div>` : ''}

        <div class="card">
          <h2 class="sec">Redraft from memory</h2>
          <div class="small muted" style="margin-bottom:12px">
            Re-runs only the drafting step against the rules currently in memory. The audit, the rebuild and the
            scores do not change, so any difference comes from what you taught it.
          </div>
          <button id="redraft">Redraft with what it has learned</button>
        </div>

        ${decided ? '' : `
        <div class="card">
          <h2 class="sec">Your decision</h2>
          <label class="field">
            <span>Why — this becomes the rule the next draft reads. Leave it blank and one is derived from your edits.</span>
            <input type="text" id="note" placeholder="e.g. Never mention the score in the first email. Lead with the phone number.">
          </label>
          <div class="row" style="margin-top:14px">
            <button class="primary" id="approve">Approve</button>
            <button id="save-edit">Save edits &amp; approve</button>
            <button class="danger" id="reject">Reject</button>
          </div>
        </div>`}
      </div>

      <div class="stack">
        <div class="card">
          <h2 class="sec">Evidence this draft is allowed to use</h2>
          ${(p.audit?.findings || []).filter((f) => (d.cited_finding_ids || []).includes(f.id)).map((f) => `
            <div style="padding:9px 0;border-bottom:1px solid var(--line)">
              <div class="small" style="font-weight:600">${esc(f.title)}</div>
              <div class="small muted">${esc(f.evidence)}</div>
              <div class="small"><span class="conf ${esc(f.confidence)}">confidence ${esc(f.confidence)}</span></div>
            </div>`).join('') || '<div class="small muted">This draft cites no findings by id.</div>'}
          <div class="small muted" style="margin-top:10px">
            Proof numbers in the email: before ${p.verification?.comparison?.before ?? '—'}, after ${p.verification?.comparison?.after ?? '—'}, over ${p.verification?.comparison?.comparable_count ?? 0} comparable checks.
          </div>
        </div>

        <div class="card">
          <h2 class="sec">Memory it read before writing</h2>
          ${d.learnings_available ? `<div class="small muted">${d.learnings_available} learning(s) were in memory when this was drafted.</div>` : '<div class="small muted">Memory was empty when this was drafted. It is a first draft.</div>'}
          ${(d.applied_learnings || []).length ? `<ul class="md">${d.applied_learnings.map((l) => `<li class="small">${esc(l)}</li>`).join('')}</ul>` : ''}
          <div class="small muted" style="margin-top:10px"><a href="#/memory">Open the memory viewer</a></div>
        </div>

        ${(p.user_edits || []).length ? `
        <div class="card">
          <h2 class="sec">Decision history</h2>
          ${p.user_edits.map((e) => `
            <div style="padding:9px 0;border-bottom:1px solid var(--line)">
              <div class="small"><b>${esc(e.decision)}</b> <span class="muted">${esc((e.at || '').slice(0, 16).replace('T', ' '))}</span></div>
              ${e.note ? `<div class="small muted">Note: ${esc(e.note)}</div>` : ''}
              ${e.diff_note ? `<div class="small muted">${esc(e.diff_note)}</div>` : ''}
            </div>`).join('')}
        </div>` : ''}
      </div>
    </div>`;

  const pick = $('#pick');
  if (pick) pick.onchange = () => { location.hash = `#/approve?p=${pick.value}`; };

  const decide = async (decision, withEdits) => {
    const payload = { decision, note: $('#note')?.value || undefined };
    if (withEdits) {
      payload.subject = $('#subject').value;
      payload.body = $('#body').value;
      payload.decision = 'edited';
    }
    for (const b of view.querySelectorAll('button')) b.disabled = true;
    try {
      const out = await api(`/api/prospects/${encodeURIComponent(id)}/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      toast(`Written to memory: "${out.rule.slice(0, 120)}"`, 'good');
      refreshCounts();
      await screenApprove(new URLSearchParams(`p=${id}`));
    } catch (err) {
      toast(err.message, 'bad');
      for (const b of view.querySelectorAll('button')) b.disabled = false;
    }
  };

  if (!decided) {
    $('#approve').onclick = () => decide('approved', false);
    $('#save-edit').onclick = () => decide('edited', true);
    $('#reject').onclick = () => decide('rejected', false);
  }

  $('#redraft').onclick = async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Reading memory and rewriting…';
    try {
      const out = await api(`/api/prospects/${encodeURIComponent(id)}/redraft`, { method: 'POST' });
      toast(`v${out.draft.version} written from ${out.learnings.length} learning(s) in memory.`, 'good');
      await screenApprove(new URLSearchParams(`p=${id}`));
    } catch (err) {
      toast(err.message, 'bad');
      e.target.disabled = false;
      e.target.textContent = 'Redraft with what it has learned';
    }
  };
}

// --------------------------------------------------------------------------
// Screen: Memory viewer
// --------------------------------------------------------------------------

async function screenMemory() {
  const m = await api('/api/memory');
  view.innerHTML = `
    <div class="screen-head">
      <h1>Memory</h1>
      <div class="note">Read-only. These are plain files on disk; edit or delete them by hand.</div>
    </div>

    <p class="voice">It remembers being corrected. That is the whole trick.</p>

    <div class="grid three" style="margin-bottom:8px">
      <div class="card">${figure(m.rules.length, 'rules the next draft reads', `Extracted from ${esc(m.files.learnings)} and injected into the drafting prompt, newest first.`, { color: 'var(--accent)' })}</div>
      <div class="card">${figure(m.runLogs.length, 'daily run logs', `One file per day in memory/runs/.`)}</div>
      <div class="card">${figure(m.profile.split('\n').filter((l) => l.trim().startsWith('-')).length, 'standing instructions', `From ${esc(m.files.profile)}. Read before every draft.`)}</div>
    </div>

    <h2 class="sec">Rules, newest first — exactly what the drafting model is given</h2>
    <div class="card">
      ${m.rules.length ? m.rules.map((r, i) => `
        <div style="display:grid;grid-template-columns:26px 1fr;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)">
          <div class="mono small muted">${i + 1}</div>
          <div class="small">${esc(r)}</div>
        </div>`).join('') : '<div class="empty small">No rules yet. Approve, edit or reject a draft and the first one appears here.</div>'}
    </div>

    <h2 class="sec">memory/learnings.md</h2>
    <div class="card"><div class="md">${md(m.learnings)}</div></div>

    <h2 class="sec">memory/profile.md</h2>
    <div class="card"><div class="md">${md(m.profile)}</div></div>

    <h2 class="sec">config/voice.md — the voice the drafts imitate</h2>
    <div class="card"><div class="md">${md(m.voice)}</div></div>

    <h2 class="sec">Run logs</h2>
    <div class="card">
      ${m.runLogs.length ? m.runLogs.map((r) => `<div><a href="#" data-log="${esc(r)}">${esc(r)}</a></div>`).join('') : '<div class="small muted">No run logs yet.</div>'}
      <div id="log-body" class="md" style="margin-top:14px"></div>
    </div>`;

  for (const a of view.querySelectorAll('[data-log]')) {
    a.onclick = async (e) => {
      e.preventDefault();
      const { text } = await api(`/api/memory/runs/${encodeURIComponent(a.dataset.log)}`);
      $('#log-body').innerHTML = md(text);
    };
  }
}

// --------------------------------------------------------------------------
// Run now
// --------------------------------------------------------------------------

async function startRun() {
  const btn = $('#run-now');
  const meta = state.meta;
  const canLive = meta.tavily;

  const niche = meta.defaultNiche?.niche || 'plumbers';
  const city = meta.defaultNiche?.city || 'San Diego, CA';
  const mode = canLive
    // eslint-disable-next-line no-alert
    ? (window.confirm(`Run in LIVE mode?\n\nOK = live: Tavily searches for a real ${niche} in ${city} and audits their real site.\nCancel = demo: the seeded fictional sample business.`) ? 'live' : 'demo')
    : 'demo';

  btn.disabled = true;
  btn.textContent = 'Starting…';
  try {
    const { runId } = await api('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ niche, city, mode }),
    });
    state.activeRun = runId;
    location.hash = `#/run?r=${runId}`;
  } catch (err) {
    toast(err.message, 'bad');
  }
  btn.disabled = false;
  btn.textContent = 'Run now';
}

// --------------------------------------------------------------------------
// Router
// --------------------------------------------------------------------------

const routes = {
  '/brief': screenBrief,
  '/queue': screenQueue,
  '/run': screenRun,
  '/proof': screenProof,
  '/approve': screenApprove,
  '/memory': screenMemory,
};

async function refreshCounts() {
  try {
    const { prospects } = await api('/api/prospects');
    state.prospects = prospects;
    const q = document.querySelector('[data-count="queue"]');
    const a = document.querySelector('[data-count="approve"]');
    if (q) q.textContent = prospects.filter((p) => !['approved', 'rejected'].includes(p.status)).length;
    if (a) a.textContent = prospects.filter((p) => p.status === 'drafted').length;
  } catch { /* the sidebar count is not worth an error */ }
}

async function route() {
  const raw = location.hash.replace(/^#/, '') || '/brief';
  const [pathname, query] = raw.split('?');
  const params = new URLSearchParams(query || '');

  for (const a of document.querySelectorAll('nav.screens a')) {
    if (a.getAttribute('href').startsWith(`#${pathname}`)) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }

  if (state.es && pathname !== '/run') { state.es.close(); state.es = null; }

  const fn = routes[pathname] || screenBrief;
  try {
    await fn(params);
  } catch (err) {
    view.innerHTML = `<div class="screen-head"><h1>Something broke</h1></div><div class="banner fail"><div>${esc(err.message)}</div></div>`;
  }
}

async function boot() {
  try {
    state.meta = await api('/api/meta');
  } catch (err) {
    view.innerHTML = `<div class="banner fail"><div>Could not reach the API: ${esc(err.message)}</div></div>`;
    return;
  }

  const m = state.meta;
  $('#mode-note').innerHTML = [
    `mode <b>${esc(m.mode)}</b>`,
    `sandbox ${esc(m.sandbox.mode)}`,
    `retry cap ${m.maxRetries}`,
    m.nebius ? 'Nebius ok' : '<span style="color:var(--fail)">no Nebius key</span>',
    m.tavily ? 'Tavily ok' : 'Tavily off (demo only)',
  ].join('<br>');

  $('#run-now').onclick = startRun;
  window.addEventListener('hashchange', route);
  await refreshCounts();
  await route();
}

boot();
