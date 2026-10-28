// Playwright capture and verification.
//
// `capture()` is used twice per prospect with the same settings:
//   - against the live site, producing the "before" evidence and baseline score
//   - against the generated page (served from disk), producing the "after"
//
// Nothing here is site-specific. If it cannot load a page, it says so and the
// caller treats the run as failed; it never returns a partial pass.
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { VIEWPORTS, domProbe, buildChecks, probeLinks, scoreChecks } from './checks.js';

let browserPromise = null;

export async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    browserPromise = null;
    await b.close().catch(() => {});
  }
}

const KB = (bytes) => Math.round((bytes / 1024) * 10) / 10;

async function onePass({ browser, url, viewport, screenshotPath, fullPage, timeoutMs, onLog }) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
    isMobile: Boolean(viewport.isMobile),
    hasTouch: Boolean(viewport.hasTouch),
    userAgent: viewport.isMobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : undefined,
    ignoreHTTPSErrors: true,
  });

  const transfer = { bytes: 0, responses: 0, measured: false, heaviest: [] };
  const consoleErrors = [];
  const requestFailures = [];

  context.on('response', (res) => {
    const len = Number(res.headers()['content-length'] || 0);
    transfer.responses += 1;
    if (len > 0) {
      transfer.measured = true;
      transfer.bytes += len;
      transfer.heaviest.push({ url: res.url().slice(0, 120), kb: KB(len) });
    }
  });

  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
  });
  page.on('requestfailed', (r) => {
    requestFailures.push({ url: r.url().slice(0, 120), reason: r.failure()?.errorText || 'unknown' });
  });

  let probe = null;
  let loadError = null;
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    if (resp && resp.status() >= 400) {
      loadError = `HTTP ${resp.status()} loading ${url}`;
    }
    // Give lazy content a moment, but never block the run on a hung page.
    await page.waitForLoadState('load', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600);
    probe = await page.evaluate(domProbe);
    if (screenshotPath) {
      await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: Boolean(fullPage) });
    }
  } catch (err) {
    loadError = String(err?.message || err).split('\n')[0].slice(0, 300);
    onLog?.({ level: 'error', message: `${viewport.width}px pass failed: ${loadError}` });
  }

  await context.close().catch(() => {});

  transfer.heaviest = transfer.heaviest.sort((a, b) => b.kb - a.kb).slice(0, 5);

  return {
    probe,
    loadError,
    transfer: { kb: KB(transfer.bytes), measured: transfer.measured, responses: transfer.responses, heaviest: transfer.heaviest },
    consoleErrors: consoleErrors.slice(0, 10),
    requestFailures: requestFailures.slice(0, 10),
  };
}

/**
 * Load a URL at both viewports, screenshot each, run the check suite.
 *
 * @param {object} o
 * @param {string} o.url
 * @param {string} o.label        'before' | 'after' | free text; used in filenames
 * @param {string} o.outDir       where screenshots go
 * @param {boolean} [o.probeLinks] probe outbound links (off for generated pages)
 * @param {function} [o.onLog]
 */
export async function capture({ url, label, outDir, probeLinks: doLinks = true, timeoutMs = 45_000, onLog = null }) {
  const browser = await getBrowser();
  const started = Date.now();
  onLog?.({ level: 'step', message: `Loading ${url} at ${VIEWPORTS.desktop.width}px and ${VIEWPORTS.mobile.width}px` });

  const desktop = await onePass({
    browser,
    url,
    viewport: VIEWPORTS.desktop,
    screenshotPath: path.join(outDir, `${label}-desktop.png`),
    fullPage: true,
    timeoutMs,
    onLog,
  });
  const mobile = await onePass({
    browser,
    url,
    viewport: VIEWPORTS.mobile,
    screenshotPath: path.join(outDir, `${label}-mobile.png`),
    fullPage: false,
    timeoutMs,
    onLog,
  });

  if (!desktop.probe && !mobile.probe) {
    const err = new Error(`Could not load ${url}: ${desktop.loadError || mobile.loadError}`);
    err.code = 'LOAD_FAILED';
    throw err;
  }

  let linkResults = [];
  if (doLinks) {
    const links = (desktop.probe?.links || mobile.probe?.links || []).filter((l) => !l.startsWith('mailto:'));
    if (links.length) {
      onLog?.({ level: 'step', message: `Probing ${Math.min(links.length, 12)} link(s)` });
      linkResults = await probeLinks(links);
    }
  }

  const transfer = desktop.transfer.measured ? desktop.transfer : mobile.transfer;
  const checks = buildChecks({ desktop: desktop.probe, mobile: mobile.probe, transfer, linkResults });
  const score = scoreChecks(checks);

  onLog?.({ level: 'result', message: `${label}: score ${score.score}, ${score.passed} passed / ${score.failed} failed / ${score.skipped} skipped of ${score.automated_total} automated checks` });

  return {
    label,
    url,
    capturedAt: new Date().toISOString(),
    ms: Date.now() - started,
    screenshots: {
      desktop: `${label}-desktop.png`,
      mobile: `${label}-mobile.png`,
    },
    checks,
    score,
    transfer,
    linkResults,
    consoleErrors: [...new Set([...desktop.consoleErrors, ...mobile.consoleErrors])],
    requestFailures: desktop.requestFailures,
    loadErrors: [desktop.loadError, mobile.loadError].filter(Boolean),
    dom: {
      title: desktop.probe?.title || mobile.probe?.title || '',
      headings: desktop.probe?.headings || mobile.probe?.headings || [],
      textLength: desktop.probe?.textLength ?? mobile.probe?.textLength ?? 0,
      phone: desktop.probe?.phone || mobile.probe?.phone || null,
      imageCount: desktop.probe?.images?.total ?? 0,
      links: (desktop.probe?.links || []).slice(0, 40),
      viewportMeta: desktop.probe?.viewportMeta ?? '',
      metaDescription: desktop.probe?.metaDescription ?? '',
      lang: desktop.probe?.lang ?? '',
    },
  };
}

/** Plain text of a page, used to give the audit model the real copy. */
export async function extractText(url, { timeoutMs = 30_000, maxChars = 12_000 } = {}) {
  const browser = await getBrowser();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForTimeout(400);
    const text = await page.evaluate(() => (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').trim());
    const html = await page.content();
    return { text: text.slice(0, maxChars), htmlLength: html.length };
  } finally {
    await context.close().catch(() => {});
  }
}
