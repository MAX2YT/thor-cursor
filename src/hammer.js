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

import { rgba } from './config.js';

export class HammerRenderer {
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
