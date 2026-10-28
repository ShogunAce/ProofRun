// The check suite.
//
// This same function runs against the prospect's live site (the "before") and
// against the page the model generates (the "after"). That is the whole basis of
// the score delta: identical code, identical viewports, identical thresholds.
//
// Honesty rules baked in here:
//   - Every check declares its own `limit`: what it did NOT look at.
//   - A check that cannot run returns status "skipped" and scores nothing. It
//     never silently passes.
//   - The score is computed from weights in code, never by a model.
//   - `automated` is false for checks a human still has to judge; those are
//     listed but excluded from the score, so the UI can say "3 of 5 automated".

export const VIEWPORTS = {
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

export const BUDGETS = {
  pageWeightKb: 600,
  domContentLoadedMs: 2000,
  minTapTargetPx: 44,
  contrastNormal: 4.5,
  contrastLarge: 3.0,
  maxLinksProbed: 12,
};

export const CHECK_CATALOG = [
  { id: 'mobile_no_overflow', title: 'No horizontal scroll on mobile', weight: 12, scope: 'mobile 390px', limit: 'One viewport width only (390px). Not tested on tablet or at 320px.' },
  { id: 'click_to_call', title: 'Tappable phone number', weight: 12, scope: 'DOM', limit: 'Checks that a tel: link exists and is reachable, not that the number is correct.' },
  { id: 'cta_above_fold', title: 'Call to action above the fold', weight: 10, scope: 'mobile 390px', limit: 'Geometric only: a link or button intersecting the first 844px. Does not judge whether the wording persuades.' },
  { id: 'text_contrast', title: 'Text contrast meets WCAG AA', weight: 12, scope: 'desktop + mobile', limit: 'Computed foreground vs nearest opaque ancestor background. Text over images or gradients is reported as unmeasurable, not as a pass.' },
  { id: 'tap_targets', title: 'Tap targets at least 44px', weight: 8, scope: 'mobile 390px', limit: 'Visible interactive elements only. Off-screen and hidden controls are skipped.' },
  { id: 'image_alt_text', title: 'Images have alt text', weight: 8, scope: 'DOM', limit: 'Presence and non-emptiness only. Cannot tell whether the alt text is accurate.' },
  { id: 'heading_structure', title: 'One h1, no skipped heading levels', weight: 6, scope: 'DOM', limit: 'Structural only. Says nothing about whether the headings are good.' },
  { id: 'viewport_meta', title: 'Responsive viewport declared', weight: 6, scope: 'DOM', limit: 'Presence of a width=device-width viewport meta tag.' },
  { id: 'title_and_description', title: 'Page title and meta description', weight: 6, scope: 'DOM', limit: 'Length and presence. Not a judgment of SEO quality.' },
  { id: 'lang_declared', title: 'Document language declared', weight: 4, scope: 'DOM', limit: 'Presence of a non-empty html[lang].' },
  { id: 'no_broken_links', title: 'No broken links', weight: 8, scope: 'network', limit: `At most ${BUDGETS.maxLinksProbed} links probed, HEAD then GET, 8s timeout each. Sites that block bots can show as unreachable rather than broken.` },
  { id: 'page_weight', title: `Page weight under ${BUDGETS.pageWeightKb}KB`, weight: 4, scope: 'network', limit: 'Summed from Content-Length headers on a single cold load. Streamed or chunked responses without that header are not counted, so this is a floor, not a total.' },
  { id: 'render_speed', title: `DOMContentLoaded under ${BUDGETS.domContentLoadedMs}ms`, weight: 4, scope: 'network', limit: 'One cold load on this machine, unthrottled. Not a field measurement and not Core Web Vitals.' },
  // Listed in the UI, deliberately not automated:
  { id: 'copy_persuades', title: 'Copy makes the offer clear', weight: 0, automated: false, scope: 'human', limit: 'A person has to read it. ProofRun does not score this.' },
  { id: 'brand_accuracy', title: 'Business facts are accurate', weight: 0, automated: false, scope: 'human', limit: 'Only the business owner can confirm services, hours and service area.' },
];

export const AUTOMATED_CHECK_IDS = CHECK_CATALOG.filter((c) => c.automated !== false).map((c) => c.id);

const meta = (id) => CHECK_CATALOG.find((c) => c.id === id);

function result(id, status, evidence, extra = {}) {
  const m = meta(id) || { title: id, weight: 0, scope: 'unknown', limit: 'Unknown check.' };
  return {
    id,
    title: m.title,
    status, // 'pass' | 'fail' | 'skipped'
    weight: m.weight,
    scope: m.scope,
    limit: m.limit,
    automated: m.automated !== false,
    evidence,
    ...extra,
  };
}

// --------------------------------------------------------------------------
// In-page probes. These are stringified into the browser, so they must be
// self-contained.
// --------------------------------------------------------------------------

/* c8 ignore start -- runs in the browser */
function domProbe() {
  const srgb = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  const parse = (s) => {
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    return { rgb: parts.slice(0, 3), a: parts.length > 3 ? parts[3] : 1 };
  };
  const ratio = (fg, bg) => {
    const l1 = lum(fg);
    const l2 = lum(bg);
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
  };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  // --- contrast ---
  const contrast = { worst: null, failures: [], unmeasurable: 0, sampled: 0 };
  const textEls = [...document.querySelectorAll('body *')].filter((el) => {
    if (!visible(el)) return false;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    return own;
  });
  for (const el of textEls.slice(0, 400)) {
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    if (!fg) continue;
    // nearest opaque ancestor background
    let bg = null;
    let overImage = false;
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      const ncs = getComputedStyle(node);
      if (ncs.backgroundImage && ncs.backgroundImage !== 'none') { overImage = true; break; }
      const c = parse(ncs.backgroundColor);
      if (c && c.a >= 0.95) { bg = c.rgb; break; }
    }
    if (!bg && !overImage) {
      const htmlBg = parse(getComputedStyle(document.documentElement).backgroundColor);
      bg = htmlBg && htmlBg.a >= 0.95 ? htmlBg.rgb : [255, 255, 255];
    }
    contrast.sampled += 1;
    if (overImage || !bg) { contrast.unmeasurable += 1; continue; }
    const size = parseFloat(cs.fontSize) || 16;
    const bold = Number(cs.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const r = ratio(fg.rgb, bg);
    const need = large ? 3.0 : 4.5;
    if (contrast.worst === null || r < contrast.worst.ratio) {
      contrast.worst = { ratio: Math.round(r * 100) / 100, need, text: el.textContent.trim().slice(0, 60), selector: el.tagName.toLowerCase() };
    }
    if (r < need) {
      contrast.failures.push({
        ratio: Math.round(r * 100) / 100,
        need,
        text: el.textContent.trim().slice(0, 60),
        color: cs.color,
        background: `rgb(${bg.join(',')})`,
        fontSize: Math.round(size),
      });
    }
  }
  contrast.failures = contrast.failures.sort((a, b) => a.ratio - b.ratio).slice(0, 8);

  // --- tap targets ---
  const interactive = [...document.querySelectorAll('a[href], button, input, select, textarea, [role="button"]')].filter(visible);
  const small = interactive
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), label: (el.innerText || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40) };
    })
    .filter((t) => t.w < 44 || t.h < 44)
    .slice(0, 10);

  // --- overflow ---
  const docW = document.documentElement.scrollWidth;
  const winW = window.innerWidth;
  const offenders = [];
  if (docW > winW + 1) {
    for (const el of [...document.querySelectorAll('body *')].slice(0, 1500)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > winW + 1) {
        offenders.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 40), right: Math.round(r.right), width: Math.round(r.width) });
        if (offenders.length >= 6) break;
      }
    }
  }

  // --- CTA above the fold ---
  const foldH = window.innerHeight;
  const ctaWords = /(call|book|quote|schedule|contact|get started|request|estimate|appointment|hire|free)/i;
  const ctas = interactive
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top < foldH && r.bottom > 0;
    })
    .map((el) => ({
      text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 60),
      href: el.getAttribute('href') || '',
      top: Math.round(el.getBoundingClientRect().top),
    }))
    .filter((c) => ctaWords.test(c.text) || /^tel:/i.test(c.href));

  // --- phone ---
  const telLinks = [...document.querySelectorAll('a[href^="tel:"]')];
  const phoneText = (document.body.innerText || '').match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);

  // --- images / headings / head ---
  const imgs = [...document.querySelectorAll('img')];
  const missingAlt = imgs
    .filter((i) => visible(i) && !(i.getAttribute('alt') || '').trim() && i.getAttribute('role') !== 'presentation' && i.getAttribute('aria-hidden') !== 'true')
    .map((i) => (i.currentSrc || i.src || '').split('/').pop().slice(0, 50))
    .slice(0, 10);
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => ({ level: Number(h.tagName[1]), text: h.innerText.trim().slice(0, 60) }));
  const vp = document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '';
  const desc = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';

  const links = [...document.querySelectorAll('a[href]')]
    .map((a) => a.href)
    .filter((h) => /^https?:/i.test(h));

  const nav = performance.getEntriesByType('navigation')[0];

  return {
    url: location.href,
    title: document.title || '',
    lang: document.documentElement.getAttribute('lang') || '',
    viewportMeta: vp,
    metaDescription: desc,
    contrast,
    tapTargets: { total: interactive.length, small },
    overflow: { docW, winW, offenders },
    ctas,
    phone: { telLinks: telLinks.length, firstTel: telLinks[0]?.getAttribute('href') || null, textMatch: phoneText ? phoneText[0] : null },
    images: { total: imgs.length, missingAlt },
    headings,
    links: [...new Set(links)],
    timing: nav ? { domContentLoaded: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd || 0) } : null,
    textLength: (document.body.innerText || '').trim().length,
  };
}
/* c8 ignore stop */

export { domProbe };

// --------------------------------------------------------------------------
// Scoring
// --------------------------------------------------------------------------

export function scoreChecks(checks) {
  const automated = checks.filter((c) => c.automated);
  const counted = automated.filter((c) => c.status !== 'skipped');
  const possible = counted.reduce((s, c) => s + c.weight, 0);
  const earned = counted.filter((c) => c.status === 'pass').reduce((s, c) => s + c.weight, 0);
  return {
    score: possible === 0 ? 0 : Math.round((earned / possible) * 100),
    passed: counted.filter((c) => c.status === 'pass').length,
    failed: counted.filter((c) => c.status === 'fail').length,
    skipped: automated.length - counted.length,
    automated_total: automated.length,
    manual_total: checks.length - automated.length,
    weight_earned: earned,
    weight_possible: possible,
    limits: [
      `${counted.length} of ${checks.length} listed checks were automated and scored`,
      'Two viewports only: desktop 1280x800 and mobile 390x844',
      'One cold load per viewport on the runner machine, unthrottled',
    ],
  };
}

// --------------------------------------------------------------------------
// Link probing (Node side)
// --------------------------------------------------------------------------

async function probeLink(url, timeoutMs = 8000) {
  const once = async (method) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method, redirect: 'follow', signal: ac.signal, headers: { 'user-agent': 'ProofRunBot/1.0 (+link check)' } });
      return res.status;
    } finally {
      clearTimeout(t);
    }
  };
  try {
    let status = await once('HEAD');
    if (status === 405 || status === 501 || status === 403) status = await once('GET');
    return { url, status, ok: status < 400 };
  } catch (err) {
    return { url, status: null, ok: null, error: err?.name === 'AbortError' ? 'timeout' : String(err?.message || err).slice(0, 120) };
  }
}

export async function probeLinks(links, max = BUDGETS.maxLinksProbed) {
  const picked = links.slice(0, max);
  return Promise.all(picked.map((l) => probeLink(l)));
}

// --------------------------------------------------------------------------
// Turning probe data into checks
// --------------------------------------------------------------------------

/**
 * @param {object} o
 * @param {object} o.desktop  domProbe() output at desktop viewport
 * @param {object} o.mobile   domProbe() output at mobile viewport
 * @param {object} o.transfer { kb, measured } page weight
 * @param {Array}  o.linkResults probeLinks() output
 */
export function buildChecks({ desktop, mobile, transfer, linkResults }) {
  const checks = [];

  // mobile overflow
  if (!mobile) checks.push(result('mobile_no_overflow', 'skipped', 'Mobile viewport pass did not complete.'));
  else {
    const over = mobile.overflow.docW - mobile.overflow.winW;
    checks.push(
      over > 1
        ? result('mobile_no_overflow', 'fail', `Document is ${mobile.overflow.docW}px wide in a ${mobile.overflow.winW}px viewport (${over}px of horizontal scroll).`, { offenders: mobile.overflow.offenders })
        : result('mobile_no_overflow', 'pass', `Document width ${mobile.overflow.docW}px fits the ${mobile.overflow.winW}px viewport.`),
    );
  }

  // click to call
  const ph = (mobile || desktop)?.phone;
  if (!ph) checks.push(result('click_to_call', 'skipped', 'No DOM snapshot.'));
  else if (ph.telLinks > 0) checks.push(result('click_to_call', 'pass', `${ph.telLinks} tel: link(s) found, first is ${ph.firstTel}.`));
  else if (ph.textMatch) checks.push(result('click_to_call', 'fail', `A phone number appears as plain text ("${ph.textMatch}") but is not a tel: link, so tapping it on a phone does nothing.`));
  else checks.push(result('click_to_call', 'fail', 'No phone number found as a tel: link or as text.'));

  // CTA above fold
  if (!mobile) checks.push(result('cta_above_fold', 'skipped', 'Mobile viewport pass did not complete.'));
  else if (mobile.ctas.length > 0) checks.push(result('cta_above_fold', 'pass', `${mobile.ctas.length} action(s) in the first screen, e.g. "${mobile.ctas[0].text || mobile.ctas[0].href}".`, { ctas: mobile.ctas.slice(0, 4) }));
  else checks.push(result('cta_above_fold', 'fail', 'Nothing in the first 844px of the mobile page reads as a call, booking or contact action.'));

  // contrast (worst case across both viewports)
  const cons = [desktop?.contrast, mobile?.contrast].filter(Boolean);
  if (cons.length === 0) checks.push(result('text_contrast', 'skipped', 'No DOM snapshot.'));
  else {
    const failures = cons.flatMap((c) => c.failures);
    const sampled = cons.reduce((s, c) => s + c.sampled, 0);
    const unmeasurable = cons.reduce((s, c) => s + c.unmeasurable, 0);
    const note = unmeasurable ? ` ${unmeasurable} element(s) sat on an image or gradient and could not be measured.` : '';
    if (sampled === 0) checks.push(result('text_contrast', 'skipped', 'No measurable text nodes found.'));
    else if (failures.length === 0) checks.push(result('text_contrast', 'pass', `${sampled} text element(s) sampled, all at or above WCAG AA.${note}`));
    else {
      const worst = failures.sort((a, b) => a.ratio - b.ratio)[0];
      checks.push(result('text_contrast', 'fail', `${failures.length} of ${sampled} sampled text element(s) below WCAG AA. Worst is ${worst.ratio}:1 where ${worst.need}:1 is required ("${worst.text}").${note}`, { failures: failures.slice(0, 6) }));
    }
  }

  // tap targets
  if (!mobile) checks.push(result('tap_targets', 'skipped', 'Mobile viewport pass did not complete.'));
  else if (mobile.tapTargets.total === 0) checks.push(result('tap_targets', 'skipped', 'No visible interactive elements to measure.'));
  else if (mobile.tapTargets.small.length === 0) checks.push(result('tap_targets', 'pass', `All ${mobile.tapTargets.total} visible controls are at least ${BUDGETS.minTapTargetPx}px on both axes.`));
  else checks.push(result('tap_targets', 'fail', `${mobile.tapTargets.small.length} of ${mobile.tapTargets.total} visible controls are under ${BUDGETS.minTapTargetPx}px, smallest "${mobile.tapTargets.small[0].label}" at ${mobile.tapTargets.small[0].w}x${mobile.tapTargets.small[0].h}px.`, { small: mobile.tapTargets.small.slice(0, 6) }));

  // alt text
  const im = (desktop || mobile)?.images;
  if (!im) checks.push(result('image_alt_text', 'skipped', 'No DOM snapshot.'));
  else if (im.total === 0) checks.push(result('image_alt_text', 'skipped', 'Page has no images.'));
  else if (im.missingAlt.length === 0) checks.push(result('image_alt_text', 'pass', `All ${im.total} visible image(s) have non-empty alt text.`));
  else checks.push(result('image_alt_text', 'fail', `${im.missingAlt.length} of ${im.total} visible image(s) have no alt text (e.g. ${im.missingAlt.slice(0, 3).join(', ')}).`, { missing: im.missingAlt }));

  // headings
  const hs = (desktop || mobile)?.headings || null;
  if (!hs) checks.push(result('heading_structure', 'skipped', 'No DOM snapshot.'));
  else {
    const h1s = hs.filter((h) => h.level === 1);
    const levels = hs.map((h) => h.level);
    let skip = null;
    for (let i = 1; i < levels.length; i += 1) {
      if (levels[i] - levels[i - 1] > 1) { skip = `h${levels[i - 1]} is followed by h${levels[i]}`; break; }
    }
    if (h1s.length === 1 && !skip) checks.push(result('heading_structure', 'pass', `Exactly one h1 ("${h1s[0].text}") and no skipped levels across ${hs.length} heading(s).`));
    else {
      const why = [];
      if (h1s.length === 0) why.push('no h1 at all');
      if (h1s.length > 1) why.push(`${h1s.length} h1 elements`);
      if (skip) why.push(skip);
      checks.push(result('heading_structure', 'fail', `Heading outline is broken: ${why.join('; ')}.`, { headings: hs.slice(0, 10) }));
    }
  }

  // viewport meta
  const vp = (desktop || mobile)?.viewportMeta;
  if (vp === undefined) checks.push(result('viewport_meta', 'skipped', 'No DOM snapshot.'));
  else if (/width\s*=\s*device-width/i.test(vp)) checks.push(result('viewport_meta', 'pass', `Viewport meta present: "${vp}".`));
  else checks.push(result('viewport_meta', 'fail', vp ? `Viewport meta does not set width=device-width: "${vp}".` : 'No viewport meta tag, so phones render the page at desktop width and zoom out.'));

  // title + description
  const head = desktop || mobile;
  if (!head) checks.push(result('title_and_description', 'skipped', 'No DOM snapshot.'));
  else {
    const t = (head.title || '').trim();
    const d = (head.metaDescription || '').trim();
    const problems = [];
    if (t.length < 10) problems.push(t ? `title is only ${t.length} characters` : 'no title');
    if (t.length > 70) problems.push(`title is ${t.length} characters, over the 70 that usually render`);
    if (!d) problems.push('no meta description');
    else if (d.length < 50) problems.push(`meta description is only ${d.length} characters`);
    checks.push(
      problems.length === 0
        ? result('title_and_description', 'pass', `Title ${t.length} chars, meta description ${d.length} chars.`)
        : result('title_and_description', 'fail', `${problems.join('; ')}.`, { title: t, description: d }),
    );
  }

  // lang
  const lang = (desktop || mobile)?.lang;
  if (lang === undefined) checks.push(result('lang_declared', 'skipped', 'No DOM snapshot.'));
  else if (lang) checks.push(result('lang_declared', 'pass', `html[lang="${lang}"].`));
  else checks.push(result('lang_declared', 'fail', 'No lang attribute on <html>, so screen readers guess the pronunciation.'));

  // links
  if (!linkResults || linkResults.length === 0) checks.push(result('no_broken_links', 'skipped', 'No external links found to probe.'));
  else {
    const broken = linkResults.filter((l) => l.ok === false);
    const unreachable = linkResults.filter((l) => l.ok === null);
    if (broken.length === 0 && unreachable.length === 0) checks.push(result('no_broken_links', 'pass', `${linkResults.length} link(s) probed, all returned under 400.`));
    else if (broken.length === 0) checks.push(result('no_broken_links', 'skipped', `${unreachable.length} of ${linkResults.length} probed link(s) did not answer (timeout or blocked), so this cannot be called a pass.`, { unreachable: unreachable.slice(0, 5) }));
    else checks.push(result('no_broken_links', 'fail', `${broken.length} of ${linkResults.length} probed link(s) returned an error, e.g. ${broken[0].status} on ${broken[0].url}.`, { broken: broken.slice(0, 5), unreachable: unreachable.slice(0, 3) }));
  }

  // page weight
  if (!transfer || !transfer.measured) checks.push(result('page_weight', 'skipped', 'No response carried a Content-Length header, so transfer size could not be measured.'));
  else if (transfer.kb <= BUDGETS.pageWeightKb) checks.push(result('page_weight', 'pass', `${transfer.kb}KB measured across ${transfer.responses} response(s), under the ${BUDGETS.pageWeightKb}KB budget.`));
  else checks.push(result('page_weight', 'fail', `${transfer.kb}KB measured across ${transfer.responses} response(s), over the ${BUDGETS.pageWeightKb}KB budget.`, { heaviest: transfer.heaviest }));

  // render speed
  const timing = desktop?.timing || mobile?.timing;
  if (!timing) checks.push(result('render_speed', 'skipped', 'Navigation timing unavailable.'));
  else if (timing.domContentLoaded <= BUDGETS.domContentLoadedMs) checks.push(result('render_speed', 'pass', `DOMContentLoaded at ${timing.domContentLoaded}ms, under the ${BUDGETS.domContentLoadedMs}ms budget.`));
  else checks.push(result('render_speed', 'fail', `DOMContentLoaded at ${timing.domContentLoaded}ms, over the ${BUDGETS.domContentLoadedMs}ms budget.`));

  // human-only checks, listed and never scored
  checks.push(result('copy_persuades', 'skipped', 'Not automated. A person has to read the page.'));
  checks.push(result('brand_accuracy', 'skipped', 'Not automated. Only the business owner can confirm these facts.'));

  return checks;
}

/** The compact failure list fed back to the model on a retry. */
export function failuresForModel(checks) {
  return checks
    .filter((c) => c.automated && c.status === 'fail')
    .map((c) => ({ id: c.id, requirement: c.title, what_went_wrong: c.evidence, details: c.offenders || c.failures || c.small || c.missing || c.broken || null }));
}
