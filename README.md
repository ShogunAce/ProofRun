# ProofRun

**License: [MIT](LICENSE)** · NVIDIA × Nebius Global AI Hackathon · Track: Personal AI

> Your always-on sales operator: it prospects overnight, ships and tests website
> redesigns, and learns from what you approve.

ProofRun finds local businesses with weak websites, audits them against a fixed
automated check suite, writes a replacement page as real HTML/CSS, **runs and
tests its own output** against the same checks, repairs it when the tests fail,
proves the improvement with before/after evidence, and drafts a personalized
outreach email.

A human approves everything. **Nothing is ever sent.**

---

## The part that matters

An agent that writes a page and tells you it is better is an expensive opinion.

ProofRun writes a page, loads it headlessly, runs **the same check code** it ran
against the original, and when a check fails it feeds the exact failing
measurement back to the model and tries again — up to three repairs, every
attempt logged.

On the seeded demo run, attempt 1 produced a 78-character page title. The check
suite caught it, the measurement went back to the model, and attempt 2 passed.
On a live run against a real San Diego plumbing company, the rebuild needed all
three repair attempts before it passed.

If it still fails at the retry cap, the UI says so plainly and **no draft is
written**. ProofRun does not pitch a rebuild that failed its own tests.

---

## Quick start

**Requirements:** Node 20+ and a [Nebius Token Factory](https://tokenfactory.nebius.com)
API key. A [Tavily](https://tavily.com) key is optional — demo mode runs without it.

```bash
git clone https://github.com/ShogunAce/ProofRun.git
cd ProofRun
npm install            # also installs the Chromium that Playwright drives
cp .env.example .env   # then add NEBIUS_API_KEY
npm run check:env      # what is configured, what is missing
npm run check:models   # probes every configured model at every endpoint
npm start              # http://localhost:3000
```

Open the app and press **Run now**. The whole loop takes about two minutes and
streams every tool call, model call and retry to the Live Run screen.

`npm run check:models` is worth running first — it lists the Nemotron models
your key can actually see per region, prints the routing table, and makes a live
one-token call to each configured model so you find out about a bad key or a
retired model ID before a run, not during one.

### Scripts

| Command | What it does |
|---|---|
| `npm start` | The web app on `PORT` (default 3000) |
| `npm run check:env` | Configuration report: what is set, what is missing, what still works without it |
| `npm run check:models` | Lists visible Nemotron models per endpoint and live-probes each configured model |
| `npm run run:nightly` | The overnight batch (`--count 5 --niche plumbers --city "San Diego, CA"`) |
| `node scripts/try-phase1.js <url>` | Audit one real site on the console: capture → checks → structured audit |
| `node scripts/try-phase2.js` | The whole loop on the console, demo mode. Add `--live <niche> <city>` for the real thing |
| `node scripts/try-memory.js` | **Proves memory changes the next draft**, and exits non-zero if it does not |
| `node scripts/try-limits.js` | Exercises every rate-limit gate and exits non-zero on a wrong decision. No model calls |

### Demo mode vs live mode

`PROOFRUN_MODE=demo` (the default) runs against a **seeded fictional business**,
Harbor & Vine Plumbing — a deliberately dated page in
`skills/proofrun/demo-fixture.js` that fails the checks real small-business
sites fail. No search is performed, no real business is contacted, and the run
is repeatable and free of Tavily cost.

Only discovery and the page fetch are seeded. The capture, the 13 checks, the
audit, the rebuild, the sandboxed verification and the retry loop are all the
real code paths running against a real local file.

`PROOFRUN_MODE=live` uses Tavily to find real businesses. Prospect files for
live runs are gitignored, so no real business data enters the repository.

---

## How NVIDIA Nemotron and Nebius Token Factory are used

**Every model call in ProofRun goes to an NVIDIA Nemotron model on Nebius Token
Factory.** There is no other inference provider in this project and no fallback
to a closed model.

Token Factory is OpenAI-compatible, so `tools/nebius.js` wraps the official
`openai` SDK with a changed `baseURL`. Three tiers of the same model family on
one endpoint is what makes the routing table below practical: changing a role
from Nano to Super is an environment variable, not an integration.

### Model routing

No model ID appears anywhere in application code. Code asks for a **role**;
[`config/routing.json`](config/routing.json) maps that role to an environment
variable. Re-routing is a config edit.

| Role | Model | One line on why |
|---|---|---|
| `audit` | **Nemotron-3-Ultra-550b-a55b** | Ranking real page defects by business impact and attaching an honest confidence level is the hardest judgment in the loop; the 1M context fits the whole DOM snapshot without truncation. |
| `redesign_plan` | **Nemotron-3-Ultra-550b-a55b** | Deciding what the new page must say and prove is strategy, not markup — same reasoning tier as the audit so the plan actually answers the findings. |
| `build` | **nemotron-3-super-120b-a12b** | Long HTML/CSS generation is throughput-bound rather than judgment-bound, at about a third of Ultra's cost per output token. |
| `repair` | **nemotron-3-super-120b-a12b** | Fixing one named failing check is a narrow, mechanical edit; temperature 0.15 keeps a retry from rewriting the whole page. |
| `classify` | **NVIDIA-Nemotron-3-Nano-30B-A3B** | "Is this search hit a real independent local business?" is a yes/no with a reason — at $0.06/M, screening dozens of hits a night is effectively free. |
| `extract` | **NVIDIA-Nemotron-3-Nano-30B-A3B** | Pulling business name, services, phone and contact page out of scraped text is pattern work: fast tier, zero temperature, structured output. |
| `summarize_tests` | **NVIDIA-Nemotron-3-Nano-30B-A3B** | Turning a raw check log into one honest sentence — and the numbers it describes are computed by code, never by the model. |
| `draft_email` | **NVIDIA-Nemotron-3-Nano-30B-A3B** | The draft must imitate the operator's own voice sample, which is a style task; findings are passed in as facts so it cannot invent evidence. |
| `brief` | **NVIDIA-Nemotron-3-Nano-30B-A3B** | The Morning Brief narrates numbers already on disk — the cheapest tier that writes a clean paragraph. |

Seven of nine roles run on the cheapest model. The expensive model is reserved
for the two places judgment genuinely matters. A full demo run is ~32,000
tokens.

**Region pinning.** Each Nemotron model is served from one region — Ultra and
Super in `us-central1`, Nano and Lightning in `eu-north1`, Super-VL in
`us-north1`. `tools/nebius.js` tries a model's regional endpoint first, falls
back to the global host, and caches whichever answered, so the endpoint question
costs at most one 404 per model per process.

**Model IDs were read, never guessed.** They come from
`https://tokenfactory.nebius.com/api/public/models_info`, the JSON the public
catalog page is built from, which carries per-model region, context window,
quantization, throughput and pricing.

### Where Token Factory accelerated the work

- **Zero provisioning.** No GPU sizing, no serving stack, no weights to
  download. The entire integration is a `baseURL` and three environment
  variables, so the first working Nemotron call happened in minutes.
- **Three tiers on one endpoint** made cost routing a config file rather than an
  architecture. Being able to put five of nine roles on a $0.06/M model is what
  makes an overnight batch economically sensible at all.
- **The public catalog JSON** meant no model ID in this project was ever a
  guess, and `npm run check:models` can verify the whole routing table against
  the live API before a run.
- **Latency was not a constraint**: Ultra answered a one-token probe in 336ms
  and a full eight-finding audit over a large DOM snapshot in about 10 seconds.

Friction is documented honestly in **[FEEDBACK.md](FEEDBACK.md)** — the shared
reasoning/output token budget, inconsistent model ID casing, and undocumented
endpoint routing.

### Other Nebius services

`jobs/nebius-serverless-job.json` defines the nightly batch as a **Nebius
Serverless Job**. The same code path runs from the "Run now" button, so the
scheduled and interactive paths cannot drift.

---

## Architecture

```
agent/            the shell: skill discovery, schemas, brief, send adapter
  core.js         reads skills/*/skill.json off disk — no skill names in code
  schemas.js      JSON Schema + zod for every structured model call
  brief.js        Morning Brief; counts from disk, model only narrates
  send-adapter.js the dead end: exports approved drafts, never sends
config/           everything tunable, no code changes needed
  routing.json    the model routing table above
  offer.md        what you sell
  voice.md        your writing, which drafts imitate      <- fill this in
  niches.json     target niches and disqualifiers
  outreach_template.md  unsubscribe line + address placeholder
skills/
  proofrun/       the flagship skill: manifest, prompt, prompts, runner, fixture
  missed-call-offer/  a stub, to show the capability boundary is a folder
tools/
  nebius.js       Token Factory client: role routing, regional fallback, traces
  checks.js       THE check suite — one implementation, run on both pages
  capture.js      Playwright capture at two viewports
  verify-worker.js  the sandboxed child process that tests generated pages
  sandbox.js      static gate, network deny-all, process isolation
  tavily.js       search + extract
  store.js        file-based memory
memory/           the source of truth. plain markdown, no database
  profile.md      who you are, your standing instructions
  learnings.md    append-only; every approval, rejection and edit
  prospects/<id>.md  one readable file per prospect
  runs/<date>.md  what happened that day
web/              express API + six static screens, no build step
jobs/             the nightly batch and its Serverless Job definition
```

**Why file-based memory.** The Memory Viewer is a render of files on disk. You
can read, edit or delete anything ProofRun knows with a text editor, and
`git diff` shows you what the agent learned. A database would have hidden that.

### The six screens

1. **Morning Brief** — what ran overnight, what is waiting, what it learned.
2. **Queue** — every prospect with status, scores and repair count.
3. **Live Run** — steps streaming over SSE, with tool calls, model calls, token
   counts and retries visible as they happen.
4. **Proof** — the hero. Before/after at 390px, the score delta on a stated
   comparable basis, the full test log, and the retry trace including failures.
5. **Approve & Edit** — the draft, the evidence it is allowed to cite, and your
   decision. Approving, editing or rejecting writes to memory.
6. **Memory Viewer** — read-only render of `learnings.md` and `profile.md`.

---

## Trust mechanisms

These are enforced in code, not promised in a prompt.

**Nothing is ever sent.** There is no SMTP client, no email API client and no
transport of any kind in this repository. `agent/send-adapter.js` throws if
called. Approved drafts are exported to `data/exports/` as JSON and markdown for
a human to send. No email address is ever harvested or stored.

**Confidence on every finding.** Each audit finding names its evidence source
(`automated_check`, `dom_snapshot`, `page_copy` or `inference`), carries a
confidence level, and states what would raise that confidence. A finding sourced
from `inference` **cannot** claim high confidence — the zod schema rejects it
and the model is handed its own error to fix.

**Verification fails open.** If the rebuild still fails checks at the retry cap,
the run is reported as `failed_verification`, the Proof screen says so in plain
words, and no draft is written. There is no fake pass.

**Every number ships with its limit.** Each check declares what it did *not*
look at. Text over a background image is reported as **unmeasurable**, never as
a pass. Page weight is summed from `Content-Length` headers only, so it is
described as a floor rather than a total. Two of the fifteen listed checks are
marked human-judgment and are never scored — which is how the UI can honestly
say "13 of 15 automated".

**The score delta is computed on a comparable basis.** A live site has outbound
links to probe; a self-contained generated page has none, so that check is
skipped on the rebuild. Comparing two percentages with different denominators
would flatter the result, so the headline delta counts only checks that produced
a result on *both* runs — and every excluded check is named on screen with the
reason it dropped out.

**Generated code is contained**, in three layers:

1. A **static gate** parses the document before it is written to disk. Any
   `<script>`, any external reference, any inline event handler, any `@import`
   or remote `url()` is a hard reject that flows back through the repair loop
   like any other failed check.
2. **Network deny-all** at load: the verification browser context aborts every
   request except the local file under test, and blocked attempts are logged.
3. **Process isolation**: the check pass runs in a child Node process with a
   scrubbed environment holding **no API keys**, a 512MB heap cap and a
   wall-clock kill.

**Mockups are labelled.** Every generated page carries a visible banner reading
"Concept mockup — not affiliated with this business", enforced by the static
gate, and is served with a restrictive `Content-Security-Policy` and
`X-Robots-Tag: noindex`.

**Full audit trail.** Every model call records role, model, endpoint, region,
latency, token usage, finish reason, reasoning length and whether a fallback
model was substituted — so a number on the Proof screen can never be credited to
a model that did not produce it.

---

## The check suite

Thirteen automated checks, run identically against the original and the rebuild
at 1280×800 and 390×844.

| Check | Weight | What it cannot tell you |
|---|---|---|
| No horizontal scroll on mobile | 12 | One viewport width only (390px) |
| Tappable phone number | 12 | That the number is correct |
| Text contrast meets WCAG AA | 12 | Text over images or gradients — reported unmeasurable |
| Call to action above the fold | 10 | Whether the wording persuades |
| Tap targets at least 44px | 8 | Hidden and off-screen controls are skipped |
| Images have alt text | 8 | Whether the alt text is accurate |
| No broken links | 8 | Sites that block bots show as unreachable, not broken |
| One h1, no skipped levels | 6 | Whether the headings are any good |
| Responsive viewport declared | 6 | — |
| Page title and meta description | 6 | Actual SEO quality |
| Document language declared | 4 | — |
| Page weight under 600KB | 4 | A floor from `Content-Length` headers, not a total |
| DOMContentLoaded under 2000ms | 4 | One cold unthrottled load; not Core Web Vitals |
| *Copy makes the offer clear* | — | **Not automated.** A person has to read it |
| *Business facts are accurate* | — | **Not automated.** Only the owner can confirm |

---

## Memory, and the claim that it works

Before drafting, the agent reads `memory/profile.md` and the rules in
`memory/learnings.md`. When you approve, edit or reject a draft, the decision —
and a rule derived from what you actually changed — is appended to
`learnings.md`.

The **Redraft** button re-runs only the drafting step. The audit, the rebuild
and the scores are untouched, so memory is the only variable between versions,
and the Approve screen renders v1 and v2 side by side.

Run `node scripts/try-memory.js` to verify this rather than take it on trust: it
prints draft v1, records a correction, redrafts, and **exits non-zero if the
draft did not change.** On a verified run, v1 opened "Hi Harbor & Vine
Plumbing,"; after the correction, v2 led with the measured defect and dropped
the score mention entirely.

---

## Skills

The assistant is the shell; skills are plug-in folders. `agent/core.js` reads
`skills/*/skill.json` off disk and contains **no list of skill names**.

- `skills/proofrun/` — the flagship skill. Manifest, prompt, prompt builders,
  runner, demo fixture.
- `skills/missed-call-offer/` — a deliberate stub. It has a manifest and a
  prompt but no runner, so the core lists it and refuses to invoke it. It is not
  built because placing test calls to real businesses is a consent and recording
  question before it is an engineering one — see its `prompt.md`.

---

## Configuration

Every value lives in `.env` (see [`.env.example`](.env.example)) or `config/`.

| Variable | Default | Notes |
|---|---|---|
| `NEBIUS_API_KEY` | — | **Required.** Token Factory key |
| `NEBIUS_BASE_URL` | `https://api.tokenfactory.nebius.com/v1` | Global endpoint |
| `NEBIUS_REGIONAL_BASE_URL_TEMPLATE` | `…{region}.nebius.com/v1` | Regional fallback template |
| `NEMOTRON_REASONING_MODEL` / `_REGION` | Ultra 550B / `us-central1` | Audit and planning |
| `NEMOTRON_BUILDER_MODEL` / `_REGION` | Super 120B / `us-central1` | Build and repair |
| `NEMOTRON_FAST_MODEL` / `_REGION` | Nano 30B / `eu-north1` | The other five roles |
| `TAVILY_API_KEY` | — | Live discovery only; demo mode works without it |
| `PROOFRUN_MODE` | `demo` | `demo` or `live` |
| `PROOFRUN_MAX_RETRIES` | `3` | Repair attempts before failing open |
| `PROOFRUN_NIGHTLY_BATCH` | `4` | Prospects per nightly run |
| `PROOFRUN_RATE_LIMIT` | `on` | `off` removes every limit below. Use it locally |
| `PROOFRUN_MAX_CONCURRENT_RUNS` | `2` | Runs in flight at once, per instance |
| `PROOFRUN_RUNS_PER_CLIENT` | `3` | Runs per client IP per window |
| `PROOFRUN_RUNS_PER_CLIENT_WINDOW_MIN` | `10` | That window, in minutes |
| `PROOFRUN_RUNS_GLOBAL` | `20` | Runs per instance per window, all clients |
| `PROOFRUN_RUNS_GLOBAL_WINDOW_MIN` | `60` | That window, in minutes |
| `PROOFRUN_CHEAP_PER_CLIENT` / `_WINDOW_MIN` | `20` / `10` | Redraft and brief rebuild |
| `TRUST_PROXY_HOPS` | `1` | Proxies in front. `0` when there are none |
| `SANDBOX_MODE` | `subprocess` | `subprocess` or `openshell` |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | Used in mockup preview links |

**Before any real use**, replace `config/voice.md` with three or four paragraphs
of your own writing — it is what the drafts imitate — and update
`memory/profile.md`, which ships with demo data.

---

## Deployment

```bash
docker build -t proofrun .
docker run -p 3000:3000 --env-file .env proofrun
```

The image installs Chromium only — not Playwright's full browser set — which
keeps it at 1.33GB rather than 3.72GB. That matters on a scale-to-zero host,
where image size is cold-start time.

**Memory:** the whole loop, including the sandboxed verification browser, was
measured peaking at **327MB** on a 512MB-capped container. 1GiB is comfortable.

### Google Cloud Run (what the hosted demo runs on)

```bash
gcloud run deploy proofrun \
  --source=. --region=us-central1 --port=3000 \
  --memory=1Gi --cpu=1 --timeout=3600 --no-cpu-throttling \
  --max-instances=3 --concurrency=10 --allow-unauthenticated \
  --set-env-vars="PROOFRUN_MODE=demo,NEBIUS_BASE_URL=...,NEMOTRON_REASONING_MODEL=..."
```

Three flags are load-bearing:

- `--no-cpu-throttling` — Cloud Run only allocates CPU while a request is in
  flight by default. A ProofRun run continues in the background while the Live
  Run screen holds an SSE connection, so if a viewer closes the tab mid-run the
  work would stall. This keeps it running.
- `--timeout=3600` — the SSE stream is a long-lived request. The default 300s
  would cut the Live Run feed off mid-run.
- `--max-instances=3` — the endpoint is unauthenticated, so together with the
  in-process limits below this bounds what anyone pressing "Run now" can cost
  you. It is the only one of the two that is a hard ceiling.

**Cloud Run's filesystem is ephemeral**, so `memory/` resets on a cold start.
That is fine for a public demo where every visitor starts their own run, and
wrong for real use — mount a GCS volume or use a host with a persistent disk.

#### Rate limits on a public URL

A run is not a cheap request: two Chromium launches, a ~327MB peak, and 30-65k
Nebius tokens. [`web/rate-limit.js`](web/rate-limit.js) gates the routes that
spend money, in order of how hard each gate is to evade:

| Gate | Default | What it protects |
|---|---|---|
| Concurrent runs | 2 | Memory and CPU. Counted from the runner's own state, so a run that throws cannot leak a slot |
| Per client IP | 3 per 10 min | Stops one visitor clicking Start repeatedly |
| Global | 20 per 60 min | The actual spend ceiling, and the only gate that holds when IPs rotate |
| Redraft, brief rebuild | 20 per 10 min | One model call each, so a looser budget of their own |

Denials return `429` with a `Retry-After` header and a plain-English reason,
which the UI shows as-is. `/api/meta` reports the limits and current usage so a
visitor can see them before hitting one. The approval route is deliberately
**not** limited: it makes no model calls, and it is the one interaction a judge
must be able to repeat freely.

Being honest about the weakness: this state is in process memory. Every cold
start resets the windows, and each instance keeps its own, so "20 per hour" is
really per instance — which is why `--max-instances` is what makes the total
bounded. A shared counter would need Redis, and this project deliberately has
no database. Set `PROOFRUN_RATE_LIMIT=off` locally, where the `try-*` scripts
legitimately start runs back to back.

### Render

`render.yaml` is included for a one-click Blueprint deploy, and declares a 1GB
persistent disk at `/app/memory` so learnings survive redeploys. Any host that
runs a Docker container with ~1GB of memory will do; headless Chromium is the
only unusual requirement.

For the nightly batch as a Nebius Serverless Job, see
[`jobs/nebius-serverless-job.json`](jobs/nebius-serverless-job.json).

---

## Honest limitations

- **Two viewports, one cold load, unthrottled, on the runner machine.** Not
  field data and not Core Web Vitals.
- **Page weight is a floor**, summed from `Content-Length` headers; chunked
  responses without that header are not counted.
- **Contrast is measured against the nearest opaque ancestor background.** Text
  over images or gradients is reported as unmeasurable.
- **The rebuild is a single self-contained page with no images.** It is a
  concept mockup to start a conversation, not a deliverable site, and `alt_text`
  and `page_weight` are usually *excluded* from the comparable delta because the
  generated page has no images to measure.
- **Link probing is capped at 12 links** with an 8-second timeout; sites that
  block bots report as unreachable rather than broken.
- **The drafting model over-reasons.** A 107-word email took ~40 seconds because
  of ~16,000 characters of reasoning in front of it.
- **No deduplication across cities**, no CRM, no reply tracking.

---

## Further reading

- **[DECISIONS.md](DECISIONS.md)** — every judgment call made while building
- **[FEEDBACK.md](FEEDBACK.md)** — friction, wins and bugs with Nebius and NVIDIA tools
- **[SUBMISSION.md](SUBMISSION.md)** — hackathon submission write-up

## License

[MIT](LICENSE).
