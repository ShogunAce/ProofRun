// What is configured, what is missing, and what still works without it.
//   npm run check:env
import fs from 'node:fs';
import { env, paths, routing } from '../tools/config.js';
import { limits } from '../web/rate-limit.js';

const rows = [];
const add = (name, ok, detail) => rows.push({ name, ok, detail });

add('NEBIUS_API_KEY', Boolean(env.nebiusKey), env.nebiusKey ? `set (${env.nebiusKey.length} chars)` : 'MISSING - no model calls possible');
add('NEBIUS_BASE_URL', true, env.nebiusBaseUrl);
for (const [role, spec] of Object.entries(routing.roles || {})) {
  const model = process.env[spec.model_env];
  add(`role:${role}`, Boolean(model), model ? `${model} @ ${process.env[spec.region_env] || 'global'}` : `MISSING ${spec.model_env}`);
}
add('TAVILY_API_KEY', Boolean(env.tavilyKey), env.tavilyKey ? 'set - live discovery available' : 'missing - demo mode still works');
add('SANDBOX_MODE', true, env.sandboxMode);
add('PROOFRUN_MODE', true, env.mode);
add('PUBLIC_BASE_URL', true, env.publicBaseUrl);
add(
  'PROOFRUN_RATE_LIMIT',
  true,
  limits.enabled
    ? `on - ${limits.concurrentRuns} concurrent, ${limits.runsPerClient}/client per ${limits.runsPerClientWindowMin}min, ${limits.runsGlobal} total per ${limits.runsGlobalWindowMin}min`
    : 'off - no ceiling on model spend. Correct locally, wrong on a public URL',
);
add('memory/', fs.existsSync(paths.memory), paths.memory);
add('config/voice.md', fs.existsSync(paths.p('config/voice.md')), 'fill this in with your own writing');

let bad = 0;
console.log('');
for (const r of rows) {
  if (!r.ok) bad += 1;
  console.log(`  ${r.ok ? 'ok  ' : 'MISS'}  ${r.name.padEnd(28)} ${r.detail}`);
}
console.log(bad === 0 ? '\nEnvironment complete.\n' : `\n${bad} item(s) need attention.\n`);
process.exit(0);
