/**
 * Particle system — sparks, embers and shockwave rings.
 *
 * Implemented as a fixed-capacity struct-of-arrays pool. Particles are never
 * allocated or garbage collected after warm-up: `spawn` claims a dead slot,
 * `update` compacts by swapping the last live particle into a dead slot. That
 * keeps the update loop cache-friendly and produces zero GC pressure, which is
 * what actually matters for holding 60fps on a laptop.
 */

const SPARK = 0;
const EMBER = 1;

export class ParticleSystem {
  constructor(cfg) {
    this.cfg = cfg;
    const cap = cfg.maxParticles;
    this.cap = cap;
    this.count = 0;

    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    this.size = new Float32Array(cap);
    this.kind = new Uint8Array(cap);
    this.tint = new Float32Array(cap);   // 0 = core/blue, 1 = accent
    this.drag = new Float32Array(cap);
    this.grav = new Float32Array(cap);

    // Rings are few and short-lived; a small object array is fine here.
    this.rings = [];
  }

  get length() { return this.count; }

  /** Claim a slot. Returns -1 when the pool is saturated. */
  _claim() {
    if (this.count >= this.cap) return -1;
    return this.count++;
  }

  /**
   * Emit a spark.
   * @param {number} speed initial px/sec
   */
  spark(x, y, angle, speed, opts = {}) {
    const i = this._claim();
    if (i < 0) return;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = Math.cos(angle) * speed;
    this.vy[i] = Math.sin(angle) * speed;
    const l = opts.life ?? (0.18 + Math.random() * 0.28);
    this.life[i] = l;
    this.maxLife[i] = l;
    this.size[i] = opts.size ?? (0.7 + Math.random() * 1.5);
    this.kind[i] = opts.ember ? EMBER : SPARK;
    this.tint[i] = opts.tint ?? (Math.random() < 0.25 ? 1 : 0);
    this.drag[i] = opts.drag ?? 0.86;
    this.grav[i] = opts.grav ?? 320;
  }

  /** Fan of sparks around a point. */
  burst(x, y, n, opts = {}) {
    const spd = opts.speed ?? 260;
    const spread = opts.spread ?? Math.PI * 2;
    const base = opts.angle ?? Math.random() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const a = base + (Math.random() - 0.5) * spread;
      this.spark(x, y, a, spd * (0.35 + Math.random() * 0.9), opts);
    }
  }

  ring(x, y, opts = {}) {
    if (this.rings.length > 12) this.rings.shift();
    this.rings.push({
      x, y,
      r: opts.r0 ?? 4,
      maxR: opts.maxR ?? 90,
      life: opts.life ?? 0.42,
      maxLife: opts.life ?? 0.42,
      width: opts.width ?? 2.6,
    });
  }

  update(dtSec) {
    const dt = dtSec;
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // Swap-remove: move the last live particle into this slot.
        const last = --this.count;
        if (i !== last) {
          this.x[i] = this.x[last];
          this.y[i] = this.y[last];
          this.vx[i] = this.vx[last];
          this.vy[i] = this.vy[last];
          this.life[i] = this.life[last];
          this.maxLife[i] = this.maxLife[last];
          this.size[i] = this.size[last];
          this.kind[i] = this.kind[last];
          this.tint[i] = this.tint[last];
          this.drag[i] = this.drag[last];
          this.grav[i] = this.grav[last];
        }
        continue; // re-test the swapped-in particle at this index
      }

      // Exponential drag, frame-rate independent.
      const d = Math.pow(this.drag[i], dt * 60);
      this.vx[i] *= d;
      this.vy[i] *= d;
      this.vy[i] += this.grav[i] * dt;

      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      i++;
    }

    for (let r = this.rings.length - 1; r >= 0; r--) {
      const ring = this.rings[r];
      ring.life -= dt;
      if (ring.life <= 0) { this.rings.splice(r, 1); continue; }
      const p = 1 - ring.life / ring.maxLife;
      // Ease-out so the ring snaps outward then settles.
      ring.r = ring.maxR * (1 - Math.pow(1 - p, 2.4));
    }
  }

  clear() {
    this.count = 0;
    this.rings.length = 0;
  }
}

export { SPARK, EMBER };
