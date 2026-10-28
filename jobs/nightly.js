// The nightly batch. Designed to run as a Nebius Serverless Job, and runnable
// anywhere Node is:
//
//   node jobs/nightly.js
//   node jobs/nightly.js --count 5 --niche plumbers --city "San Diego, CA"
//
// The "Run now" button in the UI starts a single run through the same code
// path; this just loops it and writes the brief at the end.
//
// One prospect failing never aborts the batch: each is caught, recorded, and
// the loop continues. That is the point of a batch that runs while nobody is
// watching.
import { closeBrowser } from '../tools/capture.js';
import { env, niches } from '../tools/config.js';
import * as store from '../tools/store.js';
import { runProofRun } from '../skills/proofrun/runner.js';
import { buildMorningBrief } from '../agent/brief.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

async function main() {
  const count = Number(arg('count', env.nightlyBatch));
  const mode = arg('mode', env.mode);
  const started = Date.now();

  // Rotate through the configured niches so a batch does not hammer one city.
  const pool = niches.niches?.length ? niches.niches : [niches.default];
  const explicitNiche = arg('niche', null);
  const explicitCity = arg('city', null);

  console.log(`\nProofRun nightly batch — ${count} prospect(s), ${mode} mode, ${new Date().toISOString()}`);

  const results = [];
  for (let i = 0; i < count; i += 1) {
    const target = explicitNiche
      ? { niche: explicitNiche, city: explicitCity || niches.default.city }
      : pool[i % pool.length];

    console.log(`\n[${i + 1}/${count}] ${target.niche} in ${target.city}`);
    try {
      const run = await runProofRun({ niche: target.niche, city: target.city, mode });
      run.subscribe((e) => {
        if (e.type === 'step') console.log(`    ${e.status.padEnd(8)} ${e.step}${e.detail ? ` — ${e.detail}` : ''}`);
        else if (e.type === 'error') console.log(`    ERROR ${e.message}`);
      });
      const result = await run.promise;
      results.push({ ok: Boolean(result), target, result, runId: run.id });
      if (result) {
        console.log(`    => ${result.outcome}: ${result.before} -> ${result.after ?? 'n/a'}, ${result.attemptsUsed} repair(s), draft ${result.drafted ? 'written' : 'skipped'}`);
      }
    } catch (err) {
      // Record and carry on. A batch is not allowed to die on one prospect.
      console.log(`    => failed: ${String(err.message).slice(0, 200)}`);
      results.push({ ok: false, target, error: String(err.message).slice(0, 300) });
      store.appendRunLog(store.today(), `- nightly batch item ${i + 1} failed: ${String(err.message).slice(0, 200)}`);
    }
  }

  const passed = results.filter((r) => r.result?.outcome === 'passed').length;
  const drafted = results.filter((r) => r.result?.drafted).length;

  console.log('\nWriting the Morning Brief');
  let brief = null;
  try {
    brief = await buildMorningBrief();
    console.log(`  ${brief.what_ran}`);
  } catch (err) {
    console.log(`  brief generation failed: ${err.message}`);
  }

  store.appendRunLog(store.today(), [
    '',
    `### Nightly batch summary (${mode} mode)`,
    '',
    `- Attempted: ${results.length}`,
    `- Passed verification: ${passed}`,
    `- Drafts awaiting approval: ${drafted}`,
    `- Failed: ${results.filter((r) => !r.result).length}`,
    `- Wall clock: ${((Date.now() - started) / 1000).toFixed(0)}s`,
    '',
  ].join('\n'));

  console.log(`\nDone. ${passed}/${results.length} passed verification, ${drafted} draft(s) awaiting approval, ${((Date.now() - started) / 1000).toFixed(0)}s.\n`);

  await closeBrowser();
  // Exit non-zero only if nothing at all got through, so a scheduler can alert.
  process.exit(passed === 0 && results.length > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await closeBrowser();
  process.exit(1);
});
