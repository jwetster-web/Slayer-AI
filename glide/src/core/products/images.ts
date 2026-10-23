// Local product image cache. Remote images referenced by retailer emails are
// downloaded once (size- and type-limited) and served from disk.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../db/database';

export interface FetchedImage {
  data: Buffer;
  contentType: string;
}

export type ImageFetcher = (url: string) => Promise<FetchedImage | null>;

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' };
const MAX_BYTES = 6 * 1024 * 1024;

export function cacheFileName(url: string, contentType: string): string {
  return `${createHash('sha256').update(url).digest('hex').slice(0, 32)}.${EXT[contentType] ?? 'img'}`;
}

export const httpImageFetcher: ImageFetcher = async (url) => {
  if (url.startsWith('data:image/')) {
    const m = url.match(/^data:(image\/[a-z+.-]+);base64,(.*)$/i);
    return m ? { data: Buffer.from(m[2], 'base64'), contentType: m[1].toLowerCase() } : null;
  }
  if (!/^https:\/\//i.test(url)) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'GLIDE-OrderCommandCenter/0.1 (+image-cache)' } });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!EXT[type]) return null;
    const len = Number(res.headers.get('content-length') ?? '0');
    if (len > MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES || buf.length < 200) return null; // tracking pixels are tiny
    return { data: buf, contentType: type };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
};

/** Downloads up to `limit` uncached product images. Returns how many were cached. */
export async function cacheProductImages(db: Db, dir: string, fetcher: ImageFetcher = httpImageFetcher, limit = 50): Promise<number> {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const rows = db.all<{ id: number; url: string }>(
    "SELECT id, url FROM product_images WHERE local_path IS NULL AND url IS NOT NULL AND (sha256 IS NULL OR sha256 <> 'failed') ORDER BY id LIMIT ?",
    [limit],
  );
  let n = 0;
  for (const r of rows) {
    const img = await fetcher(r.url);
    if (!img) {
      db.run("UPDATE product_images SET sha256 = 'failed' WHERE id = ?", [r.id]);
      continue;
    }
    const name = cacheFileName(r.url, img.contentType);
    const path = join(dir, name);
    if (!existsSync(path)) writeFileSync(path, img.data);
    db.run('UPDATE product_images SET local_path = ?, sha256 = ? WHERE id = ?', [name, createHash('sha256').update(img.data).digest('hex'), r.id]);
    n++;
  }
  return n;
}
