// The ProofRun loop.
//
//   discover -> enrich -> capture -> audit -> plan -> build -> verify (retry)
//   -> prove -> draft -> await approval
//
// Every step emits an event, which is what the Live Run screen streams. Every
// model call's trace is kept, which is what the Proof screen's evidence panel
// renders. Nothing is hidden: a failed attempt stays in the log.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { capture, extractText } from '../../tools/capture.js';
import { compareScores, failuresForModel } from '../../tools/checks.js';
import { env, niches, paths, operator } from '../../tools/config.js';
import { completeStructured, complete, routingTable } from '../../tools/nebius.js';
import * as sandbox from '../../tools/sandbox.js';
import * as store from '../../tools/store.js';
import * as tavily from '../../tools/tavily.js';
import {
  auditJsonSchema, auditZ,
  contextJsonSchema, contextZ,
  draftJsonSchema, draftZ,
  planJsonSchema, planZ,
  screenJsonSchema, screenZ,
  testSummaryJsonSchema, testSummaryZ,
} from '../../agent/schemas.js';
import {
  auditPrompt, buildPrompt, contextPrompt, draftPrompt, planPrompt, screenPrompt, testSummaryPrompt,
} from './prompts.js';
import { DEMO_PROSPECT, demoPageHtml } from './demo-fixture.js';

export const STEPS = [
  'discover', 'enrich', 'capture', 'audit', 'plan', 'build', 'verify', 'prove', 'draft', 'await_approval',
];

/** A run is an event emitter with a transcript, so the UI can join mid-flight. */
export class Run {
  constructor({ id, niche, city, mode }) {
    this.id = id;
    this.niche = niche;
    this.city = city;
    this.mode = mode;
    this.startedAt = new Date().toISOString();
    this.events = [];
    this.traces = [];
    this.listeners = new Set();
    this.state = 'running';
    this.prospectId = null;
    this.result = null;
  }

  emit(event) {
    const e = { seq: this.events.length, at: new Date().toISOString(), ...event };
    this.events.push(e);
    for (const fn of this.listeners) {
      try { fn(e); } catch { /* a dead listener must not break the run */ }
    }
    return e;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  step(id, status, detail) {
    return this.emit({ type: 'step', step: id, status, detail });
  }

  log(level, message) {
    return this.emit({ type: 'log', level, message });
  }

  trace(t) {
    this.traces.push(t);
    return this.emit({ type: 'trace', trace: t });
  }

  snapshot() {
    return {
      id: this.id,
      niche: this.niche,
      city: this.city,
      mode: this.mode,
      state: this.state,
      startedAt: this.startedAt,
      prospectId: this.prospectId,
      events: this.events,
      traces: this.traces,
      result: this.result,
    };
  }
}

const runs = new Map();
export const getRun = (id) => runs.get(id) || null;
export const listRuns = () => [...runs.values()].map((r) => r.snapshot());

const tokensOf = (traces) => traces.reduce((s, t) => s + (t.usage?.total_tokens || 0), 0);

// --------------------------------------------------------------------------
// Steps
// --------------------------------------------------------------------------

async function stepDiscover(run) {
  run.step('discover', 'running');

  if (run.mode === 'demo') {
    run.log('info', 'Demo mode: using the seeded sample business. No search is performed and no real business is contacted.');
    run.step('discover', 'done', `Seeded prospect: ${DEMO_PROSPECT.business_name}`);
    return { url: DEMO_PROSPECT.url, business_name: DEMO_PROSPECT.business_name, source: 'seeded demo fixture' };
  }

  if (!tavily.available()) {
    const e = new Error('Live mode needs TAVILY_API_KEY. Switch to demo mode or add the key.');
    e.code = 'NO_TAVILY_KEY';
    throw e;
  }

  const query = `${run.niche} in ${run.city}`;
  run.log('tool', `tavily.search("${query}")`);
  const hits = await tavily.search(query, { maxResults: 10 });
  run.log('info', `${hits.length} search result(s) returned`);

  const seen = new Set(store.listProspects().map((p) => p.url));
  for (const hit of hits) {
    if (seen.has(hit.url)) {
      run.log('info', `skip ${hit.url} — already in the queue`);
      continue;
    }
    const { data, trace } = await completeStructured({
      role: 'classify',
      ...screenPrompt({ hit, niche: run.niche, city: run.city, disqualifiers: niches.disqualify_if || [] }),
      schema: screenZ, jsonSchema: screenJsonSchema, schemaName: 'screen',
      onTrace: (t) => run.trace(t),
    });
    run.log('model', `${data.verdict === 'audit' ? 'AUDIT' : 'skip '} ${hit.url} — ${data.reason}`);
    if (data.verdict === 'audit') {
      run.step('discover', 'done', `${data.business_name || hit.title} — ${hit.url}`);
      return { url: hit.url, business_name: data.business_name || hit.title, source: `tavily search: ${query}` };
    }
  }
  throw new Error(`No result for "${query}" screened as an auditable independent business site.`);
}

async function stepEnrich(run, prospect) {
  run.step('enrich', 'running');

  let text;
  if (run.mode === 'demo') {
    text = DEMO_PROSPECT.page_text;
    run.log('info', 'Demo mode: using the fixture page text.');
  } else {
    run.log('tool', `playwright.extractText(${prospect.url})`);
    ({ text } = await extractText(prospect.url));
    run.log('info', `${text.length} chars of visible text read from the page`);

    if (tavily.available()) {
      try {
        run.log('tool', `tavily.extract(${prospect.url})`);
        const ex = await tavily.extract([prospect.url]);
        if (ex.results[0]?.content) {
          text = `${text}\n\n--- tavily extract ---\n${ex.results[0].content.slice(0, 6000)}`;
          run.log('info', 'Tavily extract appended for additional business context.');
        }
      } catch (err) {
        run.log('warn', `Tavily extract failed, continuing with the page text only: ${err.message.slice(0, 120)}`);
      }
    }
  }

  const { data: context } = await completeStructured({
    role: 'extract',
    ...contextPrompt({ url: prospect.url, text }),
    schema: contextZ, jsonSchema: contextJsonSchema, schemaName: 'business_context',
    onTrace: (t) => run.trace(t),
  });

  run.step('enrich', 'done', `${context.business_name} — ${context.services.length} service(s), phone ${context.phone}`);
  return { context, pageText: text };
}

async function stepCapture(run, prospect) {
  run.step('capture', 'running');
  const outDir = store.runDir(run.id);

  if (run.mode === 'demo') {
    // The demo fixture is a real local HTML file, captured by the real suite.
    const file = path.join(outDir, 'demo-original.html');
    await fsp.writeFile(file, DEMO_PROSPECT.html, 'utf8');
    run.log('info', 'Demo mode: capturing the seeded sample site, which is a local file, with the same check suite used on live sites.');
    const before = await capture({
      url: `file://${file.replace(/\\/g, '/')}`,
      label: 'before',
      outDir,
      probeLinks: false,
      onLog: (l) => run.log(l.level, l.message),
    });
    run.step('capture', 'done', `before: ${before.score.score}/100`);
    return before;
  }

  const before = await capture({
    url: prospect.url,
    label: 'before',
    outDir,
    onLog: (l) => run.log(l.level, l.message),
  });
  run.step('capture', 'done', `before: ${before.score.score}/100, ${before.score.failed} check(s) failing`);
  return before;
}

async function stepAudit(run, { prospect, context, before, pageText }) {
  run.step('audit', 'running');
  const { data: audit } = await completeStructured({
    role: 'audit',
    ...auditPrompt({ url: prospect.url, context, capture: before, pageText }),
    schema: auditZ, jsonSchema: auditJsonSchema, schemaName: 'site_audit',
    onTrace: (t) => run.trace(t),
  });
  const high = audit.findings.filter((f) => f.severity === 'high').length;
  for (const f of audit.findings) {
    run.log('finding', `[${f.severity}/${f.confidence}] ${f.title}`);
  }
  run.step('audit', 'done', `${audit.findings.length} finding(s), ${high} high severity`);
  return audit;
}

async function stepPlan(run, { audit, context }) {
  run.step('plan', 'running');
  const { data: plan } = await completeStructured({
    role: 'redesign_plan',
    ...planPrompt({ audit, context }),
    schema: planZ, jsonSchema: planJsonSchema, schemaName: 'redesign_plan',
    onTrace: (t) => run.trace(t),
  });
  run.log('info', `Positioning: ${plan.positioning}`);
  run.log('info', `Primary CTA: "${plan.primary_cta}"`);
  if (plan.must_not_claim.length) {
    run.log('guard', `${plan.must_not_claim.length} unverifiable claim(s) the page is forbidden to make: ${plan.must_not_claim.slice(0, 3).join('; ')}`);
  }
  run.step('plan', 'done', `${plan.sections.length} sections planned`);
  return plan;
}

/**
 * Build, then run and test, repairing on failure up to the cap.
 * Returns the best attempt and the full attempt log, pass or fail.
 */
async function stepBuildAndVerify(run, { plan, audit, context, prospect, before }) {
  const cap = env.maxRetries;
  const outDir = store.runDir(run.id);
  const attempts = [];
  let html = null;
  let failures = null;

  for (let attempt = 1; attempt <= cap + 1; attempt += 1) {
    const isRepair = attempt > 1;
    run.step(isRepair ? 'verify' : 'build', 'running', isRepair ? `repair attempt ${attempt - 1} of ${cap}` : null);

    // ---- generate ----
    const role = isRepair ? 'repair' : 'build';
    run.log('model', isRepair
      ? `Feeding ${failures.length} failing check(s) back to the ${role} model`
      : 'Generating the replacement page');

    const res = await complete({
      role,
      ...buildPrompt({ plan, audit, context, previousHtml: isRepair ? html : null, failures, attempt: attempt - 1 }),
      onTrace: (t) => run.trace(t),
    });

    html = extractHtmlDocument(res.text);
    if (!html) {
      run.log('error', 'The model did not return a parseable HTML document.');
      attempts.push({ attempt, ok: false, error: 'no HTML document in model output', score: null });
      failures = [{ id: 'output_format', requirement: 'Return one complete HTML document', what_went_wrong: 'Your reply contained no <html> document. Return the document only, with no commentary.' }];
      continue;
    }
    run.log('info', `${(html.length / 1024).toFixed(1)}KB of HTML generated`);

    // ---- static gate ----
    const written = await sandbox.writeCandidate({ runId: run.id, prospectId: prospect.id, attempt, html });
    const gate = sandbox.gateAsCheck(written.report);
    if (!written.report.ok) {
      run.log('guard', `Sandbox gate rejected the page: ${gate.evidence}`);
      attempts.push({ attempt, ok: false, gate, score: null, file: path.basename(written.file) });
      failures = [{ id: 'sandbox_gate', requirement: gate.title, what_went_wrong: gate.evidence }];
      if (attempt === cap + 1) break;
      continue;
    }
    run.log('guard', 'Sandbox gate passed: no scripts, no external references, banner present.');

    // ---- run and test ----
    let verified;
    try {
      verified = await sandbox.verifyFile({
        file: written.file,
        label: `after-${attempt}`,
        outDir,
        onLog: (l) => run.log(l.level, l.message),
      });
    } catch (err) {
      run.log('error', `Sandboxed verification failed to run: ${err.message}`);
      attempts.push({ attempt, ok: false, error: err.message, score: null, file: path.basename(written.file) });
      failures = [{ id: 'page_loads', requirement: 'The page must load', what_went_wrong: err.message.slice(0, 400) }];
      continue;
    }

    verified.checks.unshift(gate);
    const comparison = compareScores(before.checks, verified.checks);
    if (verified.blockedRequests?.length) {
      run.log('guard', `${verified.blockedRequests.length} outbound request(s) blocked by the sandbox: ${verified.blockedRequests.slice(0, 2).map((b) => b.url).join(', ')}`);
    }

    for (const c of verified.checks.filter((c) => c.status === 'fail')) {
      run.log('check-fail', `${c.id}: ${c.evidence}`);
    }

    const stillFailing = failuresForModel(verified.checks);
    const record = {
      attempt,
      ok: stillFailing.length === 0,
      score: verified.score,
      comparison,
      file: path.basename(written.file),
      screenshots: verified.screenshots,
      failing: stillFailing.map((f) => f.id),
      checks: verified.checks,
      blockedRequests: verified.blockedRequests || [],
    };
    attempts.push(record);

    run.log('result', `Attempt ${attempt}: ${verified.score.score}/100, ${verified.score.passed} passed / ${verified.score.failed} failed`);

    if (stillFailing.length === 0) {
      run.step('verify', 'done', `passed on attempt ${attempt} of ${cap + 1}`);
      return { outcome: 'passed', attempts, html, verified, comparison, attemptsUsed: attempt - 1, cap };
    }

    if (attempt === cap + 1) {
      // Fail open. The retry cap is spent and checks still fail.
      run.step('verify', 'failed', `${stillFailing.length} check(s) still failing after ${cap} repair attempt(s)`);
      run.log('warn', `Verification did not pass. ${stillFailing.length} check(s) still fail: ${stillFailing.map((f) => f.id).join(', ')}. This run is reported as failed; the page is kept so you can see exactly where it stands.`);
      return { outcome: 'failed_verification', attempts, html, verified, comparison, attemptsUsed: cap, cap };
    }

    failures = stillFailing;
    run.log('retry', `${stillFailing.length} check(s) failing — retrying (${attempt} of ${cap} repair attempts used)`);
  }

  run.step('verify', 'failed', `no usable page produced within ${cap} repair attempt(s)`);
  return { outcome: 'failed_no_page', attempts, html, verified: null, comparison: null, attemptsUsed: cap, cap };
}

async function stepProve(run, { before, verification }) {
  run.step('prove', 'running');
  if (!verification.verified) {
    run.step('prove', 'failed', 'no verified page to compare');
    return { summary: 'The model never produced a page that could be loaded and tested.', comparison: null };
  }

  const { data: summary } = await completeStructured({
    role: 'summarize_tests',
    ...testSummaryPrompt({
      before,
      after: verification.verified,
      attempts: verification.attemptsUsed,
      outcome: verification.outcome,
    }),
    schema: testSummaryZ, jsonSchema: testSummaryJsonSchema, schemaName: 'test_summary',
    onTrace: (t) => run.trace(t),
  });

  run.log('result', summary.one_line);
  run.step('prove', 'done', `${verification.comparison.before} -> ${verification.comparison.after} on ${verification.comparison.comparable_count} comparable check(s)`);
  return { summary, comparison: verification.comparison };
}

async function stepDraft(run, { audit, context, prospect, verification, proof }) {
  run.step('draft', 'running');

  // The memory read path. This is what makes a later draft differ from an
  // earlier one: the operator's recorded corrections are injected here.
  const learnings = store.learningRules();
  const profile = store.readProfile();
  run.log('memory', learnings.length
    ? `Read ${learnings.length} operator learning(s) from memory/learnings.md before drafting`
    : 'memory/learnings.md holds no rules yet — this is a first draft');
  for (const l of learnings.slice(0, 5)) run.log('memory', `applying: ${l}`);

  const mockupUrl = `${env.publicBaseUrl}/mockup/${prospect.id}`;
  const proofNumbers = {
    before_score: verification.comparison?.before ?? null,
    after_score: verification.comparison?.after ?? null,
    checks_passed: verification.verified?.score.passed ?? 0,
    checks_total: verification.verified?.score.automated_total ?? 0,
    baseline_passed: run.before?.score.passed ?? null,
    fixed: verification.comparison?.fixed ?? [],
    still_failing: verification.comparison?.still_failing ?? [],
    verification_outcome: verification.outcome,
  };

  const { data: draft } = await completeStructured({
    role: 'draft_email',
    ...draftPrompt({
      audit, context, proof: proofNumbers, mockupUrl, learnings, profile, city: run.city,
    }),
    schema: draftZ, jsonSchema: draftJsonSchema, schemaName: 'outreach_draft',
    onTrace: (t) => run.trace(t),
  });

  run.log('info', `Draft: "${draft.subject}" (${draft.word_count} words, citing ${draft.cited_finding_ids.length} finding(s))`);
  if (draft.applied_learnings.length) {
    run.log('memory', `The draft reports applying ${draft.applied_learnings.length} learning(s): ${draft.applied_learnings.join(' | ')}`);
  }
  run.step('draft', 'done', `"${draft.subject}"`);
  return { draft, mockupUrl, learningsUsed: learnings };
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

export function extractHtmlDocument(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/<think>[\s\S]*?<\/think>/g, '');
  const fenced = cleaned.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : cleaned;
  const start = body.search(/<!doctype\s+html|<html\b/i);
  if (start === -1) return null;
  const end = body.toLowerCase().lastIndexOf('</html>');
  return end === -1 ? body.slice(start).trim() : body.slice(start, end + 7).trim();
}

// --------------------------------------------------------------------------
// The loop
// --------------------------------------------------------------------------

export async function runProofRun({ niche, city, mode = env.mode, runId = null } = {}) {
  const id = runId || `${store.today()}-${Date.now().toString(36)}`;
  const run = new Run({
    id,
    niche: niche || niches.default.niche,
    city: city || niches.default.city,
    mode,
  });
  runs.set(id, run);

  // Run it in the background and return the handle so the UI can stream.
  run.promise = execute(run).catch((err) => {
    run.state = 'error';
    run.emit({ type: 'error', message: err?.message || String(err), code: err?.code || null });
    return null;
  });

  return run;
}

async function execute(run) {
  const started = Date.now();
  run.emit({ type: 'run-start', steps: STEPS, routing: routingTable(), sandbox: sandbox.sandboxDescription(), mode: run.mode });

  let prospect = null;
  try {
    // 1. discover
    const found = await stepDiscover(run);
    const id = (run.mode === 'demo' ? 'demo-' : 'live-') + store.slugify(found.url);
    run.prospectId = id;
    prospect = store.upsertProspect(id, {
      id,
      url: found.url,
      business_name: found.business_name,
      niche: run.niche,
      city: run.city,
      source: found.source,
      status: 'discovered',
      demo: run.mode === 'demo',
      last_run_id: run.id,
    });
    store.appendProspectHistory(id, { event: 'discovered', detail: found.source });

    // 2. enrich
    const { context, pageText } = await stepEnrich(run, prospect);
    prospect = store.upsertProspect(id, { business_name: context.business_name || prospect.business_name, context });

    // 3. capture
    const before = await stepCapture(run, prospect);
    run.before = before;
    await store.writeArtifact(run.id, 'before.json', JSON.stringify(before, null, 2));
    prospect = store.upsertProspect(id, { scores: { before: before.score }, before_checks: before.checks });

    // 4. audit
    const audit = await stepAudit(run, { prospect, context, before, pageText });
    prospect = store.upsertProspect(id, { status: 'audited', audit });
    store.appendProspectHistory(id, { event: 'audited', detail: `${audit.findings.length} findings, score ${before.score.score}` });

    // 5. plan
    const plan = await stepPlan(run, { audit, context });
    prospect = store.upsertProspect(id, { plan });

    // 6-7. build, run and test with retries
    const verification = await stepBuildAndVerify(run, { plan, audit, context, prospect, before });
    await store.writeArtifact(run.id, 'attempts.json', JSON.stringify(verification.attempts, null, 2));

    if (verification.html) {
      await fsp.writeFile(store.mockupPath(id, 'final'), verification.html, 'utf8');
    }

    prospect = store.upsertProspect(id, {
      status: verification.outcome === 'passed' ? 'redesigned' : 'failed',
      scores: { before: before.score, after: verification.verified?.score || null },
      verification: {
        outcome: verification.outcome,
        attempts: verification.attemptsUsed,
        cap: verification.cap,
        comparison: verification.comparison,
      },
      attempts: verification.attempts.map((a) => ({
        attempt: a.attempt, ok: a.ok, score: a.score?.score ?? null, failing: a.failing || [], error: a.error || null,
        screenshots: a.screenshots || null, file: a.file || null,
      })),
      after_checks: verification.verified?.checks || null,
    });
    store.appendProspectHistory(id, {
      event: 'verified',
      detail: `${verification.outcome} after ${verification.attemptsUsed} repair attempt(s)`,
    });

    // 8. prove
    const proof = await stepProve(run, { before, verification });
    prospect = store.upsertProspect(id, {
      verification: { ...prospect.verification, summary: proof.summary?.one_line || null, improved: proof.summary?.what_improved || [], still_failing: proof.summary?.what_still_fails || [] },
    });

    // 9. draft — only when there is something honest to show
    let drafted = null;
    if (verification.outcome === 'passed') {
      drafted = await stepDraft(run, { audit, context, prospect, verification, proof });
      prospect = store.upsertProspect(id, {
        status: 'drafted',
        draft: { ...drafted.draft, mockup_url: drafted.mockupUrl, drafted_at: new Date().toISOString(), learnings_available: drafted.learningsUsed.length },
      });
      store.appendProspectHistory(id, { event: 'drafted', detail: drafted.draft.subject });
    } else {
      run.step('draft', 'skipped', 'verification did not pass, so there is nothing honest to pitch');
      run.log('warn', 'No draft was written. ProofRun does not pitch a rebuild that failed its own checks.');
    }

    // 10. await approval
    run.step('await_approval', drafted ? 'waiting' : 'skipped', drafted ? 'waiting for a human decision' : null);

    run.state = 'done';
    run.result = {
      prospectId: id,
      outcome: verification.outcome,
      before: before.score.score,
      after: verification.verified?.score.score ?? null,
      comparison: verification.comparison,
      attemptsUsed: verification.attemptsUsed,
      cap: verification.cap,
      findings: audit.findings.length,
      drafted: Boolean(drafted),
      tokens: tokensOf(run.traces),
      modelCalls: run.traces.filter((t) => !t.failed && !t.truncated).length,
      ms: Date.now() - started,
    };

    store.appendRunLog(store.today(), [
      `## ${run.startedAt.slice(11, 19)} — ${prospect.business_name} (${run.mode} mode, run \`${run.id}\`)`,
      '',
      `- Outcome: **${verification.outcome}**`,
      `- Score: ${before.score.score} -> ${verification.verified?.score.score ?? 'n/a'} (comparable basis: ${verification.comparison?.before} -> ${verification.comparison?.after} over ${verification.comparison?.comparable_count} checks)`,
      `- Repair attempts: ${verification.attemptsUsed} of ${verification.cap}`,
      `- Findings: ${audit.findings.length}`,
      `- Draft written: ${drafted ? 'yes, awaiting approval' : 'no'}`,
      `- Model calls: ${run.result.modelCalls}, ${run.result.tokens} tokens`,
      '',
    ].join('\n'));

    run.emit({ type: 'run-done', result: run.result });
    return run.result;
  } catch (err) {
    run.state = 'error';
    if (prospect) {
      store.upsertProspect(prospect.id, { status: 'failed', last_error: String(err?.message || err).slice(0, 500) });
      store.appendProspectHistory(prospect.id, { event: 'failed', detail: String(err?.message || err).slice(0, 200) });
    }
    run.emit({ type: 'error', message: err?.message || String(err), code: err?.code || null, step: run.events.filter((e) => e.type === 'step').pop()?.step || null });
    throw err;
  }
}

// --------------------------------------------------------------------------
// Approval: the memory write path
// --------------------------------------------------------------------------

/**
 * Record a human decision. This is the only way a draft leaves the queue, and
 * it always writes to memory, which the next draft reads.
 */
export async function recordDecision({ prospectId, decision, note, editedSubject, editedBody, rule }) {
  const p = store.loadProspect(prospectId);
  if (!p) throw new Error(`Unknown prospect ${prospectId}`);
  if (!['approved', 'rejected', 'edited'].includes(decision)) {
    throw new Error(`decision must be approved, rejected or edited; got "${decision}"`);
  }

  const original = p.draft || null;
  const edit = {
    at: new Date().toISOString(),
    decision,
    note: note || null,
    edited_subject: editedSubject && editedSubject !== original?.subject ? editedSubject : null,
    edited_body: editedBody && editedBody !== original?.body ? editedBody : null,
    diff_note: describeEdit(original, { subject: editedSubject, body: editedBody }),
  };

  const status = decision === 'rejected' ? 'rejected' : 'approved';
  const next = store.upsertProspect(prospectId, {
    status,
    user_edits: [...(p.user_edits || []), edit],
    draft: original
      ? { ...original, subject: editedSubject || original.subject, body: editedBody || original.body, operator_decision: decision }
      : original,
    approved_at: status === 'approved' ? new Date().toISOString() : null,
  });
  store.appendProspectHistory(prospectId, { event: decision, detail: note || edit.diff_note || '' });

  // The learning the next draft will read. An explicit rule from the operator
  // wins; otherwise one is derived from what they actually did.
  const derived = rule || deriveRule({ decision, note, original, edit });
  const block = store.appendLearning({
    decision,
    prospect: prospectId,
    business: p.business_name,
    rule: derived,
    evidence: edit.diff_note || note || `operator ${decision} the draft`,
  });

  store.appendRunLog(store.today(), `- ${new Date().toISOString().slice(11, 19)} — operator **${decision}** ${p.business_name}: ${derived}`);

  return { prospect: next, learning: block, rule: derived };
}

function describeEdit(original, edited) {
  if (!original || (!edited?.subject && !edited?.body)) return null;
  const parts = [];
  if (edited.subject && edited.subject !== original.subject) {
    parts.push(`subject changed from "${original.subject}" to "${edited.subject}"`);
  }
  if (edited.body && edited.body !== original.body) {
    const before = original.body.trim().split(/\s+/).length;
    const after = edited.body.trim().split(/\s+/).length;
    parts.push(`body edited (${before} words -> ${after} words)`);
    const removed = firstRemovedSentence(original.body, edited.body);
    if (removed) parts.push(`removed: "${removed}"`);
  }
  return parts.length ? parts.join('; ') : null;
}

function firstRemovedSentence(before, after) {
  const sentences = before.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 20);
  for (const s of sentences) {
    if (!after.includes(s)) return s.slice(0, 120);
  }
  return null;
}

function deriveRule({ decision, note, original, edit }) {
  if (note && note.trim().length > 8) return note.trim();
  if (decision === 'rejected') return `The operator rejected the draft for ${original?.subject ? `"${original.subject}"` : 'this prospect'} without a note. Treat this angle as unproven and try a different opening next time.`;
  if (edit?.edited_subject) return `Subject lines like "${original?.subject}" get rewritten. The operator preferred "${edit.edited_subject}". Match that style.`;
  if (edit?.diff_note) return `The operator edited the body: ${edit.diff_note}. Write it that way the first time.`;
  return 'The operator approved this draft as written. Keep this structure and tone.';
}

export { DEMO_PROSPECT, demoPageHtml };
