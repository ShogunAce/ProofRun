// Spend and resource limits for the public demo.
//
// A ProofRun run is not a cheap request: it launches Chromium twice, peaks
// around 327MB, and spends 30-65k Nebius tokens. On a public URL with no
// limits, one person with a loop can exhaust the token budget and OOM the
// container. These gates exist so the demo URL can be handed to strangers.
//
// Three gates, ordered by how hard each is to evade:
//
//   1. concurrency - how many runs may be in flight at once. Counted from the
//      runner's own state rather than a tally kept here, so a run that throws
//      cannot leak a slot. This is the gate that protects memory and CPU.
//   2. per-client  - a sliding window keyed on client IP. Stops the obvious
//      case: one person clicking Start repeatedly.
//   3. global      - a sliding window across all clients. This is the actual
//      spend ceiling, and the only gate that holds when IPs rotate.
//
// Honest about what this is not: state lives in this process's memory. On a
// scale-to-zero host every cold start resets the windows, and with more than
// one instance each keeps its own, so the global ceiling is really
// per-instance. Capping instances (--max-instances) is what makes the total
// bounded; this file makes each instance well behaved. A shared counter would
// need Redis, which is a database, which this project deliberately does not
// have.

const MINUTE = 60_000;

const num = (name, fallback) => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
};

export const limits = {
  // Set PROOFRUN_RATE_LIMIT=off for local development and the try-* scripts,
  // which legitimately start runs back to back.
  enabled: (process.env.PROOFRUN_RATE_LIMIT || 'on').toLowerCase() !== 'off',
  concurrentRuns: num('PROOFRUN_MAX_CONCURRENT_RUNS', 2),
  runsPerClient: num('PROOFRUN_RUNS_PER_CLIENT', 3),
  runsPerClientWindowMin: num('PROOFRUN_RUNS_PER_CLIENT_WINDOW_MIN', 10),
  runsGlobal: num('PROOFRUN_RUNS_GLOBAL', 20),
  runsGlobalWindowMin: num('PROOFRUN_RUNS_GLOBAL_WINDOW_MIN', 60),
  cheapPerClient: num('PROOFRUN_CHEAP_PER_CLIENT', 20),
  cheapPerClientWindowMin: num('PROOFRUN_CHEAP_PER_CLIENT_WINDOW_MIN', 10),
};

/**
 * A sliding window of event timestamps per key. Prunes on read, so a key that
 * stops being used costs nothing until the sweep collects it.
 */
class Window {
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  /** Seconds until the oldest hit in the window expires, or 0 if there is room. */
  retryAfter(key, now = Date.now()) {
    // A max of 0 is how an operator turns a route off entirely; there is no
    // oldest hit to wait for, so quote the whole window.
    if (this.max <= 0) return Math.max(1, Math.ceil(this.windowMs / 1000));
    const kept = this.#prune(key, now);
    if (kept.length < this.max) return 0;
    return Math.max(1, Math.ceil((kept[0] + this.windowMs - now) / 1000));
  }

  record(key, now = Date.now()) {
    const kept = this.#prune(key, now);
    kept.push(now);
    this.hits.set(key, kept);
    if (this.hits.size > 5_000) this.#sweep(now);
  }

  used(key, now = Date.now()) {
    return this.#prune(key, now).length;
  }

  #prune(key, now) {
    const cutoff = now - this.windowMs;
    const kept = (this.hits.get(key) || []).filter((t) => t > cutoff);
    if (kept.length) this.hits.set(key, kept);
    else this.hits.delete(key);
    return kept;
  }

  // Unbounded key growth is the one way an in-memory limiter becomes the
  // denial of service it was meant to prevent.
  #sweep(now) {
    const cutoff = now - this.windowMs;
    for (const [key, times] of this.hits) {
      if (!times.some((t) => t > cutoff)) this.hits.delete(key);
    }
  }
}

const runsPerClient = new Window(limits.runsPerClient, limits.runsPerClientWindowMin * MINUTE);
const runsGlobally = new Window(limits.runsGlobal, limits.runsGlobalWindowMin * MINUTE);
const cheapPerClient = new Window(limits.cheapPerClient, limits.cheapPerClientWindowMin * MINUTE);

const GLOBAL_KEY = '*';

/**
 * Who is calling. Behind Cloud Run, Express needs `trust proxy` set for req.ip
 * to read X-Forwarded-For at all; see the comment where that is configured.
 * This is advisory — a spoofable header is fine for the per-client gate, which
 * only has to stop impatient clicking, and is why the global gate exists.
 */
export const clientKey = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

const denial = (message, retryAfter, detail) => ({ message, retryAfter, detail });

/**
 * Gate for starting a run. Returns null when allowed, or a denial to report.
 * Does not record the attempt: call `recordRun` only once the run has actually
 * started, so a run rejected for some other reason does not consume quota.
 */
export function checkRun({ req, runningCount }) {
  if (!limits.enabled) return null;
  const now = Date.now();

  if (runningCount >= limits.concurrentRuns) {
    // No useful retry-after here: it depends on how long the running runs
    // take. A run is 2-4 minutes, so suggest the short end.
    return denial(
      `${runningCount} run${runningCount === 1 ? ' is' : 's are'} already in flight and the demo allows ${limits.concurrentRuns} at a time. A run takes two to four minutes.`,
      60,
      { gate: 'concurrency', limit: limits.concurrentRuns, current: runningCount },
    );
  }

  const globalWait = runsGlobally.retryAfter(GLOBAL_KEY, now);
  if (globalWait) {
    return denial(
      `This demo allows ${limits.runsGlobal} runs per ${limits.runsGlobalWindowMin} minutes and has reached that ceiling. Clone the repo to run it without limits.`,
      globalWait,
      { gate: 'global', limit: limits.runsGlobal, windowMinutes: limits.runsGlobalWindowMin },
    );
  }

  const clientWait = runsPerClient.retryAfter(clientKey(req), now);
  if (clientWait) {
    return denial(
      `You have started ${limits.runsPerClient} runs in the last ${limits.runsPerClientWindowMin} minutes. Each one spends real tokens, so the demo asks you to wait.`,
      clientWait,
      { gate: 'client', limit: limits.runsPerClient, windowMinutes: limits.runsPerClientWindowMin },
    );
  }

  return null;
}

export function recordRun(req) {
  if (!limits.enabled) return;
  const now = Date.now();
  runsPerClient.record(clientKey(req), now);
  runsGlobally.record(GLOBAL_KEY, now);
}

/**
 * Gate for the cheap model-backed routes — a redraft or a brief is one call,
 * not eleven, so they share a single looser per-client budget and are not
 * subject to the concurrency or global gates.
 */
export function checkCheap(req) {
  if (!limits.enabled) return null;
  const key = clientKey(req);
  const wait = cheapPerClient.retryAfter(key);
  if (wait) {
    return denial(
      `Too many requests. The demo allows ${limits.cheapPerClient} of these every ${limits.cheapPerClientWindowMin} minutes.`,
      wait,
      { gate: 'cheap', limit: limits.cheapPerClient, windowMinutes: limits.cheapPerClientWindowMin },
    );
  }
  cheapPerClient.record(key);
  return null;
}

/** For /api/meta, so the UI can tell a visitor the limits before they hit one. */
export function limitsDescription(runningCount = 0) {
  if (!limits.enabled) return { enabled: false };
  return {
    enabled: true,
    concurrent_runs: { limit: limits.concurrentRuns, current: runningCount },
    runs_per_client: { limit: limits.runsPerClient, window_minutes: limits.runsPerClientWindowMin },
    runs_total: {
      limit: limits.runsGlobal,
      window_minutes: limits.runsGlobalWindowMin,
      used: runsGlobally.used(GLOBAL_KEY),
    },
    note: 'In-memory and per instance, so these reset on a cold start. Clone the repo to run without limits.',
  };
}
