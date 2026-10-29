# ProofRun — submission copy

Everything here is drawn from verified runs. Numbers you can quote are in
`VERIFIED NUMBERS` at the bottom. Anything you still have to do yourself is in
`STILL OPEN`.

---

## Inspiration

I sell website rebuilds to local trade businesses. The hardest part was never
the building — it was the twenty minutes per prospect spent proving there was a
problem worth paying to fix. Open the site on a phone, squint at it, write an
email that says "your site looks dated," and watch it get ignored, because
"looks dated" is an opinion and the owner has heard it from six other people
trying to sell them something.

The thing that actually works is showing someone the rebuilt page. Nobody argues
with a page that loads faster and lets them tap the phone number. But building a
speculative page per prospect is hours of work for a cold email that probably
gets deleted.

So the question was: can an agent do the whole loop overnight — find the
business, measure what's actually broken, rebuild the page, *test its own
rebuild*, and hand me a draft — while leaving every decision with me?

The part I cared most about was the testing. An agent that writes a page and
tells you it's better is just a more expensive opinion. An agent that writes a
page, runs the same check suite it ran on the original, fails, reads the
failure, fixes it, and runs again is doing something I can actually trust.

## What it does

ProofRun is an always-on sales operator. The assistant is the shell; ProofRun is
its flagship skill.

Give it a niche and a city. It then:

1. **Discovers** candidate businesses with Tavily search, and screens every hit
   through Nemotron Nano — which correctly skipped Roto-Rooter as "a national
   franchise, not an independent local business."
2. **Enriches** with Tavily extract plus a Playwright text pass, pulling only
   facts the site actually states.
3. **Captures** the live site at desktop (1280×800) and mobile (390×844):
   screenshots, DOM snapshot, and 13 automated checks.
4. **Audits** with Nemotron Ultra 550B, producing ranked findings as validated
   JSON. Every finding names its evidence source and a confidence level, and
   says what would raise that confidence.
5. **Writes** a replacement single-page site as real HTML/CSS.
6. **Runs and tests its own output** in a sandbox, headlessly, against *the same
   check code*. On failure, the exact failing measurement goes back to the model
   and it tries again, up to three repairs. Every attempt is logged.
7. **Proves** it: before/after screenshots, score delta, full test log, retry
   trace.
8. **Drafts** a personalized email citing only verified findings, in the
   operator's own voice, with an unsubscribe line and a physical-address
   placeholder.
9. **Waits.** A human approves, edits or rejects — and that decision is written
   to memory, which the next draft reads.

Six screens: Morning Brief, Queue, Live Run, **Proof** (the hero), Approve &
Edit, Memory Viewer.

**Nothing is ever sent.** There is no SMTP client, no email API client, no
transport of any kind in the repo. `agent/send-adapter.js` throws if you call
it. Approved drafts are exported to a file for a human.

**It fails open.** If the rebuild still fails checks at the retry cap, the run is
reported as failed and *no draft is written*. ProofRun does not pitch a rebuild
that failed its own tests.

## How we built it

**Everything runs on Nebius Token Factory, on NVIDIA Nemotron models, across
three tiers.** No model ID appears anywhere in the code — code asks for a *role*
and `config/routing.json` maps it to an environment variable:

| Role | Model | Why |
|---|---|---|
| `audit`, `redesign_plan` | **Nemotron-3-Ultra-550b-a55b** | Ranking real defects by business impact and attaching honest confidence is the hardest judgment in the loop. The 1M context fits the whole DOM snapshot. |
| `build`, `repair` | **nemotron-3-super-120b-a12b** | Long HTML/CSS generation is throughput-bound, not judgment-bound, at a third of Ultra's cost per token. |
| `classify`, `extract`, `summarize_tests`, `draft_email`, `brief` | **NVIDIA-Nemotron-3-Nano-30B-A3B** | Screening, extraction and style work. At $0.06/M, screening dozens of hits a night is effectively free. |

The architecture is deliberately boring and config-driven, so it can be cloned
and turned into a real sales agent by editing config and adding skill folders:

- `tools/checks.js` — one check suite, run against both the original and the
  rebuild. Same code, same viewports, same thresholds. That is the only honest
  basis for a delta.
- `tools/sandbox.js` — three layers before model-written code executes: a static
  gate (no scripts, no external references, no inline handlers), network
  deny-all at load, and a child process with a scrubbed environment holding no
  API keys.
- `agent/core.js` — reads `skills/*/skill.json` off disk. There is no list of
  skill names in it. Adding a capability means adding a folder.
- `memory/` — plain markdown files as the source of truth. No database.
- `jobs/nightly.js` — the batch, designed as a Nebius Serverless Job, with a
  "Run now" button on the same code path.

Structured output is belt-and-braces: `response_format: json_schema` with
`strict: true`, **and** zod validation, **and** on a validation failure the model
is handed its own error once before the step fails.

## Challenges we ran into

**A 200 OK containing nothing.** The hardest bug by far. Nemotron 3 models are
reasoning models, and on Token Factory `max_tokens` covers the reasoning trace
*and* the visible content. A long prompt would return `finish_reason: "length"`
with `content: ""` — a successful response with nothing in it. One call spent
**40,085 characters** on reasoning before producing a single word of output. The
client now detects empty-at-length, escalates the budget, retries, and records
the escalation in the trace.

**The retry loop didn't fire, and the reason was my fault.** My first build
prompt handed the model every threshold the check suite uses — 44px, 4.5:1,
390px. It passed first try every time. That's teaching to the test, and it made
the repair loop decorative. I rewrote the brief at intent level ("mobile-first",
"WCAG AA") — what a real operator would actually say — and left the exact
measurements to the *repair* prompt. Now failures are genuine misses, and the
loop earns its place.

**Comparing two scores that weren't comparable.** A live site has outbound links
to probe; a self-contained generated page has none, so that check is skipped on
the rebuild. Comparing percentages with different denominators would have
flattered the result. The headline delta is now computed only over checks that
produced a result on *both* runs, and every excluded check is named on screen
with the reason it dropped out.

**The model thought the future was fake.** Ultra flagged a real business's
October 2026 reviews as "future-dated and probably fabricated" — because its
training data predates today. Any prompt reasoning about recency now gets the
real date injected.

**Drafts that leaked their own scaffolding.** Live runs produced a repeated
`Subject:` line inside the body, an `Applied: 1` label, an unfilled `{{city}}`
placeholder, internal finding ids like `F1` in prose, and one unbroken wall of
text. Rather than trust the prompt, each is now a schema refinement that rejects
the output and makes the model repair itself.

**Region-pinned models.** Each Nemotron model lives in exactly one region, and
the docs show both a global and a regional host without saying whether the
global one routes everywhere. The client tries the regional endpoint first,
falls back to global, and caches whichever answered.

## Accomplishments that we're proud of

**The agent tests its own work and visibly fails.** On the demo run it wrote a
page with a 78-character title, the check suite caught it, the exact measurement
went back to the model, and the second attempt passed: 30 → 100. On a live run
against a real plumbing company it needed **all three** repair attempts to get
there. That's a real engineering loop, not a scripted animation.

**Memory provably changes the output, and there's a test that fails if it
doesn't.** `scripts/try-memory.js` prints draft v1, records an operator
correction, redrafts with the audit, proof, model and prompt all held constant,
and asserts the text changed. v1 opened "Hi Harbor & Vine Plumbing,". After the
correction, v2 led with the measured defect and dropped the score entirely — and
the model reported back exactly which rules it followed.

**Honesty is enforced in code, not promised in a prompt.** The schema rejects a
finding that claims high confidence from inference. Checks declare what they did
*not* look at. Text over a background image is reported as *unmeasurable*, never
as a pass. Page weight is described as a floor, not a total. Every number on
screen ships with its limit beside it.

**A clean one-command path.** `npm start`, press Run now, and the whole loop runs
in about two minutes with the live feed streaming every tool call, model call
and retry.

## What we learned

**Reasoning models break the `max_tokens` mental model.** If the budget covers
thinking as well as output, every token estimate built for non-reasoning models
is wrong, and the failure mode is silent — a valid response with an empty string
in it. Handle `finish_reason: "length"` explicitly.

**Where you put the specification decides whether verification means anything.**
Put the thresholds in the build prompt and the model passes trivially. Put them
only in the feedback loop and you find out what it actually gets wrong.

**Validate structure rather than asking nicely.** Every "please don't do X" in a
prompt was eventually violated. Every schema refinement was obeyed on the
repair, because the model got its own error back and fixed it.

**Cheap models are good enough for most of an agent.** Seven of nine roles run on
Nano 30B. The expensive model is reserved for the two places judgment actually
matters. A full demo run is roughly 32,000 tokens.

**An honest number is more persuasive than a big one.** "33 → 100 over 10
comparable checks, 3 excluded" is a better claim than "100/100", because it
tells you what was measured.

## What's next for ProofRun

- **Finish the Serverless Job deployment** so the nightly batch runs on Nebius
  on a schedule rather than on my laptop.
- **A second real skill.** `skills/missed-call-offer/` is a stub with a manifest
  and a prompt but no runner, because placing test calls to real businesses is a
  consent and recording question before it's an engineering one. That gets
  answered properly before it ships.
- **Nemotron Super VL on the screenshots.** The audit currently reasons over a
  DOM snapshot and check output. A vision model reading the actual rendered
  before/after would catch what the DOM cannot: visual hierarchy, whether the
  hero image is a stock photo, whether the page simply looks untrustworthy.
- **Widen the check suite honestly.** Real Core Web Vitals, throttled mobile
  loads, and a 320px viewport — each added with its limits stated, the same way
  the current thirteen are.
- **Learn from outcomes, not just corrections.** Right now memory records what I
  edited. It should eventually record which drafts got replies.

---

## Built with

```
nebius-token-factory
nvidia-nemotron
nemotron-3-ultra-550b
nemotron-3-super-120b
nemotron-3-nano-30b
tavily
playwright
node.js
express
javascript
zod
openai-sdk
server-sent-events
html
css
chromium
json-schema
structured-outputs
agents
ai-agents
web-accessibility
wcag
sandboxing
prompt-engineering
file-based-memory
```

(25 tags exactly.)

---

## Judge questionnaire

**Track:** Personal AI

**New or existing:** New. First commit made during the hackathon window; the
entire repository was written for this submission.

**Which model(s) did you use, and why that size/variant?**

Three Nemotron 3 variants, routed by role through `config/routing.json` so no
model ID appears in application code.

**Nemotron-3-Ultra-550b-a55b** (us-central1) for the audit and the redesign
plan. Ranking real page defects by business impact — and attaching an honest
confidence level with a reason it isn't higher — is the hardest judgment in the
loop, and the one most visible to a user. Its 1M context also means the whole
DOM snapshot and page text fit without truncation.

**nemotron-3-super-120b-a12b** (us-central1) for generating and repairing the
replacement page. Writing long HTML/CSS is throughput-bound rather than
judgment-bound, and Super costs about a third of Ultra per output token while
producing clean single-file pages.

**NVIDIA-Nemotron-3-Nano-30B-A3B** (eu-north1) for the five remaining roles:
screening search hits, extracting business facts, summarizing the test log,
drafting the email, and writing the Morning Brief. At $0.06/M input, screening
dozens of candidates a night is effectively free, which is what makes an
overnight batch economically sensible at all.

The split is deliberate: seven of nine roles run on the cheapest model, and the
expensive one is reserved for the two places judgment genuinely matters.

**Nemotron output quality (1–10): 8**

Strongest at reasoning and at taking correction. Ultra's audits were genuinely
good — given a check log and a DOM snapshot it produced specific, ranked,
business-framed findings, and it reliably explained what would raise its
confidence. Super's repairs were excellent: handed one failing check with its
exact measurement, it fixed that and left the rest of the page alone, which is
exactly what you want and not what I expected.

Two real weaknesses. Instruction-following on *negative* constraints in long
prompts was unreliable — "do not put a Subject: line in the body" was violated
repeatedly until I made it a schema refinement that handed the model its own
error, at which point it corrected immediately. And Nano over-reasons
dramatically on open-ended generative tasks: 40,085 characters of reasoning for
one email draft, where the same model is crisp and fast on extraction.

One avoidable error class is a date problem rather than a model problem: Ultra
flagged genuine October 2026 reviews as fabricated because its training predates
today. Injecting the real date fixed it completely.

**Fine-tune, prompt-engineer, or out of the box?**

Out of the box, with structured prompt engineering and schema-enforced
validation. No fine-tuning.

The approach that mattered: **validate, don't ask.** Every call that needs
structure sends `response_format: json_schema` with `strict: true`, validates
the reply against a zod schema, and on failure hands the model its own
validation error once before the step fails. Constraints that kept being
violated as prose instructions became schema refinements — a finding sourced
from "inference" cannot claim high confidence, a draft body cannot contain an
unfilled `{{placeholder}}`, cannot refer to internal finding ids, and must have
real paragraph breaks. Every one of those was obeyed on the repair attempt.

The second decision was about *where* to put the specification. I deliberately
do **not** give the build model the thresholds the check suite uses. It gets an
intent-level brief ("mobile-first", "WCAG AA") and the repair prompt gets the
exact failing measurement. Handing over the thresholds up front made it pass
first try every time and made the verification loop meaningless.

**How did Nemotron compare to other models for similar tasks?**

Ultra's audit quality is competitive with frontier closed models on this task —
the findings were specific and correctly prioritized, and the confidence
reasoning was better than I expected, probably because the schema forced it.

Super's narrow-repair behaviour was the standout. Many models, told to fix one
failing check, rewrite the whole page and break three others. Super consistently
changed only what was named. That single property is what makes a bounded retry
loop viable.

The genuine differences from non-reasoning models are operational, not
qualitative: the shared reasoning/output token budget changes how you size
requests, and latency is dominated by reasoning length, not output length — a
107-word email took 40 seconds because of 16,000 characters of thinking in front
of it.

**Which Nebius platform capabilities were most valuable?**

Serverless inference over an OpenAI-compatible API, which meant the official
`openai` SDK with a changed `baseURL` and nothing else. Zero GPU provisioning,
zero deployment setup, and the whole project is three environment variables.

The **public catalog JSON** at `/api/public/models_info` deserves specific
credit. It returns the full catalog with per-model region, context window,
quantization, tokens/sec and pricing, which meant not one model ID in this
project was ever guessed — I read them from the source of truth. Most providers
make you scrape a docs page.

Having **three tiers of the same model family on one endpoint** is what made the
routing table practical. Switching a role from Nano to Super is an environment
variable, not an integration.

The main friction was region pinning: each Nemotron model lives in one region,
and the docs show both a global and a regional host without stating whether the
global one routes everywhere. I implemented regional-first-then-global fallback
with endpoint caching to be safe.

**Recommend Nemotron on Nebius (1–10): 9**

Genuinely easy to adopt, the price/performance across three tiers is what made
an overnight batch viable, and the catalog JSON is a real quality signal. One
point off for documentation gaps that cost me real hours — the shared
reasoning/output token budget, and whether the global endpoint serves every
region. Neither is a product flaw; both are a sentence of documentation.

**Inference experience vs. other environments (1–10): 9**

Faster to first working call than any local setup — no weights to download, no
GPU to size, no serving stack. Compared to other hosted APIs it is equivalent in
effort because it is OpenAI-compatible, and better in transparency because of
the catalog JSON. Latency was consistently good: Ultra answered a one-token
probe in 336ms, and a full 8-finding audit over a large DOM snapshot in about
10 seconds.

**What would have made the experience more effective?**

1. **Document the token budget semantics.** State clearly that `max_tokens`
   covers reasoning *and* content, and ideally return a `reasoning_tokens` field
   in `usage`. The silent failure — HTTP 200, `finish_reason: "length"`,
   `content: ""` — cost me more debugging time than anything else.
2. **Document `response_format` support per model.** Model pages say "supports
   structured output"; the API reference doesn't document `response_format` at
   all, and nothing states whether `strict: true` is honoured or silently
   downgraded. For an agent that validates every output, that's the single most
   important thing to specify. (It does work — I verified it.)
3. **Normalize the model IDs.** The same catalog contains
   `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, `nvidia/nemotron-3-super-120b-a12b`,
   `nvidia/Nemotron-3_5-Lightning` and `nvidia/Nemotron-3.5-Super-VL` — four
   different conventions, including an underscore and a dot used
   interchangeably. Third-party docs use a fifth form.
4. **One sentence on endpoint routing.** "The global endpoint routes to all
   regions" would have deleted a function from my codebase.
5. **A reasoning-effort parameter.** Nano spending 40,000 characters of thinking
   on a short email is the wrong trade. A `low`/`medium`/`high` knob would cut
   my demo's wall-clock time substantially.

**What do you most hope to see from the Nemotron team next?**

A controllable reasoning budget, separate from `max_tokens`. The capability is
excellent; the lack of a dial means paying full reasoning cost on tasks that
don't need it, which is the main thing standing between this agent and running
comfortably at scale.

Beyond that: a smaller Nemotron tuned specifically for structured extraction.
Nano is strong at it but over-thinks it, and extraction is the highest-volume
call in any agent like this one.

And please keep the deprecation runway longer. Nano 30B is already flagged for
removal two weeks after this hackathon.

**Did you use Tavily? — Yes**

Two functional runtime calls in the live path, both exercised end to end against
real businesses:

- `POST /search` (`tools/tavily.js:search`) — discovery, with directories and
  social platforms excluded at the API level. Each hit is then screened by
  Nemotron Nano.
- `POST /extract` (`tools/tavily.js:extract`) — business context from the site
  and its contact page, appended to a Playwright text pass before extraction.

Verified on a live run against San Diego plumbers: Tavily returned 10 results,
Nano correctly skipped Roto-Rooter as a national franchise, selected an
independent local business, and Tavily extract supplied the business context
that fed the audit.

**AI tools used while building:** Claude Code (Opus) as the primary development
environment, for research, implementation, debugging and verification.

---

## VERIFIED NUMBERS (safe to quote)

**Demo run** (seeded fictional business, `PROOFRUN_MODE=demo`):
- Score 30 → 100 raw; **33 → 100 (+67)** over 10 comparable checks, 3 excluded
- 8 audit findings, 3 high severity
- **1 repair attempt** of 3 (attempt 1 wrote a 78-character title; caught, fed
  back, fixed)
- 7 model calls, 31,864 tokens, 134 seconds wall clock

**Live run** (real San Diego plumbing company, Tavily discovery):
- Score 80 → 100 raw; **76 → 100 (+24)** over 11 comparable checks, 2 excluded
- 5 findings; Tavily returned 10 hits, Nano screened out the franchise
- **3 repair attempts of 3** — the cap was reached, and it passed on the last one
- 11 model calls, 65,909 tokens, 210 seconds wall clock

**Check suite:** 13 automated checks scored, 2 listed as human-judgment and
never scored. Two viewports: 1280×800 and 390×844.

**Model latency:** Ultra one-token probe 336ms; full audit ~10s; Super page
generation ~19–32s; Nano extraction ~11s, email draft ~40–63s.

---

## STILL OPEN

Done since the last pass: `README.md`, `Dockerfile` (built and run end to end
with the full loop passing inside the container), `render.yaml`, and
`jobs/nebius-serverless-job.json`.

**Blocked — needs you:**

1. **Push the repo to GitHub.** The repository is committed locally with clean
   history (no `.env`, no key-shaped strings, no live prospect data), but the
   sandbox blocked creating a GitHub repo. One command:
   `gh repo create ProofRun --public --source=. --remote=origin --push`
2. **Deploy.** `render.yaml` is ready — connect the repo at
   [render.com/new](https://dashboard.render.com/select-repo?type=blueprint),
   then set `NEBIUS_API_KEY` and `TAVILY_API_KEY` in the dashboard. This needs
   your Render login.
3. **Record the demo video.** Walkthrough script is in the chat.

**Before any real use:**

4. **`config/voice.md` still holds the sample voice.** Replace it with three or
   four paragraphs of your own writing — it is what the drafts imitate.
5. **`memory/profile.md` still holds demo data** (Sam Reyes, example address).
