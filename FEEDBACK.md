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
`api.tokenfactory.us-central1.nebius.com/v1/`. Nothing we found states whether
the global host routes to every region. We ended up implementing
regional-then-global fallback with endpoint caching to be safe. One sentence in
the quickstart — "the global endpoint routes to all regions" or "use the
regional host for region-pinned models" — would remove that code entirely.

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

## NVIDIA Nemotron

Notes on quality and behaviour land here once the models have been exercised.
Routing intent (from `config/routing.json`): Ultra 550B for audit judgment and
redesign planning, Super 120B-A12B for HTML generation and repair, Nano 30B-A3B
for screening, extraction, summarization and drafting.

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
