// Proves the rate limiter actually denies, and denies for the right reason.
//
//   node scripts/try-limits.js
//
// The gates are the only thing standing between a public URL and an
// unbounded Nebius bill, so "it looks right" is not good enough. Each case
// below configures the limiter through the environment, exercises it, and
// asserts both the decision and which gate made it.
//
// Runs no model calls and starts no runs: it drives the limiter directly.
process.env.PROOFRUN_RATE_LIMIT = 'on';
process.env.PROOFRUN_MAX_CONCURRENT_RUNS = '2';
process.env.PROOFRUN_RUNS_PER_CLIENT = '3';
process.env.PROOFRUN_RUNS_PER_CLIENT_WINDOW_MIN = '10';
process.env.PROOFRUN_RUNS_GLOBAL = '5';
process.env.PROOFRUN_RUNS_GLOBAL_WINDOW_MIN = '60';
process.env.PROOFRUN_CHEAP_PER_CLIENT = '2';

const { checkRun, recordRun, checkCheap, limitsDescription } = await import('../web/rate-limit.js');

let failures = 0;

function check(label, condition, detail = '') {
  const mark = condition ? 'ok  ' : 'FAIL';
  if (!condition) failures += 1;
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ''}`);
}

const req = (ip) => ({ ip });

console.log('\nconcurrency gate');
{
  const idle = checkRun({ req: req('1.1.1.1'), runningCount: 0 });
  check('allows a run when nothing is in flight', idle === null);

  const busy = checkRun({ req: req('1.1.1.1'), runningCount: 2 });
  check('denies at the cap', busy !== null && busy.detail.gate === 'concurrency', busy?.detail?.gate);
  check('quotes a retry-after', busy?.retryAfter > 0, `${busy?.retryAfter}s`);
}

console.log('\nper-client gate');
{
  const alice = req('10.0.0.1');
  for (let i = 0; i < 3; i += 1) {
    const d = checkRun({ req: alice, runningCount: 0 });
    check(`run ${i + 1} of 3 allowed`, d === null, d?.detail?.gate);
    recordRun(alice);
  }
  const fourth = checkRun({ req: alice, runningCount: 0 });
  check('denies the 4th', fourth !== null && fourth.detail.gate === 'client', fourth?.detail?.gate);
  check('retry-after is within the window', fourth?.retryAfter > 0 && fourth?.retryAfter <= 600, `${fourth?.retryAfter}s`);

  // The whole point of a per-client window: another visitor is unaffected.
  const bob = checkRun({ req: req('10.0.0.2'), runningCount: 0 });
  check('a different client is unaffected', bob === null, bob?.detail?.gate);
}

console.log('\nglobal gate (the real spend ceiling)');
{
  // 3 are already recorded by alice above; 2 more from fresh IPs reach 5.
  recordRun(req('10.0.0.2'));
  recordRun(req('10.0.0.3'));

  const blocked = checkRun({ req: req('10.0.0.4'), runningCount: 0 });
  check('denies a brand-new client once the total is reached', blocked !== null, blocked?.detail?.gate);
  check('and blames the global gate, not the client', blocked?.detail?.gate === 'global', blocked?.detail?.gate);

  const desc = limitsDescription(1);
  check('reports usage for the UI', desc.runs_total.used === 5, `used ${desc.runs_total.used}/${desc.runs_total.limit}`);
}

console.log('\ncheap routes (redraft, brief rebuild)');
{
  const carol = req('10.1.0.1');
  check('1st allowed', checkCheap(carol) === null);
  check('2nd allowed', checkCheap(carol) === null);
  const third = checkCheap(carol);
  check('3rd denied', third !== null && third.detail.gate === 'cheap', third?.detail?.gate);
  check('a different client is unaffected', checkCheap(req('10.1.0.2')) === null);
}

console.log('\nwindow expiry');
{
  // Limiter state is module-level, so reimport with a 1-minute window and
  // fake the clock rather than sleeping for ten real minutes.
  process.env.PROOFRUN_RUNS_PER_CLIENT = '1';
  process.env.PROOFRUN_RUNS_PER_CLIENT_WINDOW_MIN = '1';
  const fresh = await import(`../web/rate-limit.js?expiry=${Date.now()}`);
  const dave = req('10.2.0.1');

  fresh.recordRun(dave);
  check('denied immediately after using the quota', fresh.checkRun({ req: dave, runningCount: 0 }) !== null);

  const realNow = Date.now;
  Date.now = () => realNow() + 61_000;
  try {
    check('allowed again once the window passes', fresh.checkRun({ req: dave, runningCount: 0 }) === null);
  } finally {
    Date.now = realNow;
  }
}

console.log('\ndisabled by configuration');
{
  process.env.PROOFRUN_RATE_LIMIT = 'off';
  const off = await import(`../web/rate-limit.js?off=${Date.now()}`);
  check('PROOFRUN_RATE_LIMIT=off allows a run past every gate',
    off.checkRun({ req: req('10.3.0.1'), runningCount: 99 }) === null);
  check('and says so to the UI', off.limitsDescription().enabled === false);
}

console.log(failures ? `\n${failures} check(s) FAILED\n` : '\nAll checks passed.\n');
process.exit(failures ? 1 : 0);
