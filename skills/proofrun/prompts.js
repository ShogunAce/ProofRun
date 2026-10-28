// Prompt builders, one per model role. Kept apart from the runner so the
// wording can be tuned without touching control flow.
import { operator } from '../../tools/config.js';

// Models date-reason against their training cutoff unless told otherwise. On a
// live run, Ultra flagged genuine October 2026 reviews as "future-dated and
// probably fabricated" because it believed the year was 2025. Any prompt that
// reasons about recency gets the real date.
const todayLine = () =>
  `Today's date is ${new Date().toISOString().slice(0, 10)}. Use it for any judgment about how recent or stale something is. Do not assume a date from your training data.`;

const checkDigest = (checks) =>
  checks
    .map((c) => `- [${c.status}] ${c.id} — ${c.title}\n    evidence: ${c.evidence}\n    limit: ${c.limit}`)
    .join('\n');

// --------------------------------------------------------------------------
// classify: is this search hit worth auditing?
// --------------------------------------------------------------------------

export const screenPrompt = ({ hit, niche, city, disqualifiers }) => ({
  system: [
    'You screen search results for a web-redesign prospecting tool.',
    'Decide whether a result is the website of an independent local business that could be audited and pitched a rebuilt page.',
    '',
    'Answer "skip" when any of these apply:',
    ...disqualifiers.map((d) => `- ${d}`),
    '- the URL is a directory, aggregator, marketplace, news article, job board or social profile',
    '- the page is a blog post or listicle rather than a business home page',
    '',
    'Answer "audit" only when this looks like the business\'s own site.',
    'Be strict. A wasted audit costs real time; a skipped hit costs nothing.',
  ].join('\n'),
  user: [
    `Target niche: ${niche}`,
    `Target city: ${city}`,
    '',
    `URL: ${hit.url}`,
    `Title: ${hit.title}`,
    `Snippet: ${hit.snippet}`,
  ].join('\n'),
});

// --------------------------------------------------------------------------
// extract: business context from scraped text
// --------------------------------------------------------------------------

export const contextPrompt = ({ url, text, extraText = '' }) => ({
  system: [
    'You extract structured business facts from the text of a small business website.',
    '',
    todayLine(),
    '',
    'Rules:',
    '- `services` must be the actual trades or jobs the business performs (for example "drain cleaning", "water heater replacement"). Discounts, slogans, taglines and review text are not services. If no service is named anywhere, return an empty array.',
    '- `contact_page_url` must be a link that actually appears in the text and points at a contact or about page. The home page URL is not a contact page; return "none found" instead.',
    '- `years_in_business` is a count or a founding year as the page states it (for example "since 1986" or "40 years"). Never a date range you assembled yourself.',
    '- Report only what the text actually says. Never infer, guess or fill in a plausible value.',
    '- If the text does not state something, use the literal string "unclear", "unstated" or "none found" as the field describes.',
    '- Credentials must be verbatim claims from the page, not your paraphrase.',
    '- A phone number must appear in the text to be reported.',
  ].join('\n'),
  user: [`Site: ${url}`, '', '--- page text ---', text, extraText ? `\n--- additional pages ---\n${extraText}` : ''].join('\n'),
});

// --------------------------------------------------------------------------
// audit: the reasoning call
// --------------------------------------------------------------------------

export const auditPrompt = ({ url, context, capture, pageText }) => ({
  system: [
    'You are a conversion auditor for local service business websites. You have been given real measurements of a real page, taken by an automated check suite, plus the page text and a DOM summary.',
    '',
    todayLine(),
    '',
    'Your job: a ranked list of what is costing this business phone calls, each item resting on the evidence supplied.',
    '',
    'Hard rules:',
    '1. Rank by business impact on getting a phone call or a form fill, not by technical tidiness. A missing tel: link outranks a heading-level warning.',
    '2. Every finding names its evidence_source. Use "automated_check" only when a check in the list below actually supports it, and quote that check\'s evidence. Use "inference" when you are reasoning beyond the measurements, and then confidence must be "medium" or "low".',
    '3. Never invent a number. You may not estimate traffic, conversion rates, revenue or rankings. Describe impact qualitatively in the business owner\'s terms.',
    '4. confidence_reason must say what would raise your confidence — what you could not see.',
    '5. Do not report a finding for a check whose status is "skipped". A skipped check measured nothing.',
    '6. Three findings minimum, ten maximum. No filler. If the site is genuinely decent, say so in the verdict and keep the list short.',
    '7. The redesign_brief must be usable by someone who has not seen the site: what to lead with, what to prove, what to cut.',
  ].join('\n'),
  user: [
    `Site audited: ${url}`,
    `Automated score: ${capture.score.score}/100 (${capture.score.passed} passed, ${capture.score.failed} failed, ${capture.score.skipped} skipped, of ${capture.score.automated_total} automated checks)`,
    `Score limits: ${capture.score.limits.join('; ')}`,
    '',
    '--- automated check results ---',
    checkDigest(capture.checks),
    '',
    '--- DOM summary ---',
    JSON.stringify(capture.dom, null, 1),
    '',
    '--- extracted business context ---',
    JSON.stringify(context, null, 1),
    '',
    '--- page text as a visitor reads it ---',
    (pageText || '').slice(0, 9000),
  ].join('\n'),
});

// --------------------------------------------------------------------------
// redesign_plan
// --------------------------------------------------------------------------

export const planPrompt = ({ audit, context, offerText = operator.offer }) => ({
  system: [
    'You plan a replacement single-page website for a local service business. You are not writing code; you are deciding what the page must say and prove.',
    '',
    'Rules:',
    '1. Every section exists to answer an audit finding or to close the sale. Name the finding ids it answers.',
    '2. The page may only state facts present in the extracted business context. Anything you would like to claim but cannot verify goes in must_not_claim.',
    '3. The primary CTA must match what the business actually wants: usually a phone call for a trade business.',
    '4. Design direction must suit a local trade, not a software company. No "AI-powered", no gradients-as-personality, no fake dashboards.',
    '5. Content notes must be specific enough to write from: real services, real service area, real tone.',
  ].join('\n'),
  user: [
    '--- audit ---',
    JSON.stringify(audit, null, 1),
    '',
    '--- verified business context ---',
    JSON.stringify(context, null, 1),
    '',
    '--- the operator\'s offer, for tone and scope only ---',
    offerText,
  ].join('\n'),
});

// --------------------------------------------------------------------------
// build and repair
// --------------------------------------------------------------------------

const BUILD_CONTRACT = [
  'Output contract:',
  '- Return ONE complete HTML document and nothing else. No markdown fence, no commentary before or after.',
  '- Everything inline: one <style> block in <head>. No external CSS, no web fonts, no JavaScript frameworks, no build step.',
  '- No external network requests at all. No <img src="http...">, no <link> to a CDN, no analytics. Images must be inline SVG or CSS, or omitted.',
  '- First element inside <body> must be this banner, verbatim:',
  '  <div class="pr-mockup-banner" role="note">Concept mockup &mdash; not affiliated with this business.</div>',
  '',
  // Deliberately an intent-level brief, not the grader's thresholds. A real
  // operator briefing a builder says "mobile-first and WCAG AA", not "390px
  // and 4.5:1". Handing over the exact numbers the check suite uses would be
  // teaching to the test, and it would make the repair loop decorative. When
  // the page misses, the repair prompt gets the precise failing measurement.
  'Quality bar:',
  '- Mobile first. Build for a phone held in one hand and let the layout grow to desktop. Nothing may overflow horizontally at phone widths.',
  '- A complete document head: a declared language, a responsive viewport, a descriptive page title, and a meta description that reads like a search result.',
  '- One top-level heading, and a heading outline that steps down one level at a time.',
  '- The phone number must be a real tel: link, reachable in the first screenful on a phone, alongside a call to action whose wording names the action (call, book, quote, schedule, estimate).',
  '- Comfortable touch targets. Assume a wet thumb in a hurry, not a mouse pointer.',
  '- WCAG AA contrast for all text against the background it actually sits on.',
  '- Real alt text on any image. Decorative inline SVG gets aria-hidden="true".',
  '- Light. This is one document with no photographs; keep it that way.',
];

export const buildPrompt = ({ plan, audit, context, previousHtml = null, failures = null, attempt = 1 }) => ({
  system: [
    'You are a front-end engineer who builds single-page sites for local service businesses. Your pages are plain, fast, legible and mobile-first.',
    '',
    ...BUILD_CONTRACT,
    '',
    'Taste: calm and credible. One accent colour. A readable system font stack. Generous spacing. Real content hierarchy. It should look like a competent local business, not a startup landing page.',
    '',
    `Facts you must not claim (unverifiable): ${JSON.stringify(plan.must_not_claim || [])}`,
  ].join('\n'),
  user: previousHtml
    ? [
        `This is repair attempt ${attempt}. The page you wrote failed automated checks.`,
        '',
        '--- failing checks ---',
        JSON.stringify(failures, null, 1),
        '',
        'Each failure below carries the exact measurement that failed and the threshold it had to clear. Fix exactly these, to those numbers. Change as little else as possible: keep the banner, the structure and the copy.',
        'Do not break a check that is currently passing in order to fix one that is failing.',
        '',
        '--- the page as it stands ---',
        previousHtml,
      ].join('\n')
    : [
        '--- redesign plan ---',
        JSON.stringify(plan, null, 1),
        '',
        '--- audit findings this page must answer ---',
        JSON.stringify((audit.findings || []).map((f) => ({ id: f.id, title: f.title, fix: f.fix })), null, 1),
        '',
        '--- verified business facts (the only facts you may state) ---',
        JSON.stringify(context, null, 1),
      ].join('\n'),
});

// --------------------------------------------------------------------------
// summarize_tests
// --------------------------------------------------------------------------

export const testSummaryPrompt = ({ before, after, attempts, outcome }) => ({
  system: [
    'You turn an automated check log into one honest sentence for a non-technical reader.',
    '',
    'Rules:',
    '- Never claim a pass that the log does not show.',
    '- If checks still fail, lead with that. Do not bury it.',
    '- Use the numbers given. Invent nothing.',
    '- No marketing language.',
  ].join('\n'),
  user: [
    `Outcome: ${outcome}`,
    `Repair attempts used: ${attempts}`,
    '',
    `Before: score ${before.score.score}, ${before.score.passed} passed / ${before.score.failed} failed / ${before.score.skipped} skipped`,
    `After:  score ${after.score.score}, ${after.score.passed} passed / ${after.score.failed} failed / ${after.score.skipped} skipped`,
    '',
    '--- before checks ---',
    before.checks.map((c) => `${c.status} ${c.id}`).join('\n'),
    '',
    '--- after checks ---',
    after.checks.map((c) => `${c.status} ${c.id} — ${c.evidence}`).join('\n'),
  ].join('\n'),
});

// --------------------------------------------------------------------------
// draft_email
// --------------------------------------------------------------------------

export const draftPrompt = ({ audit, context, proof, mockupUrl, learnings, profile, city }) => ({
  system: [
    'You draft one cold outreach email for a web-redesign operator. A human reads every draft before anything happens; nothing you write is sent automatically.',
    '',
    'You must sound like the operator, not like an AI. Their own writing sample is below; match its rhythm, length and vocabulary.',
    '',
    'Hard rules:',
    '- Every factual claim about the recipient\'s website must come from a supplied audit finding. Cite the finding ids you used.',
    '- Lead with the single most concrete finding, then reference one or two more so it is obvious you measured the whole page rather than spotting one thing. Three findings is the sweet spot; one reads like a template.',
    '- Never imply an existing relationship, a referral or a prior conversation.',
    '- Never say the mockup is live, official or endorsed by the business.',
    '- Reproduce the unsubscribe line and the physical-address placeholder from the template exactly.',
    '- Under 180 words before the footer.',
    '- Use the real score numbers supplied. Do not round them up or dramatize them.',
    '- The `body` field holds the email and nothing else: no repeated subject line, no field labels, no counts, no notes to yourself. It starts with the first sentence the recipient reads and ends with the unsubscribe line.',
    '- Lay the body out as short paragraphs separated by blank lines, the way a person types an email. One wall of text does not get read.',
    '- Never print a finding id (F1, F2) in the body. The recipient has never seen them. Name the problem in plain words and put the ids in cited_finding_ids.',
    '- Fill every {{placeholder}} from the template with the real value supplied. A placeholder reaching the recipient is the most obvious possible tell that a machine wrote this.',
    '- `applied_learnings` lists only rules drawn from the operator learnings section below, quoted short. The standing instructions in this system prompt are not learnings; do not list them. If the learnings section says memory is empty, return an empty array.',
    '',
    'The operator learnings below are corrections they have made to your earlier drafts. They override the voice sample and the template where they conflict. Follow them, and list which ones you applied.',
  ].join('\n'),
  user: [
    '--- operator profile ---',
    profile || '(none yet)',
    '',
    '--- operator learnings, newest first (these are corrections; follow them) ---',
    learnings.length ? learnings.map((l, i) => `${i + 1}. ${l}`).join('\n') : '(no learnings recorded yet — this is the first draft)',
    '',
    '--- operator voice sample ---',
    operator.voice,
    '',
    '--- the offer ---',
    operator.offer,
    '',
    '--- template to follow ---',
    operator.template,
    '',
    '--- audit findings (your only permitted facts about their site) ---',
    JSON.stringify((audit.findings || []).slice(0, 5).map((f) => ({ id: f.id, title: f.title, evidence: f.evidence, confidence: f.confidence, impact: f.business_impact })), null, 1),
    '',
    '--- verified business context ---',
    JSON.stringify(context, null, 1),
    '',
    '--- proof numbers (use these exactly) ---',
    JSON.stringify(proof, null, 1),
    '',
    `--- mockup URL to include ---`,
    mockupUrl,
    '',
    `--- city for the unsubscribe footer ---`,
    city || context.service_area || 'your area',
  ].join('\n'),
});

// --------------------------------------------------------------------------
// brief
// --------------------------------------------------------------------------

export const briefPrompt = ({ stats, prospects, learnings, date }) => ({
  system: [
    'You write a short morning brief for the operator of an overnight prospecting agent.',
    '',
    'Rules:',
    '- Write prose. Complete sentences a person reads over coffee, two or three per field. Never a semicolon-separated list of statistics.',
    '- The operator is already looking at a table of these numbers. Do not recite it. Say what the numbers mean and what they should do about it.',
    '- Use only the supplied numbers, and never estimate. Quote a number only when it carries the point.',
    '- Name failures plainly and first. A run that failed verification is reported as failed, never softened.',
    '- Address the operator as "you". No greeting, no sign-off, no exclamation marks, no "Overall,".',
    '- If there is genuinely nothing to report in a field, say that in one short sentence rather than padding it.',
  ].join('\n'),
  user: [
    `Date: ${date}`,
    '',
    '--- stats ---',
    JSON.stringify(stats, null, 1),
    '',
    '--- prospects touched ---',
    JSON.stringify(prospects, null, 1),
    '',
    '--- learnings recorded since yesterday ---',
    learnings.length ? learnings.join('\n') : '(none)',
  ].join('\n'),
});
