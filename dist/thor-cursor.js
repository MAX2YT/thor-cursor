/*!
 * thor-cursor v1.0.0
 * A premium cinematic Mjolnir-inspired lightning cursor for modern websites. Framework-independent, canvas-based, zero dependencies.
 * 
 * @license MIT
 *
 * An original Mjolnir-inspired design. Not affiliated with, endorsed by, or
 * derived from any Marvel or Disney property.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    var api = factory();
    root.ThorCursor = api.ThorCursor;
    root.ThorCursorInstance = api.ThorCursorInstance;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---- src/config.js ---- */
  /**
   * thor-cursor — configuration
   *
   * A single flat options object is exposed to consumers. Internally we keep
   * derived/normalised values on the same object so the hot loop never has to
   * branch on "did the user supply this?".
   */
  const DEFAULTS = {
    /* ---- master switches ---------------------------------------------- */
    enabled: true,
    trail: true,
    clickEffect: true,
    glow: true,
    hoverReact: true,
  
    /* ---- global scaling ------------------------------------------------ */
    intensity: 1,          // multiplies bolt count / spark count / flash size
    particleDensity: 1,    // multiplies spark emission only
    trailLength: 20,       // ~ number of retained path samples
    animationSpeed: 1,     // multiplies all decay rates
    clickStrength: 1,      // multiplies impact scale
  
    /* ---- hammer -------------------------------------------------------- */
    hammerSize: 34,        // px, long edge of the head
    followEase: 0.28,      // 0..1 — higher = tighter to the pointer
    tiltStrength: 1,       // how much velocity leans the hammer
    bobAmplitude: 1,       // idle float
  
    /* ---- colour -------------------------------------------------------- */
    color: '#7fd4ff',      // electric blue (arc body / glow)
    coreColor: '#ffffff',  // white-hot core
    accentColor: '#b98cff', // secondary arc tint, used sparingly
    glowIntensity: 1,
  
    /* ---- behaviour ----------------------------------------------------- */
    zIndex: 2147483000,
    hideNativeCursor: true,
    respectReducedMotion: true,
    disableOnTouch: true,
    maxParticles: 420,
    maxDpr: 2,
    interactiveSelector:
      'a, button, [role="button"], input, select, textarea, label, summary, ' +
      '[data-thor-interactive], .thor-interactive',
    /** Elements matching this keep the native caret/cursor visible. */
    nativeCursorSelector: 'input, textarea, [contenteditable="true"]',
    /** Root to attach the overlay to. */
    container: null,
  };
  
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  
  /** Parse `#rgb`, `#rrggbb`, `rgb()` / `rgba()` into `[r,g,b]`. */
  function parseColor(input, fallback = [255, 255, 255]) {
    if (Array.isArray(input)) return input.slice(0, 3);
    if (typeof input !== 'string') return fallback;
    const s = input.trim();
  
    if (s[0] === '#') {
      const hex = s.slice(1);
      if (hex.length === 3 || hex.length === 4) {
        return [
          parseInt(hex[0] + hex[0], 16),
          parseInt(hex[1] + hex[1], 16),
          parseInt(hex[2] + hex[2], 16),
        ];
      }
      if (hex.length === 6 || hex.length === 8) {
        return [
          parseInt(hex.slice(0, 2), 16),
          parseInt(hex.slice(2, 4), 16),
          parseInt(hex.slice(4, 6), 16),
        ];
      }
      return fallback;
    }
  
    const m = s.match(/-?\d*\.?\d+/g);
    if (m && m.length >= 3) return [+m[0], +m[1], +m[2]];
    return fallback;
  }
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  
  /**
   * Merge user options over the defaults and pre-compute the derived values the
   * renderers read every frame.
   */
  function resolveConfig(user = {}) {
    const cfg = Object.assign({}, DEFAULTS, user);
  
    cfg.intensity = clamp(+cfg.intensity || 0, 0, 4);
    cfg.particleDensity = clamp(+cfg.particleDensity || 0, 0, 4);
    cfg.glowIntensity = clamp(+cfg.glowIntensity || 0, 0, 3);
    cfg.clickStrength = clamp(+cfg.clickStrength || 0, 0, 4);
    cfg.animationSpeed = clamp(+cfg.animationSpeed || 0.001, 0.1, 4);
    cfg.trailLength = clamp(Math.round(+cfg.trailLength || 0), 2, 120);
    cfg.hammerSize = clamp(+cfg.hammerSize || 0, 10, 160);
    cfg.followEase = clamp(+cfg.followEase || 0, 0.02, 1);
    cfg.tiltStrength = clamp(+cfg.tiltStrength || 0, 0, 4);
    cfg.bobAmplitude = clamp(+cfg.bobAmplitude || 0, 0, 4);
    cfg.maxParticles = clamp(Math.round(+cfg.maxParticles || 0), 20, 4000);
    cfg.maxDpr = clamp(+cfg.maxDpr || 1, 1, 4);
  
    cfg._rgb = parseColor(cfg.color, [127, 212, 255]);
    cfg._core = parseColor(cfg.coreColor, [255, 255, 255]);
    cfg._accent = parseColor(cfg.accentColor, [185, 140, 255]);
  
    return cfg;
  }
  
  /* ---- src/pointer.js ---- */
  /**
   * Pointer tracking.
   *
   * Listens once on the window and keeps a small, allocation-free record of
   * where the pointer is, how fast it is moving and whether a button is held.
   * Everything else in the library reads this state; nothing else binds
   * pointer events.
   */
  class PointerTracker {
    constructor(cfg) {
      this.cfg = cfg;
  
      // Raw pointer position (target) and the eased render position.
      this.x = window.innerWidth / 2;
      this.y = window.innerHeight / 2;
      this.px = this.x;
      this.py = this.y;
  
      this.vx = 0;
      this.vy = 0;
      this.speed = 0;      // px/frame, smoothed
      this.angle = 0;      // smoothed direction of travel
  
      this.down = false;
      this.dragging = false;
      this.hasMoved = false;
      this.inside = true;
      this.overInteractive = false;
      this.overText = false;
  
      this._downX = 0;
      this._downY = 0;
      this._lastHoverCheck = 0;
      this._hoverEl = null;
  
      this._bound = [];
      this._onDownCbs = [];
      this._onUpCbs = [];
    }
  
    onDown(fn) { this._onDownCbs.push(fn); }
    onUp(fn) { this._onUpCbs.push(fn); }
  
    attach() {
      const add = (target, type, fn, opts) => {
        target.addEventListener(type, fn, opts || { passive: true });
        this._bound.push([target, type, fn, opts]);
      };
  
      this._move = (e) => {
        this.x = e.clientX;
        this.y = e.clientY;
        this.inside = true;
        if (!this.hasMoved) {
          // First sighting: snap so the hammer doesn't fly in from the centre.
          this.hasMoved = true;
          this.px = this.x;
          this.py = this.y;
        }
        if (this.down) {
          const dx = this.x - this._downX;
          const dy = this.y - this._downY;
          if (dx * dx + dy * dy > 16) this.dragging = true;
        }
        this._checkHover(e);
      };
  
      this._pointerDown = (e) => {
        // Ignore anything that isn't a primary mouse/pen press.
        if (e.pointerType === 'touch') return;
        if (e.button !== 0 && e.button !== undefined && e.button !== -1) {
          // Still track non-primary buttons for cursor state, no impact FX.
        }
        this.x = e.clientX;
        this.y = e.clientY;
        this.down = true;
        this.dragging = false;
        this._downX = e.clientX;
        this._downY = e.clientY;
        for (let i = 0; i < this._onDownCbs.length; i++) {
          this._onDownCbs[i](e.clientX, e.clientY, e);
        }
      };
  
      this._pointerUp = (e) => {
        if (!this.down) return;
        this.down = false;
        this.dragging = false;
        for (let i = 0; i < this._onUpCbs.length; i++) {
          this._onUpCbs[i](this.x, this.y, e);
        }
      };
  
      this._leave = (e) => {
        // relatedTarget null => actually left the document.
        if (e && e.relatedTarget) return;
        this.inside = false;
        this.down = false;
        this.dragging = false;
      };
  
      this._enter = () => { this.inside = true; };
  
      this._blur = () => {
        this.down = false;
        this.dragging = false;
      };
  
      add(window, 'pointermove', this._move);
      add(window, 'pointerdown', this._pointerDown);
      add(window, 'pointerup', this._pointerUp);
      add(window, 'pointercancel', this._pointerUp);
      add(document, 'mouseleave', this._leave);
      add(document, 'mouseenter', this._enter);
      add(window, 'blur', this._blur);
      // Scrolling changes what is under the pointer without a pointermove.
      add(window, 'scroll', () => { this._lastHoverCheck = 0; });
    }
  
    /**
     * Hover classification is throttled — `elementFromPoint` forces style/layout
     * resolution and is far too expensive to run on every pointermove.
     */
    _checkHover(e) {
      if (!this.cfg.hoverReact && !this.cfg.hideNativeCursor) return;
      const now = performance.now();
      if (now - this._lastHoverCheck < 60) return;
      this._lastHoverCheck = now;
  
      let el = e && e.target;
      if (!el || el.nodeType !== 1) el = document.elementFromPoint(this.x, this.y);
      if (el === this._hoverEl) return;
      this._hoverEl = el;
  
      if (!el || !el.closest) {
        this.overInteractive = false;
        this.overText = false;
        return;
      }
      this.overInteractive = !!el.closest(this.cfg.interactiveSelector);
      this.overText = !!el.closest(this.cfg.nativeCursorSelector);
    }
  
    /** Advance smoothing. `dt` is a frame-normalised delta (1 === 60fps frame). */
    update(dt) {
      const ease = 1 - Math.pow(1 - this.cfg.followEase, dt);
      const nx = this.px + (this.x - this.px) * ease;
      const ny = this.py + (this.y - this.py) * ease;
  
      // Instantaneous velocity of the *rendered* hammer, normalised per frame.
      const ivx = (nx - this.px) / Math.max(dt, 0.0001);
      const ivy = (ny - this.py) / Math.max(dt, 0.0001);
  
      this.px = nx;
      this.py = ny;
  
      // Smooth velocity so single jumpy samples don't snap the tilt.
      this.vx += (ivx - this.vx) * 0.35;
      this.vy += (ivy - this.vy) * 0.35;
  
      const s = Math.hypot(this.vx, this.vy);
      this.speed += (s - this.speed) * 0.3;
  
      if (s > 0.6) {
        const a = Math.atan2(this.vy, this.vx);
        // Shortest-path angle interpolation.
        let d = a - this.angle;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        this.angle += d * 0.25;
      }
    }
  
    destroy() {
      for (const [t, type, fn, opts] of this._bound) {
        t.removeEventListener(type, fn, opts);
      }
      this._bound.length = 0;
      this._onDownCbs.length = 0;
      this._onUpCbs.length = 0;
      this._hoverEl = null;
    }
  }
  
  /* ---- src/hammer.js ---- */
  /**
   * Hammer renderer.
   *
   * An original fantasy war-hammer silhouette drawn with canvas paths — not a
   * traced prop, and no external assets. The shape is built once into an
   * offscreen sprite at device resolution, then blitted each frame with a
   * transform. Re-drawing the vector art every frame would burn CPU redrawing
   * an image that never changes.
   *
   * Design notes: a short squared head with chamfered corners and an engraved
   * energy channel, a collar band, a wrapped leather grip, and a pommel ring.
   * The runes are abstract angular marks, not glyphs from any existing work.
   */
  class HammerRenderer {
    constructor(cfg) {
      this.cfg = cfg;
      this.sprite = null;      // offscreen canvas
      this.ox = 0;             // hotspot offset within the sprite, css px
      this.oy = 0;
      this.w = 0;
      this.h = 0;
    }
  
    /**
     * Build (or rebuild) the sprite. Called on init and whenever dpr changes.
     * @param {number} dpr device pixel ratio to bake in
     */
    build(dpr) {
      const cfg = this.cfg;
      const S = cfg.hammerSize;             // head long edge, css px
  
      // Proportions: a slightly narrower, taller head reads as heavy rather
      // than stubby, and a thicker shaft keeps the silhouette balanced at
      // small sizes where a thin one disappears.
      const headW = S * 0.92;
      const headH = S * 0.8;
      const shaftW = Math.max(3, S * 0.15);
      const shaftL = S * 1.25;
  
      // Padding leaves room for the glow bleed.
      const pad = Math.max(10, S * 0.5);
      const w = Math.ceil(headW + pad * 2);
      const h = Math.ceil(headH + shaftL + pad * 2);
  
      this.w = w;
      this.h = h;
      // Hotspot: centre of the striking face, which sits under the pointer.
      this.ox = w / 2;
      this.oy = pad + headH * 0.5;
  
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * dpr));
      c.height = Math.max(1, Math.round(h * dpr));
      const g = c.getContext('2d');
      g.scale(dpr, dpr);
  
      const cx = w / 2;
      const headTop = pad;
      const headBot = pad + headH;
      const cham = headH * 0.26;   // corner chamfer
  
      /* ---------------- shaft -------------------------------------------- */
      const shaftTop = headBot - headH * 0.1;
      const shaftBot = shaftTop + shaftL;
  
      g.save();
  
      const shaftGrad = g.createLinearGradient(cx - shaftW, 0, cx + shaftW, 0);
      shaftGrad.addColorStop(0, '#2b3340');
      shaftGrad.addColorStop(0.35, '#6d7a8c');
      shaftGrad.addColorStop(0.55, '#9fb0c4');
      shaftGrad.addColorStop(1, '#333b48');
      g.fillStyle = shaftGrad;
      this._roundRect(g, cx - shaftW / 2, shaftTop, shaftW, shaftL, shaftW * 0.4);
      g.fill();
  
      // Leather grip wrap. Drawn as one dark sleeve with diagonal binding
      // lines over it — discrete bands read as beads at cursor scale.
      const gripTop = shaftTop + shaftL * 0.3;
      const gripLen = shaftL * 0.56;
      const gripW = shaftW * 1.5;
      const sleeve = g.createLinearGradient(cx - gripW / 2, 0, cx + gripW / 2, 0);
      sleeve.addColorStop(0, '#241a16');
      sleeve.addColorStop(0.4, '#5c463a');
      sleeve.addColorStop(0.62, '#6b5344');
      sleeve.addColorStop(1, '#2a1f19');
      g.fillStyle = sleeve;
      this._roundRect(g, cx - gripW / 2, gripTop, gripW, gripLen, gripW * 0.22);
      g.fill();
  
      // Diagonal wrap seams, clipped to the sleeve.
      g.save();
      this._roundRect(g, cx - gripW / 2, gripTop, gripW, gripLen, gripW * 0.22);
      g.clip();
      g.strokeStyle = 'rgba(18,12,9,0.75)';
      g.lineWidth = Math.max(0.7, S * 0.022);
      const seams = 5;
      for (let i = 0; i <= seams; i++) {
        const y = gripTop + (gripLen / seams) * i;
        g.beginPath();
        g.moveTo(cx - gripW * 0.6, y);
        g.lineTo(cx + gripW * 0.6, y - gripW * 0.42);
        g.stroke();
      }
      // Single specular edge down the left of the sleeve.
      g.fillStyle = 'rgba(255,226,190,0.13)';
      g.fillRect(cx - gripW * 0.44, gripTop, gripW * 0.16, gripLen);
      g.restore();
  
      // Pommel ring, double-stroked so it catches the theme colour.
      const pomY = shaftBot + shaftW * 0.15;
      const pomR = shaftW * 0.62;
      g.strokeStyle = '#8b98aa';
      g.lineWidth = Math.max(1.2, S * 0.05);
      g.beginPath();
      g.arc(cx, pomY, pomR, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = rgba(cfg._rgb, 0.55);
      g.lineWidth = Math.max(0.8, S * 0.028);
      g.beginPath();
      g.arc(cx, pomY, pomR, 0, Math.PI * 2);
      g.stroke();
  
      /* ---------------- head --------------------------------------------- */
      const hx0 = cx - headW / 2;
      const hx1 = cx + headW / 2;
  
      g.beginPath();
      g.moveTo(hx0 + cham, headTop);
      g.lineTo(hx1 - cham, headTop);
      g.lineTo(hx1, headTop + cham);
      g.lineTo(hx1, headBot - cham);
      g.lineTo(hx1 - cham, headBot);
      g.lineTo(hx0 + cham, headBot);
      g.lineTo(hx0, headBot - cham);
      g.lineTo(hx0, headTop + cham);
      g.closePath();
  
      const headGrad = g.createLinearGradient(hx0, headTop, hx1, headBot);
      headGrad.addColorStop(0, '#c9d6e6');
      headGrad.addColorStop(0.28, '#8b9aae');
      headGrad.addColorStop(0.5, '#5c6878');
      headGrad.addColorStop(0.72, '#7d8b9d');
      headGrad.addColorStop(1, '#38414e');
      g.fillStyle = headGrad;
      g.fill();
  
      // Rim light along the top and left edges, clipped to the head.
      g.save();
      g.clip();
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.lineWidth = Math.max(1, S * 0.045);
      g.beginPath();
      g.moveTo(hx0 + cham * 0.6, headTop + 1);
      g.lineTo(hx1 - cham, headTop + 1);
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.22)';
      g.beginPath();
      g.moveTo(hx0 + 1, headTop + cham);
      g.lineTo(hx0 + 1, headBot - cham);
      g.stroke();
      g.restore();
  
      g.strokeStyle = 'rgba(12,16,22,0.85)';
      g.lineWidth = Math.max(1, S * 0.035);
      g.stroke();
  
      /* ---------------- engraved energy channel -------------------------- */
      const chW = headW * 0.62;
      const chH = headH * 0.2;
      g.save();
      g.shadowColor = rgba(cfg._rgb, 0.9 * cfg.glowIntensity);
      g.shadowBlur = S * 0.42 * cfg.glowIntensity;
      const chGrad = g.createLinearGradient(cx - chW / 2, 0, cx + chW / 2, 0);
      chGrad.addColorStop(0, rgba(cfg._rgb, 0.35));
      chGrad.addColorStop(0.5, rgba(cfg._core, 0.98));
      chGrad.addColorStop(1, rgba(cfg._rgb, 0.35));
      g.fillStyle = chGrad;
      this._roundRect(g, cx - chW / 2, (headTop + headBot) / 2 - chH / 2,
        chW, chH, chH * 0.5);
      g.fill();
      g.restore();
  
      // Rune marks flanking the channel — original abstract angular glyphs,
      // drawn with a glow so they read as etched light rather than scratches.
      g.save();
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.shadowColor = rgba(cfg._rgb, 0.8 * cfg.glowIntensity);
      g.shadowBlur = S * 0.16 * cfg.glowIntensity;
      g.strokeStyle = rgba(cfg._core, 0.82);
      g.lineWidth = Math.max(1, S * 0.036);
      const rw = headW * 0.11;
      const chBot = (headTop + headBot) / 2 + chH / 2;
      // Upper glyph pair: a chevron over the channel.
      for (const dir of [-1, 1]) {
        const rx = cx + dir * headW * 0.29;
        const ry = headTop + headH * 0.2;
        g.beginPath();
        g.moveTo(rx - rw, ry);
        g.lineTo(rx, ry + rw * 0.8);
        g.lineTo(rx + rw, ry);
        g.stroke();
      }
      // Lower glyph pair: an angled stave with a single branch — asymmetric so
      // it reads as a carved mark, not a plus sign or a UI icon. Mirrored so
      // the two sides face each other.
      g.strokeStyle = rgba(cfg._rgb, 0.72);
      g.lineWidth = Math.max(0.9, S * 0.028);
      for (const dir of [-1, 1]) {
        const rx = cx + dir * headW * 0.29;
        const ry = chBot + headH * 0.09;
        const hh = rw * 0.85;
        g.beginPath();
        // Slightly leaning stave.
        g.moveTo(rx + dir * rw * 0.18, ry);
        g.lineTo(rx - dir * rw * 0.18, ry + hh);
        // One branch off the upper third, angled outward.
        g.moveTo(rx + dir * rw * 0.06, ry + hh * 0.34);
        g.lineTo(rx + dir * rw * 0.62, ry + hh * 0.1);
        g.stroke();
      }
      g.restore();
  
      // Striking face: a bright bevel along the bottom edge so the head reads
      // as a tool with a business end rather than a floating block.
      g.save();
      g.beginPath();
      g.moveTo(hx0 + cham, headTop);
      g.lineTo(hx1 - cham, headTop);
      g.lineTo(hx1, headTop + cham);
      g.lineTo(hx1, headBot - cham);
      g.lineTo(hx1 - cham, headBot);
      g.lineTo(hx0 + cham, headBot);
      g.lineTo(hx0, headBot - cham);
      g.lineTo(hx0, headTop + cham);
      g.closePath();
      g.clip();
      const faceH = headH * 0.16;
      const face = g.createLinearGradient(0, headBot - faceH, 0, headBot);
      face.addColorStop(0, 'rgba(0,0,0,0.34)');
      face.addColorStop(0.55, 'rgba(196,214,236,0.30)');
      face.addColorStop(1, 'rgba(232,242,255,0.62)');
      g.fillStyle = face;
      g.fillRect(hx0, headBot - faceH, headW, faceH);
      g.restore();
  
      /* ---------------- collar ------------------------------------------- */
      const colW = shaftW * 2.3;
      const colH = headH * 0.2;
      const colGrad = g.createLinearGradient(cx - colW / 2, 0, cx + colW / 2, 0);
      colGrad.addColorStop(0, '#4a5462');
      colGrad.addColorStop(0.45, '#aab8c9');
      colGrad.addColorStop(1, '#3c444f');
      g.fillStyle = colGrad;
      this._roundRect(g, cx - colW / 2, headBot - colH * 0.35, colW, colH,
        colH * 0.3);
      g.fill();
      g.strokeStyle = 'rgba(10,14,20,0.7)';
      g.lineWidth = Math.max(0.7, S * 0.022);
      g.stroke();
  
      g.restore();
  
      this.sprite = c;
    }
  
    _roundRect(g, x, y, w, h, r) {
      const rr = Math.max(0, Math.min(r, w / 2, h / 2));
      g.beginPath();
      g.moveTo(x + rr, y);
      g.arcTo(x + w, y, x + w, y + h, rr);
      g.arcTo(x + w, y + h, x, y + h, rr);
      g.arcTo(x, y + h, x, y, rr);
      g.arcTo(x, y, x + w, y, rr);
      g.closePath();
    }
  
    /**
     * Draw the hammer into a css-pixel-space context.
     * @param {CanvasRenderingContext2D} g
     * @param {{x:number,y:number,rot:number,scale:number,glow:number,charge:number}} s
     */
    draw(g, s) {
      const sp = this.sprite;
      if (!sp) return;
      const cfg = this.cfg;
  
      g.save();
      g.translate(s.x, s.y);
      g.rotate(s.rot);
      g.scale(s.scale, s.scale);
  
      // Aura behind the hammer — a soft radial wash reads as bloom for far less
      // cost than an actual blur pass.
      if (cfg.glow && s.glow > 0.01) {
        const R = cfg.hammerSize * (1.1 + s.charge * 0.6);
        const a = 0.30 * s.glow * cfg.glowIntensity;
        const grad = g.createRadialGradient(0, 0, 0, 0, 0, R);
        grad.addColorStop(0, rgba(cfg._rgb, a));
        grad.addColorStop(0.45, rgba(cfg._rgb, a * 0.4));
        grad.addColorStop(1, rgba(cfg._rgb, 0));
        g.fillStyle = grad;
        g.beginPath();
        g.arc(0, 0, R, 0, Math.PI * 2);
        g.fill();
      }
  
      g.drawImage(sp, -this.ox, -this.oy, this.w, this.h);
  
      // Charge overlay: re-stamp additively to make the channel flare.
      if (s.charge > 0.02) {
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = Math.min(1, s.charge * 0.85);
        g.drawImage(sp, -this.ox, -this.oy, this.w, this.h);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
      }
  
      g.restore();
    }
  }
  
  /* ---- src/particles.js ---- */
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
  class ParticleSystem {
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
  
  /* ---- src/lightning.js ---- */
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
  function generateBolt(out, x1, y1, x2, y2, detail = 4, offset = 18) {
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
  class Arc {
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
  function radialTargets(cx, cy, count, minR, maxR, baseAngle = null) {
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
  
  /* ---- src/effects.js ---- */
  /**
   * Effects: the arc pool, the drag trail, and the click impact.
   *
   * All lightning is drawn in two passes — a wide, low-alpha "glow" stroke in
   * the theme colour, then a thin white-hot core stroke on top, both under
   * `lighter` compositing. That layering is what separates real-looking
   * electricity from a flat neon line, and it costs two strokes instead of a
   * blur filter.
   */
  
  
  /* ------------------------------------------------------------------ arcs */
  
  /**
   * Fixed-capacity pool of `Arc` objects. Dead arcs are reused in place, so a
   * long session never grows the heap.
   */
  class ArcPool {
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
  function drawArcs(g, pool, cfg) {
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
  class TrailSystem {
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
  class ImpactSystem {
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
  function drawParticles(g, ps, cfg) {
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
  
  /* ---- src/cursor.js ---- */
  /**
   * ThorCursor — controller.
   *
   * Owns the overlay canvas, the animation loop and the public API. Everything
   * visual lives on one fixed, pointer-events:none canvas so the page underneath
   * stays fully interactive and we never touch the DOM per effect.
   */
  
  
  
  
  
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
  class ThorCursorInstance {
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
  const ThorCursor = {
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

  ThorCursor.ThorCursor = ThorCursor;
  ThorCursor.ThorCursorInstance = ThorCursorInstance;
  ThorCursor.DEFAULTS = DEFAULTS;
  ThorCursor.resolveConfig = resolveConfig;
  ThorCursor.default = ThorCursor;
  return ThorCursor;
});
