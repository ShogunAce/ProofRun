// ProofRun web server.
//
// A thin API over the file-based memory plus an SSE stream per run. No
// database, no client framework, no build step: the six screens are static
// files that fetch JSON.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, paths, operator, niches, routing } from '../tools/config.js';
import { CHECK_CATALOG, BUDGETS, VIEWPORTS } from '../tools/checks.js';
import { routingTable } from '../tools/nebius.js';
import * as sandbox from '../tools/sandbox.js';
import * as store from '../tools/store.js';
import * as tavily from '../tools/tavily.js';
import { listSkills } from '../agent/core.js';
import { getRun, listRuns, recordDecision, redraft, runProofRun, STEPS } from '../skills/proofrun/runner.js';
import { buildMorningBrief, readTodaysBrief } from '../agent/brief.js';
import { exportApproved } from '../agent/send-adapter.js';
import { checkCheap, checkRun, limitsDescription, recordRun } from './rate-limit.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Behind Cloud Run the socket address is the load balancer, so the rate
// limiter cannot tell clients apart without X-Forwarded-For. Express counts
// hops from the right and treats the next address as the client, so 1 is
// correct for a single front end: a client who sends their own
// X-Forwarded-For adds entries to the left, where they are ignored. Set
// TRUST_PROXY_HOPS=0 when running with no proxy in front.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(HERE, 'public'), { extensions: ['html'] }));

const ok = (res, data) => res.json({ ok: true, ...data });
const fail = (res, code, message, extra = {}) => res.status(code).json({ ok: false, error: message, ...extra });

/** A denial from the rate limiter, with the header a well-behaved client reads. */
const tooMany = (res, denial) => {
  res.set('retry-after', String(denial.retryAfter));
  return fail(res, 429, denial.message, { retry_after_seconds: denial.retryAfter, limit: denial.detail });
};

const runningCount = () => listRuns().filter((r) => r.state === 'running').length;

// --------------------------------------------------------------------------
// Config and self-description
// --------------------------------------------------------------------------

app.get('/api/meta', (req, res) => {
  ok(res, {
    mode: env.mode,
    maxRetries: env.maxRetries,
    publicBaseUrl: env.publicBaseUrl,
    tavily: tavily.available(),
    nebius: Boolean(env.nebiusKey),
    routing: routingTable(),
    routingNotes: {
      fallback: routing.$fallback_note,
      maxTokens: routing.$max_tokens_note,
    },
    sandbox: sandbox.sandboxDescription(),
    checks: CHECK_CATALOG,
    budgets: BUDGETS,
    viewports: VIEWPORTS,
    steps: STEPS,
    niches: niches.niches,
    defaultNiche: niches.default,
    skills: listSkills(),
    limits: limitsDescription(runningCount()),
  });
});

// --------------------------------------------------------------------------
// Queue
// --------------------------------------------------------------------------

app.get('/api/prospects', (req, res) => {
  const list = store.listProspects().map((p) => ({
    id: p.id,
    business_name: p.business_name,
    url: p.url,
    city: p.city,
    niche: p.niche,
    status: p.status,
    demo: Boolean(p.demo),
    created_at: p.created_at,
    updated_at: p.updated_at,
    scores: p.scores || null,
    verification: p.verification
      ? { outcome: p.verification.outcome, attempts: p.verification.attempts, cap: p.verification.cap, summary: p.verification.summary || null }
      : null,
    findings: p.audit?.findings?.length || 0,
    high_severity: p.audit?.findings?.filter((f) => f.severity === 'high').length || 0,
    has_draft: Boolean(p.draft),
    edits: p.user_edits?.length || 0,
    last_run_id: p.last_run_id || null,
  }));
  ok(res, { prospects: list, statuses: store.STATUSES });
});

app.get('/api/prospects/:id', (req, res) => {
  const p = store.loadProspect(req.params.id);
  if (!p) return fail(res, 404, `No prospect "${req.params.id}"`);
  return ok(res, { prospect: p });
});

// --------------------------------------------------------------------------
// Runs
// --------------------------------------------------------------------------

app.post('/api/runs', async (req, res) => {
  const { niche, city, mode } = req.body || {};
  const useMode = mode === 'live' ? 'live' : mode === 'demo' ? 'demo' : env.mode;

  if (useMode === 'live' && !tavily.available()) {
    return fail(res, 400, 'Live mode needs TAVILY_API_KEY. Demo mode works without it.');
  }
  if (!env.nebiusKey) {
    return fail(res, 400, 'NEBIUS_API_KEY is not set, so no model calls are possible.');
  }

  // Checked after the cheap validation above so a misconfigured request does
  // not consume someone's quota, and recorded only once the run exists.
  const denial = checkRun({ req, runningCount: runningCount() });
  if (denial) return tooMany(res, denial);

  const run = await runProofRun({ niche, city, mode: useMode });
  recordRun(req);
  return ok(res, { runId: run.id, mode: run.mode });
});

app.get('/api/runs', (req, res) => {
  ok(res, {
    runs: listRuns().map((r) => ({
      id: r.id, mode: r.mode, state: r.state, startedAt: r.startedAt,
      prospectId: r.prospectId, result: r.result,
      lastStep: [...r.events].reverse().find((e) => e.type === 'step') || null,
    })),
  });
});

app.get('/api/runs/:id', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    // Not in memory any more; fall back to the artifacts on disk.
    const attempts = store.readRunJson(req.params.id, 'attempts.json');
    if (!attempts) return fail(res, 404, `No run "${req.params.id}"`);
    return ok(res, { run: { id: req.params.id, state: 'archived', attempts, events: [], traces: [] } });
  }
  return ok(res, { run: run.snapshot() });
});

/** Server-sent events: the Live Run screen's feed. Replays the transcript first. */
app.get('/api/runs/:id/stream', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return fail(res, 404, `No run "${req.params.id}"`);

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  const send = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  for (const e of run.events) send(e);
  if (run.state !== 'running') send({ type: 'closed', state: run.state });

  const unsubscribe = run.subscribe(send);
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 15_000);

  req.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
  return undefined;
});

// --------------------------------------------------------------------------
// Approval: the memory write path
// --------------------------------------------------------------------------

app.post('/api/prospects/:id/decision', async (req, res) => {
  const { decision, note, subject, body, rule } = req.body || {};
  try {
    const out = await recordDecision({
      prospectId: req.params.id,
      decision,
      note,
      editedSubject: subject,
      editedBody: body,
      rule,
    });
    return ok(res, { prospect: out.prospect, rule: out.rule, learning: out.learning });
  } catch (err) {
    return fail(res, 400, err.message);
  }
});

/**
 * Redraft using whatever is in memory now. The audit and the proof are
 * untouched, so the only thing that changed between versions is memory.
 */
app.post('/api/prospects/:id/redraft', async (req, res) => {
  const denial = checkCheap(req);
  if (denial) return tooMany(res, denial);
  try {
    const out = await redraft(req.params.id);
    return ok(res, {
      prospect: out.prospect,
      draft: out.draft,
      previous: out.previous,
      learnings: out.learnings,
      traces: out.traces,
    });
  } catch (err) {
    return fail(res, 400, err.message);
  }
});

// --------------------------------------------------------------------------
// Memory viewer (read-only)
// --------------------------------------------------------------------------

app.get('/api/memory', (req, res) => {
  ok(res, {
    profile: store.readProfile(),
    learnings: store.readLearnings(),
    rules: store.learningRules(50),
    voice: operator.voice,
    offer: operator.offer,
    template: operator.template,
    runLogs: store.listRunLogs(),
    files: {
      profile: 'memory/profile.md',
      learnings: 'memory/learnings.md',
      voice: 'config/voice.md',
      offer: 'config/offer.md',
      template: 'config/outreach_template.md',
    },
  });
});

app.get('/api/memory/runs/:name', (req, res) => {
  const name = path.basename(req.params.name);
  const text = store.readRunLog(name);
  if (!text) return fail(res, 404, `No run log "${name}"`);
  return ok(res, { name, text });
});

// --------------------------------------------------------------------------
// Morning Brief
// --------------------------------------------------------------------------

app.get('/api/brief', async (req, res) => {
  // Today's brief is cached on disk; only a rebuild costs a model call.
  const regenerate = req.query.refresh === '1';
  if (regenerate || !readTodaysBrief()) {
    const denial = checkCheap(req);
    if (denial) return tooMany(res, denial);
  }
  try {
    const brief = regenerate ? await buildMorningBrief() : (readTodaysBrief() || await buildMorningBrief());
    return ok(res, { brief });
  } catch (err) {
    return fail(res, 500, err.message);
  }
});

// --------------------------------------------------------------------------
// Artifacts: screenshots and mockups
// --------------------------------------------------------------------------

app.get('/api/runs/:id/shot/:name', (req, res) => {
  const file = path.join(paths.dataRuns, path.basename(req.params.id), path.basename(req.params.name));
  if (!fs.existsSync(file)) return fail(res, 404, 'No such screenshot');
  res.setHeader('cache-control', 'public, max-age=3600');
  return res.sendFile(file);
});

/**
 * Serves a generated mockup. Sandboxed with CSP so a preview cannot execute
 * script or reach the network even though the static gate already rejects both.
 */
app.get('/mockup/:prospectId', (req, res) => {
  const id = path.basename(req.params.prospectId);
  const attempt = /^[a-z0-9-]+$/i.test(String(req.query.attempt || '')) ? req.query.attempt : 'final';
  const file = store.mockupPath(id, attempt);
  if (!fs.existsSync(file)) return fail(res, 404, 'No mockup for this prospect yet.');
  res.setHeader(
    'content-security-policy',
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; script-src 'none'; frame-ancestors 'self'",
  );
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('x-robots-tag', 'noindex, nofollow');
  return res.send(fs.readFileSync(file, 'utf8'));
});

// --------------------------------------------------------------------------
// Export adapter. This is the only thing resembling a send path, and it does
// not send: it writes approved drafts to a file for a human to use.
// --------------------------------------------------------------------------

app.post('/api/export', async (req, res) => {
  try {
    const out = await exportApproved();
    return ok(res, out);
  } catch (err) {
    return fail(res, 500, err.message);
  }
});

app.get('/api/health', (req, res) => ok(res, { mode: env.mode, nebius: Boolean(env.nebiusKey), tavily: tavily.available() }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return fail(res, 404, `No route ${req.path}`);
  return res.sendFile(path.join(HERE, 'public', 'index.html'));
});

const server = app.listen(env.port, () => {
  console.log(`\nProofRun on http://localhost:${env.port}`);
  console.log(`  mode: ${env.mode}  |  nebius: ${env.nebiusKey ? 'configured' : 'MISSING'}  |  tavily: ${tavily.available() ? 'configured' : 'not configured (demo mode only)'}`);
  console.log(`  sandbox: ${sandbox.sandboxDescription().mode}  |  retry cap: ${env.maxRetries}\n`);
});

process.on('SIGINT', () => { server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });

export { app, server };
