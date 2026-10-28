// Phase 2 end-to-end: the whole ProofRun loop on the console, streaming the
// same events the Live Run screen renders.
//
//   node scripts/try-phase2.js                      # demo mode
//   node scripts/try-phase2.js --live plumbers "San Diego, CA"
import { closeBrowser } from '../tools/capture.js';
import { runProofRun } from '../skills/proofrun/runner.js';

const live = process.argv.includes('--live');
const [, , , niche, city] = process.argv;

const ICON = {
  running: '>>', done: 'ok', failed: 'XX', skipped: '--', waiting: '..',
};

const run = await runProofRun({
  mode: live ? 'live' : 'demo',
  niche: live ? niche : undefined,
  city: live ? city : undefined,
});

run.subscribe((e) => {
  if (e.type === 'run-start') {
    console.log(`\nRun ${run.id} — ${run.mode} mode`);
    console.log(`Sandbox: ${e.sandbox.mode}`);
    console.log(`Steps: ${e.steps.join(' > ')}\n`);
  } else if (e.type === 'step') {
    console.log(`\n[${ICON[e.status] || e.status}] ${e.step.toUpperCase()}${e.detail ? ` — ${e.detail}` : ''}`);
  } else if (e.type === 'trace') {
    const t = e.trace;
    if (t.truncated) console.log(`      ~ ${t.role}: ${t.note}`);
    else if (t.failed) console.log(`      ! ${t.role} ${t.model} ${t.status || ''} ${String(t.error).slice(0, 100)}`);
    else console.log(`      · ${t.role} -> ${t.model.split('/')[1]} ${t.ms}ms ${t.usage?.total_tokens || 0}tok${t.reasoning_chars ? ` (${t.reasoning_chars} reasoning chars)` : ''}`);
  } else if (e.type === 'log') {
    console.log(`      ${e.level.padEnd(10)} ${e.message}`);
  } else if (e.type === 'error') {
    console.log(`\nERROR${e.step ? ` in ${e.step}` : ''}: ${e.message}`);
  } else if (e.type === 'run-done') {
    const r = e.result;
    console.log('\n' + '-'.repeat(70));
    console.log(`Outcome:        ${r.outcome}`);
    console.log(`Score:          ${r.before} -> ${r.after ?? 'n/a'}`);
    if (r.comparison) {
      console.log(`Comparable:     ${r.comparison.before} -> ${r.comparison.after} (delta ${r.comparison.delta >= 0 ? '+' : ''}${r.comparison.delta}) over ${r.comparison.comparable_count} checks`);
      console.log(`Fixed:          ${r.comparison.fixed.join(', ') || 'none'}`);
      if (r.comparison.still_failing.length) console.log(`Still failing:  ${r.comparison.still_failing.join(', ')}`);
      console.log(`Excluded:       ${r.comparison.excluded.map((x) => x.id).join(', ') || 'none'}`);
    }
    console.log(`Repairs used:   ${r.attemptsUsed} of ${r.cap}`);
    console.log(`Findings:       ${r.findings}`);
    console.log(`Draft written:  ${r.drafted ? 'yes' : 'no'}`);
    console.log(`Model calls:    ${r.modelCalls}, ${r.tokens} tokens, ${(r.ms / 1000).toFixed(1)}s wall clock`);
    console.log('-'.repeat(70) + '\n');
  }
});

await run.promise;
await closeBrowser();
process.exit(run.state === 'done' ? 0 : 1);
