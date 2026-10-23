// Scale test: builds a large synthetic workspace with bulk inserts, then times
// the queries the UI depends on. Targets are design goals, not guarantees.
//   npm run test:perf                       (100k orders)
//   GLIDE_PERF_ORDERS=20000 npm run test:perf
import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openWorkspaceDb, getSettings } from '../../src/core/workspace';
import { analyticsBundle, kpis } from '../../src/core/analytics/engine';
import { listOrders, listMembers, getOrder, listProducts } from '../../src/core/queries/views';
import { gatherCandidates } from '../../src/core/identity/matcher';
import { buildRecapData } from '../../src/core/export/data';
import { processRawMessage } from '../../src/core/email/process';
import { renderSampleEmail } from '../../src/core/sample/retailerEmails';
import { rng } from '../../src/core/sample/generator';
import { addressRawHash, normalizeAddress } from '../../src/core/identity/normalize';
import type { Db } from '../../src/core/db/database';

const N = Number(process.env.GLIDE_PERF_ORDERS ?? 100000);
const MEMBERS = 10000;
const PROFILES = 10000;
let db: Db;
let dir: string;
const timings: Record<string, number> = {};

function time<T>(label: string, fn: () => T): T {
  const t0 = performance.now();
  const out = fn();
  timings[label] = Math.round(performance.now() - t0);
  return out;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'glide-perf-'));
  db = openWorkspaceDb(join(dir, 'perf.sqlite'), { name: 'perf', isSample: true });
  const r = rng(42);
  const now = Date.now();
  const retailers = ['target', 'walmart', 'pokemoncenter_us', 'amazon', 'bestbuy', 'costco', 'samsclub'];
  const t0 = performance.now();
  db.tx(() => {
    for (let i = 1; i <= MEMBERS; i++) db.run('INSERT INTO members (discord_id, username, created_at, updated_at) VALUES (?, ?, ?, ?)', [`1${String(i).padStart(17, "0")}`, `member${i}`, '2026-01-01', '2026-01-01']);
    for (let i = 1; i <= PROFILES; i++) {
      db.run("INSERT INTO profiles (member_id, name, first_name, last_name, name_key, last_key, source, created_at) VALUES (?, ?, ?, ?, ?, ?, 'import', '2026-01-01')", [((i - 1) % MEMBERS) + 1, `Profile ${i}`, `F${i}`, `L${i}`, `F${i} L${i}`, `L${i}`]);
      db.run("INSERT INTO emails (address, base_address, member_id, profile_id, status, first_seen, last_seen) VALUES (?, ?, ?, ?, 'verified', '2026-01-01', '2026-01-01')", [`buyer${i}@example.com`, `buyer${i}@example.com`, ((i - 1) % MEMBERS) + 1, i]);
      const a = { line1: `${i} Main St`, city: 'Springfield', state: 'IL', postal: String(60000 + (i % 9999)).padStart(5, '0') };
      const n = normalizeAddress(a);
      const aid = db.run('INSERT INTO addresses (canonical_key, street_key, line1, city, state, postal, country, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)', [n.canonicalKey, n.streetKey, n.line1, n.city, n.state, n.postal, n.country, '2026-01-01']).lastId;
      db.run('INSERT INTO address_variants (address_id, raw, raw_hash, first_seen) VALUES (?, ?, ?, ?)', [aid, a.line1, addressRawHash(a), '2026-01-01']);
      db.run("INSERT INTO address_owners (address_id, member_id, status, created_at) VALUES (?, ?, 'verified', '2026-01-01')", [aid, ((i - 1) % MEMBERS) + 1]);
    }
    for (let p = 1; p <= 400; p++) db.run("INSERT INTO products (retailer_id, sku, title, title_key, category, created_at, updated_at) VALUES (?, ?, ?, ?, 'other_tcg', '2026-01-01', '2026-01-01')", [retailers[p % 7], `SKU${p}`, `Product ${p}`, `product ${p}`]);
    for (let i = 1; i <= N; i++) {
      const placed = new Date(now - r.int(0, 365) * 86400000 - r.int(0, 86399) * 1000).toISOString();
      const member = r.int(1, MEMBERS);
      const units = r.int(1, 4);
      const price = r.pick([2694, 4999, 16164, 1399]);
      const total = units * price;
      const canceled = r.chance(0.15);
      const status = canceled ? 'canceled' : r.pick(['ordered', 'shipped', 'delivered', 'delivered', 'out_for_delivery']);
      const oid = db.run(
        `INSERT INTO orders (retailer_id, order_number, placed_at, currency, subtotal_cents, total_cents, net_cents, units, canceled_units, member_id, profile_id, shipping_address_id, purchase_email,
           fulfillment_status, cancel_state, canceled_cents, match_status, match_confidence, has_confirmation, search_text, last_activity_at, created_at, updated_at)
         VALUES (?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto', 0.97, 1, ?, ?, ?, ?)`,
        [retailers[i % 7], `ORD${i}`, placed, total, total, canceled ? 0 : total, units, canceled ? units : 0, member, member, member, `buyer${member}@example.com`, status, canceled ? 'full' : 'none', canceled ? total : 0, `ord${i} product ${i % 400} member${member}`, placed, placed, placed],
      ).lastId;
      db.run('INSERT INTO order_items (order_id, product_id, line_key, title, quantity, unit_price_cents, line_total_cents, canceled_qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [oid, (i % 400) + 1, `sku:SKU${(i % 400) + 1}`, `Product ${(i % 400) + 1}`, units, price, total, canceled ? units : 0]);
      if (status !== 'ordered' && !canceled) {
        const pid = db.run("INSERT INTO packages (order_id, tracking_number, carrier, status, created_at) VALUES (?, ?, 'ups', ?, ?)", [oid, `1ZTEST${i}`, status === 'delivered' ? 'delivered' : 'in_transit', placed]).lastId;
        db.run("INSERT INTO tracking_events (package_id, status, description, occurred_at, source, dedupe_key, created_at) VALUES (?, 'in_transit', 'Shipped', ?, 'email', ?, ?)", [pid, placed, `pe${pid}a`, placed]);
        if (status === 'delivered') db.run("INSERT INTO tracking_events (package_id, status, description, occurred_at, source, dedupe_key, created_at) VALUES (?, 'delivered', 'Delivered', ?, 'email', ?, ?)", [pid, placed, `pe${pid}b`, placed]);
      }
    }
  });
  timings.fixture = Math.round(performance.now() - t0);
  db.exec('ANALYZE');
});

describe(`scale: ${N.toLocaleString()} orders, ${MEMBERS.toLocaleString()} members, ${PROFILES.toLocaleString()} profiles`, () => {
  it('serves the UI queries within interactive budgets', () => {
    const s = getSettings(db);
    const last30 = { from: new Date(Date.now() - 30 * 86400000).toISOString() };
    time('orders: first page, newest', () => listOrders(db, { limit: 200 }));
    time('orders: filtered retailer+status', () => listOrders(db, { retailers: ['target'], fulfillment: ['delivered'], limit: 200 }));
    time('orders: full-text search', () => listOrders(db, { search: 'member4242', limit: 200 }));
    time('order detail', () => getOrder(db, Math.floor(N / 2)));
    time('kpis: all time', () => kpis(db, {}, s));
    time('analytics bundle: 30 days', () => analyticsBundle(db, last30, s));
    time('analytics bundle: all time', () => analyticsBundle(db, {}, s));
    time('members: top spenders page', () => listMembers(db, { limit: 60 }));
    time('products: catalog page', () => listProducts(db, { limit: 120 }));
    time('identity: candidate evidence', () => gatherCandidates(db, { id: 1, purchase_email: 'buyer77@example.com', recipient_name: 'F77 L77', phone_key: null, shipping_address_id: 77, email_account_id: null }));
    time('recap data: 30 days', () => buildRecapData(db, last30, s, { imageDir: dir }));
    console.table(timings);
    expect(timings['orders: first page, newest']).toBeLessThan(1500);
    expect(timings['orders: filtered retailer+status']).toBeLessThan(1500);
    expect(timings['order detail']).toBeLessThan(200);
    expect(timings['identity: candidate evidence']).toBeLessThan(200);
    expect(timings['analytics bundle: 30 days']).toBeLessThan(5000);
  });

  it('measures end-to-end email ingest throughput', async () => {
    const t0 = performance.now();
    const n = 1000;
    for (let i = 0; i < n; i++) {
      const raw = renderSampleEmail({ retailer: 'target', type: 'order_confirmation', orderNumber: `9129${String(i).padStart(11, '0')}`, date: new Date(), to: `buyer${(i % PROFILES) + 1}@example.com`, items: [{ title: 'Pokémon TCG: Elite Trainer Box', sku: `ETB${i % 30}`, qty: 2, unitCents: 4999 }], address: { name: `F${(i % PROFILES) + 1} L${(i % PROFILES) + 1}`, line1: `${(i % PROFILES) + 1} Main St`, city: 'Springfield', state: 'IL', postal: '60001' }, taxCents: 0, shippingCents: 0 }).raw;
      await processRawMessage({ db }, Buffer.from(raw), { kind: 'import', accountId: null, importRef: `perf:${i}` });
    }
    const perSec = Math.round((n / (performance.now() - t0)) * 1000);
    console.log(`ingest throughput on a ${N.toLocaleString()}-order database: ${perSec} messages/sec`);
    expect(perSec).toBeGreaterThan(20);
  });
});
