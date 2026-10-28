// File-based memory. This is the source of truth; there is no database.
//
//   memory/profile.md          who the operator is, how they sell
//   memory/learnings.md        append-only log of approvals, rejections, edits
//   memory/prospects/<id>.md   one markdown file per prospect, human-readable
//   memory/prospects/<id>.json the same state, machine-readable
//   memory/runs/<date>.md      what happened on a given day
//   data/runs/<runId>/         screenshots, generated HTML, raw traces
//
// Markdown so the operator can read, edit or delete anything by hand, and so
// the Memory Viewer screen is just a render of files on disk.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { paths } from './config.js';

const ensure = (dir) => fs.mkdirSync(dir, { recursive: true });

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

export const today = () => new Date().toISOString().slice(0, 10);

// --------------------------------------------------------------------------
// Prospects
// --------------------------------------------------------------------------

export const STATUSES = ['discovered', 'audited', 'redesigned', 'drafted', 'approved', 'rejected', 'failed'];

export function prospectPaths(id) {
  return {
    json: path.join(paths.prospects, `${id}.json`),
    md: path.join(paths.prospects, `${id}.md`),
  };
}

export function loadProspect(id) {
  try {
    return JSON.parse(fs.readFileSync(prospectPaths(id).json, 'utf8'));
  } catch {
    return null;
  }
}

export function listProspects() {
  ensure(paths.prospects);
  return fs
    .readdirSync(paths.prospects)
    .filter((f) => f.endsWith('.json'))
    .map((f) => loadProspect(f.replace(/\.json$/, '')))
    .filter(Boolean)
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

export function saveProspect(p) {
  ensure(paths.prospects);
  const next = { ...p, updated_at: new Date().toISOString() };
  const { json, md } = prospectPaths(next.id);
  fs.writeFileSync(json, JSON.stringify(next, null, 2));
  fs.writeFileSync(md, renderProspectMd(next));
  return next;
}

export function upsertProspect(id, patch) {
  const existing = loadProspect(id) || {
    id,
    status: 'discovered',
    created_at: new Date().toISOString(),
    history: [],
    user_edits: [],
  };
  return saveProspect({ ...existing, ...patch });
}

export function appendProspectHistory(id, entry) {
  const p = loadProspect(id);
  if (!p) return null;
  p.history = [...(p.history || []), { at: new Date().toISOString(), ...entry }];
  return saveProspect(p);
}

function renderProspectMd(p) {
  const L = [];
  L.push(`# ${p.business_name || p.id}`);
  L.push('');
  L.push(`- **Status:** ${p.status}`);
  L.push(`- **Site:** ${p.url || 'unknown'}`);
  if (p.city) L.push(`- **City:** ${p.city}`);
  if (p.niche) L.push(`- **Niche:** ${p.niche}`);
  L.push(`- **First seen:** ${(p.created_at || '').slice(0, 10)}`);
  L.push(`- **Last updated:** ${(p.updated_at || '').slice(0, 19).replace('T', ' ')}`);
  if (p.source) L.push(`- **Found via:** ${p.source}`);
  L.push('');

  if (p.scores) {
    L.push('## Scores');
    L.push('');
    L.push(`| | score | passed | failed | skipped |`);
    L.push(`|---|---|---|---|---|`);
    if (p.scores.before) L.push(`| before | ${p.scores.before.score} | ${p.scores.before.passed} | ${p.scores.before.failed} | ${p.scores.before.skipped} |`);
    if (p.scores.after) L.push(`| after | ${p.scores.after.score} | ${p.scores.after.passed} | ${p.scores.after.failed} | ${p.scores.after.skipped} |`);
    L.push('');
    L.push(`Limits: ${(p.scores.before?.limits || []).join('; ')}`);
    L.push('');
  }

  if (p.audit) {
    L.push('## Audit');
    L.push('');
    L.push(p.audit.overall?.verdict || '');
    L.push('');
    for (const f of p.audit.findings || []) {
      L.push(`### ${f.title}`);
      L.push(`- severity **${f.severity}**, confidence **${f.confidence}** (${f.confidence_reason})`);
      L.push(`- category: ${f.category}, evidence from: ${f.evidence_source}`);
      L.push(`- evidence: ${f.evidence}`);
      L.push(`- impact: ${f.business_impact}`);
      L.push(`- fix: ${f.fix}`);
      L.push('');
    }
  }

  if (p.verification) {
    L.push('## Verification');
    L.push('');
    L.push(`- Attempts: ${p.verification.attempts}, cap ${p.verification.cap}`);
    L.push(`- Outcome: **${p.verification.outcome}**`);
    if (p.verification.summary) L.push(`- ${p.verification.summary}`);
    L.push('');
  }

  if (p.draft) {
    L.push('## Latest draft');
    L.push('');
    L.push(`**Subject:** ${p.draft.subject}`);
    L.push('');
    L.push('```');
    L.push(p.draft.body);
    L.push('```');
    L.push('');
  }

  if (p.user_edits?.length) {
    L.push('## Operator edits');
    L.push('');
    for (const e of p.user_edits) {
      L.push(`### ${e.at?.slice(0, 19).replace('T', ' ')} (${e.decision})`);
      if (e.note) L.push(`Note: ${e.note}`);
      if (e.edited_subject) L.push(`Edited subject: ${e.edited_subject}`);
      if (e.diff_note) L.push(`What changed: ${e.diff_note}`);
      L.push('');
    }
  }

  if (p.history?.length) {
    L.push('## History');
    L.push('');
    for (const h of p.history) L.push(`- ${h.at?.slice(0, 19).replace('T', ' ')} — ${h.event}${h.detail ? `: ${h.detail}` : ''}`);
    L.push('');
  }

  return L.join('\n');
}

// --------------------------------------------------------------------------
// Learnings (the memory the agent reads before drafting)
// --------------------------------------------------------------------------

export function readLearnings() {
  try {
    return fs.readFileSync(paths.learnings, 'utf8');
  } catch {
    return '';
  }
}

export function readProfile() {
  try {
    return fs.readFileSync(paths.profile, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Append a learning. These are the lines the drafting model reads next time,
 * which is what makes the second draft differ from the first.
 */
export function appendLearning({ decision, prospect, business, rule, evidence }) {
  ensure(paths.memory);
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const block = [
    '',
    `## ${stamp} — ${decision} — ${business || prospect}`,
    '',
    `- **Rule for future drafts:** ${rule}`,
    evidence ? `- **Where this came from:** ${evidence}` : null,
    `- **Prospect:** \`${prospect}\``,
    '',
  ]
    .filter(Boolean)
    .join('\n');
  fs.appendFileSync(paths.learnings, block);
  return block;
}

/** The rules only, newest first, for injecting into a prompt. */
export function learningRules(limit = 12) {
  const text = readLearnings();
  const rules = [...text.matchAll(/\*\*Rule for future drafts:\*\*\s*(.+)/g)].map((m) => m[1].trim());
  return rules.reverse().slice(0, limit);
}

// --------------------------------------------------------------------------
// Run logs
// --------------------------------------------------------------------------

export function appendRunLog(date, lines) {
  ensure(paths.runs);
  const file = path.join(paths.runs, `${date}.md`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, `# Runs on ${date}\n`);
  fs.appendFileSync(file, `\n${lines}\n`);
  return file;
}

export function listRunLogs() {
  ensure(paths.runs);
  return fs
    .readdirSync(paths.runs)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .reverse();
}

export function readRunLog(name) {
  try {
    return fs.readFileSync(path.join(paths.runs, name), 'utf8');
  } catch {
    return '';
  }
}

// --------------------------------------------------------------------------
// Run artifacts (screenshots, generated HTML, traces)
// --------------------------------------------------------------------------

export function runDir(runId) {
  const dir = path.join(paths.dataRuns, runId);
  ensure(dir);
  return dir;
}

export async function writeArtifact(runId, name, content) {
  const dir = runDir(runId);
  const file = path.join(dir, name);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content);
  return file;
}

export function readRunJson(runId, name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(paths.dataRuns, runId, name), 'utf8'));
  } catch {
    return null;
  }
}

export function mockupPath(prospectId, attempt = 'final') {
  ensure(paths.mockups);
  return path.join(paths.mockups, `${prospectId}-${attempt}.html`);
}

export { ensure };
