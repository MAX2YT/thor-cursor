/**
 * thor-cursor — configuration
 *
 * A single flat options object is exposed to consumers. Internally we keep
 * derived/normalised values on the same object so the hot loop never has to
 * branch on "did the user supply this?".
 */

export const DEFAULTS = {
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
export function parseColor(input, fallback = [255, 255, 255]) {
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

export const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/**
 * Merge user options over the defaults and pre-compute the derived values the
 * renderers read every frame.
 */
export function resolveConfig(user = {}) {
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
