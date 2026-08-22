# thor-cursor

A premium cinematic **Mjolnir-inspired lightning cursor** for modern websites.
Your pointer becomes an enchanted war-hammer that trails branching electricity,
slams down on click, and paints a storm while you drag.

- **Framework-independent** — plain JS, works with React, Next.js, Vue, Angular,
  Svelte, or a static HTML file.
- **Zero dependencies.** One canvas, one `requestAnimationFrame` loop.
- **Fast.** ~4.6 ms/frame at p95 under a fully saturated particle pool on
  software rendering — roughly 3.6× headroom inside a 60 fps budget.
- **Never in the way.** The overlay is `pointer-events: none`; buttons, links,
  forms, scrollbars and text selection all behave exactly as before.
- **Considerate.** Honours `prefers-reduced-motion` and disables itself on
  touch-only devices.

---

## Table of contents

1. [Installation](#1-installation)
2. [Basic usage](#2-basic-usage)
3. [CDN usage](#3-cdn-usage)
4. [Configuration](#4-configuration)
5. [React integration](#5-react-integration)
6. [Next.js integration](#6-nextjs-integration)
7. [Plain HTML integration](#7-plain-html-integration)
8. [Vue / Angular / Svelte](#8-vue--angular--svelte)
9. [Customization](#9-customization)
10. [API reference](#10-api-reference)
11. [Performance considerations](#11-performance-considerations)
12. [Mobile behavior](#12-mobile-behavior)
13. [Accessibility](#13-accessibility)
14. [Browser support](#14-browser-support)
15. [Development](#15-development)
16. [Licence and attribution](#16-licence-and-attribution)

---

## 1. Installation

### npm

```bash
npm install thor-cursor
```

### Direct download

Grab `dist/thor-cursor.min.js` and drop it next to your HTML. No build step,
no bundler, no dependencies.

---

## 2. Basic usage

```js
import { ThorCursor } from 'thor-cursor';

ThorCursor.init();
```

That is the whole integration. `init()` builds the overlay, hides the native
cursor, and starts the loop. Call it once — calling it again just reconfigures
the existing instance rather than stacking a second cursor.

With options:

```js
ThorCursor.init({
  enabled: true,
  trail: true,
  clickEffect: true,
  intensity: 1,
  trailLength: 20,
  particleDensity: 1,
  glow: true,
});
```

---

## 3. CDN usage

```html
<script src="https://unpkg.com/thor-cursor/dist/thor-cursor.min.js"></script>
<script>
  ThorCursor.init();
</script>
```

Or via jsDelivr:

```html
<script src="https://cdn.jsdelivr.net/npm/thor-cursor/dist/thor-cursor.min.js"></script>
```

Pin a version in production (`thor-cursor@1.0.0`) so a future release cannot
change your site's feel without you choosing it.

The UMD bundle also works with AMD loaders and CommonJS `require()`.

---

## 4. Configuration

Every option is optional. Defaults are shown.

### Master switches

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Start running immediately. `false` initialises but stays idle. |
| `trail` | boolean | `true` | Lightning trail while moving/dragging. |
| `clickEffect` | boolean | `true` | Impact burst on click. |
| `glow` | boolean | `true` | Bloom/glow passes. Turn off for the cheapest possible mode. |
| `hoverReact` | boolean | `true` | Brighten and swell over interactive elements. |

### Intensity and scale

| Option | Type | Default | Range | Description |
| --- | --- | --- | --- | --- |
| `intensity` | number | `1` | 0–4 | Global multiplier for bolt and spark counts. |
| `particleDensity` | number | `1` | 0–4 | Spark emission only. `0` disables sparks. |
| `trailLength` | number | `20` | 2–120 | Retained pointer samples the trail can span. |
| `clickStrength` | number | `1` | 0–4 | Impact size and force. Growth is sub-linear, so even `4` stays local. |
| `animationSpeed` | number | `1` | 0.1–4 | Multiplies all decay rates. Higher = snappier, shorter-lived. |
| `maxParticles` | number | `420` | 20–4000 | Hard cap on live sparks. |

### Hammer

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `hammerSize` | number | `34` | Long edge of the head, in CSS px. |
| `followEase` | number | `0.28` | 0–1. Higher tracks the pointer more tightly; lower feels heavier. |
| `tiltStrength` | number | `1` | How much velocity leans the hammer. |
| `bobAmplitude` | number | `1` | Idle floating motion. `0` to sit still. |

### Colour

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `color` | string | `'#7fd4ff'` | Arc body and glow. Hex, `rgb()` or `rgba()`. |
| `coreColor` | string | `'#ffffff'` | The white-hot core of every bolt. |
| `accentColor` | string | `'#b98cff'` | Secondary arc tint, used on ~7% of arcs. |
| `glowIntensity` | number | `1` | 0–3. Strength of the glow passes. |

### Behaviour

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `zIndex` | number | `2147483000` | Overlay stacking. Lower it if you have higher-stacked UI. |
| `hideNativeCursor` | boolean | `true` | Hide the OS cursor while active. Text fields keep their caret regardless. |
| `respectReducedMotion` | boolean | `true` | Honour `prefers-reduced-motion: reduce`. |
| `disableOnTouch` | boolean | `true` | Do nothing on touch-only devices. |
| `maxDpr` | number | `2` | Cap the device pixel ratio used for the backing store. |
| `interactiveSelector` | string | see below | What counts as "clickable" for the hover reaction. |
| `nativeCursorSelector` | string | `'input, textarea, [contenteditable="true"]'` | Elements that keep the native caret. |
| `container` | Element \| null | `null` | Where to mount the canvas. Defaults to `document.body`. |

Default `interactiveSelector`:

```
a, button, [role="button"], input, select, textarea, label, summary,
[data-thor-interactive], .thor-interactive
```

Add `data-thor-interactive` to any custom element (a card, a carousel arrow) to
make the hammer react to it.

---

## 5. React integration

Create the instance in an effect and destroy it on unmount. Use `create()`
rather than `init()` so React's strict-mode double-mount cannot leave a
dangling cursor.

```jsx
import { useEffect } from 'react';
import { ThorCursor } from 'thor-cursor';

export function useThorCursor(options) {
  useEffect(() => {
    const cursor = ThorCursor.create(options);
    return () => cursor.destroy();
    // Intentionally mount-once; use cursor.configure() for live updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export default function App() {
  useThorCursor({ intensity: 1.2 });
  return <YourApp />;
}
```

To drive options from React state, keep the instance in a ref and reconfigure:

```jsx
function ThorCursorProvider({ intensity, children }) {
  const ref = useRef(null);

  useEffect(() => {
    ref.current = ThorCursor.create();
    return () => { ref.current?.destroy(); ref.current = null; };
  }, []);

  useEffect(() => {
    ref.current?.configure({ intensity });
  }, [intensity]);

  return children;
}
```

---

## 6. Next.js integration

The library no-ops during SSR, but the import itself should stay off the server
bundle. Load it in a client component:

```jsx
// app/thor-cursor.jsx
'use client';

import { useEffect } from 'react';

export default function ThorCursorMount() {
  useEffect(() => {
    let cursor;
    // Dynamic import keeps it out of the server bundle entirely.
    import('thor-cursor').then(({ ThorCursor }) => {
      cursor = ThorCursor.create({ intensity: 1.1 });
    });
    return () => cursor?.destroy();
  }, []);

  return null;
}
```

```jsx
// app/layout.jsx
import ThorCursorMount from './thor-cursor';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <ThorCursorMount />
        {children}
      </body>
    </html>
  );
}
```

For the Pages Router, the same component works in `_app.jsx`, or use
`next/script` with the CDN build:

```jsx
import Script from 'next/script';

<Script
  src="https://unpkg.com/thor-cursor/dist/thor-cursor.min.js"
  onLoad={() => window.ThorCursor.init()}
/>
```

---

## 7. Plain HTML integration

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>My site</title>
</head>
<body>
  <h1>Hello</h1>

  <script src="thor-cursor.min.js"></script>
  <script>
    ThorCursor.init({ intensity: 1.2, hammerSize: 30 });
  </script>
</body>
</html>
```

As an ES module, no bundler required:

```html
<script type="module">
  import { ThorCursor } from './dist/thor-cursor.esm.js';
  ThorCursor.init();
</script>
```

---

## 8. Vue / Angular / Svelte

**Vue 3**

```vue
<script setup>
import { onMounted, onUnmounted } from 'vue';
import { ThorCursor } from 'thor-cursor';

let cursor;
onMounted(() => { cursor = ThorCursor.create(); });
onUnmounted(() => cursor?.destroy());
</script>
```

**Angular**

```ts
import { Component, OnDestroy, OnInit } from '@angular/core';
import { ThorCursor } from 'thor-cursor';

@Component({ selector: 'app-root', template: '<router-outlet />' })
export class AppComponent implements OnInit, OnDestroy {
  private cursor: any;
  ngOnInit() { this.cursor = ThorCursor.create(); }
  ngOnDestroy() { this.cursor?.destroy(); }
}
```

**Svelte**

```svelte
<script>
  import { onMount } from 'svelte';
  import { ThorCursor } from 'thor-cursor';

  onMount(() => {
    const cursor = ThorCursor.create();
    return () => cursor.destroy();
  });
</script>
```

---

## 9. Customization

### Recipes

Subtle — a professional site that wants character, not spectacle:

```js
ThorCursor.init({
  intensity: 0.5,
  particleDensity: 0.4,
  clickStrength: 0.6,
  glowIntensity: 0.7,
  hammerSize: 26,
});
```

Maximum drama — a landing page or portfolio:

```js
ThorCursor.init({
  intensity: 2,
  particleDensity: 1.6,
  clickStrength: 2.5,
  trailLength: 40,
  glowIntensity: 1.5,
});
```

Trail only, no click effects:

```js
ThorCursor.init({ clickEffect: false });
```

Recolour to your brand:

```js
ThorCursor.init({
  color: '#8affc1',        // arc body + glow
  coreColor: '#ffffff',    // keep the core white-hot for the electric read
  accentColor: '#4fe0a0',  // occasional secondary arc
});
```

Keeping `coreColor` white is what makes the effect read as electricity rather
than as coloured string. If you tint the core, tint it only slightly.

Heavier, more deliberate hammer:

```js
ThorCursor.init({ followEase: 0.14, hammerSize: 44, tiltStrength: 1.4 });
```

### Live updates

```js
const cursor = ThorCursor.init();

cursor.configure({ intensity: 2, color: '#ffb865' });
```

`configure()` accepts any subset of the options and rebuilds only what the
change actually affects (the hammer sprite, the trail buffer, the particle
pool).

### Respecting a user preference toggle

```js
const cursor = ThorCursor.init({ enabled: false });

document.querySelector('#fancy-cursor').addEventListener('change', (e) => {
  e.target.checked ? cursor.start() : cursor.stop();
});
```

---

## 10. API reference

### `ThorCursor.init(options?)`

Creates the shared singleton, or reconfigures it if one already exists.
Returns the instance. Safe to call during SSR (returns `null` without a DOM).

### `ThorCursor.create(options?)`

Creates an independent instance. Use this in component frameworks so unmounting
cleans up exactly what you created.

### `ThorCursor.configure(patch)`

Merges new options into the running instance.

### `ThorCursor.start()` / `.stop()` / `.toggle()`

Start, stop, or flip the loop. `stop()` clears live effects, hides the overlay
and restores the native cursor.

### `ThorCursor.strike(x?, y?)`

Fire an impact programmatically. Defaults to the current cursor position.

```js
document.querySelector('#cta').addEventListener('mouseenter', () => {
  ThorCursor.strike();
});
```

### `ThorCursor.clear()`

Drop all live arcs, sparks and flashes without stopping the loop.

### `ThorCursor.destroy()`

Remove the canvas, unbind every listener, restore the cursor. No leaks.

### `ThorCursor.stats()`

`{ particles, arcs, reduced, dpr }` — useful for a debug overlay.

### `ThorCursor.supported`

`false` on touch-only devices, so you can branch your own UI.

### `ThorCursor.instance`

The current singleton, or `null`.

---

## 11. Performance considerations

The library is built so a long session costs the same as the first second.

- **One canvas, one rAF loop.** No per-effect DOM nodes — a thousand sparks
  cost one canvas, not a thousand elements.
- **Struct-of-arrays particle pool.** Sparks live in typed arrays with a
  fixed capacity and swap-remove compaction, so there is no per-particle
  allocation and no GC churn after warm-up.
- **Pooled arcs.** Bolts are recycled in place; the pool never grows.
- **Pre-rendered hammer.** The vector artwork is rasterised once into an
  offscreen sprite and blitted thereafter, rather than re-stroked each frame.
- **Two-pass arc drawing.** Glow strokes for all arcs, then cores for all arcs
  — context state changes twice per frame instead of twice per arc.
- **Cheap bloom.** Glow is layered strokes and radial gradients, not a canvas
  blur filter or a second compositing pass.
- **Throttled hover detection.** `elementFromPoint` forces style resolution, so
  it runs at most every 60 ms, never per `pointermove`.
- **Clamped delta time.** A stalled or backgrounded tab cannot teleport the
  simulation or produce a burst of catch-up work.
- **Parked when hidden.** The loop stops on `visibilitychange` and resumes
  cleanly.

Measured frame cost (update + draw), Chrome with GPU disabled, 1582×804:

| Scenario | avg | p95 | live particles |
| --- | --- | --- | --- |
| Idle | 0.17 ms | 0.40 ms | 0 |
| Fast movement | 0.57 ms | 1.20 ms | 9 |
| Fast drag (full trail) | 1.04 ms | 1.70 ms | 11 |
| Drag + repeated impacts | 2.35 ms | 3.80 ms | 57 |
| Saturated pool (worst case) | 3.20 ms | 4.60 ms | 420 |

Against a 16.67 ms budget that leaves ~3.6× headroom in the worst case, on
software rendering. Hardware acceleration is faster still.

If you need to claw back more on very low-end hardware:

```js
ThorCursor.init({
  glow: false,          // biggest single saving
  particleDensity: 0.4,
  maxParticles: 120,
  maxDpr: 1,
});
```

---

## 12. Mobile behavior

On touch-only devices the library **does nothing at all**: no canvas is
created, no listeners are bound, and the native cursor/caret behaviour is left
completely untouched.

Detection requires both `(pointer: coarse)` and `(hover: none)` to match, so
hybrid laptops with a touchscreen and a trackpad still get the cursor — the
right call, since those users do have a pointer.

```js
if (ThorCursor.supported) {
  // Desktop-only affordances.
}
```

Touch input on a hybrid device never triggers an impact; only mouse and pen
pointers do.

To force it on anyway (not recommended — there is no cursor to replace):

```js
ThorCursor.init({ disableOnTouch: false });
```

---

## 13. Accessibility

- **`prefers-reduced-motion: reduce`** is honoured by default. The trail,
  spark emission, idle bobbing and the lightning explosion are all suppressed;
  the hammer still follows the pointer and a click gets a small, brief flash so
  the interaction remains legible. The preference is watched live, so changing
  it mid-session takes effect without a reload.
- **The overlay is inert.** `pointer-events: none` plus `aria-hidden="true"`
  means it is invisible to assistive technology and to hit-testing.
- **Text fields keep their caret** — `input`, `textarea` and
  `[contenteditable]` are exempt from cursor hiding, so typing is never
  disorienting.
- **Keyboard navigation is untouched.** The library binds no key handlers and
  changes no focus behaviour.

Because hiding the system cursor can be a genuine problem for some users,
consider offering a toggle:

```js
const cursor = ThorCursor.init();
// …wire cursor.stop() / cursor.start() to a visible control.
```

---

## 14. Browser support

Chrome/Edge 79+, Firefox 72+, Safari 13.1+ — anything with Pointer Events and
Canvas 2D. The library uses no experimental APIs.

There is no IE11 build.

---

## 15. Development

```bash
npm install      # jsdom, for the test suite only
npm run build    # -> dist/ (UMD, minified, ESM)
npm test         # 145 assertions across the library + bundles
npm run demo     # serve the demo at http://localhost:8080/demo/
```

### Project layout

```
thor-cursor/
├── src/
│   ├── index.js       public entry point
│   ├── cursor.js      controller: canvas, rAF loop, public API
│   ├── hammer.js      procedural hammer sprite renderer
│   ├── lightning.js   midpoint-displacement bolt generator
│   ├── particles.js   typed-array spark/ring pool
│   ├── effects.js     arc pool, drag trail, click impact
│   ├── pointer.js     pointer tracking and smoothing
│   └── config.js      defaults, clamping, colour parsing
├── demo/              the showcase page
├── dist/              built bundles
├── test/              jsdom suites
├── build.js           dependency-free bundler
└── serve.js           static dev server
```

### How the lightning works

Bolts are generated by **midpoint displacement**: start with a straight
segment, jitter its midpoint perpendicular to the line, then recurse on both
halves with half the displacement. That self-similarity is what gives real
lightning its look — a random walk reads as scribble, and a smooth curve reads
as a neon tube.

Branches fork from random interior points and are drawn thinner and
shorter-lived, producing the tree-like silhouette. Each arc is then drawn twice:
a wide low-alpha stroke in the theme colour for the glow, then a thin
near-white stroke for the core, both under `lighter` compositing.

---

## 16. Licence and attribution

MIT. See [LICENSE](LICENSE).

### Design originality

The hammer is an **original fantasy war-hammer design**, drawn procedurally
with canvas paths — there are no image assets, no traced props, and no
third-party artwork in this project. The rune marks are abstract invented
shapes, not glyphs from any existing work.

This project is **not affiliated with, endorsed by, or derived from** Marvel,
Disney, or any of their properties. It contains no Marvel logos, characters,
names, or assets. "Mjolnir" and "Thor" refer to figures from Norse mythology,
which is public domain; the visual design deliberately avoids resembling any
specific film prop.
