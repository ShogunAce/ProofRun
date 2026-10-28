// Verifies the Token Factory key, lists the models it can see per region, and
// confirms every model ID in .env actually answers a request.
//
//   npm run check:models
import { env, routing } from '../tools/config.js';
import { complete, listModels, regionalUrl, routingTable } from '../tools/nebius.js';

const REGIONS = [...new Set(
  Object.values(routing.roles || {})
    .map((r) => process.env[r.region_env])
    .filter(Boolean),
)];

const pad = (s, n) => String(s).padEnd(n);

async function main() {
  if (!env.nebiusKey) {
    console.error('NEBIUS_API_KEY is not set. Copy .env.example to .env and add your key.');
    process.exit(2);
  }

  console.log(`\nGlobal endpoint: ${env.nebiusBaseUrl}`);
  const endpoints = [env.nebiusBaseUrl, ...REGIONS.map(regionalUrl)];
  const seen = new Map();

  for (const ep of endpoints) {
    try {
      const models = await listModels(ep);
      const nemotron = models.filter((m) => /nemotron/i.test(m.id));
      console.log(`\n${ep}\n  ${models.length} model(s) visible, ${nemotron.length} Nemotron:`);
      for (const m of nemotron) {
        console.log(`    ${m.id}`);
        seen.set(m.id, ep);
      }
    } catch (err) {
      console.log(`\n${ep}\n  could not list models: ${err.message.slice(0, 160)}`);
    }
  }

  console.log('\nRouting table:');
  for (const r of routingTable()) {
    console.log(`  ${pad(r.role, 18)} ${pad(r.model, 42)} ${r.region || '-'}`);
  }

  console.log('\nLive one-token probe per distinct model:');
  const roles = routingTable();
  const byModel = new Map();
  for (const r of roles) if (!byModel.has(r.model)) byModel.set(r.model, r.role);

  let failures = 0;
  for (const [model, role] of byModel) {
    if (model.startsWith('(unset')) {
      console.log(`  FAIL  ${pad(model, 42)} not configured`);
      failures += 1;
      continue;
    }
    try {
      const res = await complete({
        role,
        system: 'Reply with the single word: ok',
        user: 'ok?',
        maxTokens: 2000,
        allowFallbackModel: false,
      });
      console.log(`  OK    ${pad(model, 42)} ${res.trace.ms}ms via ${res.trace.endpoint}`);
    } catch (err) {
      failures += 1;
      console.log(`  FAIL  ${pad(model, 42)} ${err.status || ''} ${String(err.message).slice(0, 140)}`);
    }
  }

  console.log(
    failures === 0
      ? '\nAll configured models answered.\n'
      : `\n${failures} model(s) did not answer. Fix .env or config/routing.json before running ProofRun in live mode.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
