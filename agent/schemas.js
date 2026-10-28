// Structured output contracts.
//
// Each export is a pair: a JSON Schema sent to Token Factory as
// response_format.json_schema (strict mode, so every property is required and
// additionalProperties is false), and a zod schema used to validate what comes
// back. If validation fails, tools/nebius.js hands the model its own error once
// before the step is failed. Nothing unvalidated reaches memory or the UI.
import { z } from 'zod';

const strict = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});

const str = (description) => ({ type: 'string', description });
const enumOf = (values, description) => ({ type: 'string', enum: values, description });

// --------------------------------------------------------------------------
// Audit
// --------------------------------------------------------------------------

export const FINDING_CATEGORIES = [
  'mobile',
  'conversion',
  'trust',
  'accessibility',
  'performance',
  'content',
  'technical',
];

export const auditJsonSchema = strict({
  business: strict({
    name: str('The business name exactly as it appears on the site.'),
    what_they_do: str('One sentence, plain language.'),
    service_area: str('City or region they serve, or "unclear" if the site never says.'),
    phone: str('Phone number as shown, or "none found".'),
    primary_conversion_goal: enumOf(
      ['phone_call', 'form_submission', 'booking', 'quote_request', 'unclear'],
      'What the current site is evidently trying to get a visitor to do.',
    ),
  }),
  findings: {
    type: 'array',
    minItems: 3,
    maxItems: 10,
    description: 'Ranked most important first. Each must rest on supplied evidence.',
    items: strict({
      id: str('short-kebab-case slug'),
      title: str('One line, specific. Not a category name.'),
      category: enumOf(FINDING_CATEGORIES),
      severity: enumOf(['high', 'medium', 'low']),
      evidence: str('The concrete observation, quoting the check output or page copy you relied on.'),
      evidence_source: enumOf(
        ['automated_check', 'dom_snapshot', 'page_copy', 'inference'],
        'Where the evidence came from. Use "inference" only when you are reasoning beyond what was measured.',
      ),
      confidence: enumOf(['high', 'medium', 'low']),
      confidence_reason: str('Why that confidence level and not a higher one.'),
      business_impact: str('What this plausibly costs the business, in their terms. No invented numbers.'),
      fix: str('What the rebuilt page should do instead.'),
    }),
  },
  overall: strict({
    verdict: str('Two sentences on the state of the current site.'),
    biggest_opportunity: str('The single change with the most upside.'),
    redesign_brief: str('A paragraph briefing whoever rebuilds the page: what to lead with, what to prove, what to cut.'),
  }),
});

// The prompt tells the model that an inferred finding may not carry high
// confidence. Ultra broke that rule on a live run, so it is enforced here
// instead of trusted: a violation fails validation and the model is handed its
// own error once before the step fails.
const findingZ = z.object({
  id: z.string().min(1),
  title: z.string().min(3),
  category: z.enum(FINDING_CATEGORIES),
  severity: z.enum(['high', 'medium', 'low']),
  evidence: z.string().min(3),
  evidence_source: z.enum(['automated_check', 'dom_snapshot', 'page_copy', 'inference']),
  confidence: z.enum(['high', 'medium', 'low']),
  confidence_reason: z.string().min(3),
  business_impact: z.string().min(3),
  fix: z.string().min(3),
}).refine((f) => !(f.evidence_source === 'inference' && f.confidence === 'high'), {
  message:
    'A finding with evidence_source "inference" may not have confidence "high". Either cite the automated check or DOM fact that supports it and change evidence_source, or lower confidence to "medium" or "low".',
  path: ['confidence'],
});

export const auditZ = z.object({
  business: z.object({
    name: z.string().min(1),
    what_they_do: z.string().min(3),
    service_area: z.string(),
    phone: z.string(),
    primary_conversion_goal: z.enum(['phone_call', 'form_submission', 'booking', 'quote_request', 'unclear']),
  }),
  findings: z.array(findingZ).min(1).max(10),
  overall: z.object({
    verdict: z.string().min(3),
    biggest_opportunity: z.string().min(3),
    redesign_brief: z.string().min(10),
  }),
});

// --------------------------------------------------------------------------
// Redesign plan
// --------------------------------------------------------------------------

export const planJsonSchema = strict({
  positioning: str('One sentence the page must land in the first three seconds.'),
  primary_cta: str('The exact words on the main button.'),
  secondary_cta: str('A lower-commitment alternative, or "none".'),
  sections: {
    type: 'array',
    minItems: 4,
    maxItems: 8,
    items: strict({
      name: str('Section name, e.g. hero, proof, services.'),
      purpose: str('What this section has to accomplish.'),
      content_notes: str('The real copy direction, drawn from the extracted site content. Never invent a credential, licence number, review count or award.'),
      answers_finding_ids: { type: 'array', items: { type: 'string' }, description: 'Audit finding ids this section addresses. Empty array if none.' },
    }),
  },
  must_not_claim: { type: 'array', items: { type: 'string' }, description: 'Facts that could not be verified from the source site and so must not appear.' },
  design_direction: str('Two sentences: typography, colour, density. Must suit a local trade business, not a tech startup.'),
});

export const planZ = z.object({
  positioning: z.string().min(5),
  primary_cta: z.string().min(2),
  secondary_cta: z.string(),
  sections: z
    .array(
      z.object({
        name: z.string().min(1),
        purpose: z.string().min(3),
        content_notes: z.string().min(3),
        answers_finding_ids: z.array(z.string()),
      }),
    )
    .min(3),
  must_not_claim: z.array(z.string()),
  design_direction: z.string().min(5),
});

// --------------------------------------------------------------------------
// Prospect screening (fast tier)
// --------------------------------------------------------------------------

export const screenJsonSchema = strict({
  verdict: enumOf(['audit', 'skip'], 'Whether this is an independent local business site worth auditing.'),
  business_name: str('Best guess at the business name, or "unknown".'),
  reason: str('One sentence.'),
});

export const screenZ = z.object({
  verdict: z.enum(['audit', 'skip']),
  business_name: z.string(),
  reason: z.string().min(3),
});

// --------------------------------------------------------------------------
// Business context extraction (fast tier)
// --------------------------------------------------------------------------

export const contextJsonSchema = strict({
  business_name: str(''),
  services: { type: 'array', items: { type: 'string' }, description: 'Services actually named on the site.' },
  service_area: str('Cities or region named on the site, or "unclear".'),
  phone: str('As printed, or "none found".'),
  email: str('As printed, or "none found".'),
  contact_page_url: str('Absolute URL, or "none found".'),
  years_in_business: str('Only if the site states it. Otherwise "unstated".'),
  credentials: { type: 'array', items: { type: 'string' }, description: 'Licences, certifications, memberships the site itself claims. Verbatim. Empty if none.' },
  owner_name: str('Only if the site names one. Otherwise "unstated".'),
  tone_notes: str('How the business talks about itself, in one sentence.'),
});

export const contextZ = z.object({
  business_name: z.string(),
  services: z.array(z.string()),
  service_area: z.string(),
  phone: z.string(),
  email: z.string(),
  contact_page_url: z.string(),
  years_in_business: z.string(),
  credentials: z.array(z.string()),
  owner_name: z.string(),
  tone_notes: z.string(),
});

// --------------------------------------------------------------------------
// Outreach draft
// --------------------------------------------------------------------------

export const draftJsonSchema = strict({
  subject: str('Under 60 characters. No clickbait, no all caps.'),
  body: str('ONLY the words of the email itself, starting with its first sentence and ending with the unsubscribe line. Separate every paragraph with a blank line (\\n\\n) — at least four of them, and the signature and footer each stand alone. Never repeat the subject inside it, never write a "Subject:" line, and never include field names, labels, counts or notes to yourself.'),
  cited_finding_ids: { type: 'array', items: { type: 'string' }, description: 'Audit finding ids actually referenced in the body.' },
  applied_learnings: { type: 'array', items: { type: 'string' }, description: 'ONLY rules that came from the operator learnings list you were given, each quoted short. Not the standing instructions in your system prompt — those are not learnings. Never an index or a number. Empty array if the learnings list was empty.' },
  word_count: { type: 'integer', description: 'Words in the body before the footer.' },
});

// The body is the email and nothing else. Nemotron leaked a repeated "Subject:"
// line and an "Applied: 1" note into it on live runs, so both are rejected here
// and the model gets one chance to fix its own output.
export const draftZ = z.object({
  subject: z.string().min(3).max(120),
  body: z
    .string()
    .min(50)
    .refine((b) => !/^\s*subject\s*:/i.test(b) && !/\n\s*subject\s*:/i.test(b), {
      message: 'The body must not contain a "Subject:" line. The subject belongs in the subject field only; start the body with the first sentence of the email.',
    })
    .refine((b) => !/^\s*(applied|learnings applied|rules applied|note to self|word count)\s*:/im.test(b), {
      message: 'The body must not contain field labels or notes to yourself such as "Applied:" or "Word count:". It contains only the words the recipient reads.',
    })
    .refine((b) => !/\{\{\s*\w+\s*\}\}/.test(b), {
      message: 'The body still contains an unfilled {{placeholder}} from the template. Replace every placeholder with the real value you were given.',
    })
    .refine((b) => !/\b[Ff]\d\b/.test(b), {
      message: 'The body refers to findings by internal id (F1, F2). The recipient has never seen those ids. Describe the problem in words; the ids belong in cited_finding_ids only.',
    })
    .refine((b) => b.split(/\n\s*\n/).filter((p) => p.trim()).length >= 4, {
      message: 'The body is one unbroken block of text. Separate each paragraph with a blank line, and put the signature and the unsubscribe footer on their own. An unsolicited email that arrives as a wall of text does not get read.',
    }),
  cited_finding_ids: z.array(z.string()),
  applied_learnings: z
    .array(z.string())
    .refine((a) => a.every((s) => !/^\s*\d+\s*$/.test(s)), {
      message: 'applied_learnings must quote the rule text, not its index. Replace any bare number with the words of the rule you followed.',
    }),
  word_count: z.number().int().nonnegative(),
});

// --------------------------------------------------------------------------
// Test-log summary
// --------------------------------------------------------------------------

export const testSummaryJsonSchema = strict({
  one_line: str('One honest sentence a non-technical person understands. State failures plainly if any remain.'),
  what_improved: { type: 'array', items: { type: 'string' }, description: 'Check titles that went from fail to pass.' },
  what_still_fails: { type: 'array', items: { type: 'string' }, description: 'Check titles still failing. Empty array if none.' },
});

export const testSummaryZ = z.object({
  one_line: z.string().min(5),
  what_improved: z.array(z.string()),
  what_still_fails: z.array(z.string()),
});
