import { createHash } from 'node:crypto';
import type { ParsedItem, ProductCategory, RetailerId } from '../../shared/types';
import { now, type Db } from '../db/database';

const CATEGORY_RULES: [ProductCategory, RegExp][] = [
  ['ultra_premium_collection', /ultra[- ]premium collection|\bUPC\b(?!\s*[:#]?\s*\d)/i],
  ['elite_trainer_box', /elite trainer box|\bETB\b|top-trainer-box/i],
  ['booster_bundle', /booster bundle/i],
  ['booster_box', /booster (display )?box|booster display|display box|36[- ]pack|\bbooster-display\b/i],
  ['build_and_battle', /build (&|and) battle/i],
  ['premium_collection', /premium collection|super[- ]premium/i],
  ['binder_collection', /binder collection|portfolio/i],
  ['tin', /\btins?\b|mini tin/i],
  ['blister', /blister|checklane|3[- ]pack|three[- ]booster/i],
  ['collection_box', /collection|box set|\bbox\b/i],
  ['booster_pack', /booster pack|sleeved booster|\bbooster\b/i],
];

const TCG_HINT = /pok[eé]mon|tcg|trading card|scarlet\s*(&|and)\s*violet|sword\s*(&|and)\s*shield|mega evolution|booster/i;

/** Classifies by explicit product-format words only; anything unclear stays generic. */
export function classifyProduct(title: string): ProductCategory {
  if (!TCG_HINT.test(title) && !/elite trainer|booster/i.test(title)) return 'other';
  for (const [cat, re] of CATEGORY_RULES) if (re.test(title)) return cat;
  return 'other_tcg';
}

export const CATEGORY_LABEL: Record<ProductCategory, string> = {
  elite_trainer_box: 'Elite Trainer Box',
  booster_box: 'Booster Box',
  booster_bundle: 'Booster Bundle',
  booster_pack: 'Booster Pack',
  ultra_premium_collection: 'Ultra-Premium Collection',
  premium_collection: 'Premium Collection',
  collection_box: 'Collection Box',
  tin: 'Tin',
  blister: 'Blister',
  build_and_battle: 'Build & Battle',
  binder_collection: 'Binder Collection',
  other_tcg: 'Other TCG',
  other: 'Other',
};

export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[™®©]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function lineKeyFor(item: Pick<ParsedItem, 'sku' | 'upc' | 'title'>): string {
  if (item.sku) return `sku:${item.sku.toUpperCase()}`;
  if (item.upc) return `upc:${item.upc}`;
  return `t:${createHash('sha1').update(titleKey(item.title)).digest('hex').slice(0, 16)}`;
}

/**
 * Resolves a line item to a catalog product. Identity is decided by exact
 * identifiers (retailer SKU, then UPC), then by exact normalized title within
 * the same retailer. Titles are never fuzzily matched across products, so an
 * image is never borrowed from a merely similar-looking product.
 */
export function resolveProduct(db: Db, retailerId: RetailerId, item: ParsedItem): number {
  const ts = now();
  const sku = item.sku?.toUpperCase() ?? null;
  const upc = item.upc ?? null;
  const tk = titleKey(item.title);
  let row: { id: number; upc: string | null; locked: number } | undefined;
  if (sku) row = db.get('SELECT id, upc, locked FROM products WHERE retailer_id = ? AND sku = ?', [retailerId, sku]);
  if (!row && upc) row = db.get('SELECT id, upc, locked FROM products WHERE upc = ? ORDER BY id LIMIT 1', [upc]);
  if (!row && !sku) row = db.get('SELECT id, upc, locked FROM products WHERE retailer_id = ? AND title_key = ? AND sku IS NULL ORDER BY id LIMIT 1', [retailerId, tk]);
  let id: number;
  if (row) {
    id = row.id;
    if (!row.locked) {
      db.run('UPDATE products SET upc = COALESCE(upc, ?), url = COALESCE(url, ?), updated_at = ? WHERE id = ?', [upc, item.productUrl ?? null, ts, id]);
    }
  } else {
    id = db.run(
      `INSERT INTO products (retailer_id, sku, upc, title, title_key, category, url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [retailerId, sku, upc, item.title, tk, classifyProduct(item.title), item.productUrl ?? null, ts, ts],
    ).lastId;
  }
  if (item.imageUrl) addProductImage(db, id, 'email', item.imageUrl);
  return id;
}

export function addProductImage(db: Db, productId: number, source: 'email' | 'retailer' | 'cache' | 'provider' | 'user', url: string | null, localPath: string | null = null): number {
  const existing = db.get<{ id: number }>('SELECT id FROM product_images WHERE product_id = ? AND (url = ? OR (local_path IS NOT NULL AND local_path = ?))', [productId, url, localPath]);
  if (existing) return existing.id;
  const id = db.run('INSERT INTO product_images (product_id, source, url, local_path, created_at) VALUES (?, ?, ?, ?, ?)', [productId, source, url, localPath, now()]).lastId;
  const p = db.get<{ primary_image_id: number | null; locked: number }>('SELECT primary_image_id, locked FROM products WHERE id = ?', [productId]);
  // User uploads always win; otherwise keep the first image found (from the retailer's own email).
  if (p && (!p.primary_image_id || source === 'user')) db.run('UPDATE products SET primary_image_id = ? WHERE id = ?', [id, productId]);
  return id;
}

export function recordPrice(db: Db, productId: number, retailerId: string, cents: number, currency: string, orderId: number, at: string) {
  if (!cents) return;
  const exists = db.get('SELECT 1 FROM product_prices WHERE product_id = ? AND order_id = ?', [productId, orderId]);
  if (!exists) db.run('INSERT INTO product_prices (product_id, retailer_id, price_cents, currency, order_id, observed_at) VALUES (?, ?, ?, ?, ?, ?)', [productId, retailerId, cents, currency, orderId, at]);
}

/** Image URL used by the UI: local cached file when available, else the remote URL. */
export const PRODUCT_IMAGE_SQL = `(SELECT COALESCE(CASE WHEN pi.local_path IS NOT NULL THEN 'glide-img://local/' || pi.local_path END, pi.url) FROM product_images pi WHERE pi.id = p.primary_image_id)`;
