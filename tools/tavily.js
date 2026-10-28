// Tavily search and extract.
//
// Used only in live mode. Demo mode never touches it, so the demo is repeatable
// and costs nothing.
import { env } from './config.js';

function requireKey() {
  if (!env.tavilyKey) {
    const e = new Error('TAVILY_API_KEY is not set. Live discovery needs it; demo mode does not.');
    e.code = 'NO_TAVILY_KEY';
    throw e;
  }
}

async function post(endpoint, body, { timeoutMs = 60_000 } = {}) {
  requireKey();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.tavilyBaseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.tavilyKey}`,
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`Tavily ${endpoint} -> ${res.status}: ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}

/**
 * Search for businesses in a niche and city.
 * Returns raw hits; filtering to auditable sites is the agent's job.
 */
export async function search(query, { maxResults = 12, depth = 'basic', excludeDomains = [] } = {}) {
  const json = await post('/search', {
    query,
    max_results: maxResults,
    search_depth: depth,
    include_answer: false,
    include_raw_content: false,
    exclude_domains: [
      'yelp.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'x.com', 'twitter.com',
      'angi.com', 'homeadvisor.com', 'thumbtack.com', 'bbb.org', 'mapquest.com',
      'yellowpages.com', 'nextdoor.com', 'tripadvisor.com', 'indeed.com', 'reddit.com',
      ...excludeDomains,
    ],
  });
  return (json.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: (r.content || '').slice(0, 600),
    score: r.score,
  }));
}

/** Pull readable content from specific URLs (business context, contact page). */
export async function extract(urls, { depth = 'basic' } = {}) {
  const list = Array.isArray(urls) ? urls : [urls];
  const json = await post('/extract', { urls: list, extract_depth: depth });
  const ok = (json.results || []).map((r) => ({
    url: r.url,
    content: (r.raw_content || '').slice(0, 20_000),
  }));
  const failed = (json.failed_results || []).map((r) => ({ url: r.url, error: r.error }));
  return { results: ok, failed };
}

export function available() {
  return Boolean(env.tavilyKey);
}
