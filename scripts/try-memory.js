// Proves the claim that memory changes the next draft.
//
//   node scripts/try-memory.js <prospectId>
//
// 1. Print the current draft.
// 2. Record an operator correction, which writes a rule to memory/learnings.md.
// 3. Redraft — same audit, same proof, same model, same prompt.
// 4. Print both and report whether the output actually changed.
//
// If step 4 says the drafts are identical, the claim is false and the UI must
// not make it. That is the point of running this.
import { recordDecision, redraft } from '../skills/proofrun/runner.js';
import * as store from '../tools/store.js';

const id = process.argv[2] || store.listProspects().find((p) => p.draft)?.id;
if (!id) {
  console.error('No prospect with a draft. Run: node scripts/try-phase2.js');
  process.exit(2);
}

const CORRECTION =
  process.argv[3] ||
  'Never open with the word "Hi" or the business name. Open with the single measured defect, in the first six words. And never mention a score out of 100 anywhere in the email — business owners do not care about our number, they care about missed calls.';

const show = (label, d) => {
  console.log(`\n${'='.repeat(72)}\n${label}  (v${d.version || 1}, ${d.learnings_available ?? 0} learning(s) in memory when written)`);
  console.log(`${'='.repeat(72)}`);
  console.log(`Subject: ${d.subject}\n`);
  console.log(d.body);
};

const before = store.loadProspect(id);
if (!before?.draft) {
  console.error(`Prospect ${id} has no draft yet.`);
  process.exit(2);
}

show('DRAFT v1 — before any correction', before.draft);

console.log(`\n\n--- Recording the operator correction -------------------------------\n`);
console.log(CORRECTION);

const decision = await recordDecision({
  prospectId: id,
  decision: 'rejected',
  note: CORRECTION,
});
console.log(`\nWritten to memory/learnings.md as a rule:\n  "${decision.rule}"`);
console.log(`\nmemory/learnings.md now holds ${store.learningRules(500).length} rule(s).`);

console.log(`\n--- Redrafting. Only memory changed. --------------------------------`);
const out = await redraft(id);
show('DRAFT v2 — after reading memory', out.draft);

console.log(`\n${'='.repeat(72)}`);
const changed = out.draft.body !== before.draft.body || out.draft.subject !== before.draft.subject;
console.log(changed ? 'RESULT: the draft changed after the correction.' : 'RESULT: THE DRAFT DID NOT CHANGE. The memory claim is not supported.');

if (changed) {
  const opensWithHi = /^(hi|hello|hey)\b/i.test(out.draft.body.trim());
  const mentionsScore = /\b(\d{1,3})\s*(?:\/|out of)\s*100\b|score of \d/i.test(out.draft.body);
  console.log(`\nAgainst the specific correction:`);
  console.log(`  opens with a greeting:    ${opensWithHi ? 'STILL YES — not followed' : 'no  — followed'}`);
  console.log(`  mentions a score out of 100: ${mentionsScore ? 'STILL YES — not followed' : 'no  — followed'}`);
  console.log(`\n  The model reports applying: ${JSON.stringify(out.draft.applied_learnings, null, 2)}`);
  console.log(`\n  v1 length ${before.draft.body.length} chars, v2 length ${out.draft.body.length} chars.`);
}
console.log('');
process.exit(changed ? 0 : 1);
