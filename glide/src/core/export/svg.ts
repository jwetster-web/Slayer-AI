// Small SVG toolkit shared by the export templates.

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const FONT_DISPLAY = "'Space Grotesk', 'Inter', sans-serif";
export const FONT_BODY = "'Inter', sans-serif";
export const FONT_MONO = "'JetBrains Mono', monospace";

/** Deterministic PRNG so the same report always renders identically. */
export function seeded(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export function hexToHsl(hex: string): [number, number, number] {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return [225, 90, 65];
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s * 100, l * 100];
}

export interface Palette {
  accent: string;
  accent2: string;
  accent3: string;
  hot: string;
  bg0: string;
  bg1: string;
  text: string;
  muted: string;
  hue: number;
}

/** HSL → #rrggbb (the rasterizer does not accept hsl() colors). */
export function hsl(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

export function palette(accent: string): Palette {
  const [h] = hexToHsl(accent);
  return {
    accent: /^#[0-9a-f]{6}$/i.test(accent) ? accent : hsl(h, 90, 65),
    accent2: hsl((h + 330) % 360, 90, 68),
    accent3: hsl((h + 50) % 360, 88, 70),
    hot: hsl((h + 110) % 360, 90, 62),
    bg0: hsl(h, 55, 4),
    bg1: hsl((h + 30) % 360, 60, 11),
    text: '#f3f5ff',
    muted: '#a6afd3',
    hue: h,
  };
}

export function starfield(w: number, h: number, seed: string, count: number, maxR = 1.6): string {
  const r = seeded(seed);
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = r() * w;
    const y = r() * h;
    const rad = (r() ** 3 * maxR + 0.25).toFixed(2);
    const o = (0.15 + r() * 0.75).toFixed(2);
    out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad}" fill="#fff" opacity="${o}"/>`;
  }
  // A few bright stars with soft flares.
  for (let i = 0; i < Math.max(3, count / 120); i++) {
    const x = r() * w;
    const y = r() * h;
    const s = 6 + r() * 10;
    out += `<g opacity="${(0.5 + r() * 0.4).toFixed(2)}"><circle cx="${x}" cy="${y}" r="1.8" fill="#fff"/><path d="M${x - s} ${y} L${x + s} ${y} M${x} ${y - s} L${x} ${y + s}" stroke="#fff" stroke-width="0.6" opacity="0.7"/></g>`;
  }
  return out;
}

export function gridLines(w: number, h: number, step: number, opacity = 0.05): string {
  let d = '';
  for (let x = step; x < w; x += step) d += `M${x} 0V${h}`;
  for (let y = step; y < h; y += step) d += `M0 ${y}H${w}`;
  return `<path d="${d}" stroke="#ffffff" stroke-width="1" opacity="${opacity}"/>`;
}

/** Estimated text width (no font metrics available before rasterizing). */
export function textWidth(s: string, size: number, factor = 0.58): number {
  let w = 0;
  for (const ch of s) w += /[A-Z0-9$%#]/.test(ch) ? 0.66 : /[ilI.,:'|]/.test(ch) ? 0.3 : ch === ' ' ? 0.3 : /[mwMW]/.test(ch) ? 0.85 : factor;
  return w * size;
}

export function fitFont(s: string, maxWidth: number, maxSize: number, minSize = 10, factor?: number): number {
  const w1 = textWidth(s, 1, factor);
  return Math.max(minSize, Math.min(maxSize, maxWidth / Math.max(w1, 0.01)));
}

export function truncate(s: string, maxWidth: number, size: number): string {
  if (textWidth(s, size) <= maxWidth) return s;
  let out = s;
  while (out.length > 3 && textWidth(out + '…', size) > maxWidth) out = out.slice(0, -1);
  return out.trimEnd() + '…';
}

export function wrapText(s: string, maxWidth: number, size: number, maxLines: number): string[] {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (textWidth(cand, size) > maxWidth && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    } else cur = cand;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) lines[maxLines - 1] = truncate(lines[maxLines - 1] + ' …', maxWidth, size);
  return lines;
}

/** Best grid for n tiles of a given aspect inside w×h. */
export function bestGrid(n: number, w: number, h: number, gap: number, aspect = 1.18): { cols: number; rows: number; tileW: number; tileH: number } {
  let best = { cols: 1, rows: n, tileW: 0, tileH: 0 };
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(n / cols);
    const tw = (w - gap * (cols - 1)) / cols;
    const th = (h - gap * (rows - 1)) / rows;
    const tileW = Math.min(tw, th / aspect);
    if (tileW > best.tileW) best = { cols, rows, tileW, tileH: tileW * aspect };
  }
  return best;
}

export function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const a0 = ((from - 90) * Math.PI) / 180;
  const a1 = ((to - 90) * Math.PI) / 180;
  const large = to - from > 180 ? 1 : 0;
  return `M${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}`;
}

export function initials(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+|(?=[A-Z])/).filter(Boolean);
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase();
}
