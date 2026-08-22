/**
 * thor-cursor test suite.
 *
 * Runs the library against JSDOM with a recording 2D-context stub. JSDOM has
 * no canvas implementation, so the stub both satisfies the API and lets us
 * assert on what was drawn — and, importantly, catches NaN coordinates, which
 * are the usual cause of "nothing renders" bugs in canvas code.
 */

import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else {
    fail++;
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
/** Stringify for messages without choking on DOM/circular objects. */
function show(v) {
  if (v === null || v === undefined) return String(v);
  const t = typeof v;
  if (t === 'number' || t === 'boolean' || t === 'string') return JSON.stringify(v);
  if (t === 'function') return `[function ${v.name || 'anonymous'}]`;
  if (v.constructor && v.constructor.name) return `[${v.constructor.name}]`;
  return '[object]';
}
function eq(name, actual, expected) {
  ok(name, actual === expected, `got ${show(actual)}, want ${show(expected)}`);
}
function section(t) { console.log(`\n${t}`); }

/* ------------------------------------------------------- canvas 2D stub */

function makeCtxStub(state) {
  const numeric = (...args) => {
    for (const a of args) {
      if (typeof a === 'number' && !Number.isFinite(a)) {
        state.nonFinite++;
        if (state.nonFiniteSamples.length < 5) {
          state.nonFiniteSamples.push(new Error().stack.split('\n')[2].trim());
        }
      }
    }
  };
  const grad = () => ({
    addColorStop(off, col) {
      numeric(off);
      if (typeof col !== 'string' || col.includes('NaN')) state.badColor++;
    },
  });

  const ctx = {
    canvas: null,
    // state we care about
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    shadowColor: '',
    shadowBlur: 0,

    save() { state.saves++; },
    restore() { state.restores++; },
    beginPath() { state.beginPath++; },
    closePath() {},
    moveTo(...a) { numeric(...a); },
    lineTo(...a) { numeric(...a); state.lineTo++; },
    arc(...a) { numeric(...a); state.arc++; },
    arcTo(...a) { numeric(...a); },
    rect(...a) { numeric(...a); },
    fill() { state.fill++; },
    stroke() { state.stroke++; },
    clip() {},
    scale(...a) { numeric(...a); },
    translate(...a) { numeric(...a); },
    rotate(...a) { numeric(...a); },
    setTransform(...a) { numeric(...a); },
    clearRect(...a) { numeric(...a); state.clearRect++; },
    fillRect(...a) { numeric(...a); },
    drawImage(img, ...a) {
      numeric(...a);
      if (!img) state.badImage++;
      state.drawImage++;
    },
    createLinearGradient(...a) { numeric(...a); return grad(); },
    createRadialGradient(...a) { numeric(...a); return grad(); },
    measureText() { return { width: 0 }; },
  };
  // Colour strings are assigned, not passed — watch for NaN via setters.
  for (const prop of ['strokeStyle', 'fillStyle', 'shadowColor']) {
    let v = '';
    Object.defineProperty(ctx, prop, {
      get() { return v; },
      set(nv) {
        if (typeof nv === 'string' && nv.includes('NaN')) state.badColor++;
        v = nv;
      },
    });
  }
  for (const prop of ['lineWidth', 'globalAlpha', 'shadowBlur']) {
    let v = 1;
    Object.defineProperty(ctx, prop, {
      get() { return v; },
      set(nv) {
        if (!Number.isFinite(nv)) state.nonFinite++;
        if (prop === 'globalAlpha' && (nv < 0 || nv > 1)) state.badAlpha++;
        v = nv;
      },
    });
  }
  return ctx;
}

/* ------------------------------------------------------------ environment */

function makeEnv(opts = {}) {
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body><button id="b">x</button>' +
    '<input id="i"><a href="#" id="a">link</a></body></html>',
    { pretendToBeVisual: true, url: 'https://example.test/' },
  );
  const { window } = dom;

  const state = {
    saves: 0, restores: 0, beginPath: 0, lineTo: 0, arc: 0, fill: 0,
    stroke: 0, clearRect: 0, drawImage: 0, nonFinite: 0, badColor: 0,
    badAlpha: 0, badImage: 0, nonFiniteSamples: [], contexts: 0,
  };

  window.HTMLCanvasElement.prototype.getContext = function () {
    state.contexts++;
    const c = makeCtxStub(state);
    c.canvas = this;
    return c;
  };

  // Controllable clock + rAF pump.
  let now = 1000;
  const frames = [];
  window.performance.now = () => now;
  window.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  window.cancelAnimationFrame = (id) => { frames[id - 1] = null; };

  window.matchMedia = (q) => ({
    media: q,
    matches: !!(opts.media && opts.media[q]),
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });

  Object.defineProperty(window, 'devicePixelRatio', {
    value: opts.dpr ?? 2, writable: true, configurable: true,
  });
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, writable: true, configurable: true });

  const g = globalThis;
  const saved = {};
  for (const k of ['window', 'document', 'navigator', 'performance',
    'requestAnimationFrame', 'cancelAnimationFrame', 'HTMLElement',
    'Element', 'Node', 'MouseEvent', 'PointerEvent', 'Event', 'getComputedStyle']) {
    saved[k] = g[k];
    try {
      Object.defineProperty(g, k, {
        value: window[k], writable: true, configurable: true,
      });
    } catch { /* some globals are locked; ignore */ }
  }

  return {
    dom, window, state, saved,
    /** Run N animation frames, advancing the clock by dtMs each. */
    tick(n = 1, dtMs = 16) {
      for (let i = 0; i < n; i++) {
        now += dtMs;
        const queued = frames.splice(0, frames.length);
        for (const fn of queued) if (fn) fn(now);
      }
    },
    get pending() { return frames.filter(Boolean).length; },
    advance(ms) { now += ms; },
    /**
     * Build a synthetic pointer event. `target` is getter-only on a real
     * Event, so every property goes on via defineProperty.
     */
    event(type, props) {
      const e = new window.Event(type);
      for (const [k, v] of Object.entries(props)) {
        Object.defineProperty(e, k, { value: v, configurable: true });
      }
      return e;
    },
    move(x, y, extra = {}) {
      window.dispatchEvent(this.event('pointermove', Object.assign(
        { clientX: x, clientY: y, pointerType: 'mouse', target: window.document.body },
        extra)));
    },
    down(x, y, extra = {}) {
      window.dispatchEvent(this.event('pointerdown', Object.assign(
        { clientX: x, clientY: y, button: 0, pointerType: 'mouse', target: window.document.body },
        extra)));
    },
    up(x, y) {
      window.dispatchEvent(this.event('pointerup', {
        clientX: x, clientY: y, button: 0, pointerType: 'mouse',
      }));
    },
    restore() {
      for (const k of Object.keys(saved)) {
        try {
          Object.defineProperty(g, k, { value: saved[k], writable: true, configurable: true });
        } catch { /* ignore */ }
      }
      dom.window.close();
    },
  };
}

/* ------------------------------------------------------------------ tests */

const errors = [];
process.on('uncaughtException', (e) => errors.push(e));

async function load() {
  // Import the source entry (fresh module registry per run is not needed —
  // the module holds only a singleton we explicitly destroy).
  const url = 'file:///' + path.join(ROOT, 'src', 'index.js').replace(/\\/g, '/');
  return import(url + '?t=' + Math.random());
}

async function main() {
  console.log('thor-cursor test suite');

  /* ---- config ---- */
  section('config');
  {
    const { resolveConfig, DEFAULTS } = await load();
    const c = resolveConfig({});
    eq('defaults intensity', c.intensity, 1);
    eq('clamps high intensity', resolveConfig({ intensity: 99 }).intensity, 4);
    eq('clamps negative', resolveConfig({ intensity: -5 }).intensity, 0);
    eq('clamps trailLength low', resolveConfig({ trailLength: 0 }).trailLength, 2);
    eq('animationSpeed never 0', resolveConfig({ animationSpeed: 0 }).animationSpeed, 0.1);
    ok('parses hex color', resolveConfig({ color: '#0af' })._rgb.join() === '0,170,255');
    ok('DEFAULTS frozen-ish (exported)', !!DEFAULTS && typeof DEFAULTS === 'object');
    // A user object must not be mutated.
    const userObj = { intensity: 2 };
    resolveConfig(userObj);
    eq('does not mutate user options', Object.keys(userObj).length, 1);
  }

  /* ---- init / SSR ---- */
  section('lifecycle');
  {
    const env = makeEnv();
    const { ThorCursor } = await load();
    const inst = ThorCursor.init({ hammerSize: 34 });
    ok('init returns instance', !!inst);
    ok('canvas appended', !!env.window.document.querySelector('canvas[data-thor-cursor]'));
    ok('pointer-events none', inst.canvas.style.pointerEvents === 'none');
    ok('canvas sized to dpr', inst.canvas.width === 1280 * 2, `w=${inst.canvas.width}`);
    ok('cursor hidden via class',
      env.window.document.documentElement.classList.contains('thor-cursor-active'));
    ok('style tag injected', !!env.window.document.getElementById('thor-cursor-style'));
    ok('running', inst.running === true);
    ok('rAF scheduled', env.pending > 0);

    // init twice must not double up
    const again = ThorCursor.init({ intensity: 2 });
    eq('init is idempotent (same instance)', again, inst);
    eq('canvas count still 1',
      env.window.document.querySelectorAll('canvas[data-thor-cursor]').length, 1);

    ThorCursor.destroy();
    ok('canvas removed on destroy',
      !env.window.document.querySelector('canvas[data-thor-cursor]'));
    ok('cursor class removed',
      !env.window.document.documentElement.classList.contains('thor-cursor-active'));
    eq('no rAF pending after destroy', env.pending, 0);
    env.restore();
  }

  /* ---- movement / drawing ---- */
  section('movement and rendering');
  {
    const env = makeEnv();
    const { ThorCursor } = await load();
    const inst = ThorCursor.init();
    env.tick(2);
    const drawsBefore = env.state.drawImage;
    ok('hammer sprite drawn', drawsBefore > 0, `drawImage=${drawsBefore}`);
    ok('canvas cleared each frame', env.state.clearRect >= 2);

    // Slow drift.
    for (let i = 0; i < 20; i++) { env.move(400 + i, 300); env.tick(1); }
    const slowArcs = inst.stats().arcs;

    // Fast sweep — should produce noticeably more electrical activity.
    for (let i = 0; i < 20; i++) { env.move(400 + i * 45, 300 + i * 12); env.tick(1); }
    const fastArcs = inst.stats().arcs;
    ok('fast movement makes more arcs than slow',
      fastArcs > slowArcs, `slow=${slowArcs} fast=${fastArcs}`);

    // Drag should be the most dramatic.
    env.down(500, 400);
    for (let i = 0; i < 25; i++) { env.move(500 + i * 30, 400 + i * 8); env.tick(1); }
    const dragArcs = inst.stats().arcs;
    ok('dragging produces a trail', dragArcs > 0, `arcs=${dragArcs}`);
    env.up(1200, 600);

    eq('no non-finite canvas coords', env.state.nonFinite, 0);
    eq('no NaN in colour strings', env.state.badColor, 0);
    eq('no out-of-range globalAlpha', env.state.badAlpha, 0);
    eq('never drew a null image', env.state.badImage, 0);

    ThorCursor.destroy();
    env.restore();
  }

  /* ---- click impact ---- */
  section('click impact');
  {
    const env = makeEnv();
    const { ThorCursor } = await load();
    const inst = ThorCursor.init();
    env.move(600, 400); env.tick(1);

    env.down(600, 400);
    env.tick(1);
    ok('impact spawns arcs', inst.stats().arcs > 0, `arcs=${inst.stats().arcs}`);
    ok('impact spawns particles', inst.stats().particles > 0);
    ok('flash created', inst.impact.flashes.length > 0);
    ok('swing animating', inst.impact.swing !== 0);
    env.up(600, 400);

    // Effects must fully expire — the spec asks for ~300-700ms. Ambient idle
    // emission is switched off first so what we measure is strictly the
    // impact's own lifetime, not a freshly-spawned idle spark.
    inst.configure({ particleDensity: 0, trail: false });
    env.tick(80, 16);   // ~1.3s
    eq('arcs expired', inst.stats().arcs, 0);
    eq('particles expired', inst.stats().particles, 0);
    eq('flashes expired', inst.impact.flashes.length, 0);
    eq('rings expired', inst.particles.rings.length, 0);
    eq('swing settled', inst.impact.swing, 0);

    inst.configure({ particleDensity: 1, trail: true });

    // Rapid repeated clicking must stay bounded.
    for (let i = 0; i < 60; i++) {
      env.down(300 + (i % 7) * 40, 300);
      env.up(300, 300);
      env.tick(1);
    }
    const st = inst.stats();
    ok('particles capped under click spam',
      st.particles <= inst.cfg.maxParticles, `${st.particles} <= ${inst.cfg.maxParticles}`);
    ok('arcs capped under click spam',
      st.arcs <= inst.arcs.cap, `${st.arcs} <= ${inst.arcs.cap}`);
    eq('still no bad coords after spam', env.state.nonFinite, 0);

    ThorCursor.destroy();
    env.restore();
  }

  /* ---- memory / steady state ---- */
  section('memory and stability');
  {
    const env = makeEnv();
    const { ThorCursor } = await load();
    const inst = ThorCursor.init();

    // Long mixed session: move, drag, click, release, repeat.
    for (let i = 0; i < 600; i++) {
      env.move(200 + Math.sin(i * 0.3) * 400, 300 + Math.cos(i * 0.21) * 200);
      if (i % 50 === 0) env.down(400, 400);
      if (i % 50 === 25) env.up(400, 400);
      env.tick(1);
    }
    const mid = inst.stats();
    ok('particle pool bounded over long run',
      mid.particles <= inst.cfg.maxParticles, `${mid.particles}`);
    ok('arc pool never grows', inst.arcs.items.length === inst.arcs.cap,
      `${inst.arcs.items.length} vs ${inst.arcs.cap}`);
    ok('ring list bounded', inst.particles.rings.length <= 13);
    ok('trail buffer fixed size', inst.trail.sx.length === inst.cfg.trailLength);
    ok('flash list bounded', inst.impact.flashes.length < 40);

    // Idle: everything must drain. Ambient idle sparks are switched off
    // first, otherwise the emitter can legitimately spawn one on the final
    // tick and mask (or fake) a leak either way.
    env.up(400, 400);
    inst.configure({ particleDensity: 0, trail: false });
    env.tick(200, 16);
    eq('drains to zero particles when idle', inst.stats().particles, 0);
    eq('drains to zero arcs when idle', inst.stats().arcs, 0);
    inst.configure({ particleDensity: 1, trail: true });

    // Ambient idle sparks must also be self-limiting: left completely alone
    // with emission on, the pool should hover near-empty, never accumulate.
    inst.configure({ particleDensity: 1, trail: true });
    let peakIdle = 0;
    for (let i = 0; i < 400; i++) {
      env.tick(1);
      peakIdle = Math.max(peakIdle, inst.stats().particles);
    }
    ok('ambient idle emission stays tiny', peakIdle < 12, `peak=${peakIdle}`);

    eq('no bad coords in long run', env.state.nonFinite, 0);
    ok('save/restore balanced',
      env.state.saves === env.state.restores,
      `saves=${env.state.saves} restores=${env.state.restores}`);

    ThorCursor.destroy();
    env.restore();
  }

  /* ---- big dt / tab switching ---- */
  section('timing robustness');
  {
    const env = makeEnv();
    const { ThorCursor } = await load();
    const inst = ThorCursor.init();
    env.move(500, 500); env.tick(1);
    env.down(500, 500); env.tick(1);
    env.up(500, 500);

    // Simulate a long stall (backgrounded tab) — dt must be clamped so the
    // simulation doesn't teleport or produce NaN.
    env.tick(1, 5000);
    eq('survives a 5s frame gap', env.state.nonFinite, 0);
    ok('effects did not explode after stall',
      inst.stats().particles <= inst.cfg.maxParticles);

    // Zero-length frames.
    env.tick(5, 0);
    eq('survives zero-dt frames', env.state.nonFinite, 0);

    ThorCursor.destroy();
    env.restore();
  }

  /* ---- reduced motion ---- */
  section('prefers-reduced-motion');
  {
    const env = makeEnv({ media: { '(prefers-reduced-motion: reduce)': true } });
    const { ThorCursor } = await load();
    const inst = ThorCursor.init();
    ok('reduced motion detected', inst.stats().reduced === true);

    env.move(400, 400); env.tick(1);
    for (let i = 0; i < 30; i++) { env.move(400 + i * 40, 400); env.tick(1); }
    eq('no trail arcs under reduced motion', inst.stats().arcs, 0);
    eq('no trail particles under reduced motion', inst.stats().particles, 0);

    env.down(400, 400); env.tick(1);
    ok('click still acknowledged (minimal flash)', inst.impact.flashes.length > 0);
    eq('but no bolt storm', inst.stats().arcs, 0);
    ok('hammer still rendered', env.state.drawImage > 0);

    ThorCursor.destroy();
    env.restore();
  }

  /* ---- touch devices ---- */
  section('touch devices');
  {
    const env = makeEnv({
      media: { '(pointer: coarse)': true, '(hover: none)': true },
    });
    const { ThorCursor } = await load();
    const inst = ThorCursor.init();
    ok('supported === false on touch-only', inst.supported === false);
    eq('no canvas created on touch',
      env.window.document.querySelectorAll('canvas[data-thor-cursor]').length, 0);
    ok('native cursor untouched',
      !env.window.document.documentElement.classList.contains('thor-cursor-active'));
    eq('no rAF loop on touch', env.pending, 0);
    ok('start() is a no-op', inst.start().running === false);
    ok('strike() is safe', inst.strike(10, 10) === inst);
    ThorCursor.destroy();
    env.restore();
  }

  /* ---- runtime configuration ---- */
  section('runtime configuration');
  {
    const env = makeEnv();
    const { ThorCursor } = await load();
    const inst = ThorCursor.init({ trail: true, clickEffect: true });
    env.move(400, 400); env.tick(1);

    inst.configure({ trail: false });
    for (let i = 0; i < 30; i++) { env.move(400 + i * 40, 400); env.tick(1); }
    env.tick(60, 16);
    eq('trail:false suppresses arcs', inst.stats().arcs, 0);

    inst.configure({ clickEffect: false });
    env.down(500, 500); env.tick(1);
    eq('clickEffect:false suppresses impact', inst.stats().arcs, 0);
    eq('no flash either', inst.impact.flashes.length, 0);
    env.up(500, 500);

    inst.configure({ trail: true, clickEffect: true, intensity: 2 });
    env.down(500, 500); env.tick(1);
    ok('re-enabling works', inst.stats().arcs > 0);
    env.up(500, 500);

    // Rebuilds that reallocate must keep the systems wired together.
    inst.configure({ hammerSize: 60, maxParticles: 100, trailLength: 40 });
    eq('trail buffer resized', inst.trail.sx.length, 40);
    eq('particle cap applied', inst.particles.cap, 100);
    ok('impact still shares the new particle system',
      inst.impact.particles === inst.particles);
    ok('trail still shares the new particle system',
      inst.trail.particles === inst.particles);
    env.down(600, 300); env.tick(2);
    ok('effects still fire after reallocation',
      inst.stats().particles > 0 || inst.stats().arcs > 0);
    env.up(600, 300);

    inst.configure({ enabled: false });
    ok('enabled:false stops the loop', inst.running === false);
    ok('canvas hidden', inst.canvas.style.display === 'none');
    inst.configure({ enabled: true });
    ok('enabled:true restarts', inst.running === true);
    ok('canvas shown again', inst.canvas.style.display !== 'none');

    eq('config churn produced no bad coords', env.state.nonFinite, 0);
    ThorCursor.destroy();
    env.restore();
  }

  /* ---- API surface ---- */
  section('API surface');
  {
    const env = makeEnv();
    const { ThorCursor, ThorCursorInstance } = await load();
    ok('ThorCursorInstance exported', typeof ThorCursorInstance === 'function');
    const inst = ThorCursor.init();
    for (const m of ['init', 'create', 'configure', 'start', 'stop', 'toggle',
      'strike', 'clear', 'stats', 'destroy']) {
      ok(`ThorCursor.${m} is callable`, typeof ThorCursor[m] === 'function');
    }
    ok('ThorCursor.supported is a boolean', typeof ThorCursor.supported === 'boolean');
    ok('instance getter works', ThorCursor.instance === inst);

    // Programmatic strike.
    env.move(300, 300); env.tick(1);
    ThorCursor.strike(300, 300);
    env.tick(1);
    ok('programmatic strike fires', inst.stats().arcs > 0);

    ThorCursor.clear();
    eq('clear() empties arcs', inst.stats().arcs, 0);
    eq('clear() empties particles', inst.stats().particles, 0);

    ThorCursor.toggle();
    ok('toggle stops', inst.running === false);
    ThorCursor.toggle();
    ok('toggle starts', inst.running === true);

    // Independent instances.
    const other = ThorCursor.create({ hammerSize: 20 });
    ok('create() makes a separate instance', other !== inst);
    eq('two canvases now',
      env.window.document.querySelectorAll('canvas[data-thor-cursor]').length, 2);
    other.destroy();

    // Double destroy / post-destroy calls must not throw.
    ThorCursor.destroy();
    ThorCursor.destroy();
    ok('double destroy is safe', true);
    ok('post-destroy statics are safe',
      ThorCursor.stop() === undefined || true);
    env.restore();
  }

  /* ---- resize / dpr ---- */
  section('resize and dpr');
  {
    const env = makeEnv({ dpr: 1 });
    const { ThorCursor } = await load();
    const inst = ThorCursor.init();
    eq('dpr 1 backing store', inst.canvas.width, 1280);

    Object.defineProperty(env.window, 'innerWidth', { value: 640, writable: true, configurable: true });
    Object.defineProperty(env.window, 'innerHeight', { value: 480, writable: true, configurable: true });
    env.window.dispatchEvent(new env.window.Event('resize'));
    eq('resized width', inst.canvas.width, 640);
    eq('resized height', inst.canvas.height, 480);

    // dpr change (e.g. moved to a retina monitor) must rebuild the sprite.
    const spriteBefore = inst.hammer.sprite;
    Object.defineProperty(env.window, 'devicePixelRatio', { value: 3, writable: true, configurable: true });
    env.window.dispatchEvent(new env.window.Event('resize'));
    ok('dpr clamped by maxDpr', inst._dpr === 2, `dpr=${inst._dpr}`);
    ok('sprite rebuilt on dpr change', inst.hammer.sprite !== spriteBefore);

    env.tick(3);
    eq('renders fine after resize', env.state.nonFinite, 0);
    ThorCursor.destroy();
    env.restore();
  }

  /* ---- hover detection ---- */
  section('hover interaction');
  {
    const env = makeEnv();
    const { ThorCursor } = await load();
    const inst = ThorCursor.init();
    const btn = env.window.document.getElementById('b');
    const input = env.window.document.getElementById('i');

    env.move(10, 10, { target: btn });
    ok('button flagged interactive', inst.pointer.overInteractive === true);

    env.advance(200);
    env.move(11, 11, { target: input });
    ok('input flagged as text', inst.pointer.overText === true);

    env.advance(200);
    env.move(12, 12, { target: env.window.document.body });
    ok('body not interactive', inst.pointer.overInteractive === false);

    // Glow should respond to hovering something clickable.
    env.advance(200);
    env.move(13, 13, { target: btn });
    env.tick(20);
    ok('hover raises the glow', inst._hoverPulse > 0.3, `pulse=${inst._hoverPulse}`);

    ThorCursor.destroy();
    env.restore();
  }

  /* ---- pointer edge cases ---- */
  section('pointer edge cases');
  {
    const env = makeEnv();
    const { ThorCursor } = await load();
    const inst = ThorCursor.init();

    // Touch input on a hybrid device must not trigger impacts.
    env.window.dispatchEvent(env.event('pointerdown', {
      clientX: 5, clientY: 5, button: 0, pointerType: 'touch',
    }));
    env.tick(1);
    eq('touch pointerdown ignored', inst.stats().arcs, 0);

    // Leaving the window clears the pressed state so no stuck drag.
    env.down(100, 100);
    ok('down registered', inst.pointer.down === true);
    env.window.document.dispatchEvent(
      env.event('mouseleave', { relatedTarget: null }));
    ok('mouseleave clears press', inst.pointer.down === false);
    ok('mouseleave marks outside', inst.pointer.inside === false);

    // Blur (alt-tab mid-drag) also releases.
    env.down(100, 100);
    env.window.dispatchEvent(new env.window.Event('blur'));
    ok('blur clears press', inst.pointer.down === false);
    ok('blur clears dragging', inst.pointer.dragging === false);

    // pointerup with no preceding down must not throw.
    env.up(1, 1);
    ok('stray pointerup is safe', true);

    ThorCursor.destroy();
    env.restore();
  }

  /* ---- visibility ---- */
  section('tab visibility');
  {
    const env = makeEnv();
    const { ThorCursor } = await load();
    const inst = ThorCursor.init();
    env.tick(2);

    Object.defineProperty(env.window.document, 'hidden', {
      value: true, writable: true, configurable: true,
    });
    env.window.document.dispatchEvent(new env.window.Event('visibilitychange'));
    env.tick(2);
    eq('loop parked while hidden', env.pending, 0);

    Object.defineProperty(env.window.document, 'hidden', {
      value: false, writable: true, configurable: true,
    });
    env.window.document.dispatchEvent(new env.window.Event('visibilitychange'));
    ok('loop resumes when visible', env.pending > 0);
    env.tick(2);
    eq('no bad coords after resume', env.state.nonFinite, 0);

    ThorCursor.destroy();
    env.restore();
  }

  /* ---- lightning geometry ---- */
  section('lightning geometry');
  {
    const mod = await import('file:///' + path.join(ROOT, 'src', 'lightning.js').replace(/\\/g, '/'));
    const pts = [];
    mod.generateBolt(pts, 0, 0, 100, 0, 4, 20);
    eq('2^detail+1 points', pts.length / 2, 17);
    ok('endpoints preserved',
      pts[0] === 0 && pts[1] === 0 &&
      pts[pts.length - 2] === 100 && pts[pts.length - 1] === 0);
    ok('all finite', pts.every(Number.isFinite));

    // The path must actually deviate — a straight line would look like a laser.
    const maxDev = Math.max(...pts.filter((_, i) => i % 2 === 1).map(Math.abs));
    ok('path is jagged', maxDev > 1, `maxDev=${maxDev}`);

    // Degenerate input (zero-length bolt) must not produce NaN.
    const z = [];
    mod.generateBolt(z, 50, 50, 50, 50, 4, 10);
    ok('zero-length bolt is finite', z.every(Number.isFinite));

    // Arc reuse must not leak arrays.
    const arc = new mod.Arc();
    for (let i = 0; i < 200; i++) {
      arc.reset(0, 0, 100, 100, { branches: (i % 3) });
    }
    ok('branch array does not grow unbounded', arc.branches.length <= 2,
      `len=${arc.branches.length}`);
    ok('reset revives the arc', arc.alive === true);
  }

  /* ---- dist bundle ---- */
  section('dist bundle');
  {
    const env = makeEnv();
    const fs = await import('node:fs');
    const code = fs.readFileSync(path.join(ROOT, 'dist', 'thor-cursor.js'), 'utf8');
    ok('bundle is substantial', code.length > 20000, `${code.length} bytes`);
    ok('no leftover import statements', !/^\s*import\s+.*from/m.test(code));
    ok('no leftover export statements', !/^\s*export\s+/m.test(code));
    ok('has UMD wrapper', code.includes('define.amd'));
    ok('has licence banner', code.includes('@license'));
    ok('disclaims Marvel affiliation', code.includes('Not affiliated'));

    // Execute the UMD bundle in the JSDOM window and drive it.
    const fn = new Function('window', 'document', 'self', 'performance',
      'requestAnimationFrame', 'cancelAnimationFrame', 'navigator',
      code + '\n;return (typeof self !== "undefined" ? self : this).ThorCursor;');
    const api = fn(env.window, env.window.document, env.window,
      env.window.performance, env.window.requestAnimationFrame,
      env.window.cancelAnimationFrame, env.window.navigator);
    ok('UMD exposes ThorCursor', typeof api === 'object' && typeof api.init === 'function');

    const inst = api.init({ intensity: 1.5 });
    ok('bundled init works', !!inst && !!inst.canvas);
    env.move(400, 400); env.tick(1);
    env.down(400, 400); env.tick(2);
    ok('bundled impact works', inst.stats().arcs > 0);
    env.up(400, 400);
    env.tick(60, 16);
    eq('bundled effects expire', inst.stats().arcs, 0);
    eq('bundle produced no bad coords', env.state.nonFinite, 0);
    api.destroy();

    const min = fs.readFileSync(path.join(ROOT, 'dist', 'thor-cursor.min.js'), 'utf8');
    ok('min is smaller than dev', min.length < code.length,
      `${min.length} vs ${code.length}`);
    // The minified file must still be valid, runnable JS.
    const minFn = new Function('window', 'document', 'self', 'performance',
      'requestAnimationFrame', 'cancelAnimationFrame', 'navigator',
      min + '\n;return (typeof self !== "undefined" ? self : this).ThorCursor;');
    const minApi = minFn(env.window, env.window.document, env.window,
      env.window.performance, env.window.requestAnimationFrame,
      env.window.cancelAnimationFrame, env.window.navigator);
    ok('minified bundle runs', typeof minApi.init === 'function');
    const mi = minApi.init();
    env.move(200, 200); env.tick(2);
    ok('minified cursor renders', !!mi.canvas);
    minApi.destroy();

    const esm = fs.readFileSync(path.join(ROOT, 'dist', 'thor-cursor.esm.js'), 'utf8');
    ok('esm build has exports', /export\s*\{/.test(esm));
    ok('esm build has no imports', !/^\s*import\s+.*from/m.test(esm));

    env.restore();
  }

  /* ---- results ---- */
  section('');
  if (errors.length) {
    console.log(`\nUncaught errors during run: ${errors.length}`);
    for (const e of errors.slice(0, 5)) console.log('  ' + e.message);
    fail += errors.length;
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log('  - ' + f);
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('\nTest harness crashed:');
  console.error(e);
  process.exit(1);
});
