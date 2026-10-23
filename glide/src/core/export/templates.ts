// Cook Export Studio templates. Every template is a pure function from real
// recap data to an SVG document in "design units" (shorter side = 1080), which
// the renderer rasterizes at the exact output resolution — vector-sharp at 4K.

import { formatCents, formatNumber, formatPct } from '../../shared/format';
import { CATEGORY_LABEL } from '../products/catalog';
import { carrierName } from '../tracking/carriers';
import type { RecapData, RecapProduct } from './data';
import { FONT_BODY, FONT_DISPLAY, FONT_MONO, arc, bestGrid, esc, fitFont, gridLines, initials, palette, seeded, starfield, textWidth, truncate, wrapText, type Palette } from './svg';

export type TemplateId = 'galactic' | 'legendary' | 'wall' | 'leaderboard' | 'retailers' | 'shipments' | 'custom';

export interface TemplateOptions {
  width: number;
  height: number;
  transparent?: boolean;
  headline?: 'net' | 'gross';
  title?: string;
  subtitle?: string;
  watermark?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'none';
  /** 0..1 — used by animated exports for counting numbers and entrances. */
  progress?: number;
  maxProducts?: number;
  showTitles?: boolean;
}

export interface TemplateDef {
  id: TemplateId;
  name: string;
  description: string;
  supportsTransparent: boolean;
  render(d: RecapData, o: TemplateOptions, custom?: CustomProject): string;
}

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const stage = (o: TemplateOptions, start: number, end: number) => (o.progress === undefined ? 1 : ease((o.progress - start) / Math.max(0.0001, end - start)));
const count = (v: number, o: TemplateOptions, s = 0, e = 0.7) => Math.round(v * stage(o, s, e));
const money = (c: number, cur: string, compact = false) => formatCents(c, cur, { compact });
let uid = 0;
const id = (p: string) => `${p}${++uid}`;

// ---------------------------------------------------------------------------
// Shared building blocks

function defs(p: Palette): string {
  return `<defs>
  <linearGradient id="gText" x1="0" y1="0" x2="1" y2="0.3"><stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="${p.accent2}"/><stop offset="1" stop-color="${p.accent3}"/></linearGradient>
  <linearGradient id="gAccent" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.accent}"/><stop offset="1" stop-color="${p.accent3}"/></linearGradient>
  <linearGradient id="gCool" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${p.accent2}"/><stop offset="1" stop-color="${p.accent}"/></linearGradient>
  <linearGradient id="gGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3b0"/><stop offset="0.5" stop-color="#f5c542"/><stop offset="1" stop-color="#b8860b"/></linearGradient>
  <linearGradient id="gSilver" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#c9d1e3"/><stop offset="1" stop-color="#7d879c"/></linearGradient>
  <linearGradient id="gBronze" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd2a8"/><stop offset="0.5" stop-color="#d08a4f"/><stop offset="1" stop-color="#7a4a24"/></linearGradient>
  <linearGradient id="gGlass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.09"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.025"/></linearGradient>
  <linearGradient id="gEdge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.28"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0.06"/><stop offset="1" stop-color="${p.accent}" stop-opacity="0.35"/></linearGradient>
  <radialGradient id="gTile" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="${p.accent}" stop-opacity="0.22"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
  <filter id="blurXL" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="90"/></filter>
  <filter id="blurL" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>
  <filter id="glow" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="18"/></filter>
  <filter id="glowS" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="6"/></filter>
  <linearGradient id="fadeGrid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.6" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0.3"/></linearGradient>
  <mask id="gridMask"><rect width="100%" height="100%" fill="url(#fadeGrid)"/></mask>
</defs>`;
}

function background(W: number, H: number, p: Palette, seed: string, o: TemplateOptions, style: 'galaxy' | 'aurora' | 'holo' = 'galaxy'): string {
  if (o.transparent) return '';
  const r = seeded(seed + style);
  const blobs = [
    { x: W * (0.15 + r() * 0.2), y: H * (0.1 + r() * 0.2), rx: W * 0.45, ry: H * 0.32, c: p.accent, o: 0.32 },
    { x: W * (0.7 + r() * 0.2), y: H * (0.25 + r() * 0.25), rx: W * 0.4, ry: H * 0.35, c: p.accent3, o: 0.22 },
    { x: W * (0.4 + r() * 0.2), y: H * (0.85 + r() * 0.1), rx: W * 0.55, ry: H * 0.25, c: p.accent2, o: 0.18 },
  ];
  const nebula = blobs.map((b) => `<ellipse cx="${b.x}" cy="${b.y}" rx="${b.rx}" ry="${b.ry}" fill="${b.c}" opacity="${b.o}" filter="url(#blurXL)"/>`).join('');
  const rays =
    style === 'holo'
      ? Array.from({ length: 28 }, (_, i) => {
          const a = (i / 28) * Math.PI * 2;
          const len = Math.max(W, H);
          const cx = W / 2;
          const cy = H * 0.42;
          const w = 0.035;
          return `<path d="M${cx} ${cy} L${cx + Math.cos(a - w) * len} ${cy + Math.sin(a - w) * len} L${cx + Math.cos(a + w) * len} ${cy + Math.sin(a + w) * len} Z" fill="${i % 2 ? p.accent2 : p.accent3}" opacity="${(0.03 + r() * 0.05).toFixed(3)}"/>`;
        }).join('')
      : '';
  return `<rect width="${W}" height="${H}" fill="${p.bg0}"/>
<rect width="${W}" height="${H}" fill="${p.bg1}" opacity="0.55"/>
${nebula}${rays}
<g mask="url(#gridMask)">${gridLines(W, H, Math.round(Math.min(W, H) / 18), 0.045)}</g>
${starfield(W, H, seed, Math.round((W * H) / 5200))}
<rect width="${W}" height="${H}" fill="url(#vignette)" opacity="0.9"/>
<defs><radialGradient id="vignette" cx="50%" cy="45%" r="75%"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.65"/></radialGradient></defs>`;
}

function glass(x: number, y: number, w: number, h: number, r: number, extra = ''): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#gGlass)" stroke="url(#gEdge)" stroke-width="1.5" ${extra}/>`;
}

function brandMark(x: number, y: number, size: number, d: RecapData, p: Palette): string {
  if (d.logo) {
    const cid = id('logo');
    return `<defs><clipPath id="${cid}"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.24}"/></clipPath></defs><image href="${d.logo}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" clip-path="url(#${cid})"/>`;
  }
  const cx = x + size / 2;
  const cy = y + size / 2;
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${cx + (size / 2) * Math.cos(a)},${cy + (size / 2) * Math.sin(a)}`;
  }).join(' ');
  return `<polygon points="${pts}" fill="url(#gAccent)" opacity="0.95"/><polygon points="${pts}" fill="none" stroke="#fff" stroke-opacity="0.5" stroke-width="1.5"/>
<text x="${cx}" y="${cy + size * 0.17}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${size * 0.46}" fill="#fff" text-anchor="middle">${esc(initials(d.brandName))}</text>`;
}

function header(W: number, pad: number, d: RecapData, p: Palette, title: string, scale: number): string {
  const s = 64 * scale;
  const dateW = Math.min(W * 0.42, 40 * scale + d.dateLabel.length * 15 * scale);
  return `<g>
${brandMark(pad, pad, s, d, p)}
<text x="${pad + s + 22 * scale}" y="${pad + s * 0.45}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${30 * scale}" fill="${p.text}" letter-spacing="${1 * scale}">${esc(d.brandName.toUpperCase())}</text>
<text x="${pad + s + 22 * scale}" y="${pad + s * 0.88}" font-family="${FONT_BODY}" font-weight="600" font-size="${17 * scale}" fill="${p.muted}" letter-spacing="${4 * scale}">${esc(title.toUpperCase())}</text>
${glass(W - pad - dateW, pad + s * 0.12, dateW, s * 0.76, s * 0.38)}
<text x="${W - pad - dateW / 2}" y="${pad + s * 0.62}" font-family="${FONT_MONO}" font-weight="700" font-size="${19 * scale}" fill="${p.text}" text-anchor="middle" letter-spacing="${1 * scale}">${esc(d.dateLabel.toUpperCase())}</text>
</g>`;
}

function footer(W: number, H: number, pad: number, d: RecapData, p: Palette, scale: number, o: TemplateOptions): string {
  const y = H - pad * 0.62;
  const sample = d.isSample
    ? `<g><rect x="${W / 2 - 170 * scale}" y="${y - 44 * scale}" width="${340 * scale}" height="${30 * scale}" rx="${15 * scale}" fill="#f59e0b" opacity="0.9"/><text x="${W / 2}" y="${y - 23.5 * scale}" font-family="${FONT_BODY}" font-weight="800" font-size="${14 * scale}" fill="#1a1205" text-anchor="middle" letter-spacing="${3 * scale}">SAMPLE DATA — NOT REAL ORDERS</text></g>`
    : '';
  const wm = o.watermark ?? 'bottom-right';
  const wmText = `${d.brandName} · GLIDE`;
  const wmPos: Record<string, [number, number, string]> = {
    'bottom-right': [W - pad, y, 'end'],
    'bottom-left': [pad, y, 'start'],
    'top-right': [W - pad, pad * 0.5, 'end'],
    'top-left': [pad, pad * 0.5, 'start'],
  };
  const watermark = wm !== 'none' && wmPos[wm] ? `<text x="${wmPos[wm][0]}" y="${wmPos[wm][1]}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${15 * scale}" fill="#fff" opacity="0.55" text-anchor="${wmPos[wm][2]}" letter-spacing="${2 * scale}">${esc(wmText.toUpperCase())}</text>` : '';
  const left = wm === 'bottom-left' ? W - pad : pad;
  const anchor = wm === 'bottom-left' ? 'end' : 'start';
  return `${sample}<text x="${left}" y="${y}" font-family="${FONT_BODY}" font-weight="500" font-size="${13 * scale}" fill="${p.muted}" text-anchor="${anchor}" letter-spacing="${0.5 * scale}">From ${formatNumber(d.kpis.orders)} recorded orders · ${esc(d.rangeLabel)}</text>${watermark}`;
}

function kpiChip(x: number, y: number, w: number, h: number, label: string, value: string, color: string, scale: number, p: Palette): string {
  const vs = fitFont(value, w - 36 * scale, h * 0.46, 12, 0.62);
  return `<g>${glass(x, y, w, h, 18 * scale)}
<rect x="${x + 18 * scale}" y="${y + 18 * scale}" width="${26 * scale}" height="${5 * scale}" rx="${2.5 * scale}" fill="${color}"/>
<text x="${x + 18 * scale}" y="${y + h * 0.45}" font-family="${FONT_BODY}" font-weight="700" font-size="${13.5 * scale}" fill="${p.muted}" letter-spacing="${2.4 * scale}">${esc(label.toUpperCase())}</text>
<text x="${x + 18 * scale}" y="${y + h * 0.84}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${vs}" fill="${p.text}">${esc(value)}</text></g>`;
}

function productTile(x: number, y: number, w: number, h: number, pr: RecapProduct, p: Palette, scale: number, showTitle: boolean, appear = 1): string {
  const r = Math.min(22 * scale, w * 0.12);
  const cid = id('pc');
  const imgPad = w * 0.08;
  const titleH = showTitle ? Math.min(h * 0.2, 46 * scale) : 0;
  const badgeH = Math.max(18, Math.min(h * (showTitle ? 0.17 : 0.22), 40 * scale));
  const imgH = h - titleH - badgeH * 0.55 - imgPad;
  const qty = `×${formatNumber(pr.units)}`;
  const bw = Math.max(badgeH * 1.6, badgeH * 0.62 * qty.length + badgeH * 0.6);
  const img = pr.image
    ? `<image href="${pr.image}" x="${x + imgPad}" y="${y + imgPad}" width="${w - imgPad * 2}" height="${imgH - imgPad}" preserveAspectRatio="xMidYMid meet" clip-path="url(#${cid})"/>`
    : `<text x="${x + w / 2}" y="${y + imgH / 2 + 8 * scale}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${Math.min(30 * scale, w * 0.14)}" fill="${p.muted}" text-anchor="middle">${esc(CATEGORY_LABEL[pr.category]?.split(' ').map((s) => s[0]).join('') ?? '◆')}</text>`;
  const fs = Math.max(9, Math.min(15 * scale, w * 0.075));
  const lines = showTitle ? wrapText(pr.title.replace(/^Pok[ée]mon TCG:\s*/i, ''), w - 20 * scale, fs, 2) : [];
  const ty = y + h - titleH + fs * 0.4;
  return `<g opacity="${appear.toFixed(3)}" transform="translate(0 ${((1 - appear) * 30 * scale).toFixed(1)})">
<defs><clipPath id="${cid}"><rect x="${x + imgPad}" y="${y + imgPad}" width="${w - imgPad * 2}" height="${imgH - imgPad}" rx="${r * 0.6}"/></clipPath></defs>
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#gGlass)" stroke="url(#gEdge)" stroke-width="1.2"/>
<rect x="${x}" y="${y}" width="${w}" height="${imgH}" rx="${r}" fill="url(#gTile)"/>
${img}
<rect x="${x + w / 2 - bw / 2}" y="${y + imgH - badgeH * 0.45}" width="${bw}" height="${badgeH}" rx="${badgeH / 2}" fill="url(#gAccent)"/>
<text x="${x + w / 2}" y="${y + imgH - badgeH * 0.45 + badgeH * 0.72}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${badgeH * 0.62}" fill="#fff" text-anchor="middle">${esc(qty)}</text>
${lines.map((l, i) => `<text x="${x + w / 2}" y="${ty + i * fs * 1.25}" font-family="${FONT_BODY}" font-weight="600" font-size="${fs}" fill="${p.text}" fill-opacity="0.86" text-anchor="middle">${esc(l)}</text>`).join('')}
</g>`;
}

function productGrid(x: number, y: number, w: number, h: number, products: RecapProduct[], p: Palette, scale: number, o: TemplateOptions, showTitles?: boolean): string {
  if (!products.length) return `<text x="${x + w / 2}" y="${y + h / 2}" font-family="${FONT_BODY}" font-size="${22 * scale}" fill="${p.muted}" text-anchor="middle">No products in this range</text>`;
  const gap = Math.max(6, Math.min(18 * scale, (w / Math.sqrt(products.length)) * 0.06));
  const g = bestGrid(products.length, w, h, gap, showTitles === false ? 1.05 : 1.22);
  const titles = showTitles ?? g.tileW > 120 * scale;
  const gridW = g.cols * g.tileW + (g.cols - 1) * gap;
  const ox = x + (w - gridW) / 2;
  const rowsUsed = Math.ceil(products.length / g.cols);
  const gridH = rowsUsed * g.tileH + (rowsUsed - 1) * gap;
  const oy = y + (h - gridH) / 2;
  return products
    .map((pr, i) => {
      const c = i % g.cols;
      const rr = Math.floor(i / g.cols);
      const lastRowCount = products.length - rr * g.cols;
      const rowOffset = lastRowCount < g.cols ? ((g.cols - lastRowCount) * (g.tileW + gap)) / 2 : 0;
      const appear = stage(o, 0.25 + (i / products.length) * 0.5, 0.45 + (i / products.length) * 0.5);
      return productTile(ox + rowOffset + c * (g.tileW + gap), oy + rr * (g.tileH + gap), g.tileW, g.tileH, pr, p, scale, titles, appear);
    })
    .join('');
}

function retailerBadges(x: number, y: number, maxW: number, d: RecapData, scale: number, p: Palette, center = false): string {
  const h = 40 * scale;
  const items = d.retailers.slice(0, 8).map((r) => {
    const label = `${r.shortName}  ${formatNumber(r.live)}`;
    return { r, label, w: 30 * scale + label.length * 10.5 * scale };
  });
  let total = items.reduce((s, i) => s + i.w + 10 * scale, -10 * scale);
  while (total > maxW && items.length > 1) {
    const rm = items.pop()!;
    total -= rm.w + 10 * scale;
  }
  let cx = center ? x + (maxW - total) / 2 : x;
  return items
    .map((i) => {
      const out = `<g><rect x="${cx}" y="${y}" width="${i.w}" height="${h}" rx="${h / 2}" fill="${i.r.color}" fill-opacity="0.16" stroke="${i.r.color}" stroke-opacity="0.75" stroke-width="1.5"/>
<circle cx="${cx + 18 * scale}" cy="${y + h / 2}" r="${5 * scale}" fill="${i.r.color}"/>
<text x="${cx + 30 * scale}" y="${y + h * 0.66}" font-family="${FONT_BODY}" font-weight="700" font-size="${16 * scale}" fill="${p.text}">${esc(i.r.shortName)} <tspan fill="${p.muted}" font-family="${FONT_MONO}">${formatNumber(i.r.live)}</tspan></text></g>`;
      cx += i.w + 10 * scale;
      return out;
    })
    .join('');
}

function svgDoc(W: number, H: number, body: string, p: Palette): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs(p)}${body}</svg>`;
}

function heroValue(d: RecapData, o: TemplateOptions) {
  const net = (o.headline ?? 'net') === 'net';
  return { cents: net ? d.kpis.netCents : d.kpis.grossCents, label: net ? 'Total Secured' : 'Gross Checkout Value' };
}

// ---------------------------------------------------------------------------
// 1. Galactic Checkout Recap

const galactic: TemplateDef = {
  id: 'galactic',
  name: 'Galactic Checkout Recap',
  description: 'Massive glowing total, live/canceled/success KPIs, retailer badges and a product grid over a starfield.',
  supportsTransparent: true,
  render(d, o) {
    const W = o.width;
    const H = o.height;
    const p = palette(d.accent);
    const scale = Math.min(W, H) / 1080;
    const pad = 64 * scale;
    const landscape = W > H * 1.25;
    const k = d.kpis;
    const hv = heroValue(d, o);
    const cur = k.currency;
    const heroStr = money(count(hv.cents, o), cur);
    let body = background(W, H, p, `galactic${d.rangeLabel}`, o, 'galaxy');
    body += header(W, pad, d, p, o.title ?? 'Checkout Recap', scale);
    const top = pad + 110 * scale;
    if (landscape) {
      const leftW = W * 0.4;
      const fs = fitFont(heroStr, leftW - pad, 168 * scale, 40, 0.6);
      body += `<text x="${pad}" y="${top + 40 * scale}" font-family="${FONT_BODY}" font-weight="700" font-size="${18 * scale}" fill="${p.muted}" letter-spacing="${6 * scale}">${esc(hv.label.toUpperCase())}</text>
<text x="${pad}" y="${top + 40 * scale + fs * 0.98}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${fs}" fill="${p.accent}" filter="url(#glow)" opacity="0.85">${esc(heroStr)}</text>
<text x="${pad}" y="${top + 40 * scale + fs * 0.98}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${fs}" fill="url(#gText)">${esc(heroStr)}</text>`;
      const chipsTop = top + 80 * scale + fs;
      const cw = (leftW - pad - 16 * scale) / 2;
      const ch = 112 * scale;
      const chips: [string, string, string][] = [
        ['Orders', formatNumber(count(k.orders, o)), p.accent2],
        ['Live', formatNumber(count(k.liveOrders, o)), '#34d399'],
        ['Canceled', formatNumber(count(k.canceledOrders, o)), '#fb7185'],
        ['Success', formatPct(k.successRate * stage(o, 0, 0.7)), p.accent3],
        ['Units', formatNumber(count(k.netUnits, o)), p.hot],
        ['Buyers', formatNumber(count(k.activeBuyers, o)), '#fbbf24'],
      ];
      chips.forEach(([l, v, c], i) => (body += kpiChip(pad + (i % 2) * (cw + 16 * scale), chipsTop + Math.floor(i / 2) * (ch + 16 * scale), cw, ch, l, v, c, scale, p)));
      body += retailerBadges(pad, H - pad - 100 * scale, leftW - pad, d, scale, p);
      body += productGrid(leftW + 30 * scale, top, W - leftW - 30 * scale - pad, H - top - pad - 50 * scale, d.products.slice(0, o.maxProducts ?? 24), p, scale, o, o.showTitles);
    } else {
      const fs = fitFont(heroStr, W - pad * 2, (W > H ? 190 : 200) * scale, 40, 0.6);
      body += `<text x="${W / 2}" y="${top + 34 * scale}" font-family="${FONT_BODY}" font-weight="700" font-size="${18 * scale}" fill="${p.muted}" letter-spacing="${7 * scale}" text-anchor="middle">${esc(hv.label.toUpperCase())}</text>
<text x="${W / 2}" y="${top + 30 * scale + fs * 0.98}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${fs}" fill="${p.accent}" filter="url(#glow)" opacity="0.85" text-anchor="middle">${esc(heroStr)}</text>
<text x="${W / 2}" y="${top + 30 * scale + fs * 0.98}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${fs}" fill="url(#gText)" text-anchor="middle">${esc(heroStr)}</text>`;
      const chipsTop = top + 70 * scale + fs;
      const n = 4;
      const gap = 14 * scale;
      const cw = (W - pad * 2 - gap * (n - 1)) / n;
      const ch = 108 * scale;
      const chips: [string, string, string][] = [
        ['Orders', formatNumber(count(k.orders, o)), p.accent2],
        ['Live', formatNumber(count(k.liveOrders, o)), '#34d399'],
        ['Canceled', formatNumber(count(k.canceledOrders, o)), '#fb7185'],
        ['Success', formatPct(k.successRate * stage(o, 0, 0.7)), p.accent3],
      ];
      chips.forEach(([l, v, c], i) => (body += kpiChip(pad + i * (cw + gap), chipsTop, cw, ch, l, v, c, scale, p)));
      const badgesY = chipsTop + ch + 26 * scale;
      body += retailerBadges(pad, badgesY, W - pad * 2, d, scale, p, true);
      const gridTop = badgesY + 70 * scale;
      body += productGrid(pad, gridTop, W - pad * 2, H - gridTop - pad - 60 * scale, d.products.slice(0, o.maxProducts ?? (H > W * 1.3 ? 18 : 12)), p, scale, o, o.showTitles);
    }
    body += footer(W, H, pad, d, p, scale, o);
    return svgDoc(W, H, body, p);
  },
};

// ---------------------------------------------------------------------------
// 2. Legendary Drop

const legendary: TemplateDef = {
  id: 'legendary',
  name: 'Legendary Drop',
  description: 'Featured product in rarity-style lighting, giant checkout metrics and a collector showcase.',
  supportsTransparent: false,
  render(d, o) {
    const W = o.width;
    const H = o.height;
    const p = palette(d.accent);
    const scale = Math.min(W, H) / 1080;
    const pad = 64 * scale;
    const k = d.kpis;
    const hero = d.products[0];
    const landscape = W > H * 1.25;
    let body = background(W, H, p, `legendary${d.rangeLabel}`, o, 'holo');
    body += header(W, pad, d, p, o.title ?? 'Legendary Drop', scale);
    const cx = landscape ? W * 0.32 : W / 2;
    const tall = H > W * 1.3;
    const R = (landscape ? Math.min(H * 0.3, W * 0.2) : tall ? W * 0.3 : Math.min(W, H) * 0.14) * (0.85 + 0.15 * stage(o, 0, 0.5));
    const cy = landscape ? H * 0.5 : pad + 130 * scale + R * 1.3;
    // Rarity halo: concentric rings + foil sweep.
    body += `<circle cx="${cx}" cy="${cy}" r="${R * 1.35}" fill="${p.accent3}" opacity="0.22" filter="url(#blurL)"/>
<circle cx="${cx}" cy="${cy}" r="${R * 1.05}" fill="none" stroke="url(#gGold)" stroke-width="${3 * scale}" opacity="0.9"/>
<circle cx="${cx}" cy="${cy}" r="${R * 1.13}" fill="none" stroke="#fff" stroke-width="${1 * scale}" opacity="0.35" stroke-dasharray="${2 * scale} ${10 * scale}"/>
<path d="${arc(cx, cy, R * 1.22, 200, 340)}" fill="none" stroke="url(#gCool)" stroke-width="${5 * scale}" stroke-linecap="round" opacity="0.8"/>
<path d="${arc(cx, cy, R * 1.22, 20, 160)}" fill="none" stroke="url(#gAccent)" stroke-width="${5 * scale}" stroke-linecap="round" opacity="0.8"/>`;
    if (hero) {
      const cid = id('hero');
      body += hero.image
        ? `<defs><clipPath id="${cid}"><circle cx="${cx}" cy="${cy}" r="${R}"/></clipPath></defs><circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#gTile)"/><image href="${hero.image}" x="${cx - R * 0.86}" y="${cy - R * 0.86}" width="${R * 1.72}" height="${R * 1.72}" preserveAspectRatio="xMidYMid meet" clip-path="url(#${cid})"/>`
        : `<circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#gTile)"/>`;
      const label = 'FEATURED PULL';
      body += `<rect x="${cx - 120 * scale}" y="${cy + R * 1.1}" width="${240 * scale}" height="${38 * scale}" rx="${19 * scale}" fill="url(#gGold)"/>
<text x="${cx}" y="${cy + R * 1.1 + 26 * scale}" font-family="${FONT_BODY}" font-weight="800" font-size="${16 * scale}" fill="#2a1d00" text-anchor="middle" letter-spacing="${4 * scale}">${label}</text>`;
      const tl = wrapText(hero.title.replace(/^Pok[ée]mon TCG:\s*/i, ''), landscape ? W * 0.5 : W - pad * 2, 30 * scale, 2);
      tl.forEach((l, i) => (body += `<text x="${cx}" y="${cy + R * 1.1 + 84 * scale + i * 38 * scale}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${30 * scale}" fill="${p.text}" text-anchor="middle">${esc(l)}</text>`));
      body += `<text x="${cx}" y="${cy + R * 1.1 + 84 * scale + tl.length * 38 * scale + 6 * scale}" font-family="${FONT_MONO}" font-weight="700" font-size="${22 * scale}" fill="${p.accent2}" text-anchor="middle">×${formatNumber(count(hero.units, o))} SECURED</text>`;
    }
    const hv = heroValue(d, o);
    const heroStr = money(count(hv.cents, o), k.currency);
    const mx = landscape ? W * 0.62 : pad;
    const mw = landscape ? W - mx - pad : W - pad * 2;
    let my = landscape ? H * 0.24 : cy + R * 1.1 + (tall ? 230 : 175) * scale;
    const fs = fitFont(heroStr, mw, (tall || landscape ? 150 : 110) * scale, 36, 0.6);
    const anchor = landscape ? 'start' : 'middle';
    const ax = landscape ? mx : W / 2;
    body += `<text x="${ax}" y="${my}" font-family="${FONT_BODY}" font-weight="700" font-size="${17 * scale}" fill="${p.muted}" letter-spacing="${6 * scale}" text-anchor="${anchor}">${esc(hv.label.toUpperCase())}</text>
<text x="${ax}" y="${my + fs}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${fs}" fill="#f5c542" filter="url(#glow)" opacity="0.7" text-anchor="${anchor}">${esc(heroStr)}</text>
<text x="${ax}" y="${my + fs}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${fs}" fill="url(#gGold)" text-anchor="${anchor}">${esc(heroStr)}</text>`;
    my += fs + (landscape || tall ? 40 : 26) * scale;
    const stats: [string, string][] = [
      ['Orders', formatNumber(count(k.orders, o))],
      ['Live', formatNumber(count(k.liveOrders, o))],
      ['Units', formatNumber(count(k.netUnits, o))],
      ['Success', formatPct(k.successRate * stage(o, 0, 0.7))],
    ];
    const cols = landscape ? 2 : 4;
    const sw = (mw - (cols - 1) * 14 * scale) / cols;
    const sh = (landscape || tall ? 100 : 88) * scale;
    stats.forEach(([l, v], i) => (body += kpiChip(mx + (i % cols) * (sw + 14 * scale), my + Math.floor(i / cols) * (sh + 14 * scale), sw, sh, l, v, i === 1 ? '#34d399' : i === 3 ? p.accent3 : '#f5c542', scale, p)));
    my += Math.ceil(stats.length / cols) * (sh + 14 * scale) + 20 * scale;
    const rest = d.products.slice(1, landscape ? 7 : 6);
    if (rest.length && H - pad - 60 * scale - my > 120 * scale) body += productGrid(mx, my, mw, H - pad - 60 * scale - my, rest, p, scale, o, false);
    body += footer(W, H, pad, d, p, scale, o);
    return svgDoc(W, H, body, p);
  },
};

// ---------------------------------------------------------------------------
// 3. Wall of Success

const wall: TemplateDef = {
  id: 'wall',
  name: 'Wall of Success',
  description: 'Every unique product secured with its total quantity — scales to hundreds of tiles.',
  supportsTransparent: true,
  render(d, o) {
    const W = o.width;
    const H = o.height;
    const p = palette(d.accent);
    const scale = Math.min(W, H) / 1080;
    const pad = 56 * scale;
    let body = background(W, H, p, `wall${d.rangeLabel}`, o, 'aurora');
    body += header(W, pad, d, p, o.title ?? 'Wall of Success', scale);
    const k = d.kpis;
    const line = `${formatNumber(count(d.products.length, o))} products · ${formatNumber(count(k.netUnits, o))} units · ${money(count(heroValue(d, o).cents, o), k.currency)} ${(o.headline ?? 'net') === 'net' ? 'secured' : 'gross'}`;
    body += `<text x="${W / 2}" y="${pad + 128 * scale}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${fitFont(line, W - pad * 2, 40 * scale, 14)}" fill="url(#gText)" text-anchor="middle">${esc(line)}</text>`;
    const top = pad + 160 * scale;
    body += productGrid(pad, top, W - pad * 2, H - top - pad - 40 * scale, d.products.slice(0, o.maxProducts ?? 400), p, scale, o, o.showTitles);
    body += footer(W, H, pad, d, p, scale, o);
    return svgDoc(W, H, body, p);
  },
};

// ---------------------------------------------------------------------------
// 4. Spending Leaderboard

const leaderboard: TemplateDef = {
  id: 'leaderboard',
  name: 'Spending Leaderboard',
  description: 'Top 10 members by net spend with rank medallions, orders and items. Supports masked names.',
  supportsTransparent: true,
  render(d, o) {
    const W = o.width;
    const H = o.height;
    const p = palette(d.accent);
    const scale = Math.min(W, H) / 1080;
    const pad = 64 * scale;
    let body = background(W, H, p, `leader${d.rangeLabel}`, o, 'galaxy');
    body += header(W, pad, d, p, o.title ?? 'Spending Leaderboard', scale);
    const leaders = d.leaders.slice(0, 10);
    const top = pad + 120 * scale;
    const avail = H - top - pad - 60 * scale;
    const rowH = Math.min(118 * scale, avail / Math.max(leaders.length, 1));
    const gap = rowH * 0.14;
    const max = Math.max(1, ...leaders.map((l) => l.netCents));
    const medal = ['url(#gGold)', 'url(#gSilver)', 'url(#gBronze)'];
    leaders.forEach((l, i) => {
      const y = top + i * rowH;
      const h = rowH - gap;
      const appear = stage(o, 0.1 + i * 0.05, 0.4 + i * 0.05);
      const x = pad;
      const w = W - pad * 2;
      const av = h * 0.72;
      const cid = id('av');
      const barW = (w * 0.42 * l.netCents) / max;
      const rankFill = medal[i] ?? 'url(#gGlass)';
      const amount = money(count(l.netCents, o, 0.1, 0.8), d.kpis.currency);
      body += `<g opacity="${appear.toFixed(3)}" transform="translate(${((1 - appear) * -40 * scale).toFixed(1)} 0)">
${glass(x, y, w, h, h / 2, i < 3 ? `stroke-opacity="0.9"` : '')}
<rect x="${x + h * 0.9 + av + 30 * scale}" y="${y + h * 0.78}" width="${barW}" height="${4 * scale}" rx="${2 * scale}" fill="url(#gCool)" opacity="0.8"/>
<circle cx="${x + h / 2}" cy="${y + h / 2}" r="${h * 0.36}" fill="${rankFill}"/>
<text x="${x + h / 2}" y="${y + h / 2 + h * 0.13}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${h * 0.36}" fill="${i < 3 ? '#1b1405' : p.text}" text-anchor="middle">${l.rank}</text>
<defs><clipPath id="${cid}"><circle cx="${x + h * 0.9 + av / 2 + 14 * scale}" cy="${y + h / 2}" r="${av / 2}"/></clipPath></defs>
<circle cx="${x + h * 0.9 + av / 2 + 14 * scale}" cy="${y + h / 2}" r="${av / 2}" fill="url(#gAccent)"/>
${l.avatar ? `<image href="${l.avatar}" x="${x + h * 0.9 + 14 * scale}" y="${y + h / 2 - av / 2}" width="${av}" height="${av}" clip-path="url(#${cid})" preserveAspectRatio="xMidYMid slice"/>` : `<text x="${x + h * 0.9 + av / 2 + 14 * scale}" y="${y + h / 2 + av * 0.15}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${av * 0.4}" fill="#fff" text-anchor="middle">${esc(initials(l.name))}</text>`}
<text x="${x + h * 0.9 + av + 30 * scale}" y="${y + h * 0.48}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${Math.min(30 * scale, h * 0.32)}" fill="${p.text}">${esc(truncate(l.name, w * 0.36, Math.min(30 * scale, h * 0.32)))}</text>
<text x="${x + h * 0.9 + av + 30 * scale}" y="${y + h * 0.7}" font-family="${FONT_BODY}" font-weight="600" font-size="${Math.min(16 * scale, h * 0.18)}" fill="${p.muted}">${formatNumber(l.orders)} orders · ${formatNumber(l.units)} items</text>
<text x="${x + w - 34 * scale}" y="${y + h / 2 + h * 0.13}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${Math.min(40 * scale, h * 0.38)}" fill="${i === 0 ? '#f5c542' : p.text}" text-anchor="end">${esc(amount)}</text>
</g>`;
    });
    if (!leaders.length) body += `<text x="${W / 2}" y="${H / 2}" font-family="${FONT_BODY}" font-size="${24 * scale}" fill="${p.muted}" text-anchor="middle">No matched members in this range</text>`;
    body += footer(W, H, pad, d, p, scale, o);
    return svgDoc(W, H, body, p);
  },
};

// ---------------------------------------------------------------------------
// 5. Retailer Domination

const retailers: TemplateDef = {
  id: 'retailers',
  name: 'Retailer Domination',
  description: 'Cinematic comparison of retailers: spend, orders, units and success rate rings.',
  supportsTransparent: true,
  render(d, o) {
    const W = o.width;
    const H = o.height;
    const p = palette(d.accent);
    const scale = Math.min(W, H) / 1080;
    const pad = 64 * scale;
    let body = background(W, H, p, `retail${d.rangeLabel}`, o, 'aurora');
    body += header(W, pad, d, p, o.title ?? 'Retailer Domination', scale);
    const list = d.retailers.slice(0, W > H ? 6 : 8);
    const top = pad + 130 * scale;
    const availH = H - top - pad - 60 * scale;
    const cols = W > H * 1.25 ? Math.min(3, list.length) : W > H * 0.9 ? 2 : 1;
    const rows = Math.ceil(list.length / Math.max(cols, 1));
    const gap = 20 * scale;
    const cw = (W - pad * 2 - gap * (cols - 1)) / Math.max(cols, 1);
    const ch = Math.min((availH - gap * (rows - 1)) / Math.max(rows, 1), 340 * scale);
    const max = Math.max(1, ...list.map((r) => r.netCents));
    list.forEach((r, i) => {
      const x = pad + (i % cols) * (cw + gap);
      const y = top + Math.floor(i / cols) * (ch + gap);
      const appear = stage(o, 0.05 + i * 0.07, 0.4 + i * 0.07);
      const ringR = Math.min(ch * 0.3, cw * 0.17);
      const rcx = x + cw - ringR - 28 * scale;
      const rcy = y + ch / 2;
      const deg = 359.9 * r.successRate * appear;
      const label = money(count(r.netCents, o), d.kpis.currency);
      const nameSize = Math.min(34 * scale, ch * 0.16);
      body += `<g opacity="${appear.toFixed(3)}">
<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="${26 * scale}" fill="${r.color}" fill-opacity="0.12" stroke="${r.color}" stroke-opacity="0.6" stroke-width="1.5"/>
<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="${26 * scale}" fill="url(#gGlass)"/>
<rect x="${x + 26 * scale}" y="${y + 26 * scale}" width="${6 * scale}" height="${ch - 52 * scale}" rx="${3 * scale}" fill="${r.color}"/>
<text x="${x + 50 * scale}" y="${y + 26 * scale + nameSize}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${nameSize}" fill="${p.text}">${esc(truncate(textWidth(r.name, nameSize) > cw - ringR * 2 - 110 * scale ? r.shortName : r.name, cw - ringR * 2 - 110 * scale, nameSize))}</text>
<text x="${x + 50 * scale}" y="${y + ch * 0.58}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${fitFont(label, cw - ringR * 2 - 110 * scale, ch * 0.22, 12)}" fill="url(#gText)">${esc(label)}</text>
<text x="${x + 50 * scale}" y="${y + ch - 30 * scale}" font-family="${FONT_BODY}" font-weight="600" font-size="${Math.min(17 * scale, ch * 0.08)}" fill="${p.muted}">${formatNumber(r.orders)} orders · ${formatNumber(r.units)} units · ${formatNumber(r.canceled)} canceled</text>
<rect x="${x + 50 * scale}" y="${y + ch * 0.66}" width="${(cw - ringR * 2 - 110 * scale) * (r.netCents / max) * appear}" height="${5 * scale}" rx="${2.5 * scale}" fill="${r.color}"/>
<circle cx="${rcx}" cy="${rcy}" r="${ringR}" fill="none" stroke="#fff" stroke-opacity="0.12" stroke-width="${10 * scale}"/>
${deg > 0.5 ? `<path d="${arc(rcx, rcy, ringR, 0, deg)}" fill="none" stroke="${r.color}" stroke-width="${10 * scale}" stroke-linecap="round"/>` : ''}
<text x="${rcx}" y="${rcy + ringR * 0.16}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${ringR * 0.46}" fill="${p.text}" text-anchor="middle">${formatPct(r.successRate * appear, 0)}</text>
<text x="${rcx}" y="${rcy + ringR * 0.5}" font-family="${FONT_BODY}" font-weight="700" font-size="${ringR * 0.17}" fill="${p.muted}" text-anchor="middle" letter-spacing="${2 * scale}">SUCCESS</text>
</g>`;
    });
    if (!list.length) body += `<text x="${W / 2}" y="${H / 2}" font-family="${FONT_BODY}" font-size="${24 * scale}" fill="${p.muted}" text-anchor="middle">No orders in this range</text>`;
    body += footer(W, H, pad, d, p, scale, o);
    return svgDoc(W, H, body, p);
  },
};

// ---------------------------------------------------------------------------
// 6. Shipment Intelligence

const shipments: TemplateDef = {
  id: 'shipments',
  name: 'Shipment Intelligence',
  description: 'Packages shipped, out for delivery, delivered and outstanding on a glowing pipeline, with carrier split.',
  supportsTransparent: true,
  render(d, o) {
    const W = o.width;
    const H = o.height;
    const p = palette(d.accent);
    const scale = Math.min(W, H) / 1080;
    const pad = 64 * scale;
    const s = d.shipments;
    let body = background(W, H, p, `ship${d.rangeLabel}`, o, 'galaxy');
    body += header(W, pad, d, p, o.title ?? 'Shipment Intelligence', scale);
    const stages: [string, number, string][] = [
      ['Label created', s.labelCreated, p.muted],
      ['In transit', s.inTransit, p.accent2],
      ['Out for delivery', s.outForDelivery, '#fbbf24'],
      ['Delivered', s.delivered, '#34d399'],
    ];
    const top = pad + 150 * scale;
    const big = formatNumber(count(s.packages, o));
    body += `<text x="${W / 2}" y="${top}" font-family="${FONT_BODY}" font-weight="700" font-size="${18 * scale}" fill="${p.muted}" letter-spacing="${7 * scale}" text-anchor="middle">PACKAGES TRACKED</text>
<text x="${W / 2}" y="${top + 150 * scale}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${150 * scale}" fill="${p.accent}" filter="url(#glow)" opacity="0.8" text-anchor="middle">${big}</text>
<text x="${W / 2}" y="${top + 150 * scale}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${150 * scale}" fill="url(#gText)" text-anchor="middle">${big}</text>`;
    const ly = top + 270 * scale;
    const lx0 = pad + 70 * scale;
    const lx1 = W - pad - 70 * scale;
    const step = (lx1 - lx0) / (stages.length - 1);
    const progress = s.packages ? (s.delivered + s.outForDelivery * 0.66 + s.inTransit * 0.33) / s.packages : 0;
    body += `<line x1="${lx0}" y1="${ly}" x2="${lx1}" y2="${ly}" stroke="#fff" stroke-opacity="0.15" stroke-width="${8 * scale}" stroke-linecap="round"/>
<line x1="${lx0}" y1="${ly}" x2="${lx0 + (lx1 - lx0) * progress * stage(o, 0.1, 0.8)}" y2="${ly}" stroke="url(#gCool)" stroke-width="${8 * scale}" stroke-linecap="round"/>
<line x1="${lx0}" y1="${ly}" x2="${lx0 + (lx1 - lx0) * progress * stage(o, 0.1, 0.8)}" y2="${ly}" stroke="${p.accent2}" stroke-width="${8 * scale}" stroke-linecap="round" filter="url(#glowS)"/>`;
    stages.forEach(([label, v, c], i) => {
      const x = lx0 + i * step;
      const pct = s.packages ? v / s.packages : 0;
      body += `<circle cx="${x}" cy="${ly}" r="${26 * scale}" fill="${p.bg0}" stroke="${c}" stroke-width="${4 * scale}"/>
<circle cx="${x}" cy="${ly}" r="${10 * scale}" fill="${c}"/>
<text x="${x}" y="${ly + 86 * scale}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${52 * scale}" fill="${p.text}" text-anchor="middle">${formatNumber(count(v, o))}</text>
<text x="${x}" y="${ly + 118 * scale}" font-family="${FONT_BODY}" font-weight="700" font-size="${15 * scale}" fill="${p.muted}" text-anchor="middle" letter-spacing="${2.5 * scale}">${label.toUpperCase()}</text>
<text x="${x}" y="${ly + 146 * scale}" font-family="${FONT_MONO}" font-weight="700" font-size="${15 * scale}" fill="${c}" text-anchor="middle">${formatPct(pct, 0)}</text>`;
    });
    const by = ly + 210 * scale;
    const chips: [string, string, string][] = [
      ['Outstanding', formatNumber(count(s.outstanding, o)), '#fb7185'],
      ['Exceptions', formatNumber(count(s.exceptions, o)), '#f97316'],
      ['Avg transit', s.avgTransitDays === null ? '—' : `${s.avgTransitDays.toFixed(1)} d`, p.accent3],
      ['Orders delivered', formatNumber(count(d.kpis.deliveredOrders, o)), '#34d399'],
    ];
    const n = W > H * 0.9 ? 4 : 2;
    const cw = (W - pad * 2 - 14 * scale * (n - 1)) / n;
    chips.forEach(([l, v, c], i) => (body += kpiChip(pad + (i % n) * (cw + 14 * scale), by + Math.floor(i / n) * 120 * scale, cw, 104 * scale, l, v, c, scale, p)));
    const cy = by + Math.ceil(chips.length / n) * 120 * scale + 20 * scale;
    if (s.byCarrier.length && H - pad - 60 * scale - cy > 60 * scale) {
      const total = s.byCarrier.reduce((t, c) => t + c.count, 0);
      const colors = [p.accent, p.accent2, p.accent3, '#34d399', '#fbbf24', '#fb7185'];
      let x = pad;
      const bw = W - pad * 2;
      body += `<text x="${pad}" y="${cy}" font-family="${FONT_BODY}" font-weight="700" font-size="${14 * scale}" fill="${p.muted}" letter-spacing="${3 * scale}">CARRIER SPLIT</text>`;
      s.byCarrier.slice(0, 6).forEach((c, i) => {
        const w = (bw * c.count) / total;
        body += `<rect x="${x}" y="${cy + 14 * scale}" width="${Math.max(0, w - 4 * scale)}" height="${26 * scale}" rx="${6 * scale}" fill="${colors[i % colors.length]}" opacity="0.85"/>
${w > 110 * scale ? `<text x="${x + 12 * scale}" y="${cy + 33 * scale}" font-family="${FONT_BODY}" font-weight="700" font-size="${14 * scale}" fill="#0b0d18">${esc(carrierName(c.carrier))} ${formatPct(c.count / total, 0)}</text>` : ''}`;
        x += w;
      });
    }
    body += footer(W, H, pad, d, p, scale, o);
    return svgDoc(W, H, body, p);
  },
};

// ---------------------------------------------------------------------------
// 7. Custom Creator

export type CustomElement =
  | { id: string; type: 'kpi'; x: number; y: number; w: number; h: number; metric: 'net' | 'gross' | 'orders' | 'live' | 'canceled' | 'success' | 'units' | 'buyers' | 'avgOrder' | 'delivered'; label?: string; color?: string }
  | { id: string; type: 'text'; x: number; y: number; w: number; h: number; text: string; size: number; weight: 400 | 600 | 700 | 800; color: string; align: 'start' | 'middle' | 'end'; font: 'display' | 'body' | 'mono'; gradient?: boolean }
  | { id: string; type: 'heroValue'; x: number; y: number; w: number; h: number; metric: 'net' | 'gross'; align: 'start' | 'middle' | 'end' }
  | { id: string; type: 'productGrid'; x: number; y: number; w: number; h: number; count: number; titles: boolean }
  | { id: string; type: 'product'; x: number; y: number; w: number; h: number; rank: number }
  | { id: string; type: 'leaderboard'; x: number; y: number; w: number; h: number; count: number }
  | { id: string; type: 'retailers'; x: number; y: number; w: number; h: number }
  | { id: string; type: 'chart'; x: number; y: number; w: number; h: number; series: 'net' | 'orders' }
  | { id: string; type: 'logo'; x: number; y: number; w: number; h: number }
  | { id: string; type: 'image'; x: number; y: number; w: number; h: number; src: string; fit: 'meet' | 'slice'; radius: number }
  | { id: string; type: 'date'; x: number; y: number; w: number; h: number; size: number }
  | { id: string; type: 'decoration'; x: number; y: number; w: number; h: number; kind: 'orb' | 'ring' | 'panel' | 'divider' | 'stars' };

export interface CustomProject {
  version: 1;
  name: string;
  width: number;
  height: number;
  background: 'galaxy' | 'aurora' | 'holo' | 'solid' | 'none';
  elements: CustomElement[];
}

function metricValue(d: RecapData, m: string, o: TemplateOptions): { label: string; value: string } {
  const k = d.kpis;
  const cur = k.currency;
  switch (m) {
    case 'net': return { label: 'Total secured', value: money(count(k.netCents, o), cur) };
    case 'gross': return { label: 'Gross value', value: money(count(k.grossCents, o), cur) };
    case 'orders': return { label: 'Orders', value: formatNumber(count(k.orders, o)) };
    case 'live': return { label: 'Live', value: formatNumber(count(k.liveOrders, o)) };
    case 'canceled': return { label: 'Canceled', value: formatNumber(count(k.canceledOrders, o)) };
    case 'success': return { label: 'Success', value: formatPct(k.successRate * stage(o, 0, 0.7)) };
    case 'units': return { label: 'Units', value: formatNumber(count(k.netUnits, o)) };
    case 'buyers': return { label: 'Buyers', value: formatNumber(count(k.activeBuyers, o)) };
    case 'avgOrder': return { label: 'Avg order', value: money(count(k.avgOrderCents, o), cur) };
    case 'delivered': return { label: 'Delivered', value: formatNumber(count(k.deliveredOrders, o)) };
    default: return { label: m, value: '—' };
  }
}

function sparkline(x: number, y: number, w: number, h: number, d: RecapData, series: 'net' | 'orders', p: Palette, scale: number): string {
  const pts = d.timeline.map((t) => (series === 'net' ? t.netCents : t.orders));
  if (pts.length < 2) return `<text x="${x + w / 2}" y="${y + h / 2}" font-family="${FONT_BODY}" font-size="${16 * scale}" fill="${p.muted}" text-anchor="middle">Not enough days for a chart</text>`;
  const max = Math.max(...pts, 1);
  const step = w / (pts.length - 1);
  const coords = pts.map((v, i) => `${(x + i * step).toFixed(1)},${(y + h - (v / max) * h * 0.9).toFixed(1)}`);
  const gid = id('spark');
  return `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.accent}" stop-opacity="0.45"/><stop offset="1" stop-color="${p.accent}" stop-opacity="0"/></linearGradient></defs>
<path d="M${x},${y + h} L${coords.join(' L')} L${x + w},${y + h} Z" fill="url(#${gid})"/>
<path d="M${coords.join(' L')}" fill="none" stroke="url(#gCool)" stroke-width="${3 * scale}" stroke-linejoin="round"/>
<path d="M${coords.join(' L')}" fill="none" stroke="${p.accent2}" stroke-width="${3 * scale}" filter="url(#glowS)" opacity="0.7"/>`;
}

const custom: TemplateDef = {
  id: 'custom',
  name: 'Custom Creator',
  description: 'Compose your own layout from KPI blocks, products, charts, leaderboards, text, logos and effects.',
  supportsTransparent: true,
  render(d, o, proj) {
    const project = proj ?? defaultCustomProject(o.width, o.height);
    const W = project.width;
    const H = project.height;
    const p = palette(d.accent);
    const scale = Math.min(W, H) / 1080;
    let body = project.background === 'none' || o.transparent ? '' : project.background === 'solid' ? `<rect width="${W}" height="${H}" fill="${p.bg0}"/>` : background(W, H, p, `custom${project.name}`, o, project.background);
    for (const e of project.elements) {
      switch (e.type) {
        case 'kpi': {
          const mv = metricValue(d, e.metric, o);
          body += kpiChip(e.x, e.y, e.w, e.h, e.label ?? mv.label, mv.value, e.color ?? p.accent2, Math.min(e.h / 108, 2) * 1, p);
          break;
        }
        case 'text': {
          const fam = e.font === 'display' ? FONT_DISPLAY : e.font === 'mono' ? FONT_MONO : FONT_BODY;
          const ax = e.align === 'middle' ? e.x + e.w / 2 : e.align === 'end' ? e.x + e.w : e.x;
          const lines = wrapText(e.text, e.w, e.size, Math.max(1, Math.floor(e.h / (e.size * 1.2))));
          lines.forEach((l, i) => (body += `<text x="${ax}" y="${e.y + e.size + i * e.size * 1.2}" font-family="${fam}" font-weight="${e.weight}" font-size="${e.size}" fill="${e.gradient ? 'url(#gText)' : esc(e.color)}" text-anchor="${e.align}">${esc(l)}</text>`));
          break;
        }
        case 'heroValue': {
          const v = metricValue(d, e.metric, o).value;
          const fs = fitFont(v, e.w, e.h * 0.95, 12, 0.6);
          const ax = e.align === 'middle' ? e.x + e.w / 2 : e.align === 'end' ? e.x + e.w : e.x;
          body += `<text x="${ax}" y="${e.y + e.h * 0.5 + fs * 0.36}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${fs}" fill="${p.accent}" filter="url(#glow)" opacity="0.8" text-anchor="${e.align}">${esc(v)}</text>
<text x="${ax}" y="${e.y + e.h * 0.5 + fs * 0.36}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${fs}" fill="url(#gText)" text-anchor="${e.align}">${esc(v)}</text>`;
          break;
        }
        case 'productGrid':
          body += productGrid(e.x, e.y, e.w, e.h, d.products.slice(0, e.count), p, scale, o, e.titles);
          break;
        case 'product': {
          const pr = d.products[e.rank - 1];
          if (pr) body += productTile(e.x, e.y, e.w, e.h, pr, p, scale, e.h > 160 * scale);
          break;
        }
        case 'leaderboard': {
          const rows = d.leaders.slice(0, e.count);
          const rh = e.h / Math.max(rows.length, 1);
          rows.forEach((l, i) => {
            const y = e.y + i * rh;
            body += `${glass(e.x, y + rh * 0.08, e.w, rh * 0.84, rh * 0.42)}
<text x="${e.x + rh * 0.5}" y="${y + rh * 0.62}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${rh * 0.36}" fill="${i === 0 ? '#f5c542' : p.text}" text-anchor="middle">${l.rank}</text>
<text x="${e.x + rh * 1.0}" y="${y + rh * 0.62}" font-family="${FONT_BODY}" font-weight="700" font-size="${rh * 0.3}" fill="${p.text}">${esc(truncate(l.name, e.w * 0.5, rh * 0.3))}</text>
<text x="${e.x + e.w - rh * 0.4}" y="${y + rh * 0.62}" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${rh * 0.32}" fill="${p.text}" text-anchor="end">${esc(money(count(l.netCents, o), d.kpis.currency))}</text>`;
          });
          break;
        }
        case 'retailers':
          body += retailerBadges(e.x, e.y + e.h / 2 - 20 * scale, e.w, d, scale, p, true);
          break;
        case 'chart':
          body += `${glass(e.x, e.y, e.w, e.h, 20 * scale)}${sparkline(e.x + 20 * scale, e.y + 20 * scale, e.w - 40 * scale, e.h - 40 * scale, d, e.series, p, scale)}`;
          break;
        case 'logo':
          body += brandMark(e.x, e.y, Math.min(e.w, e.h), d, p);
          break;
        case 'image': {
          if (!e.src.startsWith('data:image/')) break;
          const cid = id('img');
          body += `<defs><clipPath id="${cid}"><rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" rx="${e.radius}"/></clipPath></defs><image href="${e.src}" x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" preserveAspectRatio="xMidYMid ${e.fit}" clip-path="url(#${cid})"/>`;
          break;
        }
        case 'date':
          body += `${glass(e.x, e.y, e.w, e.h, e.h / 2)}<text x="${e.x + e.w / 2}" y="${e.y + e.h / 2 + e.size * 0.36}" font-family="${FONT_MONO}" font-weight="700" font-size="${e.size}" fill="${p.text}" text-anchor="middle">${esc(d.dateLabel.toUpperCase())}</text>`;
          break;
        case 'decoration':
          if (e.kind === 'orb') body += `<ellipse cx="${e.x + e.w / 2}" cy="${e.y + e.h / 2}" rx="${e.w / 2}" ry="${e.h / 2}" fill="${p.accent3}" opacity="0.45" filter="url(#blurL)"/>`;
          if (e.kind === 'ring') body += `<ellipse cx="${e.x + e.w / 2}" cy="${e.y + e.h / 2}" rx="${e.w / 2}" ry="${e.h / 2}" fill="none" stroke="url(#gAccent)" stroke-width="${4 * scale}"/>`;
          if (e.kind === 'panel') body += glass(e.x, e.y, e.w, e.h, 24 * scale);
          if (e.kind === 'divider') body += `<rect x="${e.x}" y="${e.y + e.h / 2 - 1.5 * scale}" width="${e.w}" height="${3 * scale}" rx="${1.5 * scale}" fill="url(#gCool)"/>`;
          if (e.kind === 'stars') body += `<g transform="translate(${e.x} ${e.y})">${starfield(e.w, e.h, e.id, Math.round((e.w * e.h) / 2500), 2.2)}</g>`;
          break;
      }
    }
    if (d.isSample) body += footer(W, H, 56 * scale, d, p, scale, { ...o, watermark: 'none' });
    return svgDoc(W, H, body, p);
  },
};

export function defaultCustomProject(width = 1080, height = 1080): CustomProject {
  const s = Math.min(width, height) / 1080;
  return {
    version: 1,
    name: 'My Cook Graphic',
    width,
    height,
    background: 'galaxy',
    elements: [
      { id: 'logo', type: 'logo', x: 60 * s, y: 60 * s, w: 70 * s, h: 70 * s },
      { id: 'title', type: 'text', x: 150 * s, y: 62 * s, w: 600 * s, h: 70 * s, text: 'DROP DAY RECAP', size: 40 * s, weight: 700, color: '#ffffff', align: 'start', font: 'display', gradient: true },
      { id: 'date', type: 'date', x: width - 360 * s, y: 70 * s, w: 300 * s, h: 52 * s, size: 18 * s },
      { id: 'hero', type: 'heroValue', x: 60 * s, y: 170 * s, w: width - 120 * s, h: 180 * s, metric: 'net', align: 'middle' },
      { id: 'k1', type: 'kpi', x: 60 * s, y: 380 * s, w: (width - 156 * s) / 3, h: 108 * s, metric: 'orders' },
      { id: 'k2', type: 'kpi', x: 78 * s + (width - 156 * s) / 3, y: 380 * s, w: (width - 156 * s) / 3, h: 108 * s, metric: 'live', color: '#34d399' },
      { id: 'k3', type: 'kpi', x: 96 * s + ((width - 156 * s) / 3) * 2, y: 380 * s, w: (width - 156 * s) / 3, h: 108 * s, metric: 'success' },
      { id: 'grid', type: 'productGrid', x: 60 * s, y: 520 * s, w: width - 120 * s, h: height - 600 * s, count: 8, titles: true },
    ],
  };
}

export const TEMPLATES: TemplateDef[] = [galactic, legendary, wall, leaderboard, retailers, shipments, custom];

export function template(idv: TemplateId): TemplateDef {
  return TEMPLATES.find((t) => t.id === idv) ?? galactic;
}
