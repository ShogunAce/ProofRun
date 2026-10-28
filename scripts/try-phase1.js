// Phase 1 end-to-end check against one real public site:
//   Tavily search (optional) -> page text -> context extraction (fast model)
//   -> Playwright capture + check suite -> structured audit (reasoning model)
//
//   node scripts/try-phase1.js https://example-business.com
//   node scripts/try-phase1.js --search "plumbers San Diego CA"
import { capture, closeBrowser, extractText } from '../tools/capture.js';
import { completeStructured } from '../tools/nebius.js';
import { paths, niches } from '../tools/config.js';
import * as tavily from '../tools/tavily.js';
import { auditJsonSchema, auditZ, contextJsonSchema, contextZ, screenJsonSchema, screenZ } from '../agent/schemas.js';
import { auditPrompt, contextPrompt, screenPrompt } from '../skills/proofrun/prompts.js';

const traces = [];
const onTrace = (t) => {
  traces.push(t);
  const tag = t.failed ? 'FAIL' : ' ok ';
  console.log(`  [${tag}] ${t.role} via ${t.model} @ ${t.endpoint} ${t.ms}ms ${t.usage ? `${t.usage.total_tokens} tok` : ''}${t.error ? ` :: ${t.error.slice(0, 120)}` : ''}`);
};

const arg = process.argv[2];

async function pickUrlBySearch(query) {
  console.log(`\n1. Tavily search: "${query}"`);
  const hits = await tavily.search(query, { maxResults: 8 });
  console.log(`   ${hits.length} hit(s)`);
  for (const hit of hits) {
    const { system, user } = screenPrompt({ hit, niche: query, city: '', disqualifiers: niches.disqualify_if || [] });
    const { data } = await completeStructured({ role: 'classify', system, user, schema: screenZ, jsonSchema: screenJsonSchema, schemaName: 'screen', onTrace });
    console.log(`   ${data.verdict === 'audit' ? 'AUDIT' : 'skip '} ${hit.url} — ${data.reason}`);
    if (data.verdict === 'audit') return hit.url;
  }
  throw new Error('No hit screened as auditable.');
}

async function main() {
  let url = arg;
  if (arg === '--search') url = await pickUrlBySearch(process.argv[3]);
  if (!url) {
    console.error('usage: node scripts/try-phase1.js <url> | --search "<query>"');
    process.exit(2);
  }

  console.log(`\n2. Reading page text: ${url}`);
  const { text } = await extractText(url);
  console.log(`   ${text.length} chars of visible text`);

  console.log('\n3. Extracting business context (fast tier)');
  const ctx = await completeStructured({
    role: 'extract',
    ...contextPrompt({ url, text }),
    schema: contextZ,
    jsonSchema: contextJsonSchema,
    schemaName: 'business_context',
    onTrace,
  });
  console.log(JSON.stringify(ctx.data, null, 2));

  console.log('\n4. Capture + check suite');
  const cap = await capture({
    url,
    label: 'before',
    outDir: paths.p('data', 'runs', 'phase1'),
    onLog: (l) => console.log(`   [${l.level}] ${l.message}`),
  });
  for (const c of cap.checks) {
    console.log(`   ${c.status.toUpperCase().padEnd(7)} ${c.id.padEnd(22)} ${String(c.evidence).slice(0, 100)}`);
  }

  console.log('\n5. Structured audit (reasoning tier)');
  const audit = await completeStructured({
    role: 'audit',
    ...auditPrompt({ url, context: ctx.data, capture: cap, pageText: text }),
    schema: auditZ,
    jsonSchema: auditJsonSchema,
    schemaName: 'site_audit',
    onTrace,
  });

  console.log(`\n   Business: ${audit.data.business.name} — ${audit.data.business.what_they_do}`);
  console.log(`   Goal: ${audit.data.business.primary_conversion_goal}`);
  console.log(`\n   Verdict: ${audit.data.overall.verdict}`);
  console.log(`\n   ${audit.data.findings.length} findings:`);
  for (const f of audit.data.findings) {
    console.log(`\n   - ${f.title}`);
    console.log(`     severity ${f.severity} | confidence ${f.confidence} (${f.confidence_reason})`);
    console.log(`     source: ${f.evidence_source}`);
    console.log(`     evidence: ${f.evidence}`);
    console.log(`     impact: ${f.business_impact}`);
    console.log(`     fix: ${f.fix}`);
  }
  console.log(`\n   Redesign brief: ${audit.data.overall.redesign_brief}`);

  const totalTokens = traces.reduce((s, t) => s + (t.usage?.total_tokens || 0), 0);
  console.log(`\nPhase 1 OK. Score ${cap.score.score}/100, ${audit.data.findings.length} validated findings, ${totalTokens} tokens across ${traces.filter((t) => !t.failed).length} model call(s).`);
  console.log(`Screenshots: ${paths.p('data', 'runs', 'phase1')}\n`);
}

main()
  .catch((err) => {
    console.error(`\nFAILED: ${err.message}`);
    if (err.code === 'NO_API_KEY') console.error('Run: cp .env.example .env  and add NEBIUS_API_KEY');
    process.exitCode = 1;
  })
  .finally(closeBrowser);
