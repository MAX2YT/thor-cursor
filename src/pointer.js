/**
 * Pointer tracking.
 *
 * Listens once on the window and keeps a small, allocation-free record of
 * where the pointer is, how fast it is moving and whether a button is held.
 * Everything else in the library reads this state; nothing else binds
 * pointer events.
 */

export class PointerTracker {
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
