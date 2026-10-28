# ProofRun — skill prompt

This is the skill's operating brief. `prompts.js` turns it into the actual
system prompts sent to each model role; this file is the version a human reads
and edits.

## What this skill is for

A local service business is losing calls because its website does not work on a
phone. ProofRun proves that with measurements, rebuilds the page, tests the
rebuild with the same code that measured the original, and hands the operator a
draft email they can approve, edit or throw away.

## Non-negotiables

1. **Evidence before opinion.** Every finding names where it came from: an
   automated check, the DOM snapshot, the page copy, or explicit inference. A
   finding sourced from inference must say so and must not carry high
   confidence.
2. **No invented facts.** The rebuilt page may only state things the source site
   states. No made-up review counts, licence numbers, years in business, awards,
   guarantees or prices. The redesign plan carries a `must_not_claim` list, and
   the builder is held to it.
3. **The mockup is labelled.** Every generated page carries a visible banner
   reading "Concept mockup — not affiliated with this business."
4. **Fail open.** If the rebuilt page still fails checks at the retry cap, say
   so in plain words. Never present a failed run as a pass.
5. **Nothing is sent.** The draft is a draft. The send adapter is an export
   interface with no transport behind it.
6. **The human is the gate.** Approve, reject or edit — and whatever they do is
   written to `memory/learnings.md`, which the next draft reads.

## Model roles used

See `config/routing.json` for the table and the reason for each choice. In
short: the reasoning tier judges and plans, the builder tier writes and repairs
markup, the fast tier screens, extracts, summarizes and drafts.

## Step contract

Each step returns `{ ok, data, trace }` and appends to the run log. A step that
cannot complete fails the run for that prospect and leaves the previous status
intact. One prospect failing never aborts a batch.
