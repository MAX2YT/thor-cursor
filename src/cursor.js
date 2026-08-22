/**
 * ThorCursor — controller.
 *
 * Owns the overlay canvas, the animation loop and the public API. Everything
 * visual lives on one fixed, pointer-events:none canvas so the page underneath
 * stays fully interactive and we never touch the DOM per effect.
 */

import { resolveConfig, DEFAULTS } from './config.js';
import { PointerTracker } from './pointer.js';
import { HammerRenderer } from './hammer.js';
import { ParticleSystem } from './particles.js';
import { ArcPool, TrailSystem, ImpactSystem, drawArcs, drawParticles } from './effects.js';

const STYLE_ID = 'thor-cursor-style';

function isTouchOnly() {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const noHover = window.matchMedia && window.matchMedia('(hover: none)').matches;
  return !!(coarse && noHover);
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

export class ThorCursorInstance {
  constructor(options = {}) {
    this.cfg = resolveConfig(options);
    this.running = false;
    this.destroyed = false;
    this._raf = 0;
    this._last = 0;
    this._dpr = 1;
    this._visible = true;
    this._reduced = false;

    // Hammer render state, smoothed each frame.
    this._rot = 0;
    this._scale = 1;
    this._glow = 1;
    this._charge = 0;
    this._bob = 0;
    this._hoverPulse = 0;

    this._skipped = 0;      // consecutive over-budget frames
    this._degraded = false; // auto-reduced quality

    this.canvas = null;
    this.ctx = null;
  }

  /* ------------------------------------------------------------ lifecycle */

  init() {
    if (this.destroyed) return this;
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      // SSR (Next.js, Nuxt): no-op until called on the client.
      return this;
    }
    if (this.canvas) return this;

    if (this.cfg.disableOnTouch && isTouchOnly()) {
      this.supported = false;
      return this;
    }
    this.supported = true;

    this._reduced = this.cfg.respectReducedMotion && prefersReducedMotion();

    this._buildCanvas();

    this.pointer = new PointerTracker(this.cfg);
    this.hammer = new HammerRenderer(this.cfg);
    this.particles = new ParticleSystem(this.cfg);
    this.arcs = new ArcPool(this._reduced ? 20 : 72);
    this.trail = new TrailSystem(this.cfg, this.arcs, this.particles);
    this.impact = new ImpactSystem(this.cfg, this.arcs, this.particles);

    this._dpr = Math.min(window.devicePixelRatio || 1, this.cfg.maxDpr);
    this.hammer.build(this._dpr);
    this._resize();

    this.pointer.onDown((x, y) => {
      if (!this.cfg.enabled) return;
      // Under reduced motion, keep a minimal acknowledgement only.
      if (this._reduced) {
        this.impact.flashes.push({ x, y, life: 0.12, maxLife: 0.12, r: 26 });
        return;
      }
      this.impact.strike(x, y);
    });

    this.pointer.attach();

    this._onResize = () => this._resize();
    this._onVis = () => {
      this._visible = !document.hidden;
      if (this._visible && this.running) {
        this._last = performance.now();   // avoid a giant dt on resume
        this._schedule();
      }
    };

    window.addEventListener('resize', this._onResize, { passive: true });
    document.addEventListener('visibilitychange', this._onVis);

    // React to a monitor change / zoom, which alters devicePixelRatio.
    if (window.matchMedia) {
      this._dprQuery = window.matchMedia(`(resolution: ${this._dpr}dppx)`);
      this._onDpr = () => this._resize();
      if (this._dprQuery.addEventListener) {
        this._dprQuery.addEventListener('change', this._onDpr);
      }

      this._rmQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      this._onRm = () => {
        if (!this.cfg.respectReducedMotion) return;
        this._reduced = this._rmQuery.matches;
        this.clear();
      };
      if (this._rmQuery.addEventListener) {
        this._rmQuery.addEventListener('change', this._onRm);
      }
    }

    this._applyCursorHiding();
    if (this.cfg.enabled) this.start();
    return this;
  }

  _buildCanvas() {
    const cfg = this.cfg;
    const c = document.createElement('canvas');
    c.setAttribute('aria-hidden', 'true');
    c.dataset.thorCursor = '';
    const s = c.style;
    s.position = 'fixed';
    s.top = '0';
    s.left = '0';
    s.width = '100%';
    s.height = '100%';
    s.pointerEvents = 'none';   // never intercept a click
    s.zIndex = String(cfg.zIndex);
    s.userSelect = 'none';
    // Keep it off the main document flow / out of scroll calculations.
    s.contain = 'strict';

    (cfg.container || document.body).appendChild(c);
    this.canvas = c;
    this.ctx = c.getContext('2d', { alpha: true, desynchronized: true });
  }

  /**
   * Hide the native cursor via a stylesheet rather than an inline style, so we
   * can cover `*` and still let inputs keep their caret.
   */
  _applyCursorHiding() {
    if (!this.cfg.hideNativeCursor) return;
    if (document.getElementById(STYLE_ID)) {
      this._styleShared = true;
      return;
    }
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent =
      'html.thor-cursor-active, html.thor-cursor-active * { cursor: none !important; }\n' +
      // Text fields keep their caret so typing stays usable.
      'html.thor-cursor-active input, html.thor-cursor-active textarea,\n' +
      'html.thor-cursor-active [contenteditable="true"] { cursor: auto !important; }\n';
    document.head.appendChild(st);
    this._style = st;
    document.documentElement.classList.add('thor-cursor-active');
  }

  _removeCursorHiding() {
    document.documentElement.classList.remove('thor-cursor-active');
    if (this._style && this._style.parentNode) {
      this._style.parentNode.removeChild(this._style);
    }
    this._style = null;
  }

  _resize() {
    if (!this.canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, this.cfg.maxDpr);
    const w = window.innerWidth;
    const h = window.innerHeight;

    const needSprite = dpr !== this._dpr;
    this._dpr = dpr;

    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    // Work in css pixels everywhere else.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (needSprite) this.hammer.build(dpr);
  }

  start() {
    if (!this.supported || this.destroyed || this.running) return this;
    this.running = true;
    this.cfg.enabled = true;
    if (this.canvas) this.canvas.style.display = '';
    this._applyCursorHiding();
    this._last = performance.now();
    this._schedule();
    return this;
  }

  stop() {
    this.running = false;
    this.cfg.enabled = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    this.clear();
    if (this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.canvas.style.display = 'none';
    }
    this._removeCursorHiding();
    return this;
  }

  toggle() {
    return this.running ? this.stop() : this.start();
  }

  /** Merge new options in at runtime. */
  configure(patch = {}) {
    const prevSize = this.cfg.hammerSize;
    const prevTrail = this.cfg.trailLength;
    const prevMax = this.cfg.maxParticles;

    this.cfg = resolveConfig(Object.assign({}, this.cfg, patch));

    // Rebuild anything whose geometry/capacity is baked in.
    if (this.hammer) {
      this.hammer.cfg = this.cfg;
      if (this.cfg.hammerSize !== prevSize || 'color' in patch ||
          'coreColor' in patch || 'glowIntensity' in patch) {
        this.hammer.build(this._dpr);
      }
    }
    if (this.trail) {
      this.trail.cfg = this.cfg;
      if (this.cfg.trailLength !== prevTrail) {
        this.trail = new TrailSystem(this.cfg, this.arcs, this.particles);
      }
    }
    if (this.particles) {
      this.particles.cfg = this.cfg;
      if (this.cfg.maxParticles !== prevMax) {
        this.particles = new ParticleSystem(this.cfg);
        this.trail.particles = this.particles;
        this.impact.particles = this.particles;
      }
    }
    if (this.impact) this.impact.cfg = this.cfg;
    if (this.pointer) this.pointer.cfg = this.cfg;
    if (this.canvas) this.canvas.style.zIndex = String(this.cfg.zIndex);

    if ('hideNativeCursor' in patch) {
      if (this.cfg.hideNativeCursor) this._applyCursorHiding();
      else this._removeCursorHiding();
    }
    if ('enabled' in patch) {
      if (this.cfg.enabled) this.start();
      else this.stop();
    }
    return this;
  }

  /** Trigger an impact programmatically. */
  strike(x, y) {
    if (!this.supported || !this.impact) return this;
    const px = x ?? this.pointer.px;
    const py = y ?? this.pointer.py;
    this.impact.strike(px, py);
    return this;
  }

  /** Drop all live effects without stopping the loop. */
  clear() {
    if (this.arcs) this.arcs.clear();
    if (this.particles) this.particles.clear();
    if (this.impact) this.impact.clear();
    if (this.trail) this.trail.reset();
    return this;
  }

  destroy() {
    this.stop();
    this.destroyed = true;
    if (this.pointer) this.pointer.destroy();
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVis);
    if (this._dprQuery && this._dprQuery.removeEventListener) {
      this._dprQuery.removeEventListener('change', this._onDpr);
    }
    if (this._rmQuery && this._rmQuery.removeEventListener) {
      this._rmQuery.removeEventListener('change', this._onRm);
    }
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    this.canvas = null;
    this.ctx = null;
    this.hammer = null;
    this.arcs = null;
    this.particles = null;
    this.trail = null;
    this.impact = null;
    this.pointer = null;
    return this;
  }

  /* ----------------------------------------------------------------- loop */

  _schedule() {
    this._raf = requestAnimationFrame(this._frame);
  }

  // Bound as a field-style arrow so rAF keeps `this` without a per-frame bind.
  _frame = (now) => {
    this._raf = 0;
    if (!this.running || this.destroyed) return;
    if (!this._visible) return;    // resumed by visibilitychange

    // Clamp dt: a background tab or a stall must not teleport the simulation.
    let dtMs = now - this._last;
    this._last = now;
    if (dtMs > 60) dtMs = 60;
    if (dtMs < 0) dtMs = 0;
    const dt = dtMs / 1000;
    const dtf = dtMs / 16.6667;   // frame-normalised

    this._update(dt, dtf);
    this._draw();

    this._schedule();
  };

  _update(dt, dtf) {
    const cfg = this.cfg;
    const p = this.pointer;

    p.update(dtf);

    const speed = p.speed;
    const norm = Math.min(1, speed / 24);

    if (!this._reduced) {
      this.trail.update(dt, p);
    }
    this.arcs.update(dt * cfg.animationSpeed);
    this.particles.update(dt * cfg.animationSpeed);
    this.impact.update(dt);

    // --- hammer pose -----------------------------------------------------
    // Lean into the direction of travel; the faster it goes, the more it
    // tilts, capped so it never spins.
    let targetRot = 0;
    if (speed > 0.4) {
      // Perpendicular lean: horizontal motion tips the head sideways.
      targetRot = Math.max(-0.62, Math.min(0.62, p.vx * 0.030)) *
        cfg.tiltStrength;
      // A touch of vertical influence so diagonal moves feel right.
      targetRot += Math.max(-0.18, Math.min(0.18, p.vy * 0.008)) *
        cfg.tiltStrength;
    }

    // Swing overrides the lean: rotate hard, then recoil back.
    const sw = this.impact.swing;
    if (sw !== 0) targetRot += sw * 0.95;

    this._rot += (targetRot - this._rot) * (1 - Math.pow(0.001, dtf * 0.18));

    // Idle bob.
    this._bob += dt * 2.4;
    const bobY = this._reduced ? 0
      : Math.sin(this._bob) * 1.6 * cfg.bobAmplitude * (1 - norm);

    // Scale: slight squash on the slam, plus hover pop.
    const hoverTarget = (cfg.hoverReact && p.overInteractive) ? 1 : 0;
    this._hoverPulse += (hoverTarget - this._hoverPulse) * Math.min(1, dtf * 0.2);

    const swScale = sw > 0 ? 1 + sw * 0.16 : 1 + sw * 0.05;
    const target = swScale * (1 + this._hoverPulse * 0.12);
    this._scale += (target - this._scale) * Math.min(1, dtf * 0.25);

    // Glow: brighter when moving fast, hovering something, or striking.
    const glowTarget = 0.55 + norm * 0.5 + this._hoverPulse * 0.5 +
      Math.abs(sw) * 0.6;
    this._glow += (glowTarget - this._glow) * Math.min(1, dtf * 0.16);

    const chargeTarget = (p.dragging ? 0.55 : 0) + norm * 0.3 +
      this._hoverPulse * 0.25;
    this._charge += (chargeTarget - this._charge) * Math.min(1, dtf * 0.15);

    this._renderY = p.py + bobY;

    // --- fast-move sparks ------------------------------------------------
    if (!this._reduced && cfg.particleDensity > 0 && speed > 14 &&
        Math.random() < 0.35 * cfg.particleDensity) {
      const a = p.angle + Math.PI + (Math.random() - 0.5) * 1.2;
      this.particles.spark(p.px, p.py, a, 60 + Math.random() * 120, {
        life: 0.12 + Math.random() * 0.2,
        size: 0.5 + Math.random() * 1.0,
        grav: 180,
      });
    }
  }

  _draw() {
    const g = this.ctx;
    const cfg = this.cfg;
    if (!g) return;

    // clearRect in css space — the transform already accounts for dpr.
    g.clearRect(0, 0, window.innerWidth, window.innerHeight);

    if (!this.pointer.inside) return;

    drawArcs(g, this.arcs, cfg);
    drawParticles(g, this.particles, cfg);
    this.impact.draw(g, cfg);

    // The hammer draws last so it sits on top of its own lightning.
    this.hammer.draw(g, {
      x: this.pointer.px,
      y: this._renderY,
      rot: this._rot,
      scale: this._scale,
      glow: this._glow,
      charge: this._charge,
    });
  }

  /** Live counters, handy for the demo's debug readout. */
  stats() {
    return {
      particles: this.particles ? this.particles.length : 0,
      arcs: this.arcs ? this.arcs.liveCount : 0,
      reduced: this._reduced,
      dpr: this._dpr,
    };
  }
}

/* ------------------------------------------------------------ public API */

let singleton = null;

export const ThorCursor = {
  /** Defaults, exposed for reference. */
  defaults: DEFAULTS,

  /**
   * Initialise (or reconfigure) the shared cursor instance.
   * Safe to call during SSR — it no-ops without a DOM.
   */
  init(options = {}) {
    if (typeof window === 'undefined') return null;
    if (singleton && !singleton.destroyed) {
      singleton.configure(options);
      return singleton;
    }
    singleton = new ThorCursorInstance(options);
    singleton.init();
    return singleton;
  },

  /** Create an independent instance (rare; the singleton usually suffices). */
  create(options = {}) {
    const inst = new ThorCursorInstance(options);
    inst.init();
    return inst;
  },

  get instance() { return singleton; },

  configure(patch) { return singleton && singleton.configure(patch); },
  start() { return singleton && singleton.start(); },
  stop() { return singleton && singleton.stop(); },
  toggle() { return singleton && singleton.toggle(); },
  strike(x, y) { return singleton && singleton.strike(x, y); },
  clear() { return singleton && singleton.clear(); },
  stats() { return singleton ? singleton.stats() : null; },

  destroy() {
    if (singleton) singleton.destroy();
    singleton = null;
  },

  /** True when the environment supports the cursor (not touch-only). */
  get supported() {
    if (typeof window === 'undefined') return false;
    return !isTouchOnly();
  },
};

export default ThorCursor;
