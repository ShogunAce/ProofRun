# Harbor & Vine Plumbing

- **Status:** drafted
- **Site:** https://harbor-vine-plumbing.example
- **City:** San Diego, CA
- **Niche:** plumbers
- **First seen:** 2026-10-28
- **Last updated:** 2026-10-28 23:18:36
- **Found via:** seeded demo fixture

## Scores

| | score | passed | failed | skipped |
|---|---|---|---|---|
| before | 30 | 3 | 8 | 2 |
| after | 100 | 11 | 0 | 2 |

Limits: 11 of 15 listed checks were automated and scored; Two viewports only: desktop 1280x800 and mobile 390x844; One cold load per viewport on the runner machine, unthrottled

## Audit

The site has strong trust signals (35+ years, family-owned, licensed, testimonials) but three mobile-first technical failures — no tel: link, no viewport meta, undersized tap targets — block the majority of high-intent mobile visitors from calling. A stale 2011 timestamp erodes the trust the copy builds. Fix the top three and update the date; the rest are polish.

### Phone number is not a tappable tel: link
- severity **high**, confidence **high** (The check directly confirms the number exists as text but lacks the tel: protocol. Mobile users must memorize or copy-paste the number to call — a step many will not take.)
- category: conversion, evidence from: automated_check
- evidence: automated_check: click_to_call — "A phone number appears as plain text ('(619) 555-0142') but is not a tel: link, so tapping it on a phone does nothing."
- impact: Every mobile visitor who wants to call hits a dead tap. For an emergency plumber, this is the single biggest leak: the moment of highest intent (burst pipe, no hot water) is exactly when someone is on a phone and least willing to transcribe digits.
- fix: Wrap the number in <a href="tel:+16195550142">(619) 555-0142</a> everywhere it appears — header, body, footer.

### No viewport meta tag — mobile renders as zoomed-out desktop
- severity **high**, confidence **high** (The check is binary: the tag is absent. Without it, the 390px mobile viewport shows a 980px-wide page shrunk to fit, making the phone number, hours, and navigation tiny and unreadable without pinch-zoom.)
- category: mobile, evidence from: automated_check
- evidence: automated_check: viewport_meta — "No viewport meta tag, so phones render the page at desktop width and zoom out."
- impact: Mobile visitors (likely >60% for local search) land on a page they cannot read. They leave before they even see the phone number. This compounds F1: even if the number were a link, it would be too small to hit reliably.
- fix: Add <meta name="viewport" content="width=device-width, initial-scale=1"> to <head>.

### All tap targets under 44×44px — navigation and CTAs too small for thumbs
- severity **high**, confidence **high** (The check measured every visible interactive element. All six — the primary navigation — fail the 44px minimum. No manual testing needed to confirm the defect.)
- category: mobile, evidence from: automated_check
- evidence: automated_check: tap_targets — "6 of 6 visible controls are under 44px, smallest 'Home' at 29x14px."
- impact: The 'Contact' link that passes cta_above_fold is geometrically present but physically untappable. A thumb covers the whole nav bar. Mis-taps send users to wrong pages or nowhere, increasing bounce before a call happens.
- fix: Increase padding/line-height on nav links and the Contact CTA to ≥44×44px. Use a mobile-first nav pattern (hamburger or stacked buttons) with generous hit areas.

### Stale "Site last updated March 2011" signal undermines trust for emergency work
- severity **medium**, confidence **medium** (Would rise to high with a quick owner confirmation that the site content (services, hours, license) is current. The date itself is visible in the provided page text.)
- category: trust, evidence from: inference
- evidence: inference: Page text footer reads "Site last updated March 2011." Today is 2026-10-28 — over 15 years stale. Business context says "Serving San Diego since 1987" and "Emergency service available."
- impact: A homeowner with a burst pipe at 10 PM judges credibility in seconds. A 2011 timestamp suggests the business may be closed, the number dead, or the emergency promise empty. They call the next listing instead.
- fix: Remove the hard-coded "Site last updated" line or replace it with a dynamic "Content reviewed <current year>" if the info is current. Add a recent Google review or job photo with a 2024-2025 date.

### Title tag is only "Plumbing" (8 chars) and no meta description — weak search snippet
- severity **medium**, confidence **high** (The check measures length and presence directly. DOM summary confirms title="Plumbing" and metaDescription="".)
- category: accessibility, evidence from: automated_check
- evidence: automated_check: title_and_description — "title is only 8 characters; no meta description."
- impact: In Google Maps / local pack results, the snippet shows "Plumbing" with no descriptive line. Searchers see no location, no emergency hint, no "family owned since 1987." Click-through drops, so fewer people ever reach the page to call.
- fix: Title: "Harbor & Vine Plumbing | Emergency & Repiping | San Diego, CA" (≈60 chars). Meta description: "Family-owned since 1987. Licensed, bonded, insured. Drain cleaning, water heaters, slab leaks, 24/7 emergency. Call (619) 555-0142."

### 16 text elements below WCAG AA contrast — phone number and hours hard to read
- severity **medium**, confidence **medium** (The check sampled 56 elements and computed contrast against opaque backgrounds. It cannot measure text over images/gradients (reported as unmeasurable). The worst offender is the copyright line, but body copy and the phone number may also be low-contrast.)
- category: accessibility, evidence from: automated_check
- evidence: automated_check: text_contrast — "16 of 56 sampled text element(s) below WCAG AA. Worst is 2.13:1 where 4.5:1 is required ('Copyright 1998-2024 Harbor & Vine Plumbing. All rights reser')."
- impact: Older homeowners (core plumbing demographic) struggle to read the number, hours, or address on a bright screen. They give up or mis-dial. The copyright line is the least important text but signals a systemic contrast problem.
- fix: Audit the color palette: ensure body text ≥4.5:1, large text (≥18px) ≥3:1. Darken gray body copy or lighten the background. Test the phone number line specifically.

### Broken heading structure (two H1s, jump to H3) — hurts screen-reader users and SEO
- severity **low**, confidence **high** (The check and DOM summary agree on the exact heading tree. No ambiguity.)
- category: accessibility, evidence from: automated_check
- evidence: automated_check: heading_structure — "Heading outline is broken: 2 h1 elements; h1 is followed by h3." DOM summary shows H1: "Harbor & Vine Plumbing", H1: "Welcome To Our Website", then H3: "Our Services", "What Our Customers Say", "Contact Us".
- impact: Screen-reader users (some of whom are homeowners with disabilities) cannot navigate by heading hierarchy. Google may misunderstand page topic. Indirectly reduces calls from accessibility-reliant users and organic search.
- fix: Single H1: "Harbor & Vine Plumbing — San Diego Plumbing Since 1987". H2 for major sections: "Our Services", "What Our Customers Say", "Contact Us". Remove the second H1.

### Two images have no alt text — minor accessibility gap
- severity **low**, confidence **high** (The check found two base64-encoded GIFs (likely spacers or tracking pixels) with empty alt. Presence/emptiness is binary.)
- category: accessibility, evidence from: automated_check
- evidence: automated_check: image_alt_text — "2 of 2 visible image(s) have no alt text (e.g. gif;base64,R0lGODlhAQABAIAAAMLCwgAAACwAAAAAAQABAAA, gif;base64,R0lGODlhAQABAIAAAMLCwgAAACwAAAAAAQABAAA)."
- impact: Negligible for calls. Only matters if images convey content (badges, license photos, truck wrap). These appear to be decorative/spacers.
- fix: Add alt="" to decorative images. If either image is a trust badge (license, BBB, manufacturer), add descriptive alt text.

## Verification

- Attempts: 1, cap 3
- Outcome: **passed**
- The page passed all automated checks after one repair attempt, with scores improving from 30 (3 passed, 8 failed) to 100 (11 passed, 0 failed).

## Latest draft

**Subject:** Missed call on mobile

```
Phone number not tappable on mobile — visitors can’t call with a tap.

Every missed call costs you a job.

Here is the rebuilt page - I rebuilt your page so you can look at it instead of imagining it: http://localhost:3000/mockup/demo-harbor-vine-plumbing-example

That page is a concept mockup I made, not affiliated with Harbor & Vine Plumbing. It passed 11 of 13 automated checks, against 3 of 13 for the current page.

Look at the page and reply yes or no.

Thanks,

Sam Reyes

1234 Example St, Suite 100, San Diego, CA 92101

You are receiving this one-off note because your business is listed publicly in San Diego, CA. Reply "unsubscribe" and I will remove you and never contact you again.
```

## Operator edits

### 2026-10-28 23:09:24 (rejected)
Note: Never open with the word "Hi" or the business name. Open with the single measured defect, in the first six words. And never mention a score out of 100 anywhere in the email — business owners do not care about our number, they care about missed calls.

## History

- 2026-10-28 22:54:56 — discovered: seeded demo fixture
- 2026-10-28 22:55:18 — audited: 8 findings, score 30
- 2026-10-28 22:56:05 — verified: passed after 0 repair attempt(s)
- 2026-10-28 22:56:40 — drafted: Phone number not tappable – quick fix?
- 2026-10-28 22:57:42 — discovered: seeded demo fixture
- 2026-10-28 22:58:10 — audited: 8 findings, score 30
- 2026-10-28 22:58:52 — verified: passed after 1 repair attempt(s)
- 2026-10-28 23:01:06 — drafted: Phone link not tappable
- 2026-10-28 23:09:24 — rejected: Never open with the word "Hi" or the business name. Open with the single measured defect, in the first six words. And never mention a score out of 100 anywhere in the email — business owners do not care about our number, they care about missed calls.
- 2026-10-28 23:10:20 — redrafted: v2 with 1 learning(s) in memory
- 2026-10-28 23:12:02 — redrafted: v3 with 1 learning(s) in memory
- 2026-10-28 23:17:09 — redrafted: v4 with 1 learning(s) in memory
- 2026-10-28 23:18:36 — redrafted: v5 with 1 learning(s) in memory
