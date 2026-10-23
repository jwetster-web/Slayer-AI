// Generated placeholder product art for sample mode. Clearly marked SAMPLE.

import type { SampleProduct } from './catalog';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function wrap(text: string, max: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max) {
      if (cur) lines.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

export function sampleProductArt(p: SampleProduct): string {
  const h = p.hue;
  const h2 = (h + 40) % 360;
  const tall = /Elite Trainer|Booster Box|Ultra-Premium|Collection|Build/.test(p.format);
  const w = tall ? 300 : 260;
  const bh = tall ? 360 : 300;
  const x = (600 - w) / 2;
  const y = (600 - bh) / 2 + 10;
  const depth = 46;
  const set = wrap(p.setName.toUpperCase(), 14);
  const fmt = wrap(p.format.toUpperCase(), 16);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
<defs>
  <radialGradient id="bg" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="hsl(${h},55%,22%)"/><stop offset="1" stop-color="#05060d"/></radialGradient>
  <linearGradient id="front" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},85%,62%)"/><stop offset=".55" stop-color="hsl(${h2},80%,46%)"/><stop offset="1" stop-color="hsl(${h},70%,28%)"/></linearGradient>
  <linearGradient id="side" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="hsl(${h},60%,30%)"/><stop offset="1" stop-color="hsl(${h},55%,18%)"/></linearGradient>
  <linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h},80%,78%)"/><stop offset="1" stop-color="hsl(${h},70%,55%)"/></linearGradient>
  <linearGradient id="gloss" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="28"/></filter>
</defs>
<rect width="600" height="600" fill="url(#bg)"/>
<ellipse cx="300" cy="${y + bh + 18}" rx="${w * 0.7}" ry="22" fill="#000" opacity=".55" filter="url(#glow)"/>
<circle cx="300" cy="280" r="170" fill="hsl(${h},90%,60%)" opacity=".28" filter="url(#glow)"/>
<polygon points="${x + w},${y} ${x + w + depth},${y - depth * 0.6} ${x + w + depth},${y + bh - depth * 0.6} ${x + w},${y + bh}" fill="url(#side)"/>
<polygon points="${x},${y} ${x + depth},${y - depth * 0.6} ${x + w + depth},${y - depth * 0.6} ${x + w},${y}" fill="url(#top)"/>
<rect x="${x}" y="${y}" width="${w}" height="${bh}" rx="6" fill="url(#front)"/>
<rect x="${x}" y="${y}" width="${w}" height="${bh}" rx="6" fill="url(#gloss)"/>
<rect x="${x + 16}" y="${y + 16}" width="${w - 32}" height="${bh - 32}" rx="4" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2"/>
<circle cx="${x + w / 2}" cy="${y + bh * 0.42}" r="${w * 0.22}" fill="#fff" fill-opacity=".14" stroke="#fff" stroke-opacity=".5" stroke-width="3"/>
<path d="M ${x + w / 2 - w * 0.22} ${y + bh * 0.42} h ${w * 0.44}" stroke="#fff" stroke-opacity=".5" stroke-width="3"/>
<circle cx="${x + w / 2}" cy="${y + bh * 0.42}" r="${w * 0.06}" fill="#fff" fill-opacity=".7"/>
${set.map((l, i) => `<text x="${x + w / 2}" y="${y + 52 + i * 30}" font-family="Space Grotesk, Inter, Arial" font-weight="700" font-size="26" fill="#fff" text-anchor="middle" letter-spacing="1">${esc(l)}</text>`).join('')}
${fmt.map((l, i) => `<text x="${x + w / 2}" y="${y + bh - 40 - (fmt.length - 1 - i) * 24}" font-family="Inter, Arial" font-weight="800" font-size="19" fill="#fff" fill-opacity=".92" text-anchor="middle" letter-spacing="2">${esc(l)}</text>`).join('')}
<g transform="translate(470 40)"><rect width="104" height="30" rx="15" fill="#000" fill-opacity=".55" stroke="#fff" stroke-opacity=".35"/><text x="52" y="20" font-family="Inter, Arial" font-size="13" font-weight="700" fill="#fff" text-anchor="middle" letter-spacing="2">SAMPLE</text></g>
</svg>`;
}
