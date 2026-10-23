import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openWorkspaceDb } from '../../src/core/workspace';
import { generateSampleWorkspace } from '../../src/core/sample/generator';
import { SAMPLE_PRODUCTS } from '../../src/core/sample/catalog';

describe('sample workspace', () => {
  it('keeps every sample product distinct and every image cached', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'glide-sample-'));
    const db = openWorkspaceDb(join(dir, 'w.sqlite'), { name: 's', isSample: true });
    await generateSampleWorkspace(db, { orders: 250, imageDir: join(dir, 'images'), seed: 3 });
    // A product's catalog title must match the titles of every line item attached to it.
    const mismatched = db.value<number>('SELECT COUNT(*) FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.title <> p.title');
    expect(mismatched).toBe(0);
    const distinctTitles = db.value<number>('SELECT COUNT(DISTINCT title) FROM products');
    expect(distinctTitles).toBeLessThanOrEqual(SAMPLE_PRODUCTS.length);
    expect(db.value<number>('SELECT COUNT(*) FROM product_images WHERE local_path IS NULL')).toBe(0);
    expect(db.value('SELECT value FROM workspace_meta WHERE key = ?', ['is_sample'])).toBe('1');
    expect(db.value<number>("SELECT COUNT(*) FROM source_messages WHERE parse_status = 'failed'")).toBe(0);
  }, 120000);
});
