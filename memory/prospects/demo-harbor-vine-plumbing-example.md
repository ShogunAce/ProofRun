# Harbor & Vine Plumbing

- **Status:** drafted
- **Site:** https://harbor-vine-plumbing.example
- **City:** San Diego, CA
- **Niche:** plumbers
- **First seen:** 2026-10-29
- **Last updated:** 2026-10-29 04:28:56
- **Found via:** seeded demo fixture

## Scores

| | score | passed | failed | skipped |
|---|---|---|---|---|
| before | 30 | 3 | 8 | 2 |
| after | 100 | 11 | 0 | 2 |

Limits: 11 of 15 listed checks were automated and scored; Two viewports only: desktop 1280x800 and mobile 390x844; One cold load per viewport on the runner machine, unthrottled

## Audit

The site has strong trust content (35 years, family-owned, licensed, testimonials) but critical mobile usability failures — no clickable phone number, no viewport tag, microscopic tap targets — that stop mobile callers cold. A stale 2011 timestamp further erodes trust at the moment of emergency. Fix the top three technical items first; they are the difference between a ringing phone and a silent one.

### Phone number is not a tappable link on mobile
- severity **high**, confidence **high** (The check directly measured telLinks: 0 and textMatch: "(619) 555-0142". No inference needed.)
- category: conversion, evidence from: automated_check
- evidence: The number “(619) 555-0142” appears as plain text; the automated check found 0 tel: links. On a phone, tapping it does nothing.
- impact: Every mobile visitor who wants to call must manually copy or memorize the number. Many will abandon the effort, especially in an emergency.
- fix: Wrap the number in <a href="tel:+16195550142">(619) 555-0142</a> everywhere it appears — header, body, footer.

### No viewport meta tag — mobile renders at desktop width
- severity **high**, confidence **high** (Direct measurement of the missing meta tag.)
- category: technical, evidence from: automated_check
- evidence: viewportMeta is empty string; the check reports “No viewport meta tag, so phones render the page at desktop width and zoom out.”
- impact: The page loads tiny and zoomed out on phones. Even if the phone number were a link, users must pinch-zoom to find and tap it. Most won’t bother.
- fix: Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the <head>.

### All tap targets are far below the 44 px minimum
- severity **high**, confidence **high** (Direct measurement of visible interactive elements.)
- category: technical, evidence from: automated_check
- evidence: 6 of 6 visible controls under 44 px; smallest "Home" at 29×14 px.
- impact: Navigation links (Home, Services, About Us, Contact, Testimonials) are too small to tap reliably on a phone. Visitors cannot reach the Contact page or any other section.
- fix: Increase tap target size to at least 44×44 px — enlarge font, add padding, or convert to full-width mobile buttons.

### Stale "Site last updated March 2011" contradicts copyright 2024 and 35-year claim
- severity **high**, confidence **medium** (I see the conflicting dates in the extracted page text. Only the owner can confirm whether the business is still active; the 2011 date makes the site look abandoned.)
- category: trust, evidence from: inference
- evidence: Page text reads "Site last updated March 2011" while copyright says "1998-2024" and copy claims "over thirty-five years".
- impact: A homeowner with a burst pipe sees a site apparently untouched since 2011 and doubts the emergency number works. Trust evaporates at the moment of highest intent.
- fix: Remove or update the "last updated" line to today’s date. Ensure copyright year matches reality.

### Page title is only 8 characters and no meta description exists
- severity **medium**, confidence **high** (Direct measurement of title length and missing meta description.)
- category: technical, evidence from: automated_check
- evidence: title is only 8 characters; no meta description.
- impact: Search results show a generic "Plumbing" title with no descriptive snippet. Fewer searchers click through; fewer callers arrive.
- fix: Set a descriptive title (e.g., "Harbor & Vine Plumbing — San Diego Emergency & Residential Plumbing Since 1987") and a 150-character meta description highlighting emergency service, license, and phone number.

### 16 text elements fail WCAG AA contrast (worst 2.13:1)
- severity **medium**, confidence **high** (Direct contrast measurement against WCAG AA threshold.)
- category: accessibility, evidence from: automated_check
- evidence: 16 of 56 sampled text elements below WCAG AA. Worst is 2.13:1 where 4.5:1 is required (copyright notice).
- impact: Older homeowners — a core plumbing demographic — may struggle to read the phone number, hours, or address. Lost legibility = lost calls.
- fix: Darken the low-contrast text (especially footer copyright) against its background to meet 4.5:1.

### Heading structure broken: two H1s and skipped H2 level
- severity **low**, confidence **high** (Direct structural analysis of heading levels.)
- category: technical, evidence from: automated_check
- evidence: Heading outline is broken: 2 h1 elements; h1 is followed by h3.
- impact: Screen readers and search crawlers misinterpret page hierarchy. Indirectly reduces discoverability and accessibility.
- fix: Use one H1 (business name + location), then H2 for major sections (Services, Testimonials, Contact), H3 for sub-items.

### Two images lack alt text (appear to be 1×1 tracking GIFs)
- severity **low**, confidence **high** (Direct measurement of alt attribute presence.)
- category: accessibility, evidence from: automated_check
- evidence: 2 of 2 visible image(s) have no alt text (e.g. gif;base64,R0lGODlhAQABAIAAAMLCwgAAACwAAAAAAQABAAA).
- impact: Minor — these are likely invisible tracking pixels. No direct effect on calls, but an accessibility audit flag.
- fix: Add alt="" to decorative images or remove them if unused.

## Verification

- Attempts: 1, cap 3
- Outcome: **passed**
- After one repair, the site passes all automated checks, scoring 100 with zero failures.

## Latest draft

**Subject:** Harbor & Vine Plumbing – mobile tap issue

```
Hi Harbor & Vine Plumbing,

Your phone number isn’t a tappable link on mobile, and the page has no viewport meta tag, so phones render it at desktop width and the contact button is too small to tap reliably.

It costs $1,800 USD for a rebuilt, mobile‑first single‑page site that passes all the checks I run.

the rebuilt page - I rebuilt your page so you can look at it instead of imagining it: http://localhost:3000/mockup/demo-harbor-vine-plumbing-example

That page is a concept mockup I made, not affiliated with Harbor & Vine Plumbing. It passed 11 of 13 automated checks, against 3 of 13 for the current page.

Take a look at the page I built and reply yes or no.

Best,
Sam Reyes

Sam Reyes - 1234 Example St, Suite 100, San Diego, CA 92101
You are receiving this one-off note because your business is listed publicly in San Diego, CA. Reply "unsubscribe" and I will remove you and never contact you again.
```

## History

- 2026-10-29 04:26:41 — discovered: seeded demo fixture
- 2026-10-29 04:27:12 — audited: 8 findings, score 30
- 2026-10-29 04:27:49 — verified: passed after 1 repair attempt(s)
- 2026-10-29 04:28:56 — drafted: Harbor & Vine Plumbing – mobile tap issue
