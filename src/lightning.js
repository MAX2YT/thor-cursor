/**
 * Lightning generator.
 *
 * Bolts are produced by midpoint displacement: start from a straight segment
 * and recursively jitter the midpoint perpendicular to the segment, halving
 * the displacement each level. That yields the self-similar, jagged look real
 * lightning has — a plain random walk looks like scribble, and a smooth curve
 * looks like a neon tube.
 *
 * Branches fork off at random interior points and are drawn thinner and
 * shorter-lived, which is what gives a bolt its "tree" silhouette.
 *
 * Points are stored flat (x0,y0,x1,y1,...) to keep allocation down; bolts
 * themselves are pooled by the arc system that owns them.
 */

const TAU = Math.PI * 2;

/**
 * Midpoint-displacement polyline from (x1,y1) to (x2,y2).
 * @param {number[]} out flat array to fill (cleared first)
 * @param {number} detail recursion depth — 2^detail segments
 * @param {number} offset initial perpendicular displacement in px
 */
export function generateBolt(out, x1, y1, x2, y2, detail = 4, offset = 18) {
  out.length = 0;
  out.push(x1, y1, x2, y2);

  let disp = offset;
  for (let level = 0; level < detail; level++) {
    // Walk the current polyline back-to-front, inserting a displaced midpoint
    // into each segment. Iterating backwards keeps earlier indices valid.
    for (let i = out.length - 2; i >= 2; i -= 2) {
      const ax = out[i - 2], ay = out[i - 1];
      const bx = out[i], by = out[i + 1];

      const mx = (ax + bx) * 0.5;
      const my = (ay + by) * 0.5;

      let nx = -(by - ay);
      let ny = bx - ax;
      const len = Math.hypot(nx, ny) || 1;
      nx /= len; ny /= len;

      const d = (Math.random() - 0.5) * 2 * disp;
      out.splice(i, 0, mx + nx * d, my + ny * d);
    }
    disp *= 0.55;
  }
  return out;
}

/**
 * A single arc: a main bolt plus optional branches, with its own lifetime.
 * Reused via `reset()` so no per-arc garbage is produced in the hot path.
 */
export class Arc {
  constructor() {
    this.pts = [];
    this.branches = [];   // array of flat point arrays
    this.life = 0;
    this.maxLife = 1;
    this.width = 1.4;
    this.alive = false;
    this.tint = 0;        // 0 = primary colour, 1 = accent
    this.flicker = 0;
  }

  reset(x1, y1, x2, y2, opts = {}) {
    const detail = opts.detail ?? 4;
    const offset = opts.offset ?? 18;

    generateBolt(this.pts, x1, y1, x2, y2, detail, offset);

    // --- branches ---------------------------------------------------------
    const want = opts.branches ?? 2;
    // Recycle branch arrays rather than reallocating.
    while (this.branches.length < want) this.branches.push([]);
    this.branches.length = want;

    const n = this.pts.length / 2;
    for (let b = 0; b < want; b++) {
      // Fork from somewhere in the middle 70% of the bolt.
      const idx = 1 + Math.floor(Math.random() * Math.max(1, n - 2));
      const bx = this.pts[idx * 2];
      const by = this.pts[idx * 2 + 1];

      // Branch direction: main heading rotated by a wide-ish random angle.
      const heading = Math.atan2(y2 - y1, x2 - x1);
      const spread = (Math.random() - 0.5) * 1.7;
      // Cap branch length in absolute terms as well as proportionally, so a
      // long main bolt cannot spawn branches that double its footprint.
      const mainLen = Math.hypot(x2 - x1, y2 - y1);
      const blen = Math.min(52, (0.22 + Math.random() * 0.34) * mainLen);
      const ex = bx + Math.cos(heading + spread) * blen;
      const ey = by + Math.sin(heading + spread) * blen;

      generateBolt(this.branches[b], bx, by, ex, ey,
        Math.max(1, detail - 2), offset * 0.5);
    }

    this.maxLife = opts.life ?? 0.22;
    this.life = this.maxLife;
    this.width = opts.width ?? 1.5;
    // Accent tint is rare on purpose: at higher rates consecutive arcs
    // land the same colour and the trail reads as two ribbons.
    this.tint = opts.tint ?? (Math.random() < 0.07 ? 1 : 0);
    this.flicker = Math.random() * TAU;
    this.alive = true;
    return this;
  }

  /** @param {number} dtSec seconds since last frame */
  update(dtSec) {
    this.life -= dtSec;
    if (this.life <= 0) this.alive = false;
  }

  /** 0..1 remaining life. */
  get t() { return this.life / this.maxLife; }
}

/**
 * Radial burst of arcs from a point — used for click impacts and for the
 * little sparks that fire off the hammer at speed.
 */
export function radialTargets(cx, cy, count, minR, maxR, baseAngle = null) {
  const out = [];
  const jitter = TAU / count;
  for (let i = 0; i < count; i++) {
    const a = (baseAngle ?? Math.random() * TAU) +
      (i / count) * TAU + (Math.random() - 0.5) * jitter;
    const r = minR + Math.random() * (maxR - minR);
    out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return out;
}
