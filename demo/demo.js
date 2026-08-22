/* ==========================================================================
   thor-cursor demo page script.
   Wires the playground controls, the FPS/stat readout and the ambient motes.
   ========================================================================== */

(function () {
  'use strict';

  /* -------------------------------------------------------------- cursor */

  const cursor = ThorCursor.init({
    intensity: 1,
    trailLength: 20,
  });

  const isTouch = !ThorCursor.supported;
  if (isTouch) {
    const note = document.getElementById('touch-note');
    if (note) note.hidden = false;
  }

  /* ------------------------------------------------------------ controls */

  const RANGES = [
    'intensity', 'hammerSize', 'trailLength', 'particleDensity',
    'glowIntensity', 'clickStrength', 'animationSpeed', 'followEase',
  ];
  const TOGGLES = ['trail', 'clickEffect', 'glow', 'hoverReact'];

  const DEFAULTS = {
    intensity: 1, hammerSize: 34, trailLength: 20, particleDensity: 1,
    glowIntensity: 1, clickStrength: 1, animationSpeed: 1, followEase: 0.28,
    trail: true, clickEffect: true, glow: true, hoverReact: true,
    color: '#7fd4ff', accentColor: '#b98cff',
  };

  const current = Object.assign({}, DEFAULTS);
  const snippetEl = document.getElementById('snippet');

  /** Only emit options the user actually changed — keeps the snippet honest. */
  function renderSnippet() {
    const diff = {};
    for (const k of Object.keys(current)) {
      if (current[k] !== DEFAULTS[k]) diff[k] = current[k];
    }
    const keys = Object.keys(diff);
    let body;
    if (!keys.length) {
      body = 'ThorCursor.init();';
    } else {
      const lines = keys.map((k) => {
        const v = typeof diff[k] === 'string' ? `'${diff[k]}'` : diff[k];
        return `  ${k}: ${v},`;
      });
      body = 'ThorCursor.init({\n' + lines.join('\n') + '\n});';
    }
    if (snippetEl) snippetEl.textContent = body;
  }

  function apply(patch) {
    Object.assign(current, patch);
    if (cursor) cursor.configure(patch);
    renderSnippet();
  }

  for (const key of RANGES) {
    const input = document.getElementById('c-' + key);
    if (!input) continue;
    const out = document.querySelector(`[data-out="${key}"]`);
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      if (out) out.textContent = v;
      apply({ [key]: v });
    });
  }

  for (const key of TOGGLES) {
    const input = document.getElementById('c-' + key);
    if (!input) continue;
    input.addEventListener('change', () => apply({ [key]: input.checked }));
  }

  // Palette swatches.
  const swatches = document.getElementById('swatches');
  if (swatches) {
    swatches.addEventListener('click', (e) => {
      const btn = e.target.closest('.swatch');
      if (!btn) return;
      for (const s of swatches.querySelectorAll('.swatch')) s.classList.remove('is-on');
      btn.classList.add('is-on');
      const color = btn.dataset.color;
      const accentColor = btn.dataset.accent || color;
      apply({ color, accentColor });
      document.documentElement.style.setProperty('--bolt', color);
    });
  }

  // Click-strength presets.
  for (const chip of document.querySelectorAll('.chip[data-strength]')) {
    chip.addEventListener('click', () => {
      for (const c of document.querySelectorAll('.chip[data-strength]')) {
        c.classList.remove('is-on');
      }
      chip.classList.add('is-on');
      const v = parseFloat(chip.dataset.strength);
      apply({ clickStrength: v });
      const slider = document.getElementById('c-clickStrength');
      const out = document.querySelector('[data-out="clickStrength"]');
      if (slider) slider.value = v;
      if (out) out.textContent = v;
    });
  }

  // Reset.
  const resetBtn = document.getElementById('reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      apply(Object.assign({}, DEFAULTS));
      for (const key of RANGES) {
        const input = document.getElementById('c-' + key);
        const out = document.querySelector(`[data-out="${key}"]`);
        if (input) input.value = DEFAULTS[key];
        if (out) out.textContent = DEFAULTS[key];
      }
      for (const key of TOGGLES) {
        const input = document.getElementById('c-' + key);
        if (input) input.checked = DEFAULTS[key];
      }
      for (const s of document.querySelectorAll('.swatch')) s.classList.remove('is-on');
      const first = document.querySelector('.swatch');
      if (first) first.classList.add('is-on');
      document.documentElement.style.setProperty('--bolt', DEFAULTS.color);
    });
  }

  // Copy config.
  const copyBtn = document.getElementById('copy');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const text = snippetEl ? snippetEl.textContent : '';
      const done = () => {
        const old = copyBtn.textContent;
        copyBtn.textContent = 'Copied';
        setTimeout(() => { copyBtn.textContent = old; }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        done();
      }
    });
  }

  // Enable/disable toggle.
  const toggleBtn = document.getElementById('toggle');
  if (toggleBtn) {
    if (isTouch) {
      toggleBtn.disabled = true;
      toggleBtn.textContent = 'Cursor unavailable (touch)';
    } else {
      toggleBtn.addEventListener('click', () => {
        const inst = ThorCursor.instance;
        if (!inst) return;
        inst.toggle();
        toggleBtn.textContent = inst.running ? 'Disable cursor' : 'Enable cursor';
      });
    }
  }

  // Hero "summon" button fires a strike at the button itself.
  const heroBtn = document.getElementById('strike-hero');
  if (heroBtn) {
    heroBtn.addEventListener('click', (e) => {
      // The pointerdown already struck; add a second, offset burst so the
      // button feels heavier than a normal click.
      const r = heroBtn.getBoundingClientRect();
      setTimeout(() => {
        ThorCursor.strike(r.left + r.width * 0.5, r.top + r.height * 0.5);
      }, 90);
    });
  }

  /* ------------------------------------------------------------- readout */

  const fpsEl = document.getElementById('fps');
  const pEl = document.getElementById('s-particles');
  const aEl = document.getElementById('s-arcs');
  const dEl = document.getElementById('s-dpr');

  let frames = 0;
  let lastSample = performance.now();

  function sample(now) {
    frames++;
    if (now - lastSample >= 500) {
      const fps = Math.round((frames * 1000) / (now - lastSample));
      if (fpsEl) fpsEl.textContent = fps;
      frames = 0;
      lastSample = now;

      const st = ThorCursor.stats();
      if (st) {
        if (pEl) pEl.textContent = st.particles;
        if (aEl) aEl.textContent = st.arcs;
        if (dEl) dEl.textContent = st.dpr.toFixed(1);
      } else {
        if (dEl) dEl.textContent = '—';
      }
    }
    requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);

  /* --------------------------------------------------------------- motes */

  /**
   * Ambient drifting motes behind the content. Deliberately tiny and
   * independent of the cursor — it exists to give the page depth without
   * competing with the lightning for frame budget.
   */
  (function motes() {
    const canvas = document.getElementById('motes');
    if (!canvas) return;
    const reduced = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const g = canvas.getContext('2d');
    let dpr = 1;
    let w = 0;
    let h = 0;
    let items = [];

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Scale count with viewport area, capped so big monitors stay cheap.
      const n = Math.min(70, Math.round((w * h) / 26000));
      items = [];
      for (let i = 0; i < n; i++) {
        items.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: 0.4 + Math.random() * 1.4,
          vx: (Math.random() - 0.5) * 0.14,
          vy: -0.05 - Math.random() * 0.18,
          a: 0.12 + Math.random() * 0.4,
          ph: Math.random() * Math.PI * 2,
        });
      }
    }

    function frame(t) {
      g.clearRect(0, 0, w, h);
      for (const m of items) {
        if (!reduced) {
          m.x += m.vx;
          m.y += m.vy;
          if (m.y < -8) { m.y = h + 8; m.x = Math.random() * w; }
          if (m.x < -8) m.x = w + 8;
          if (m.x > w + 8) m.x = -8;
        }
        const tw = reduced ? 1 : 0.65 + 0.35 * Math.sin(t * 0.002 + m.ph);
        g.fillStyle = `rgba(150,205,255,${(m.a * tw).toFixed(3)})`;
        g.beginPath();
        g.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        g.fill();
      }
      requestAnimationFrame(frame);
    }

    resize();
    window.addEventListener('resize', resize, { passive: true });
    requestAnimationFrame(frame);
  })();

  renderSnippet();
})();
