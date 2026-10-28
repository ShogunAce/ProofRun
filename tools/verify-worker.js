// Runs inside the sandbox child process. Reads a job on stdin, loads the
// generated page with the network denied, runs the check suite, prints one JSON
// line on stdout. Progress goes to stderr as "LOG {json}".
//
// This process is started with a scrubbed environment, so it holds no API keys
// and cannot reach Token Factory or Tavily even if the page under test tried.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { VIEWPORTS, domProbe, buildChecks, scoreChecks } from './checks.js';

const log = (level, message) => process.stderr.write(`LOG ${JSON.stringify({ level, message })}\n`);

const readStdin = () =>
  new Promise((resolve) => {
    let s = '';
    process.stdin.on('data', (d) => { s += d; });
    process.stdin.on('end', () => resolve(s));
  });

async function main() {
  const { file, label, outDir } = JSON.parse(await readStdin());
  const fileUrl = `file://${file.replace(/\\/g, '/')}`;
  const blocked = [];

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-extensions', '--disable-background-networking'],
  });

  const passes = {};
  let transfer = { kb: 0, measured: false, responses: 0, heaviest: [] };

  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
      isMobile: Boolean(viewport.isMobile),
      hasTouch: Boolean(viewport.hasTouch),
      offline: false,
    });

    // Network deny-all: nothing but the file under test may load.
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url === fileUrl || url.startsWith('file://')) return route.continue();
      blocked.push({ url: url.slice(0, 160), method: route.request().method() });
      return route.abort('blockedbyclient');
    });

    const page = await context.newPage();
    try {
      await page.goto(fileUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(300);
      passes[name] = await page.evaluate(domProbe);
      await fsp.mkdir(outDir, { recursive: true });
      await page.screenshot({
        path: path.join(outDir, `${label}-${name}.png`),
        fullPage: name === 'desktop',
      });
      log('step', `${viewport.width}px pass complete`);
    } catch (err) {
      log('error', `${viewport.width}px pass failed: ${String(err.message).split('\n')[0]}`);
      passes[name] = null;
    }
    await context.close().catch(() => {});
  }

  // A generated page is a single local file: measure it from disk, since a
  // file:// response carries no Content-Length.
  try {
    const stat = await fsp.stat(file);
    transfer = {
      kb: Math.round((stat.size / 1024) * 10) / 10,
      measured: true,
      responses: 1,
      heaviest: [{ url: path.basename(file), kb: Math.round((stat.size / 1024) * 10) / 10 }],
    };
  } catch { /* leave unmeasured */ }

  await browser.close().catch(() => {});

  if (!passes.desktop && !passes.mobile) {
    process.stderr.write('both viewport passes failed\n');
    process.exit(3);
  }

  // No link probing for a generated page: it has no outbound links by design,
  // and the sandbox denies the network anyway. The check reports as skipped.
  const checks = buildChecks({ desktop: passes.desktop, mobile: passes.mobile, transfer, linkResults: [] });
  const score = scoreChecks(checks);

  process.stdout.write(
    `${JSON.stringify({
      label,
      url: fileUrl,
      capturedAt: new Date().toISOString(),
      screenshots: { desktop: `${label}-desktop.png`, mobile: `${label}-mobile.png` },
      checks,
      score,
      transfer,
      blockedRequests: blocked.slice(0, 20),
      sandbox: { mode: 'subprocess', networkDenied: true, blockedCount: blocked.length },
      dom: {
        title: passes.desktop?.title || passes.mobile?.title || '',
        headings: passes.desktop?.headings || [],
        textLength: passes.desktop?.textLength ?? 0,
        phone: passes.desktop?.phone || passes.mobile?.phone || null,
      },
    })}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err}\n`);
  process.exit(1);
});
