import { describe, expect, it, beforeAll } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { openWorkspaceDb, getSettings } from '../../src/core/workspace';
import { generateSampleWorkspace } from '../../src/core/sample/generator';
import { buildRecapData } from '../../src/core/export/data';
import { renderExport, setFontDir, buildSvg } from '../../src/core/export/render';
import { TEMPLATES } from '../../src/core/export/templates';
import { hsl } from '../../src/core/export/svg';
import type { Db } from '../../src/core/db/database';

const OUT = process.env.GLIDE_EXPORT_OUT;
let db: Db;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'glide-export-'));
  db = openWorkspaceDb(join(dir, 'w.sqlite'), { name: 'Sample', isSample: true });
  await generateSampleWorkspace(db, { orders: 300, imageDir: join(dir, 'images'), seed: 7 });
  setFontDir(resolve('resources/fonts'));
}, 120000);

describe('Cook Export Studio', () => {
  it('Scenario 7: aggregates exactly what the database holds', () => {
    const s = getSettings(db);
    const d = buildRecapData(db, {}, s, { imageDir: join(dir, 'images'), isSample: true });
    const units = db.value<number>("SELECT SUM(oi.quantity - oi.canceled_qty) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.cancel_state <> 'full'");
    expect(d.products.reduce((t, p) => t + p.units, 0)).toBe(units);
    expect(d.kpis.orders).toBe(db.value('SELECT COUNT(*) FROM orders'));
    expect(d.retailers.reduce((t, r) => t + r.orders, 0)).toBe(d.kpis.orders);
    expect(d.kpis.liveOrders + d.kpis.canceledOrders).toBe(d.kpis.orders);
    expect(d.products.every((p) => p.image?.startsWith('data:image/svg+xml'))).toBe(true);
    expect(d.isSample).toBe(true);
  });

  for (const t of TEMPLATES) {
    it(`renders ${t.id} at 1080×1080 and 1080×1920`, async () => {
      const d = buildRecapData(db, {}, getSettings(db), { imageDir: join(dir, 'images'), isSample: true });
      for (const [w, h] of [[1080, 1080], [1080, 1920]]) {
        const r = await renderExport(d, { template: t.id, width: w, height: h, format: 'png' });
        const meta = await sharp(r.buffer).metadata();
        expect([meta.width, meta.height]).toEqual([w, h]);
        expect(r.svg).toContain('SAMPLE DATA');
        if (OUT) {
          mkdirSync(OUT, { recursive: true });
          writeFileSync(join(OUT, `${t.id}-${w}x${h}.png`), r.buffer);
        }
      }
    }, 60000);
  }

  it('renders true 4K landscape plus JPG, WebP, PDF and transparent PNG', async () => {
    const d = buildRecapData(db, {}, getSettings(db), { imageDir: join(dir, 'images') });
    const k4 = await renderExport(d, { template: 'galactic', width: 3840, height: 2160, format: 'png' });
    expect((await sharp(k4.buffer).metadata()).width).toBe(3840);
    if (OUT) writeFileSync(join(OUT, 'galactic-3840x2160.png'), k4.buffer);
    const jpg = await renderExport(d, { template: 'retailers', width: 1920, height: 1080, format: 'jpg' });
    expect((await sharp(jpg.buffer).metadata()).format).toBe('jpeg');
    if (OUT) writeFileSync(join(OUT, 'retailers-1920x1080.jpg'), jpg.buffer);
    const webp = await renderExport(d, { template: 'wall', width: 1920, height: 1080, format: 'webp' });
    expect((await sharp(webp.buffer).metadata()).format).toBe('webp');
    const pdf = await renderExport(d, { template: 'leaderboard', width: 1080, height: 1350, format: 'pdf' });
    expect(pdf.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    const tp = await renderExport(d, { template: 'wall', width: 1080, height: 1080, format: 'png', options: { transparent: true } });
    const stats = await sharp(tp.buffer).stats();
    expect(stats.isOpaque).toBe(false);
  }, 120000);

  it('masks member names in leaderboard privacy mode', () => {
    const d = buildRecapData(db, {}, getSettings(db), { imageDir: join(dir, 'images'), maskNames: true });
    const svg = buildSvg(d, { template: 'leaderboard', width: 1080, height: 1080 });
    const real = db.all<{ n: string }>('SELECT COALESCE(display_name, username) AS n FROM members').map((r) => r.n);
    for (const n of real) expect(svg.includes(`>${n}<`)).toBe(false);
    expect(svg).toContain('•');
  });

  it('renders an animated GIF', async () => {
    const d = buildRecapData(db, {}, getSettings(db), { imageDir: join(dir, 'images') });
    const gif = await renderExport(d, { template: 'galactic', width: 1080, height: 1080, format: 'gif' });
    expect(gif.buffer.subarray(0, 6).toString()).toBe('GIF89a');
    if (OUT) writeFileSync(join(OUT, 'galactic.gif'), gif.buffer);
  }, 120000);
  it('applies the Studio color slider and tile options', () => {
    const d = buildRecapData(db, {}, getSettings(db), { imageDir: join(dir, 'images'), isSample: true });
    const base = buildSvg(d, { template: 'wall', width: 1080, height: 1080, options: {} });
    const tuned = buildSvg(d, { template: 'wall', width: 1080, height: 1080, options: { hue: 120, tileQtyBadge: false, tileGlow: false, stars: false, background: 'solid', tileRadius: 0 } });
    expect(tuned).not.toBe(base);
    expect(tuned).toContain(hsl(120, 90, 65));
    expect(base.match(/fill="url\(#gTile\)"/g)?.length ?? 0).toBeGreaterThan(0);
    expect(tuned).not.toContain('fill="url(#gTile)"');
    expect(tuned).not.toMatch(/>×\d/);
    expect(tuned).not.toContain('filter="url(#blurXL)"');
  });
});
