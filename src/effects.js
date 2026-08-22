/**
 * Effects: the arc pool, the drag trail, and the click impact.
 *
 * All lightning is drawn in two passes — a wide, low-alpha "glow" stroke in
 * the theme colour, then a thin white-hot core stroke on top, both under
 * `lighter` compositing. That layering is what separates real-looking
 * electricity from a flat neon line, and it costs two strokes instead of a
 * blur filter.
 */

import { Arc, radialTargets } from './lightning.js';
import { rgba } from './config.js';

/* ------------------------------------------------------------------ arcs */

/**
 * Fixed-capacity pool of `Arc` objects. Dead arcs are reused in place, so a
 * long session never grows the heap.
 */
export class ArcPool {
  constructor(cap = 64) {
    this.items = [];
    this.cap = cap;
    for (let i = 0; i < cap; i++) this.items.push(new Arc());
  }

  /** Grab a dead arc, or the shortest-lived live one if all are busy. */
  acquire() {
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      if (!items[i].alive) return items[i];
    }
    let best = items[0];
    for (let i = 1; i < items.length; i++) {
      if (items[i].life < best.life) best = items[i];
    }
    return best;
  }

  update(dt) {
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].alive) this.items[i].update(dt);
    }
  }

  clear() {
    for (const a of this.items) a.alive = false;
  }

  get liveCount() {
    let n = 0;
    for (const a of this.items) if (a.alive) n++;
    return n;
  }
}

/** Stroke one flat point array. */
function strokePath(g, pts) {
  if (pts.length < 4) return;
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.stroke();
}

/**
 * Draw every live arc in the pool.
 * Two passes over the whole set (all glows, then all cores) so the context
 * state changes twice rather than twice per arc.
 */
export function drawArcs(g, pool, cfg) {
  const items = pool.items;
  const gi = cfg.glow ? cfg.glowIntensity : 0;

  g.save();
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  g.lineJoin = 'round';

  // --- pass 1: coloured glow ---
  if (gi > 0) {
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      if (!a.alive) continue;
      const t = a.t;
      // Flicker keeps arcs from fading in a visibly linear ramp.
      const flick = 0.75 + 0.25 * Math.sin(a.flicker + t * 22);
      const col = a.tint ? cfg._accent : cfg._rgb;
      g.strokeStyle = rgba(col, 0.30 * t * flick * gi);
      g.lineWidth = a.width * 5.5;
      strokePath(g, a.pts);
      g.strokeStyle = rgba(col, 0.55 * t * flick);
      g.lineWidth = a.width * 2.4;
      strokePath(g, a.pts);
      for (let b = 0; b < a.branches.length; b++) {
        g.lineWidth = a.width * 1.5;
        strokePath(g, a.branches[b]);
      }
    }
  }

  // --- pass 2: white-hot core ---
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    if (!a.alive) continue;
    const t = a.t;
    const flick = 0.7 + 0.3 * Math.sin(a.flicker + t * 30);
    g.strokeStyle = rgba(cfg._core, Math.min(1, 0.95 * t * flick));
    g.lineWidth = Math.max(0.6, a.width * 0.85);
    strokePath(g, a.pts);
    g.strokeStyle = rgba(cfg._core, Math.min(1, 0.6 * t * flick));
    g.lineWidth = Math.max(0.4, a.width * 0.5);
    for (let b = 0; b < a.branches.length; b++) {
      strokePath(g, a.branches[b]);
    }
  }

  g.restore();
}

/* ----------------------------------------------------------------- trail */

/**
 * Lightning trail.
 *
 * Keeps a ring buffer of recent pointer samples and, at an emission rate tied
 * to speed, spawns short arcs that hop between consecutive samples. Because
 * each arc is independently jittered and short-lived, the result is a
 * flickering chain of irregular arcs rather than one smooth stroke.
 */
export class TrailSystem {
  constructor(cfg, pool, particles) {
    this.cfg = cfg;
    this.pool = pool;
    this.particles = particles;

    this.cap = cfg.trailLength;
    this.sx = new Float32Array(this.cap);
    this.sy = new Float32Array(this.cap);
    this.n = 0;      // samples written
    this.head = 0;

    this._emitAcc = 0;
    this._sampleAcc = 0;
  }

  reset() {
    this.n = 0;
    this.head = 0;
    this._emitAcc = 0;
  }

  _push(x, y) {
    this.sx[this.head] = x;
    this.sy[this.head] = y;
    this.head = (this.head + 1) % this.cap;
    if (this.n < this.cap) this.n++;
  }

  /** Index into the ring, 0 = most recent. */
  _at(k) {
    const i = (this.head - 1 - k + this.cap * 2) % this.cap;
    return i;
  }

  /**
   * @param {number} dt seconds
   * @param {object} p pointer tracker
   */
  update(dt, p) {
    const cfg = this.cfg;
    if (!cfg.trail) return;

    // Sample at a fixed cadence so the trail's spatial density tracks speed
    // rather than frame rate.
    this._sampleAcc += dt;
    if (this._sampleAcc >= 1 / 90) {
      this._sampleAcc = 0;
      this._push(p.px, p.py);
    }
    if (this.n < 2) return;

    const speed = p.speed;              // px per 60fps-frame
    const dragging = p.dragging;

    // Below this, only the occasional idle spark — no arcs.
    if (!dragging && speed < 1.2) {
      this._emitAcc = 0;
      if (Math.random() < 0.02 * cfg.particleDensity) {
        this._idleSpark(p);
      }
      return;
    }

    // Emission rate: dragging is dramatic and continuous; plain movement
    // scales up from almost nothing.
    const norm = Math.min(1, speed / 26);
    const rate = dragging
      ? (26 + norm * 44) * cfg.intensity
      : (norm * norm * 30) * cfg.intensity;

    this._emitAcc += rate * dt;
    let budget = Math.min(4, Math.floor(this._emitAcc));
    this._emitAcc -= budget;

    while (budget-- > 0) {
      // Span a couple of samples back so arcs bridge real distance.
      const span = 1 + Math.floor(Math.random() * Math.min(3, this.n - 1));
      const i0 = this._at(0);
      const i1 = this._at(span);
      const x1 = this.sx[i0], y1 = this.sy[i0];
      const x2 = this.sx[i1], y2 = this.sy[i1];

      const dist = Math.hypot(x2 - x1, y2 - y1);
      if (dist < 2) continue;

      const arc = this.pool.acquire();
      arc.reset(x1, y1, x2, y2, {
        detail: dist > 60 ? 4 : 3,
        offset: Math.min(26, 4 + dist * 0.28) * (dragging ? 1.25 : 0.85),
        branches: dragging
          ? (Math.random() < 0.55 ? 2 : 1)
          : (Math.random() < 0.3 ? 1 : 0),
        life: (dragging ? 0.14 : 0.10) + Math.random() * 0.10,
        width: (dragging ? 1.5 : 1.05) * (0.8 + norm * 0.5),
      });
      arc.maxLife /= cfg.animationSpeed;
      arc.life = arc.maxLife;

      // Sparks shed off the arc's midpoint.
      const pd = cfg.particleDensity;
      if (pd > 0 && Math.random() < (dragging ? 0.5 : 0.25) * pd) {
        const a = Math.random() * Math.PI * 2;
        this.particles.spark(x1, y1, a, 40 + Math.random() * 150 * norm, {
          life: 0.14 + Math.random() * 0.22,
          size: 0.6 + Math.random() * 1.1,
          grav: 200,
        });
      }
    }
  }

  _idleSpark(p) {
    const a = Math.random() * Math.PI * 2;
    const r = this.cfg.hammerSize * 0.4;
    this.particles.spark(
      p.px + Math.cos(a) * r, p.py + Math.sin(a) * r,
      a, 10 + Math.random() * 30,
      { life: 0.2 + Math.random() * 0.25, size: 0.5 + Math.random() * 0.7, grav: 60 },
    );
  }
}

/* ---------------------------------------------------------------- impact */

/**
 * Click impact.
 *
 * Owns the flash and the swing/recoil timeline; the arcs and sparks it spawns
 * are handed to the shared pool and particle system so they decay with
 * everything else. `flashes` is a tiny array — impacts are rare enough that
 * object churn here is irrelevant.
 */
export class ImpactSystem {
  constructor(cfg, pool, particles) {
    this.cfg = cfg;
    this.pool = pool;
    this.particles = particles;
    this.flashes = [];
    /** Swing animation progress, 0 = idle. Read by the cursor controller. */
    this.swing = 0;
    this._swingT = 0;
    this._swinging = false;
  }

  /** Fire an impact at (x, y). */
  strike(x, y) {
    const cfg = this.cfg;
    if (!cfg.clickEffect) return;

    const k = cfg.clickStrength;
    const inten = cfg.intensity;

    this._swinging = true;
    this._swingT = 0;

    // Core flash.
    this.flashes.push({
      x, y,
      life: 0.18 / cfg.animationSpeed,
      maxLife: 0.18 / cfg.animationSpeed,
      r: (34 + 14 * Math.sqrt(k)) * (0.9 + Math.min(inten, 2) * 0.2),
    });

    // Ground-level shockwave.
    this.particles.ring(x, y, {
      r0: 6,
      maxR: (56 + 26 * Math.sqrt(k)) * (0.92 + Math.min(inten, 2) * 0.16),
      life: 0.4 / cfg.animationSpeed,
      width: 2.4 + k,
    });
    // Second, faster, tighter ring for a bit of depth.
    this.particles.ring(x, y, {
      r0: 3,
      maxR: 30 + 16 * Math.sqrt(k),
      life: 0.26 / cfg.animationSpeed,
      width: 1.4,
    });

    // Radiating bolts. Count is deliberately modest — legibility beats spam,
    // and the branches already read as many more strands than this.
    // Radius is deliberately restrained: an impact should read as a strike on
    // the page, not take over the viewport. Growth is sub-linear in strength
    // so even clickStrength 4 stays local.
    const n = Math.max(3, Math.round((5 + 2 * k) * Math.min(inten, 2)));
    const reach = Math.sqrt(k);
    const t = radialTargets(x, y, n, 24 + 16 * reach, 52 + 42 * reach);
    for (let i = 0; i < t.length; i += 2) {
      const arc = this.pool.acquire();
      arc.reset(x, y, t[i], t[i + 1], {
        detail: 4,
        offset: 14 + Math.random() * 12,
        branches: Math.random() < 0.7 ? 2 : 1,
        life: (0.16 + Math.random() * 0.16) / cfg.animationSpeed,
        width: 1.7 + Math.random() * 0.9,
      });
    }

    // Spark burst, biased upward so it reads as debris kicked off the ground.
    const pd = cfg.particleDensity;
    const sparks = Math.round(16 * k * pd * inten);
    for (let i = 0; i < sparks; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.7;
      this.particles.spark(x, y, a, 110 + Math.random() * 190 * Math.sqrt(k), {
        life: 0.2 + Math.random() * 0.34,
        size: 0.7 + Math.random() * 1.6,
        grav: 420,
        drag: 0.9,
      });
    }
    // A few slower embers that linger a touch longer.
    const embers = Math.round(5 * k * pd);
    for (let i = 0; i < embers; i++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.spark(x, y, a, 30 + Math.random() * 90, {
        life: 0.34 + Math.random() * 0.3,
        size: 0.5 + Math.random() * 0.9,
        grav: 120,
        ember: true,
      });
    }
  }

  update(dt) {
    // Swing timeline: fast slam, slower recoil. ~0.34s total at speed 1.
    if (this._swinging) {
      this._swingT += dt * this.cfg.animationSpeed;
      const T = 0.34;
      if (this._swingT >= T) {
        this._swinging = false;
        this.swing = 0;
      } else {
        const p = this._swingT / T;
        // 0 -> 1 in the first 25% (the slam), then eased back with a small
        // overshoot past neutral (the recoil).
        this.swing = p < 0.25
          ? Math.pow(p / 0.25, 0.6)
          : -0.42 * Math.sin((p - 0.25) / 0.75 * Math.PI) +
            (1 - (p - 0.25) / 0.75) * 0.42;
      }
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      if (f.life <= 0) this.flashes.splice(i, 1);
    }
  }

  draw(g, cfg) {
    if (!this.flashes.length) return;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const f of this.flashes) {
      const t = f.life / f.maxLife;
      // Expand slightly while fading — a static circle reads as a dot.
      const r = f.r * (1.25 - t * 0.35);
      const grad = g.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      grad.addColorStop(0, rgba(cfg._core, 0.95 * t));
      grad.addColorStop(0.18, rgba(cfg._core, 0.7 * t));
      grad.addColorStop(0.45, rgba(cfg._rgb, 0.45 * t));
      grad.addColorStop(1, rgba(cfg._rgb, 0));
      g.fillStyle = grad;
      g.beginPath();
      g.arc(f.x, f.y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  clear() {
    this.flashes.length = 0;
    this.swing = 0;
    this._swinging = false;
  }
}

/** Draw sparks and shockwave rings. */
export function drawParticles(g, ps, cfg) {
  const n = ps.count;
  g.save();
  g.globalCompositeOperation = 'lighter';

  for (let i = 0; i < n; i++) {
    const t = ps.life[i] / ps.maxLife[i];
    const col = ps.tint[i] ? cfg._accent : cfg._rgb;
    const s = ps.size[i] * (0.4 + t * 0.6);

    // Streak the spark along its velocity — a dot at speed looks like noise,
    // a short streak reads as a spark.
    const vx = ps.vx[i], vy = ps.vy[i];
    const sp = Math.hypot(vx, vy);
    if (sp > 60) {
      const k = Math.min(9, sp * 0.022) / sp;
      g.strokeStyle = rgba(col, 0.5 * t);
      g.lineWidth = s * 1.7;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(ps.x[i], ps.y[i]);
      g.lineTo(ps.x[i] - vx * k, ps.y[i] - vy * k);
      g.stroke();
    }

    if (cfg.glow) {
      g.fillStyle = rgba(col, 0.30 * t * cfg.glowIntensity);
      g.beginPath();
      g.arc(ps.x[i], ps.y[i], s * 2.6, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = rgba(cfg._core, Math.min(1, 0.9 * t));
    g.beginPath();
    g.arc(ps.x[i], ps.y[i], s * 0.8, 0, Math.PI * 2);
    g.fill();
  }

  for (const ring of ps.rings) {
    const t = ring.life / ring.maxLife;
    g.strokeStyle = rgba(cfg._rgb, 0.42 * t * (cfg.glow ? cfg.glowIntensity : 1));
    g.lineWidth = ring.width * t;
    g.beginPath();
    g.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = rgba(cfg._core, 0.4 * t * t);
    g.lineWidth = Math.max(0.5, ring.width * t * 0.4);
    g.beginPath();
    g.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
    g.stroke();
  }

  g.restore();
}
