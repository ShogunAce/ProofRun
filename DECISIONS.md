# Decisions

Every judgment call made while building ProofRun, newest phase last.

## Phase 1 — core

**Model IDs were read from the live catalog, not guessed.**
`https://tokenfactory.nebius.com/api/public/models_info` is the authoritative
JSON the Nebius model catalog page is built from. It lists exactly five NVIDIA
models, each pinned to one region:

| Model ID | Region | Context | In / Out per 1M |
|---|---|---|---|
| `nvidia/Nemotron-3-Ultra-550b-a55b` | us-central1 | 1024K | 1.00 / 3.00 |
| `nvidia/nemotron-3-super-120b-a12b` | us-central1 | 256K | 0.30 / 0.90 |
| `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | eu-north1 | 262K | 0.06 / 0.24 |
| `nvidia/Nemotron-3_5-Lightning` | eu-north1 | 1024K | 0.06 / 0.24 |
| `nvidia/Nemotron-3.5-Super-VL` | us-north1 | 1024K | 0.30 / 0.90 |

Note the inconsistent casing between IDs (`NVIDIA-Nemotron-3-Nano...` vs
`nemotron-3-super...`). They are used verbatim. All five are in `.env.example`.

**Region handling.** Because each Nemotron model lives in one region and the
Nebius Nemotron docs themselves use a regional host
(`api.tokenfactory.us-central1.nebius.com`), `tools/nebius.js` tries a model's
regional endpoint first and falls back to the global host, caching whichever
answered. This was chosen over hardcoding one endpoint because the global host
is not documented as serving every region's catalog, and a 404 on a model ID is
indistinguishable from a typo without trying both.

**Token Factory is treated as OpenAI-compatible, via the official `openai` SDK.**
Confirmed from the Token Factory quickstart, which ships an OpenAI-client
example against `/v1/`. SDK retries are disabled (`maxRetries: 0`) so the
retry/fallback trace shown on the Proof screen is the real one rather than a
summary of hidden attempts.

**Structured output is belt-and-braces.** Calls that need JSON send
`response_format: {type: 'json_schema', strict: true}` AND validate the reply
with zod AND, on a validation failure, hand the model its own error once before
failing the step. The Nebius model pages say Nemotron "supports structured
output" but do not document `strict` json_schema specifically, so the parse path
tolerates fenced JSON, `<think>` blocks and prose around the object.

**Routing lives in `config/routing.json`, keyed by role, not by model.** Code
asks for `role: 'audit'`; the table maps that to an env var name. Re-routing is
a config edit. The table carries a `why` string per role, which the README and
the Evidence screen both render, so the stated reason and the actual call can
never drift apart.

**A model fallback chain exists but is recorded.** If a role's model fails after
retries, ProofRun walks `fallback_chain` and stamps `substituted_for` on the
trace. A number on the Proof screen is always attributable to the model that
actually produced it.

**The check suite is shared code, not two code paths.** `tools/checks.js` runs
identically against the prospect's live site and the generated page, at the same
two viewports (1280x800 desktop, 390x844 mobile). That is the only honest basis
for a score delta. Scoring is weighted and computed in code; no model ever
assigns a score.

**Checks fail open and declare their own limits.** Each check carries a `limit`
string describing what it did not look at, and a check that cannot run returns
`skipped` and scores nothing rather than passing. Two checks (`copy_persuades`,
`brand_accuracy`) are listed in the UI but marked `automated: false` and
excluded from the score, which is how the UI can honestly say "13 of 15 checks
automated".

Contrast specifically: text sitting on a background image or gradient is counted
as *unmeasurable* and reported, never as a pass. Page weight is summed from
`Content-Length` headers only, so it is described as a floor, not a total.

**13 automated checks, not a Lighthouse integration.** Running real Lighthouse
per prospect costs 20-40s and produces numbers whose provenance is hard to show
in a UI. Hand-rolled checks are specific enough to feed back to the model as
repair instructions ("`tap_targets`: 'Skip to main content' is 160x22px"), which
a Lighthouse score is not.

**Verified against a real site before writing any more.**
`https://colepepperplumbing.com` scores 62/100: passes tel: links, viewport,
title/description, lang, links and render speed; fails contrast (16 of 352 text
elements, worst 3.12:1), tap targets (10 of 65 under 44px), alt text (10 of 132
images), heading structure (h2 followed by h4) and page weight (1584KB against a
600KB budget). Those are real, specific, actionable findings, which is the bar
the suite had to clear.

**Prospect `url` is kept out of the repo as live data.** `.gitignore` excludes
`memory/prospects/live-*` and all of `data/runs/`; only the seeded demo prospect
is committed.

**Node, ESM, no build step.** Express plus static files. Playwright is already a
Node dependency, so adding a bundler and a framework would add deploy risk for a
six-screen UI with no client-side routing.

## Phase 4 — ship

**OpenShell was evaluated and not shipped; a three-layer sandbox was.** The
OpenShell docs describe a gateway control plane plus per-sandbox YAML policy
with kernel-level isolation, aimed at constraining coding agents like Claude
Code or OpenCode that have broad filesystem and network reach. ProofRun's
untrusted code is narrower than that by construction: one self-contained HTML
document with no JavaScript and no network access, loaded in a headless browser
we already launch ourselves. Standing up a gateway to contain a static document
would have been architecture for the slide rather than for the threat, and the
hackathon cut line put OpenShell below the retry loop and the Proof screen.

What shipped instead is defence in depth sized to the actual risk: a static gate
that rejects any script, external reference or inline handler before the file is
written; network deny-all at load, with blocked requests logged; and a child
process with a scrubbed environment holding no API keys, a 512MB heap cap and a
wall-clock kill. `SANDBOX_MODE=openshell` exists as a documented adapter seam in
`tools/sandbox.js` and throws rather than pretending to work.

**The Docker base image is pinned to the exact Playwright version.** The image
ships browser builds tied to its own release, and Playwright resolves a build
number from the library version. `mcr.microsoft.com/playwright:v1.57.0-noble`
with `playwright@1.64.1` resolved from `^1.57.0` built cleanly and then failed at
`browserType.launch()` inside the container with "Executable doesn't exist at
/ms-playwright/chromium_headless_shell-1248". Both are now pinned to 1.64.1, and
the Dockerfile carries a comment saying why. This is the kind of failure that
only appears when you actually run the artifact you intend to deploy, which is
why the container was run end to end rather than just built.

**Render was chosen for the hosted demo** over a plain Node host because the
only awkward dependency is headless Chromium, and a Docker deploy from the
Playwright base image removes that entirely. `render.yaml` declares a persistent
disk mounted at `/app/memory`, because file-based memory is the source of truth
and a stateless redeploy would wipe `learnings.md` — the one thing the product
is supposed to accumulate.

**The nightly Serverless Job retries zero times.** `jobs/nightly.js` already
catches per-prospect failures and continues, so a job-level retry would re-audit
prospects that already succeeded and write duplicate drafts. It exits non-zero
only when every prospect in a batch failed verification, which is the only
condition worth alerting on.
