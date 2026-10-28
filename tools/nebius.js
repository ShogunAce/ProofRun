// Nebius Token Factory client.
//
// Token Factory is OpenAI-compatible (verified: docs.tokenfactory.nebius.com),
// so this wraps the official OpenAI SDK with three things ProofRun needs:
//
//   1. Role-based routing. Callers ask for a role ("audit", "build"); the model
//      ID comes from config/routing.json -> env. No model ID appears in code.
//   2. Regional fallback. Nemotron models are pinned to regions (Ultra and
//      Super in us-central1, Nano and Lightning in eu-north1, Super VL in
//      us-north1). If the global endpoint rejects a model, we retry against
//      that model's regional endpoint and remember which one worked.
//   3. Honest traces. Every call records role, model, endpoint, latency, token
//      usage and whether a fallback model was substituted. The Proof screen
//      reads these, so it can never credit a number to a model that did not
//      produce it.
import OpenAI from 'openai';
import { env, routing } from './config.js';

const clients = new Map();

function clientFor(baseURL) {
  if (!clients.has(baseURL)) {
    clients.set(
      baseURL,
      new OpenAI({
        apiKey: env.nebiusKey,
        baseURL,
        timeout: 180_000,
        maxRetries: 0, // we do our own, so the trace stays truthful
      }),
    );
  }
  return clients.get(baseURL);
}

export function regionalUrl(region) {
  if (!region) return null;
  return env.regionalTemplate.replace('{region}', region).replace(/\/+$/, '');
}

export function resolveRole(role) {
  const spec = routing.roles?.[role];
  if (!spec) throw new Error(`Unknown model role "${role}". Add it to config/routing.json.`);
  const model = process.env[spec.model_env];
  if (!model) {
    throw new Error(
      `Role "${role}" maps to env var ${spec.model_env}, which is not set. See .env.example.`,
    );
  }
  return {
    role,
    model,
    region: process.env[spec.region_env] || null,
    temperature: spec.temperature ?? 0.3,
    maxTokens: spec.max_tokens ?? 2000,
    why: spec.why || '',
    modelEnv: spec.model_env,
  };
}

/** The routing table as the README and the UI show it. */
export function routingTable() {
  return Object.keys(routing.roles || {}).map((role) => {
    const spec = routing.roles[role];
    return {
      role,
      model: process.env[spec.model_env] || `(unset: ${spec.model_env})`,
      model_env: spec.model_env,
      region: process.env[spec.region_env] || null,
      temperature: spec.temperature,
      max_tokens: spec.max_tokens,
      why: spec.why,
    };
  });
}

// Endpoints that have already worked for a given model, so we stop paying the
// 404 tax on every later call in a run.
const goodEndpoint = new Map();

function endpointsFor(resolved) {
  const cached = goodEndpoint.get(resolved.model);
  if (cached) return [cached];
  const regional = regionalUrl(resolved.region);
  // Regional first when we know the region: it is the endpoint the Nebius
  // Nemotron docs themselves use, and the global host does not serve every
  // region's catalog.
  return regional ? [regional, env.nebiusBaseUrl] : [env.nebiusBaseUrl];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRetryable(err) {
  const s = err?.status;
  return s === 408 || s === 409 || s === 429 || (s >= 500 && s < 600) || !s;
}

function isWrongEndpoint(err) {
  return err?.status === 404 || err?.status === 403;
}

// Nemotron 3 models are reasoning models, and on Token Factory the `max_tokens`
// budget is shared between the reasoning trace and the visible content. A long
// prompt can produce 8-10K characters of reasoning, exhaust the budget, and
// return finish_reason "length" with content: "" — a success response with
// nothing in it. So a truncated-empty reply is retried with a larger budget
// rather than reported as a model failure. See FEEDBACK.md.
const MAX_TOKEN_CEILING = 32_000;
const ESCALATION_FACTOR = 3;

/**
 * One chat completion.
 *
 * @param {object} o
 * @param {string} o.role        routing role, e.g. "audit"
 * @param {string} o.system      system prompt
 * @param {string|Array} o.user  user content (string, or OpenAI content parts)
 * @param {object} [o.jsonSchema] JSON schema -> asks for structured output
 * @param {string} [o.schemaName]
 * @param {number} [o.attempts]  network attempts per endpoint (default 3)
 * @param {(t:object)=>void} [o.onTrace] called with the trace record
 * @param {boolean} [o.allowFallbackModel] walk routing.fallback_chain on failure
 */
export async function complete({
  role,
  system,
  user,
  jsonSchema = null,
  schemaName = 'result',
  attempts = 3,
  onTrace = null,
  allowFallbackModel = true,
  temperature,
  maxTokens,
}) {
  if (!env.nebiusKey) {
    const e = new Error(
      'NEBIUS_API_KEY is not set. Copy .env.example to .env and add your Token Factory key.',
    );
    e.code = 'NO_API_KEY';
    throw e;
  }

  const primary = resolveRole(role);
  const candidates = [primary];
  if (allowFallbackModel) {
    for (const envName of routing.fallback_chain || []) {
      const model = process.env[envName];
      if (!model || candidates.some((c) => c.model === model)) continue;
      // Reuse the primary's knobs; only the model changes.
      const regionEnv = Object.values(routing.roles).find((r) => r.model_env === envName)?.region_env;
      candidates.push({
        ...primary,
        model,
        modelEnv: envName,
        region: regionEnv ? process.env[regionEnv] || null : null,
        substituted: true,
      });
    }
  }

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];

  const body = {
    temperature: temperature ?? primary.temperature,
    max_tokens: maxTokens ?? primary.maxTokens,
  };
  if (jsonSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: schemaName, strict: true, schema: jsonSchema },
    };
  }

  let lastErr;
  for (const cand of candidates) {
    for (const baseURL of endpointsFor(cand)) {
      let budget = body.max_tokens;
      let escalations = 0;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const started = Date.now();
        try {
          const res = await clientFor(baseURL).chat.completions.create({
            model: cand.model,
            messages,
            ...body,
            max_tokens: budget,
          });
          goodEndpoint.set(cand.model, baseURL);
          const choice = res.choices?.[0];
          const text = choice?.message?.content ?? '';
          const reasoning = choice?.message?.reasoning || choice?.message?.reasoning_content || '';
          const trace = {
            role,
            model: cand.model,
            model_env: cand.modelEnv,
            endpoint: baseURL,
            region: cand.region,
            substituted_for: cand.substituted ? primary.model : null,
            ms: Date.now() - started,
            usage: res.usage || null,
            structured: Boolean(jsonSchema),
            finish_reason: choice?.finish_reason,
            max_tokens: budget,
            reasoning_chars: reasoning.length,
            escalated_from: budget === body.max_tokens ? null : body.max_tokens,
            attempt,
            at: new Date().toISOString(),
          };

          // Reasoning ate the budget. Give it more room and try again.
          if (!text.trim() && choice?.finish_reason === 'length' && budget < MAX_TOKEN_CEILING && escalations < 2) {
            const next = Math.min(MAX_TOKEN_CEILING, Math.round(budget * ESCALATION_FACTOR));
            onTrace?.({
              ...trace,
              truncated: true,
              note: `Empty content at finish_reason=length after ${reasoning.length} chars of reasoning. Raising max_tokens ${budget} -> ${next}.`,
            });
            budget = next;
            escalations += 1;
            attempt -= 1; // an escalation is not a failed network attempt
            continue;
          }

          onTrace?.(trace);
          return { text, reasoning, finishReason: choice?.finish_reason, trace };
        } catch (err) {
          lastErr = err;
          const detail = {
            role,
            model: cand.model,
            endpoint: baseURL,
            status: err?.status ?? null,
            error: err?.message || String(err),
            ms: Date.now() - started,
            attempt,
            at: new Date().toISOString(),
            failed: true,
          };
          onTrace?.(detail);
          if (err?.status === 401) throw err; // bad key: no point retrying
          if (isWrongEndpoint(err)) break; // try the next endpoint
          if (!isRetryable(err) || attempt === attempts) break;
          await sleep(Math.min(8000, 600 * 2 ** (attempt - 1)));
        }
      }
    }
  }
  throw lastErr || new Error('No Token Factory endpoint accepted the request.');
}

/** Pull the first JSON object/array out of a model response. */
export function parseJsonLoose(text) {
  if (!text) throw new Error('Empty model response.');
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through to brace matching */
  }
  const start = cleaned.search(/[[{]/);
  if (start === -1) throw new Error(`No JSON found in model response: ${cleaned.slice(0, 200)}`);
  const open = cleaned[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1));
    }
  }
  throw new Error('Unbalanced JSON in model response.');
}

/**
 * Structured call: ask for JSON, validate with a zod schema, and on a validation
 * failure hand the model its own error once before giving up.
 */
export async function completeStructured({ schema, jsonSchema, repairAttempts = 1, ...rest }) {
  let lastProblem = null;
  for (let i = 0; i <= repairAttempts; i += 1) {
    const user =
      lastProblem === null
        ? rest.user
        : `${rest.user}\n\n---\nYour previous reply did not validate. Error:\n${lastProblem}\nReturn corrected JSON only.`;
    const res = await complete({ ...rest, user, jsonSchema });
    try {
      const raw = parseJsonLoose(res.text);
      const parsed = schema ? schema.parse(raw) : raw;
      return { data: parsed, trace: res.trace, raw };
    } catch (err) {
      lastProblem = (err?.message || String(err)).slice(0, 1500);
      if (i === repairAttempts) {
        const e = new Error(`Model returned invalid structured output: ${lastProblem}`);
        e.code = 'BAD_STRUCTURED_OUTPUT';
        e.trace = res.trace;
        throw e;
      }
    }
  }
  throw new Error('unreachable');
}

/** Lists models the key can actually see at an endpoint. */
export async function listModels(baseURL = env.nebiusBaseUrl) {
  const res = await fetch(`${baseURL}/models`, {
    headers: { Authorization: `Bearer ${env.nebiusKey}` },
  });
  if (!res.ok) throw new Error(`GET ${baseURL}/models -> ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.data || [];
}
