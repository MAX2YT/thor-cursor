/**
 * Type definitions for thor-cursor.
 */

export interface ThorCursorOptions {
  /* master switches */
  enabled?: boolean;
  trail?: boolean;
  clickEffect?: boolean;
  glow?: boolean;
  hoverReact?: boolean;

  /* intensity and scale */
  /** Global multiplier for bolt/spark counts. 0–4. */
  intensity?: number;
  /** Spark emission multiplier. 0–4. `0` disables sparks. */
  particleDensity?: number;
  /** Retained pointer samples the trail can span. 2–120. */
  trailLength?: number;
  /** Impact size and force. 0–4. */
  clickStrength?: number;
  /** Multiplies all decay rates. 0.1–4. */
  animationSpeed?: number;
  /** Hard cap on live sparks. 20–4000. */
  maxParticles?: number;

  /* hammer */
  /** Long edge of the head, CSS px. 10–160. */
  hammerSize?: number;
  /** Pointer-follow tightness. 0.02–1. */
  followEase?: number;
  /** How much velocity leans the hammer. 0–4. */
  tiltStrength?: number;
  /** Idle floating motion. 0–4. */
  bobAmplitude?: number;

  /* colour */
  /** Arc body and glow. Hex, `rgb()` or `rgba()`. */
  color?: string;
  /** White-hot bolt core. */
  coreColor?: string;
  /** Secondary arc tint. */
  accentColor?: string;
  /** Glow strength. 0–3. */
  glowIntensity?: number;

  /* behaviour */
  zIndex?: number;
  hideNativeCursor?: boolean;
  respectReducedMotion?: boolean;
  disableOnTouch?: boolean;
  /** Cap on the device pixel ratio used for the backing store. 1–4. */
  maxDpr?: number;
  /** Selector for elements the hammer reacts to. */
  interactiveSelector?: string;
  /** Selector for elements that keep the native caret. */
  nativeCursorSelector?: string;
  /** Mount point for the overlay canvas. Defaults to `document.body`. */
  container?: Element | null;
}

export interface ThorCursorStats {
  particles: number;
  arcs: number;
  reduced: boolean;
  dpr: number;
}

export declare class ThorCursorInstance {
  constructor(options?: ThorCursorOptions);

  readonly running: boolean;
  readonly destroyed: boolean;
  /** `false` on touch-only devices, where the cursor is not created. */
  readonly supported: boolean;
  readonly canvas: HTMLCanvasElement | null;

  init(): this;
  start(): this;
  stop(): this;
  toggle(): this;
  configure(patch: ThorCursorOptions): this;
  /** Fire an impact. Defaults to the current pointer position. */
  strike(x?: number, y?: number): this;
  /** Drop all live effects without stopping the loop. */
  clear(): this;
  destroy(): this;
  stats(): ThorCursorStats;
}

export interface ThorCursorAPI {
  readonly defaults: Required<
    Omit<ThorCursorOptions, 'container'>
  > & { container: Element | null };

  /** Create or reconfigure the shared singleton. Returns `null` during SSR. */
  init(options?: ThorCursorOptions): ThorCursorInstance | null;
  /** Create an independent instance. Preferred in component frameworks. */
  create(options?: ThorCursorOptions): ThorCursorInstance;

  readonly instance: ThorCursorInstance | null;
  /** `false` on touch-only devices. */
  readonly supported: boolean;

  configure(patch: ThorCursorOptions): ThorCursorInstance | null | undefined;
  start(): ThorCursorInstance | null | undefined;
  stop(): ThorCursorInstance | null | undefined;
  toggle(): ThorCursorInstance | null | undefined;
  strike(x?: number, y?: number): ThorCursorInstance | null | undefined;
  clear(): ThorCursorInstance | null | undefined;
  stats(): ThorCursorStats | null;
  destroy(): void;
}

export declare const ThorCursor: ThorCursorAPI;
export declare const DEFAULTS: ThorCursorAPI['defaults'];
export declare function resolveConfig(
  user?: ThorCursorOptions,
): Required<ThorCursorOptions> & Record<string, unknown>;

export default ThorCursor;
