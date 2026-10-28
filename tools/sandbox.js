// Sandbox for running model-generated code.
//
// What actually gets executed: one self-contained HTML document, loaded in a
// headless Chromium that ProofRun launches. The threat is a generated page that
// phones home, pulls a remote script, or reads something local.
//
// Defence in depth, in order of how much it buys us:
//
//   1. Static gate (`inspect`). The document is parsed before it is written to
//      disk. Any external reference, any <script>, any inline event handler is
//      a hard reject — the page is sent back to the repair loop as a failed
//      check, exactly like a contrast failure. A page that cannot reach the
//      network cannot do much.
//   2. Network deny-all at load. The verification context aborts every request
//      whose URL is not the local file being tested. So even a reference the
//      static gate missed never leaves the machine, and it shows up in the
//      trace as a blocked request.
//   3. Process isolation (`SANDBOX_MODE`). `subprocess` runs the check pass in
//      a child Node process with a clean environment and a wall-clock kill, so
//      a hung or memory-hungry page cannot take the server with it.
//      `openshell` is wired as an adapter; see DECISIONS.md for why it is not
//      the default.
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, paths } from './config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// --------------------------------------------------------------------------
// 1. Static gate
// --------------------------------------------------------------------------

const VIOLATIONS = [
  { id: 'script_tag', re: /<script\b/i, why: 'A <script> tag. Generated pages must be static; nothing here needs JavaScript.' },
  { id: 'external_src', re: /\b(?:src|href)\s*=\s*["']?(?:https?:)?\/\//i, why: 'A reference to an external URL. The page must be fully self-contained.' },
  { id: 'inline_handler', re: /\son(?:click|load|error|mouseover|focus|submit|input|change)\s*=/i, why: 'An inline event handler attribute.' },
  { id: 'css_import', re: /@import\b/i, why: 'A CSS @import, which fetches a remote stylesheet.' },
  { id: 'css_url_remote', re: /url\(\s*["']?(?:https?:)?\/\//i, why: 'A CSS url() pointing at a remote resource.' },
  { id: 'iframe', re: /<(?:iframe|object|embed|frame)\b/i, why: 'An embedded frame, which can load remote content.' },
  { id: 'form_action_remote', re: /<form[^>]*\baction\s*=\s*["']?(?:https?:)?\/\//i, why: 'A form posting to a remote endpoint.' },
  { id: 'meta_refresh', re: /<meta[^>]*http-equiv\s*=\s*["']?refresh/i, why: 'A meta refresh redirect.' },
  { id: 'data_script', re: /data:\s*(?:text\/javascript|application\/javascript)/i, why: 'A javascript data: URI.' },
];

const REQUIRED = [
  { id: 'doctype', re: /<!doctype\s+html/i, why: 'Missing <!doctype html>.' },
  { id: 'mockup_banner', re: /class\s*=\s*["'][^"']*pr-mockup-banner/i, why: 'Missing the required "Concept mockup" banner element.' },
];

/**
 * Reject a generated document before it is written or loaded.
 * @returns {{ok: boolean, violations: Array, missing: Array}}
 */
export function inspect(html) {
  const text = String(html || '');
  const violations = VIOLATIONS.filter((v) => v.re.test(text)).map(({ id, why }) => ({
    id,
    why,
    excerpt: (text.match(VIOLATIONS.find((x) => x.id === id).re)?.[0] || '').slice(0, 120),
  }));
  const missing = REQUIRED.filter((r) => !r.re.test(text)).map(({ id, why }) => ({ id, why }));
  return { ok: violations.length === 0 && missing.length === 0, violations, missing };
}

/** The static gate rendered as a check, so a reject flows through the retry loop. */
export function gateAsCheck(report) {
  const problems = [
    ...report.violations.map((v) => `${v.id}: ${v.why}${v.excerpt ? ` (found: ${v.excerpt})` : ''}`),
    ...report.missing.map((m) => `${m.id}: ${m.why}`),
  ];
  return {
    id: 'sandbox_gate',
    title: 'Page is self-contained and labelled',
    status: report.ok ? 'pass' : 'fail',
    weight: 0, // a gate, not a score component
    scope: 'static analysis',
    limit: 'Pattern matching over the document source. Catches external references, scripts and inline handlers; it is not a full HTML parser.',
    automated: true,
    evidence: report.ok
      ? 'No scripts, no external references, no inline handlers, mockup banner present.'
      : problems.join(' | '),
    gate: true,
  };
}

// --------------------------------------------------------------------------
// Writing a candidate page
// --------------------------------------------------------------------------

export async function writeCandidate({ runId, prospectId, attempt, html }) {
  const report = inspect(html);
  const dir = path.join(paths.dataRuns, runId);
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `candidate-${attempt}.html`);
  await fsp.writeFile(file, html, 'utf8');
  return { file, report, url: `file://${file.replace(/\\/g, '/')}` };
}

// --------------------------------------------------------------------------
// 3. Process isolation
// --------------------------------------------------------------------------

/**
 * Run the check suite over a local HTML file.
 *
 * In `subprocess` mode this happens in a child Node process with a scrubbed
 * environment (no API keys reach it) and a hard timeout. The child prints one
 * JSON line on stdout.
 */
export async function verifyFile({ file, label, outDir, timeoutMs = 120_000, onLog = null }) {
  if (env.sandboxMode === 'openshell') {
    return verifyViaOpenShell({ file, label, outDir, timeoutMs, onLog });
  }
  return verifyViaSubprocess({ file, label, outDir, timeoutMs, onLog });
}

function verifyViaSubprocess({ file, label, outDir, timeoutMs, onLog }) {
  const worker = path.join(HERE, 'verify-worker.js');
  onLog?.({ level: 'step', message: `Loading the generated page in a sandboxed child process (network deny-all)` });

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker], {
      stdio: ['pipe', 'pipe', 'pipe'],
      // Clean environment: the sandboxed pass gets no credentials at all.
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        HOME: process.env.HOME,
        USERPROFILE: process.env.USERPROFILE,
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
        NODE_OPTIONS: '--max-old-space-size=512',
      },
    });

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Sandboxed verification exceeded ${timeoutMs}ms and was killed.`));
    }, timeoutMs);

    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => {
      const s = String(d);
      err += s;
      for (const line of s.split('\n')) {
        if (line.startsWith('LOG ')) {
          try { onLog?.(JSON.parse(line.slice(4))); } catch { /* ignore */ }
        }
      }
    });

    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Sandboxed verification exited ${code}: ${err.split('\n').filter((l) => !l.startsWith('LOG ')).join(' ').slice(0, 400)}`));
        return;
      }
      try {
        resolve(JSON.parse(out.trim().split('\n').pop()));
      } catch (e) {
        reject(new Error(`Sandbox returned unparseable output: ${out.slice(0, 300)}`));
      }
    });

    child.stdin.end(JSON.stringify({ file, label, outDir }));
  });
}

/**
 * OpenShell adapter. Kept as a seam so the sandbox can be swapped without
 * touching the loop. Not the default; see DECISIONS.md.
 */
async function verifyViaOpenShell({ file, label, outDir, onLog }) {
  if (!env.openshellGateway) {
    throw new Error('SANDBOX_MODE=openshell but OPENSHELL_GATEWAY_URL is not set.');
  }
  onLog?.({ level: 'step', message: `Dispatching verification to the OpenShell gateway at ${env.openshellGateway}` });
  throw new Error(
    'The OpenShell adapter is a documented seam, not a shipped path. Set SANDBOX_MODE=subprocess. See DECISIONS.md for the evaluation.',
  );
}

export function sandboxDescription() {
  return env.sandboxMode === 'openshell'
    ? { mode: 'openshell', gateway: env.openshellGateway, layers: ['static gate', 'network deny-all', 'OpenShell policy sandbox'] }
    : {
        mode: 'subprocess',
        layers: [
          'static gate: no scripts, no external references, no inline handlers',
          'network deny-all: every request except the local file under test is aborted',
          'child process: scrubbed environment, 512MB heap cap, wall-clock kill',
        ],
      };
}
