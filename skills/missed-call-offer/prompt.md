# Missed Call Offer — skill prompt (stub)

**Status: stub. There is no runner. The agent core lists it and refuses to
invoke it.** It exists to show the shape of a second skill, so that "skills are
plug-in folders" is a demonstrable claim rather than an assertion.

## The idea

A local trade business loses more money to a phone nobody answers than to a bad
website. The loop would be: establish that calls go unanswered, build the thing
that would have answered them, prove it works, and offer it.

## Why it is not built

Placing test calls to real businesses to measure whether they answer is a
consent and call-recording problem before it is an engineering problem, and the
rules differ by state. ProofRun's whole premise is that the evidence is honestly
obtained; a skill that cannot clear that bar does not ship, even as a demo.

## What it would reuse unchanged

- `tools/nebius.js` — the same role-based routing, no new model wiring
- `tools/sandbox.js` — the same static gate and network-denied verification
- `tools/store.js` — the same prospect files, learnings and run logs
- `agent/core.js` — discovery, input validation and invocation
- The approval gate and `memory/learnings.md` write path

## What it would add

- A telephony adapter (the piece that does not exist)
- A responder template instead of a page template
- A different check suite: does the responder fire, how fast, does it capture a
  callback number

## The one thing a reviewer should take from this folder

The capability boundary is the folder. Adding a skill means adding a manifest, a
prompt and a runner — not editing the agent core. `agent/core.js` reads
`skills/*/skill.json` off disk; it has no list of skill names in it.
