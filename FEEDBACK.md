# Feedback on Nebius and NVIDIA tools

Running notes kept while building, not written up afterwards. Friction, wins and
bugs as they happened.

## Nebius Token Factory

**Win — the catalog has a machine-readable source.**
`https://tokenfactory.nebius.com/api/public/models_info` returns the full
catalog as JSON, with per-model region, context window, quantization, tokens/sec
and pricing. That is better than most inference providers offer, and it meant no
model ID in this project was ever guessed. The docs site should link to it
prominently; we found it in a footnote on the catalog page.

**Friction — model IDs are inconsistently cased.** In the same catalog:

- `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` (vendor prefix repeated, title case)
- `nvidia/nemotron-3-super-120b-a12b` (all lower case)
- `nvidia/Nemotron-3-Ultra-550b-a55b` (mixed)
- `nvidia/Nemotron-3_5-Lightning` (underscore where the others use a dot)
- `nvidia/Nemotron-3.5-Super-VL` (dot where Lightning uses an underscore)

Third-party docs and the Nebius cookbook use yet another form
(`nvidia/nvidia-nemotron-3-nano-30b-a3b`). If IDs are case-sensitive this is a
guaranteed source of 404s; if they are not, the inconsistency is still a tax on
every integrator. Either normalize the IDs or document case-insensitivity.

**Friction — region pinning is real but under-documented.** Each Nemotron model
is available in exactly one region (Ultra and Super in us-central1, Nano and
Lightning in eu-north1, Super VL in us-north1). The quickstart shows the global
host `api.tokenfactory.nebius.com/v1/`, while the Nemotron product page shows
`api.tokenfactory.us-central1.nebius.com/v1/`. Nothing in the docs states
whether the global host routes to every region, so we implemented
regional-then-global fallback with endpoint caching to be safe.

**Resolved by testing, and worth documenting:** once we had a key, `GET /models`
showed the global endpoint listing **all 5** Nemotron models, and the eu-north1
endpoint also listing all 5, while us-central1 listed only 4 (no Super VL). So
the global endpoint does appear to route across regions, and the regional hosts
are not strictly necessary. One sentence in the quickstart would have saved a
fallback path, an endpoint cache and an afternoon. We kept the fallback because
it costs at most one 404 per model per process and it is the difference between
a demo that works on someone else's account and one that does not.

**Friction — the catalog and the API disagree about which models exist where.**
The public catalog JSON pins `nvidia/Nemotron-3.5-Super-VL` to `us-north1`, but
`GET /models` against `us-north1` is not where we found it — it showed up on the
global and eu-north1 endpoints instead. If the catalog's `regions` field is
advisory rather than authoritative, that should be stated, because it is the
field an integrator will build their routing on.

**Friction — `/models` is referenced but not shown.** The API reference page
documents `POST /v1/chat/completions` and links to a "list models" page, but
gives no request example. We implemented `GET /v1/models` with a bearer token on
the OpenAI-compatible assumption.

**Gap — structured output support is asserted, not specified.** Model pages say
Nemotron "supports function calling and structured output", but the API
reference does not document `response_format`, and nothing states whether
`json_schema` with `strict: true` is honoured or silently downgraded to
free-form JSON. For an agent that validates every model output against a schema,
that is the single most important thing to document. We shipped a tolerant
parser as insurance.

**Nit — deprecation timing is tight.** `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`
is already flagged for removal on 2026-11-09, about two weeks after this
hackathon, with `nvidia/Nemotron-3_5-Lightning` as the replacement. A model
being deprecated inside the submission window is awkward; ProofRun routes by
role through env vars, so swapping it is a one-line `.env` change, but a
hackathon entrant following a tutorial would be broken by it.

**The big one — `max_tokens` covers reasoning AND content, and the failure is
silent.** Nemotron 3 models are reasoning models, and on Token Factory the
`max_tokens` budget is shared between the reasoning trace and the visible
message content. Exceed it during reasoning and the API returns **HTTP 200**
with `finish_reason: "length"` and `content: ""` — a successful response
containing nothing. Measured on real calls: one extraction spent 7,985
characters of reasoning and returned empty at a 2,000-token budget; a later one
spent **40,085 characters** before producing a word; an email draft spent 31,243.

This cost more debugging time than everything else in the project combined,
because every obvious hypothesis (bad schema, bad key, wrong model ID) was
wrong. Three things would fix it:

1. State it in the API reference, in the `max_tokens` description.
2. Return `reasoning_tokens` in the `usage` object, the way `completion_tokens`
   is already broken out. `completion_tokens_details` comes back `null`.
3. Expose a reasoning-effort parameter. Nano spending 40,000 characters of
   thinking on a 107-word email is the wrong trade, and there is currently no
   way to say so.

We now detect empty-content-at-length, escalate the budget threefold, retry, and
record the escalation in the run trace.

**Confirmed working — `response_format` with `json_schema` and `strict: true`.**
Undocumented in the API reference but it does work, including nested objects,
enums, arrays with `minItems`/`maxItems` and `additionalProperties: false`. We
verified it explicitly against Nano before relying on it. Please document it:
for any agent that validates model output, whether `strict` is honoured or
silently downgraded is the single most important fact about the API.

## NVIDIA Nemotron

Routing (from `config/routing.json`): Ultra 550B for audit judgment and redesign
planning, Super 120B-A12B for HTML generation and repair, Nano 30B-A3B for
screening, extraction, summarization and drafting.

**Win — Super's narrow-repair behaviour.** The standout result of the project.
Handed a generated page plus one failing check with its exact measurement, Super
fixed that check and left the rest of the page alone, repeatedly. Many models
rewrite the whole document and break three things to fix one. That single
property is what makes a bounded retry loop viable at all — without it, every
repair attempt would need a full re-audit.

**Win — Ultra's audit reasoning.** Given a check log and a DOM snapshot it
produced specific, correctly prioritized, business-framed findings, and the
`confidence_reason` field ("what would raise my confidence") was consistently
thoughtful rather than boilerplate. It also caught a real defect we had not
asked about — future-dated review timestamps on a live site — which leads to the
next item.

**Friction — date reasoning defaults to the training cutoff.** Ultra flagged a
real business's October 2026 reviews as "future-dated... either fake reviews or
a broken site", because it believed the current year was 2025. Entirely fixable
by injecting the date into the prompt, which we now do everywhere recency is
judged, but worth a line in the model card: these models will confidently
misjudge recency unless told the date.

**Friction — negative constraints in long prompts are unreliable.** "Do not put
a Subject: line in the body", "do not use internal finding ids", "fill every
placeholder" were each violated on live runs despite being explicit. Converting
them from prose instructions into schema refinements that hand the model its own
validation error fixed every one on the first repair. The lesson generalizes:
with these models, validate structurally rather than asking nicely.

**Friction — Nano over-reasons on generative tasks.** The same model that
extracts structured facts in 11 seconds takes 40 to 63 seconds to write a
107-word email, almost all of it reasoning. For a product where a human is
watching a progress feed, that is the difference between responsive and
sluggish, and there is no knob to turn.

## NVIDIA OpenShell

Evaluated from the docs (`docs.nvidia.com/openshell`) before committing to it.
It is a sandbox runtime with a gateway control plane, per-sandbox YAML policy,
and kernel-level isolation, aimed at constraining coding agents such as Claude
Code or OpenCode. The fit question for ProofRun is narrow: the only untrusted
code we execute is a single self-contained HTML document with no JavaScript and
no network access, loaded in a headless Chromium that we already launch with a
restrictive flag set. See `DECISIONS.md` for which sandbox shipped and why.

## NemoClaw / Hermes Agent

Evaluated as optional. Notes on fit to follow.
