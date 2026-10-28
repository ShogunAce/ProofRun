// The Morning Brief: what ran overnight, what is waiting, what was learned.
//
// The numbers are counted from files on disk. The model only narrates them, and
// it is told explicitly not to estimate.
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../tools/config.js';
import { completeStructured } from '../tools/nebius.js';
import * as store from '../tools/store.js';
import { briefPrompt } from '../skills/proofrun/prompts.js';
import { z } from 'zod';

const briefJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    what_ran: { type: 'string', description: 'One short paragraph.' },
    needs_you: { type: 'string', description: 'One short paragraph. If nothing is waiting, say so plainly.' },
    what_i_learned: { type: 'string', description: 'One short paragraph. If memory gained nothing, say so.' },
  },
  required: ['what_ran', 'needs_you', 'what_i_learned'],
};

const briefZ = z.object({
  what_ran: z.string().min(5),
  needs_you: z.string().min(5),
  what_i_learned: z.string().min(5),
});

const briefPath = (date) => path.join(paths.runs, `brief-${date}.json`);

export function readTodaysBrief(date = store.today()) {
  try {
    return JSON.parse(fs.readFileSync(briefPath(date), 'utf8'));
  } catch {
    return null;
  }
}

/** Counts, straight from the prospect files. No model involved. */
export function briefStats(date = store.today()) {
  const all = store.listProspects();
  const touchedToday = all.filter((p) => (p.updated_at || '').slice(0, 10) === date);

  const byStatus = {};
  for (const p of all) byStatus[p.status] = (byStatus[p.status] || 0) + 1;

  const verified = all.filter((p) => p.verification?.outcome);
  const deltas = all
    .filter((p) => p.verification?.comparison)
    .map((p) => p.verification.comparison.delta);

  return {
    date,
    total_prospects: all.length,
    touched_today: touchedToday.length,
    by_status: byStatus,
    awaiting_approval: all.filter((p) => p.status === 'drafted').length,
    approved: all.filter((p) => p.status === 'approved').length,
    rejected: all.filter((p) => p.status === 'rejected').length,
    failed_verification: verified.filter((p) => p.verification.outcome !== 'passed').length,
    passed_verification: verified.filter((p) => p.verification.outcome === 'passed').length,
    repair_attempts_used: verified.reduce((s, p) => s + (p.verification.attempts || 0), 0),
    median_delta: deltas.length ? deltas.sort((a, b) => a - b)[Math.floor(deltas.length / 2)] : null,
    learnings_total: store.learningRules(500).length,
  };
}

export async function buildMorningBrief({ date = store.today() } = {}) {
  const stats = briefStats(date);

  const prospects = store.listProspects().slice(0, 12).map((p) => ({
    business: p.business_name,
    status: p.status,
    before: p.scores?.before?.score ?? null,
    after: p.scores?.after?.score ?? null,
    verification: p.verification?.outcome ?? null,
    repair_attempts: p.verification?.attempts ?? null,
    still_failing: p.verification?.still_failing ?? [],
    updated: (p.updated_at || '').slice(0, 10),
  }));

  const learnings = store.learningRules(8);

  const { data } = await completeStructured({
    role: 'brief',
    ...briefPrompt({ stats, prospects, learnings, date }),
    schema: briefZ,
    jsonSchema: briefJsonSchema,
    schemaName: 'morning_brief',
  });

  const brief = {
    date,
    generated_at: new Date().toISOString(),
    stats,
    prospects,
    learnings,
    ...data,
  };

  store.ensure(paths.runs);
  fs.writeFileSync(briefPath(date), JSON.stringify(brief, null, 2));
  return brief;
}
