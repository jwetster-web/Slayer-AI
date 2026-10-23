// Renders the GLIDE app icon (build/icon.png, 1024²) from vector source.
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b8cff"/><stop offset=".55" stop-color="#8b5cf6"/><stop offset="1" stop-color="#e879f9"/></linearGradient>
  <radialGradient id="shine" cx="30%" cy="20%" r="80%"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="22"/></filter>
</defs>
<rect x="64" y="64" width="896" height="896" rx="200" fill="#070912"/>
<rect x="96" y="96" width="832" height="832" rx="176" fill="url(#bg)"/>
<rect x="96" y="96" width="832" height="832" rx="176" fill="url(#shine)"/>
<g opacity=".25">${Array.from({ length: 40 }, (_, i) => `<circle cx="${140 + ((i * 197) % 740)}" cy="${140 + ((i * 331) % 740)}" r="${(i % 3) + 2}" fill="#fff"/>`).join('')}</g>
<text x="512" y="660" font-family="Space Grotesk" font-weight="700" font-size="520" fill="#ffffff" text-anchor="middle" filter="url(#glow)" opacity=".55">G</text>
<text x="512" y="660" font-family="Space Grotesk" font-weight="700" font-size="520" fill="#ffffff" text-anchor="middle">G</text>
<path d="M300 780 Q512 840 724 780" stroke="#fff" stroke-opacity=".7" stroke-width="18" fill="none" stroke-linecap="round"/>
</svg>`;
const fonts = readdirSync('resources/fonts').filter((f) => f.endsWith('.ttf')).map((f) => join('resources/fonts', f));
const png = new Resvg(svg, { font: { fontFiles: fonts, loadSystemFonts: false, defaultFontFamily: 'Space Grotesk' } }).render().asPng();
writeFileSync('build/icon.png', png);
console.log('build/icon.png', png.length);
