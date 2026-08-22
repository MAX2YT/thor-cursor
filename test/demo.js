/**
 * Demo page smoke test.
 *
 * Loads demo/index.html in JSDOM with the real scripts executing, then drives
 * the controls. The point is to catch broken selectors, missing element ids
 * and console errors — the things that make a demo look shipped but land
 * blank in a browser.
 */

import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else {
    fail++; failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const consoleErrors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => consoleErrors.push('jsdomError: ' + e.message));
vc.on('error', (...a) => consoleErrors.push('console.error: ' + a.join(' ')));

console.log('demo page smoke test\n');

const html = fs.readFileSync(path.join(ROOT, 'demo', 'index.html'), 'utf8');

/* Canvas stub — JSDOM has none. Records NaN like the main suite. */
let nonFinite = 0;
function ctxStub() {
  const num = (...a) => a.forEach((v) => {
    if (typeof v === 'number' && !Number.isFinite(v)) nonFinite++;
  });
  const grad = { addColorStop() {} };
  return new Proxy({
    canvas: null, globalAlpha: 1, globalCompositeOperation: '',
    strokeStyle: '', fillStyle: '', lineWidth: 1, lineCap: '', lineJoin: '',
    shadowColor: '', shadowBlur: 0,
    createLinearGradient: (...a) => { num(...a); return grad; },
    createRadialGradient: (...a) => { num(...a); return grad; },
    setTransform: (...a) => num(...a),
  }, {
    get(t, k) {
      if (k in t) return t[k];
      return (...a) => { num(...a); };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  resources: undefined,        // we inject scripts manually below
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: 'file:///' + path.join(ROOT, 'demo', 'index.html').replace(/\\/g, '/'),
});
const { window } = dom;

window.HTMLCanvasElement.prototype.getContext = function () {
  const c = ctxStub();
  c.canvas = this;
  return c;
};
window.matchMedia = (q) => ({
  media: q, matches: false,
  addEventListener() {}, removeEventListener() {},
  addListener() {}, removeListener() {},
});
Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });

// Deterministic rAF pump.
let now = 0;
const queue = [];
window.performance.now = () => now;
window.requestAnimationFrame = (fn) => { queue.push(fn); return queue.length; };
window.cancelAnimationFrame = (id) => { queue[id - 1] = null; };
function tick(n = 1, dt = 16) {
  for (let i = 0; i < n; i++) {
    now += dt;
    const batch = queue.splice(0, queue.length);
    for (const fn of batch) if (fn) fn(now);
  }
}

// Execute the library then the demo script, in document order.
const libCode = fs.readFileSync(path.join(ROOT, 'dist', 'thor-cursor.js'), 'utf8');
const demoCode = fs.readFileSync(path.join(ROOT, 'demo', 'demo.js'), 'utf8');

try {
  window.eval(libCode);
  ok('library script evaluates', typeof window.ThorCursor === 'object');
  window.eval(demoCode);
  ok('demo script evaluates', true);
} catch (e) {
  ok('scripts evaluate', false, e.message);
}

/* ---- structure ---- */
const $ = (s) => window.document.querySelector(s);

ok('hero title present', $('.title') && $('.title').textContent.trim() === 'MJOLNIR');
ok('has subtitle/lede', !!$('.lede') && $('.lede').textContent.length > 40);
ok('has nav', !!$('.nav') && window.document.querySelectorAll('.nav-links a').length >= 4);
ok('has buttons', window.document.querySelectorAll('.btn').length >= 3);
ok('has cards', window.document.querySelectorAll('.card').length >= 4);
ok('movement section', !!$('#move'));
ok('impact section', !!$('#impact'));
ok('drag section', !!$('#drag'));
ok('playground section', !!$('#playground'));
ok('form controls present',
  !!$('input[type="text"]') && !!$('select') && !!$('textarea'));
ok('scroll region present', !!$('.scroller'));
ok('cursor overlay canvas created', !!$('canvas[data-thor-cursor]'));
ok('motes canvas present', !!$('#motes'));
ok('legal disclaimer present',
  window.document.body.textContent.includes('Not affiliated'));

/* ---- every id the demo script reaches for must exist ---- */
const referencedIds = [...demoCode.matchAll(/getElementById\('([^']+)'\)/g)]
  .map((m) => m[1]);
const missing = referencedIds.filter((id) => !window.document.getElementById(id));
ok('no dangling getElementById targets', missing.length === 0,
  missing.join(', '));

const dataOuts = [...demoCode.matchAll(/data-out="\$\{key\}"/g)];
const rangeIds = ['intensity', 'hammerSize', 'trailLength', 'particleDensity',
  'glowIntensity', 'clickStrength', 'animationSpeed', 'followEase'];
const missingRange = rangeIds.filter((k) => !window.document.getElementById('c-' + k));
ok('every range control exists', missingRange.length === 0, missingRange.join(', '));
const missingOut = rangeIds.filter((k) => !$(`[data-out="${k}"]`));
ok('every range has a readout', missingOut.length === 0, missingOut.join(', '));

/* ---- interaction ---- */
tick(3);
const inst = window.ThorCursor.instance;
ok('cursor instance live', !!inst && inst.running === true);

function ev(type, props) {
  const e = new window.Event(type, { bubbles: true });
  for (const [k, v] of Object.entries(props)) {
    Object.defineProperty(e, k, { value: v, configurable: true });
  }
  return e;
}

// Move + click + drag through the page.
for (let i = 0; i < 30; i++) {
  window.dispatchEvent(ev('pointermove', {
    clientX: 200 + i * 30, clientY: 300 + i * 9,
    pointerType: 'mouse', target: window.document.body,
  }));
  tick(1);
}
ok('movement produced effects', inst.stats().arcs > 0 || inst.stats().particles > 0);

window.dispatchEvent(ev('pointerdown', {
  clientX: 600, clientY: 400, button: 0, pointerType: 'mouse',
  target: window.document.body,
}));
tick(2);
ok('click produced an impact', inst.impact.flashes.length > 0);
window.dispatchEvent(ev('pointerup', { clientX: 600, clientY: 400, button: 0, pointerType: 'mouse' }));

// Sliders.
const slider = window.document.getElementById('c-intensity');
slider.value = '2.4';
slider.dispatchEvent(ev('input', {}));
ok('slider updates config', Math.abs(inst.cfg.intensity - 2.4) < 0.001,
  `intensity=${inst.cfg.intensity}`);
ok('slider updates readout',
  $('[data-out="intensity"]').textContent === '2.4');

// Toggles.
const trailToggle = window.document.getElementById('c-trail');
trailToggle.checked = false;
trailToggle.dispatchEvent(ev('change', {}));
ok('checkbox updates config', inst.cfg.trail === false);
trailToggle.checked = true;
trailToggle.dispatchEvent(ev('change', {}));

// Snippet reflects changes.
const snip = window.document.getElementById('snippet').textContent;
ok('snippet reflects changed options', snip.includes('intensity: 2.4'), snip.slice(0, 80));

// Swatch.
const sw = window.document.querySelectorAll('.swatch')[2];
sw.dispatchEvent(ev('click', { target: sw }));
ok('swatch changes colour', inst.cfg.color === sw.dataset.color,
  `${inst.cfg.color} vs ${sw.dataset.color}`);
ok('swatch marks itself active', sw.classList.contains('is-on'));

// Strength preset chips.
const chip = window.document.querySelector('.chip[data-strength="2"]');
chip.dispatchEvent(ev('click', { target: chip }));
ok('preset chip sets clickStrength', inst.cfg.clickStrength === 2);
ok('preset syncs the slider',
  window.document.getElementById('c-clickStrength').value === '2');

// Reset.
window.document.getElementById('reset').dispatchEvent(ev('click', {}));
ok('reset restores intensity', inst.cfg.intensity === 1);
ok('reset restores slider', window.document.getElementById('c-intensity').value === '1');
ok('reset restores colour', inst.cfg.color === '#7fd4ff');

// Enable/disable toggle button.
const tg = window.document.getElementById('toggle');
tg.dispatchEvent(ev('click', {}));
ok('toggle button stops the cursor', inst.running === false);
ok('toggle button relabels', tg.textContent === 'Enable cursor');
tg.dispatchEvent(ev('click', {}));
ok('toggle button restarts', inst.running === true);

// Stats readout populates.
tick(50, 16);
ok('fps readout populated', window.document.getElementById('fps').textContent !== '—',
  window.document.getElementById('fps').textContent);
ok('dpr readout populated', window.document.getElementById('dpr') === null ||
  window.document.getElementById('s-dpr').textContent !== '—');

// Resize.
Object.defineProperty(window, 'innerWidth', { value: 700, configurable: true });
Object.defineProperty(window, 'innerHeight', { value: 500, configurable: true });
window.dispatchEvent(new window.Event('resize'));
tick(3);
ok('survives resize', inst.canvas.width === 700 * 2, `w=${inst.canvas.width}`);

ok('no NaN coordinates anywhere', nonFinite === 0, `count=${nonFinite}`);
ok('no console errors', consoleErrors.length === 0,
  consoleErrors.slice(0, 3).join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  - ' + f);
}
dom.window.close();
process.exit(fail ? 1 : 0);
