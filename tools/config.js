// Loads .env and the files in config/. Everything tunable lives in config/ or
// the environment; nothing in this file hardcodes a model, a key, or a niche.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const p = (...parts) => path.join(ROOT, ...parts);

function readText(rel, fallback = '') {
  try {
    return fs.readFileSync(p(rel), 'utf8');
  } catch {
    return fallback;
  }
}

function readJson(rel, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(p(rel), 'utf8'));
  } catch {
    return fallback;
  }
}

export const paths = {
  root: ROOT,
  p,
  memory: p('memory'),
  prospects: p('memory', 'prospects'),
  runs: p('memory', 'runs'),
  learnings: p('memory', 'learnings.md'),
  profile: p('memory', 'profile.md'),
  dataRuns: p('data', 'runs'),
  mockups: p('data', 'mockups'),
  skills: p('skills'),
};

export const env = {
  nebiusKey: process.env.NEBIUS_API_KEY || '',
  nebiusBaseUrl: (process.env.NEBIUS_BASE_URL || 'https://api.tokenfactory.nebius.com/v1').replace(/\/+$/, ''),
  regionalTemplate:
    process.env.NEBIUS_REGIONAL_BASE_URL_TEMPLATE ||
    'https://api.tokenfactory.{region}.nebius.com/v1',
  tavilyKey: process.env.TAVILY_API_KEY || '',
  tavilyBaseUrl: (process.env.TAVILY_BASE_URL || 'https://api.tavily.com').replace(/\/+$/, ''),
  sandboxMode: process.env.SANDBOX_MODE || 'subprocess',
  openshellGateway: process.env.OPENSHELL_GATEWAY_URL || '',
  port: Number(process.env.PORT || 3000),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, ''),
  mode: process.env.PROOFRUN_MODE || 'demo',
  maxRetries: Number(process.env.PROOFRUN_MAX_RETRIES || 3),
  nightlyBatch: Number(process.env.PROOFRUN_NIGHTLY_BATCH || 4),
};

export const routing = readJson('config/routing.json', { roles: {} });
export const niches = readJson('config/niches.json', { niches: [] });

// Operator-authored context the agent reads before it writes anything.
export const operator = {
  get offer() {
    return readText('config/offer.md');
  },
  get voice() {
    return readText('config/voice.md');
  },
  get template() {
    return readText('config/outreach_template.md');
  },
};

export { readText, readJson };
