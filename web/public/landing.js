// Landing page behaviour. No framework, no build step — same constraints as the
// app. Three jobs: reveal content on scroll, run the nav, and tell the truth
// about the demo's current capacity by asking the API that enforces it.

// The console used to live at "/". Anyone holding a bookmark to a hash route
// (/#/queue, /#/run?r=...) gets forwarded rather than dropped on the landing
// page with a hash that means nothing here.
if (/^#\/[a-z]/.test(location.hash)) {
  location.replace(`/app${location.hash}`);
}

const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// --- scroll reveal ---------------------------------------------------------
// IntersectionObserver, never a scroll listener: a scroll handler reflows on
// every frame and wrecks mobile. Elements unobserve once shown.

const revealables = document.querySelectorAll('.reveal');

if (prefersReduced || !('IntersectionObserver' in window)) {
  for (const el of revealables) el.classList.add('in');
} else {
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('in');
      io.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

  for (const el of revealables) io.observe(el);

  // Anything already in the viewport on load should not wait for a scroll that
  // may never come.
  requestAnimationFrame(() => {
    for (const el of revealables) {
      if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add('in');
    }
  });
}

// --- nav -------------------------------------------------------------------

const nav = document.getElementById('nav');
const burger = document.getElementById('burger');
const menu = document.getElementById('menu');

// A sentinel at the top of the document beats reading scrollTop on every frame.
if (nav) {
  const sentinel = document.createElement('div');
  sentinel.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:12px;pointer-events:none';
  document.body.prepend(sentinel);
  new IntersectionObserver(([e]) => {
    nav.dataset.stuck = String(!e.isIntersecting);
  }).observe(sentinel);
}

const setMenu = (open) => {
  document.body.classList.toggle('lp-open', open);
  burger?.setAttribute('aria-expanded', String(open));
  burger?.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  // Lock the page behind the overlay, but only while it is open.
  document.documentElement.style.overflow = open ? 'hidden' : '';
};

burger?.addEventListener('click', () => setMenu(!document.body.classList.contains('lp-open')));
menu?.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

// Close the overlay if the viewport grows past the breakpoint that hides the
// burger, otherwise the page stays locked behind an invisible menu.
window.matchMedia('(min-width: 881px)').addEventListener('change', (e) => { if (e.matches) setMenu(false); });

// --- smooth anchors --------------------------------------------------------

for (const a of document.querySelectorAll('a[href^="#"]')) {
  a.addEventListener('click', (e) => {
    const target = document.querySelector(a.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
    history.replaceState(null, '', a.getAttribute('href'));
  });
}

// --- live demo status ------------------------------------------------------
// The hero promises the demo is rate-limited and shared. /api/meta is the
// service that actually enforces that, so the promise is quoted from it rather
// than hard-coded here. Failure is silent: the static copy already reads true.

(async () => {
  let meta;
  try {
    const res = await fetch('/api/meta');
    const json = await res.json();
    if (!json.ok) return;
    meta = json;
  } catch { return; }

  const l = meta.limits;
  if (!l?.enabled) return;

  const total = l.runs_total;
  const left = Math.max(0, (total?.limit ?? 0) - (total?.used ?? 0));
  const mine = l.runs_per_client;

  const note = [
    `The demo runs the whole loop against a seeded sample business in about two minutes.`,
    `It is shared and rate-limited: <b>${mine.limit} runs per visitor</b> every ${mine.window_minutes} minutes,`,
    `<b>${left} of ${total.limit}</b> left in the current ${total.window_minutes}-minute window.`,
    `Clone the repo to run it without limits.`,
  ].join(' ');

  const el = document.getElementById('demo-note');
  if (el) el.innerHTML = note;

  const el2 = document.getElementById('demo-note-2');
  if (el2) {
    el2.innerHTML = `Shared and rate-limited so the demo survives a crowd — <b>${left} of ${total.limit}</b> runs left in this window. MIT licensed: clone it and run it with your own Nebius key for unlimited runs.`;
  }
})();
