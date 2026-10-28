// Send adapter — deliberately a dead end.
//
// ProofRun never sends email. There is no SMTP client, no API client, no
// transport of any kind in this repo, and adding one is not a configuration
// change: it is new code someone has to write and own.
//
// What this does instead: exports approved drafts to a file the operator can
// read, check, and paste wherever they want. The Instantly shape below exists
// so the export is a recognizable format, not because anything is wired to it.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { paths } from '../tools/config.js';
import * as store from '../tools/store.js';

/** The interface a real sender would have to implement. Nothing implements it. */
export const SendAdapter = {
  name: 'none',
  /* eslint-disable-next-line no-unused-vars */
  async send(_draft) {
    throw new Error(
      'ProofRun has no send transport by design. Approved drafts are exported for a human to send. See agent/send-adapter.js.',
    );
  },
};

/**
 * Write every approved draft to data/exports/<date>-approved.json and a
 * human-readable .md beside it. Returns what it wrote.
 */
export async function exportApproved() {
  const approved = store.listProspects().filter((p) => p.status === 'approved' && p.draft);

  const rows = approved.map((p) => ({
    prospect_id: p.id,
    business_name: p.business_name,
    website: p.url,
    // No email address is ever harvested or stored. The operator supplies the
    // recipient when they send, by hand.
    recipient: null,
    recipient_note: 'ProofRun does not collect or store email addresses. Add the recipient yourself.',
    subject: p.draft.subject,
    body: p.draft.body,
    mockup_url: p.draft.mockup_url || null,
    approved_at: p.approved_at || null,
    operator_edited: Boolean(p.user_edits?.some((e) => e.decision === 'edited' || e.edited_body || e.edited_subject)),
    evidence: {
      before_score: p.scores?.before?.score ?? null,
      after_score: p.scores?.after?.score ?? null,
      comparable: p.verification?.comparison
        ? { before: p.verification.comparison.before, after: p.verification.comparison.after, basis: p.verification.comparison.basis }
        : null,
      verification_outcome: p.verification?.outcome ?? null,
      repair_attempts: p.verification?.attempts ?? null,
      cited_findings: p.draft.cited_finding_ids || [],
    },
  }));

  const dir = path.join(paths.root, 'data', 'exports');
  await fsp.mkdir(dir, { recursive: true });
  const stamp = store.today();

  const jsonFile = path.join(dir, `${stamp}-approved.json`);
  await fsp.writeFile(
    jsonFile,
    JSON.stringify(
      {
        exported_at: new Date().toISOString(),
        count: rows.length,
        transport: 'none — ProofRun does not send. This file is for a human.',
        drafts: rows,
      },
      null,
      2,
    ),
  );

  const mdFile = path.join(dir, `${stamp}-approved.md`);
  const md = [
    `# Approved drafts — ${stamp}`,
    '',
    `${rows.length} draft(s) approved. **Nothing has been sent.** ProofRun has no send transport.`,
    '',
    ...rows.flatMap((r) => [
      `## ${r.business_name}`,
      '',
      `- Site: ${r.website}`,
      `- Mockup: ${r.mockup_url || 'n/a'}`,
      `- Score: ${r.evidence.before_score} -> ${r.evidence.after_score}${r.evidence.comparable ? ` (comparable basis ${r.evidence.comparable.before} -> ${r.evidence.comparable.after})` : ''}`,
      `- Verification: ${r.evidence.verification_outcome}, ${r.evidence.repair_attempts} repair attempt(s)`,
      `- Operator edited the draft: ${r.operator_edited ? 'yes' : 'no'}`,
      '',
      `**Subject:** ${r.subject}`,
      '',
      '```',
      r.body,
      '```',
      '',
    ]),
  ].join('\n');
  await fsp.writeFile(mdFile, md);

  return {
    count: rows.length,
    files: [path.relative(paths.root, jsonFile), path.relative(paths.root, mdFile)],
    sent: 0,
    transport: 'none',
  };
}
