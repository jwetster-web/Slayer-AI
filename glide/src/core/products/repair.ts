// Image upkeep for the product catalog: a one-time repair of data parsed by
// older extractors, and reuse of an image between products whose titles are
// identical once normalized (the same product bought at different retailers).

import { now, type Db } from '../db/database';
import { reparseStored } from '../email/process';
import { recomputeOrder } from '../orders/state';
import type { DataCipher } from '../secrets';
import { addProductImage, titleKey } from './catalog';

const JUNK_TITLE = /^(see (all|more)|view all|show (all|more)|\d+\s+items?)$/i;

/** Same product, different wording: "Pokémon Trading Card Game: X" ≡ "Pokémon TCG: X". */
export function canonicalTitle(title: string): string {
  return titleKey(title).replace(/\btrading card game\b/g, 'tcg').replace(/\s+/g, ' ').trim();
}

/** Gives image-less products the image of a product with the identical canonical title. Returns how many were filled. */
export function borrowImagesByTitle(db: Db): number {
  const missing = db.all<{ id: number; title: string }>('SELECT id, title FROM products WHERE primary_image_id IS NULL');
  if (!missing.length) return 0;
  const withImg = new Map<string, { url: string | null; local: string | null }>();
  for (const r of db.all<{ title: string; url: string | null; local_path: string | null }>(
    'SELECT p.title, pi.url, pi.local_path FROM products p JOIN product_images pi ON pi.id = p.primary_image_id',
  )) {
    const k = canonicalTitle(r.title);
    if (!withImg.has(k) || (r.local_path && !withImg.get(k)!.local)) withImg.set(k, { url: r.url, local: r.local_path });
  }
  let n = 0;
  for (const p of missing) {
    const hit = withImg.get(canonicalTitle(p.title));
    if (!hit) continue;
    addProductImage(db, p.id, 'provider', hit.url, hit.local);
    n++;
  }
  return n;
}

/**
 * One-time clean-up: drops placeholder images and junk "items" ("See all", "3 items"),
 * then re-reads the stored emails behind image-less products with the current extractor.
 */
export async function repairProductImages(db: Db, cipher: DataCipher | null): Promise<{ removedPlaceholders: number; removedJunk: number; recovered: number }> {
  const placeholders = db.all<{ id: number; product_id: number }>("SELECT id, product_id FROM product_images WHERE url LIKE '%gray-bag%' OR url LIKE '%placeholder%'");
  const junk = db.all<{ id: number; order_id: number; title: string }>('SELECT id, order_id, title FROM order_items').filter((r) => JUNK_TITLE.test(r.title.trim()));
  db.tx(() => {
    for (const ph of placeholders) {
      db.run('UPDATE order_items SET image_url = NULL WHERE image_url = (SELECT url FROM product_images WHERE id = ?)', [ph.id]);
      db.run('UPDATE products SET primary_image_id = NULL WHERE primary_image_id = ?', [ph.id]);
      db.run('DELETE FROM product_images WHERE id = ?', [ph.id]);
      db.run('UPDATE products SET primary_image_id = (SELECT MIN(id) FROM product_images WHERE product_id = ?) WHERE id = ? AND primary_image_id IS NULL', [ph.product_id, ph.product_id]);
    }
    for (const j of junk) db.run('DELETE FROM order_items WHERE id = ?', [j.id]);
    for (const orderId of new Set(junk.map((j) => j.order_id))) recomputeOrder(db, orderId);
    db.run('DELETE FROM products WHERE primary_image_id IS NULL AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id = products.id) AND NOT EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = products.id)');
  });

  let recovered = 0;
  const targets = db.all<{ product_id: number; title: string; order_id: number }>(
    'SELECT oi.product_id, oi.title, oi.order_id FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE p.primary_image_id IS NULL',
  );
  const done = new Set<number>();
  for (const t of targets) {
    if (done.has(t.product_id)) continue;
    const msgs = db.all<{ id: number }>('SELECT sm.id FROM source_messages sm JOIN source_message_blobs b ON b.message_id = sm.id WHERE sm.order_id = ? ORDER BY sm.id', [t.order_id]);
    for (const m of msgs) {
      const parsed = await reparseStored(db, m.id, cipher);
      const want = titleKey(t.title);
      const hit = parsed.flatMap((p) => p.items).find((it) => it.imageUrl && titleKey(it.title) === want);
      if (!hit?.imageUrl) continue;
      db.tx(() => {
        addProductImage(db, t.product_id, 'email', hit.imageUrl!);
        db.run('UPDATE order_items SET image_url = COALESCE(image_url, ?) WHERE product_id = ?', [hit.imageUrl!, t.product_id]);
      });
      done.add(t.product_id);
      recovered++;
      break;
    }
  }
  // Order statuses are recomputed once so the newer rules (e.g. delivered with no item list) apply to existing orders.
  db.tx(() => {
    for (const o of db.all<{ id: number }>('SELECT id FROM orders')) recomputeOrder(db, o.id);
  });
  db.run("INSERT INTO workspace_meta (key, value) VALUES ('image_repair_v1', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [now()]);
  return { removedPlaceholders: placeholders.length, removedJunk: junk.length, recovered };
}

export function imageRepairDone(db: Db): boolean {
  return !!db.value("SELECT value FROM workspace_meta WHERE key = 'image_repair_v1'");
}
