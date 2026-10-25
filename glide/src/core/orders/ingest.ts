// Applies a parsed retailer email to the order database.
//
// Every effect is idempotent: the semantic fingerprint of a message is stored
// as an order event, so the same confirmation arriving directly and through
// two forwarding inboxes produces one canonical order with three source
// references and no double-counted quantities, refunds or tracking events.

import { createHash } from 'node:crypto';
import { DEFAULT_SETTINGS, type ActivityKind, type AppSettings, type MessageType, type PackageStatus, type ParsedItem, type ParsedOrderEmail } from '../../shared/types';
import { now, type Db } from '../db/database';
import { EventSink } from '../events';
import { matchOrder } from '../identity/matcher';
import { maskPhone, normalizeEmail, phoneKey } from '../identity/normalize';
import { upsertAddress, upsertEmail } from '../identity/store';
import { lineKeyFor, recordPrice, resolveProduct } from '../products/catalog';
import { retailer } from '../retailers/registry';
import { packageStatusRank, trackingUrl } from '../tracking/carriers';
import { recomputeOrder, refreshSearchText } from './state';

export interface IngestContext {
  db: Db;
  settings?: AppSettings;
  sourceMessageId?: number | null;
  accountId?: number | null;
  /** When the retailer sent the message (inner date for forwards). */
  occurredAt: string;
  sink?: EventSink;
  source?: 'email' | 'import' | 'sample';
}

export interface IngestResult {
  orderId: number;
  created: boolean;
  duplicate: boolean;
}

export function fingerprint(p: ParsedOrderEmail): string {
  const items = p.items.map((i) => `${lineKeyFor(i)}x${i.quantity}:${i.status ?? ''}`).sort().join(',');
  const trk = p.shipments.map((s) => s.trackingNumber ?? '').sort().join(',');
  const s = [p.retailer, p.type, p.orderNumber, items, trk, p.totalCents ?? '', p.refundCents ?? ''].join('|');
  return createHash('sha256').update(s).digest('hex').slice(0, 24);
}

const TYPE_LABEL: Record<MessageType, string> = {
  order_confirmation: 'Order confirmed',
  order_update: 'Order updated',
  shipping: 'Shipped',
  out_for_delivery: 'Out for delivery',
  delivery: 'Delivered',
  cancellation: 'Order canceled',
  partial_cancellation: 'Items canceled',
  review_hold: 'Placed on review hold',
  backorder: 'Backordered',
  delay: 'Delayed',
  return: 'Return processed',
  refund: 'Refund issued',
  unknown: 'Message received',
};

function activity(db: Db, kind: ActivityKind, o: { id: number; retailer_id: string; member_id: number | null; currency: string }, label: string, at: string, key: string, amount?: number | null, units?: number | null) {
  db.run(
    'INSERT OR IGNORE INTO activity_feed (at, kind, retailer_id, order_id, member_id, amount_cents, currency, units, label, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [at, kind, o.retailer_id, o.id, o.member_id, amount ?? null, o.currency, units ?? null, label, key],
  );
}

export function orderEvent(db: Db, orderId: number, kind: string, label: string, at: string, source: string, sourceMessageId: number | null, detail: Record<string, unknown> | null, dedupeKey: string | null): boolean {
  const r = db.run(
    'INSERT OR IGNORE INTO order_events (order_id, kind, label, occurred_at, source, source_message_id, detail_json, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [orderId, kind, label, at, source, sourceMessageId, detail ? JSON.stringify(detail) : null, dedupeKey],
  );
  return r.changes > 0;
}

interface ItemRow {
  id: number;
  line_key: string;
  quantity: number;
  canceled_qty: number;
  shipped_qty: number;
  delivered_qty: number;
  returned_qty: number;
  unit_price_cents: number;
}

function upsertItem(db: Db, orderId: number, retailerId: string, currency: string, it: ParsedItem, mode: 'confirm' | 'observe', at: string): ItemRow {
  const key = lineKeyFor(it);
  const productId = resolveProduct(db, retailerId as never, it);
  const unit = it.unitPriceCents ?? (it.lineTotalCents ? Math.round(it.lineTotalCents / Math.max(1, it.quantity)) : 0);
  const line = it.lineTotalCents ?? unit * it.quantity;
  let row = db.get<ItemRow>('SELECT id, line_key, quantity, canceled_qty, shipped_qty, delivered_qty, returned_qty, unit_price_cents FROM order_items WHERE order_id = ? AND line_key = ?', [orderId, key]);
  if (!row) {
    // Same product under a different key (e.g. shipping email without SKU)?
    row = db.get<ItemRow>('SELECT id, line_key, quantity, canceled_qty, shipped_qty, delivered_qty, returned_qty, unit_price_cents FROM order_items WHERE order_id = ? AND product_id = ?', [orderId, productId]);
  }
  if (!row) {
    const id = db.run(
      `INSERT INTO order_items (order_id, product_id, line_key, title, sku, upc, image_url, quantity, unit_price_cents, line_total_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderId, productId, key, it.title, it.sku ?? null, it.upc ?? null, it.imageUrl ?? null, it.quantity, unit, line],
    ).lastId;
    if (unit) recordPrice(db, productId, retailerId, unit, currency, orderId, at);
    return { id, line_key: key, quantity: it.quantity, canceled_qty: 0, shipped_qty: 0, delivered_qty: 0, returned_qty: 0, unit_price_cents: unit };
  }
  if (mode === 'confirm') {
    db.run(
      `UPDATE order_items SET quantity = MAX(quantity, ?), unit_price_cents = CASE WHEN ? > 0 THEN ? ELSE unit_price_cents END,
         line_total_cents = CASE WHEN ? > 0 THEN ? ELSE line_total_cents END, title = ?, sku = COALESCE(sku, ?), upc = COALESCE(upc, ?),
         image_url = COALESCE(image_url, ?), product_id = COALESCE(product_id, ?) WHERE id = ?`,
      [it.quantity, unit, unit, line, line, it.title, it.sku ?? null, it.upc ?? null, it.imageUrl ?? null, productId, row.id],
    );
    if (unit) recordPrice(db, productId, retailerId, unit, currency, orderId, at);
  } else {
    db.run('UPDATE order_items SET image_url = COALESCE(image_url, ?), quantity = MAX(quantity, ?) WHERE id = ?', [it.imageUrl ?? null, it.quantity, row.id]);
  }
  return db.get<ItemRow>('SELECT id, line_key, quantity, canceled_qty, shipped_qty, delivered_qty, returned_qty, unit_price_cents FROM order_items WHERE id = ?', [row.id])!;
}

function upsertPackage(db: Db, orderId: number, trackingNumber: string, carrier: string, url: string | undefined, est: string | undefined, at: string): { id: number; created: boolean } {
  const existing = db.value<number>('SELECT id FROM packages WHERE order_id = ? AND tracking_number = ?', [orderId, trackingNumber]);
  if (existing) {
    if (est) db.run('UPDATE packages SET estimated_delivery = COALESCE(?, estimated_delivery) WHERE id = ?', [est, existing]);
    return { id: existing, created: false };
  }
  const id = db.run(
    'INSERT INTO packages (order_id, tracking_number, carrier, tracking_url, status, estimated_delivery, next_check_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [orderId, trackingNumber, carrier, url ?? trackingUrl(carrier as never, trackingNumber), 'label_created', est ?? null, at, now()],
  ).lastId;
  return { id, created: true };
}

/** Adds a tracking event and moves the package status forward (or to exception/delay). */
export function addTrackingEvent(db: Db, packageId: number, status: PackageStatus, description: string, at: string, source: 'email' | 'carrier_api' | 'manual' | 'provider', location: string | null = null, sourceRef: string | null = null): boolean {
  const key = createHash('sha1').update(`${packageId}|${status}|${source}|${at.slice(0, 16)}|${description}`).digest('hex');
  const r = db.run(
    'INSERT OR IGNORE INTO tracking_events (package_id, status, description, location, occurred_at, source, source_ref, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [packageId, status, description, location, at, source, sourceRef, key, now()],
  );
  if (!r.changes) return false;
  const pkg = db.get<{ status: PackageStatus; last_event_at: string | null }>('SELECT status, last_event_at FROM packages WHERE id = ?', [packageId])!;
  const newer = !pkg.last_event_at || at >= pkg.last_event_at;
  const terminal = pkg.status === 'delivered' || pkg.status === 'returned';
  let next = pkg.status;
  if (status === 'returned') next = 'returned';
  else if (!terminal && (packageStatusRank(status) > packageStatusRank(pkg.status) || (newer && (status === 'exception' || status === 'delayed' || pkg.status === 'exception' || pkg.status === 'delayed')))) next = status;
  db.run(
    'UPDATE packages SET status = ?, last_event_at = CASE WHEN ? THEN ? ELSE last_event_at END, delivered_at = CASE WHEN ? = ? THEN COALESCE(delivered_at, ?) ELSE delivered_at END, last_verified_at = ? WHERE id = ?',
    [next, newer ? 1 : 0, at, next, 'delivered', at, now(), packageId],
  );
  return true;
}

export function deliverItemsForPackage(db: Db, orderId: number, packageId: number) {
  const mapped = db.all<{ order_item_id: number; quantity: number }>('SELECT order_item_id, quantity FROM package_items WHERE package_id = ?', [packageId]);
  if (mapped.length) {
    for (const m of mapped) db.run('UPDATE order_items SET delivered_qty = MIN(quantity - canceled_qty, delivered_qty + ?) WHERE id = ?', [m.quantity, m.order_item_id]);
    return;
  }
  const pkgCount = db.value<number>('SELECT COUNT(*) FROM packages WHERE order_id = ?', [orderId]) ?? 0;
  const undelivered = db.value<number>("SELECT COUNT(*) FROM packages WHERE order_id = ? AND status NOT IN ('delivered','returned')", [orderId]) ?? 0;
  if (pkgCount <= 1 || undelivered === 0) db.run('UPDATE order_items SET delivered_qty = MAX(delivered_qty, CASE WHEN shipped_qty > 0 THEN shipped_qty ELSE quantity - canceled_qty END) WHERE order_id = ?', [orderId]);
}

export function applyParsedEmail(ctx: IngestContext, p: ParsedOrderEmail): IngestResult {
  const { db } = ctx;
  const settings = ctx.settings ?? DEFAULT_SETTINGS;
  const sink = ctx.sink ?? new EventSink();
  const at = ctx.occurredAt;
  const src = ctx.source ?? 'email';
  const msgId = ctx.sourceMessageId ?? null;

  return db.tx(() => {
    const meta = retailer(p.retailer);
    let order = db.get<{ id: number; retailer_id: string; member_id: number | null; currency: string; has_confirmation: number; placed_at: string }>(
      'SELECT id, retailer_id, member_id, currency, has_confirmation, placed_at FROM orders WHERE retailer_id = ? AND order_number = ?',
      [p.retailer, p.orderNumber],
    );
    let created = false;
    const ts = now();
    if (!order) {
      const id = db.run(
        `INSERT INTO orders (retailer_id, order_number, placed_at, currency, email_account_id, last_activity_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.retailer, p.orderNumber, p.placedAt ?? at, p.currency || meta.currency, ctx.accountId ?? null, at, ts, ts],
      ).lastId;
      order = { id, retailer_id: p.retailer, member_id: null, currency: p.currency || meta.currency, has_confirmation: 0, placed_at: p.placedAt ?? at };
      created = true;
    }
    const orderId = order.id;
    if (msgId) db.run('INSERT OR IGNORE INTO order_sources (order_id, source_message_id) VALUES (?, ?)', [orderId, msgId]);

    const fp = fingerprint(p);
    const fresh = orderEvent(db, orderId, p.type, TYPE_LABEL[p.type], at, src, msgId, { warnings: p.warnings.length ? p.warnings : undefined, tracking: p.shipments.map((s) => s.trackingNumber).filter(Boolean) }, `msg:${fp}`);
    if (!fresh) {
      sink.push({ kind: 'order_duplicate', key: `dup:${orderId}:${fp}:${msgId}`, orderId, at, retailerId: p.retailer });
      return { orderId, created: false, duplicate: true };
    }

    // Identity facts (first non-empty value wins; confirmations overwrite stubs).
    const isConfirm = p.type === 'order_confirmation';
    const shipAddrId = p.shippingAddress ? upsertAddress(db, p.shippingAddress) : null;
    const billAddrId = p.billingAddress ? upsertAddress(db, p.billingAddress) : null;
    const email = normalizeEmail(p.customerEmail);
    if (email) upsertEmail(db, email);
    db.run(
      `UPDATE orders SET
         shipping_address_id = COALESCE(?, shipping_address_id), billing_address_id = COALESCE(?, billing_address_id),
         purchase_email = COALESCE(purchase_email, ?), recipient_name = COALESCE(?, recipient_name),
         phone_key = COALESCE(?, phone_key), phone_masked = COALESCE(?, phone_masked),
         email_account_id = COALESCE(email_account_id, ?), updated_at = ?,
         last_activity_at = CASE WHEN ? > last_activity_at THEN ? ELSE last_activity_at END
       WHERE id = ?`,
      [shipAddrId, billAddrId, email, p.recipientName ?? null, phoneKey(p.phone), maskPhone(p.phone), ctx.accountId ?? null, ts, at, at, orderId],
    );

    if (isConfirm) {
      const placedAt = p.placedAt ?? at;
      db.run(
        `UPDATE orders SET has_confirmation = 1, placed_at = ?, currency = ?,
           subtotal_cents = COALESCE(?, subtotal_cents), tax_cents = COALESCE(?, tax_cents), shipping_cents = COALESCE(?, shipping_cents),
           discount_cents = COALESCE(?, discount_cents), total_cents = COALESCE(?, total_cents)
         WHERE id = ?`,
        [order.has_confirmation ? (placedAt < order.placed_at ? placedAt : order.placed_at) : placedAt, p.currency, p.subtotalCents ?? null, p.taxCents ?? null, p.shippingCents ?? null, p.discountCents ?? null, p.totalCents ?? null, orderId],
      );
    } else if (!order.has_confirmation && p.totalCents && created) {
      db.run('UPDATE orders SET total_cents = ? WHERE id = ?', [p.totalCents, orderId]);
    }

    const items = p.items.map((it) => ({ parsed: it, row: upsertItem(db, orderId, p.retailer, p.currency, it, isConfirm ? 'confirm' : 'observe', at) }));
    // Item-level statuses carried by any email (e.g. a confirmation listing one line as canceled).
    for (const { parsed, row } of items) {
      if (parsed.status === 'backordered') db.run('UPDATE order_items SET backordered = 1 WHERE id = ?', [row.id]);
    }

    const evBase = { orderId, retailerId: p.retailer, at };
    switch (p.type) {
      case 'shipping':
      case 'out_for_delivery':
      case 'delivery': {
        const status: PackageStatus = p.type === 'shipping' ? 'in_transit' : p.type === 'out_for_delivery' ? 'out_for_delivery' : 'delivered';
        const pkgIds: number[] = [];
        for (const s of p.shipments) {
          if (!s.trackingNumber) continue;
          const pk = upsertPackage(db, orderId, s.trackingNumber, s.carrier ?? 'other', s.trackingUrl, s.estimatedDelivery, at);
          pkgIds.push(pk.id);
          if (pk.created) sink.push({ kind: 'tracking_added', key: `trk:${pk.id}`, packageId: pk.id, ...evBase, detail: { carrier: s.carrier, trackingNumber: s.trackingNumber } });
          // Items listed in a shipping email belong to its package (only reliable with one package per email).
          if (p.type === 'shipping' && p.shipments.length === 1) {
            for (const { parsed, row } of items) db.run('INSERT OR IGNORE INTO package_items (package_id, order_item_id, quantity) VALUES (?, ?, ?)', [pk.id, row.id, parsed.quantity]);
          }
        }
        if (!pkgIds.length && p.type !== 'shipping') {
          // No tracking number in the email: apply to all open packages of the order.
          pkgIds.push(...db.all<{ id: number }>("SELECT id FROM packages WHERE order_id = ? AND status NOT IN ('delivered','returned')", [orderId]).map((r) => r.id));
        }
        const label = p.type === 'shipping' ? 'Shipped — retailer notification' : p.type === 'out_for_delivery' ? 'Out for delivery — retailer notification' : 'Delivered — retailer notification';
        for (const pid of pkgIds) {
          if (addTrackingEvent(db, pid, status, label, at, 'email', null, msgId ? `msg:${msgId}` : null)) {
            if (status === 'delivered') {
              deliverItemsForPackage(db, orderId, pid);
              sink.push({ kind: 'delivered', key: `del:${pid}`, packageId: pid, ...evBase });
            } else if (status === 'out_for_delivery') sink.push({ kind: 'out_for_delivery', key: `ofd:${pid}`, packageId: pid, ...evBase });
            else sink.push({ kind: 'package_status', key: `ps:${pid}:${status}`, packageId: pid, ...evBase, detail: { status } });
          }
        }
        if (p.type === 'shipping') {
          if (items.length) {
            for (const { parsed, row } of items) db.run('UPDATE order_items SET shipped_qty = MIN(quantity - canceled_qty, shipped_qty + ?) WHERE id = ?', [parsed.quantity, row.id]);
          } else {
            db.run('UPDATE order_items SET shipped_qty = quantity - canceled_qty WHERE order_id = ?', [orderId]);
          }
          // Shipping implies any review hold was cleared.
          db.run("UPDATE orders SET review_status = 'cleared' WHERE id = ? AND review_status = 'hold'", [orderId]);
        }
        if (p.type === 'delivery' && !pkgIds.length) {
          db.run('UPDATE order_items SET delivered_qty = CASE WHEN shipped_qty > 0 THEN shipped_qty ELSE quantity - canceled_qty END, shipped_qty = CASE WHEN shipped_qty > 0 THEN shipped_qty ELSE quantity - canceled_qty END WHERE order_id = ?', [orderId]);
          sink.push({ kind: 'delivered', key: `del:o${orderId}`, ...evBase });
        }
        break;
      }
      case 'cancellation':
      case 'partial_cancellation': {
        const marked = items.filter(({ parsed }) => parsed.status === 'canceled');
        // When the email marks specific lines as canceled, only those are; otherwise every listed line is.
        const listed = marked.length ? marked : items;
        const all = db.all<ItemRow>('SELECT id, line_key, quantity, canceled_qty, shipped_qty, delivered_qty, returned_qty, unit_price_cents FROM order_items WHERE order_id = ?', [orderId]);
        const coversAll = p.type === 'cancellation' && (listed.length === 0 || all.every((a) => listed.some((l) => l.row.id === a.id && l.parsed.quantity >= a.quantity - a.shipped_qty)));
        if (coversAll) {
          db.run('UPDATE order_items SET canceled_qty = quantity - shipped_qty, status = ? WHERE order_id = ?', ['canceled', orderId]);
          sink.push({ kind: 'order_canceled', key: `cancel:${orderId}`, ...evBase });
        } else {
          for (const { parsed, row } of listed) {
            db.run("UPDATE order_items SET canceled_qty = MIN(quantity - shipped_qty, canceled_qty + ?), status = CASE WHEN canceled_qty + ? >= quantity THEN 'canceled' ELSE 'partially_canceled' END WHERE id = ?", [parsed.quantity, parsed.quantity, row.id]);
          }
          sink.push({ kind: 'partial_cancel', key: `pcancel:${orderId}:${fp}`, ...evBase, detail: { lines: listed.length } });
        }
        if (p.refundCents) db.run('INSERT OR IGNORE INTO payments (order_id, kind, amount_cents, currency, occurred_at, source_message_id, dedupe_key, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [orderId, 'refund', p.refundCents, p.currency, at, msgId, `refund:${orderId}:${fp}`, 'cancellation']);
        break;
      }
      case 'review_hold':
        db.run("UPDATE orders SET review_status = 'hold' WHERE id = ?", [orderId]);
        sink.push({ kind: 'review_hold', key: `hold:${orderId}`, ...evBase });
        break;
      case 'refund':
      case 'return': {
        if (p.type === 'return') {
          for (const { parsed, row } of items) db.run('UPDATE order_items SET returned_qty = MIN(quantity - canceled_qty, returned_qty + ?) WHERE id = ?', [parsed.quantity, row.id]);
          sink.push({ kind: 'returned', key: `ret:${orderId}:${fp}`, ...evBase });
        }
        const amount = p.refundCents ?? (p.type === 'refund' ? p.totalCents : undefined);
        if (amount) {
          db.run('INSERT OR IGNORE INTO payments (order_id, kind, amount_cents, currency, occurred_at, source_message_id, dedupe_key, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [orderId, 'refund', amount, p.currency, at, msgId, `refund:${orderId}:${fp}`, p.type]);
          sink.push({ kind: 'refund', key: `refund:${orderId}:${fp}`, ...evBase, detail: { amount } });
        }
        break;
      }
      case 'backorder':
        db.run('UPDATE order_items SET backordered = 1 WHERE order_id = ? AND shipped_qty < quantity - canceled_qty', [orderId]);
        break;
      case 'delay':
        for (const pk of db.all<{ id: number }>("SELECT id FROM packages WHERE order_id = ? AND status NOT IN ('delivered','returned')", [orderId])) addTrackingEvent(db, pk.id, 'delayed', 'Delay notice — retailer notification', at, 'email');
        break;
      default:
        break;
    }

    const state = recomputeOrder(db, orderId);
    const o = db.get<{ id: number; retailer_id: string; member_id: number | null; currency: string; total_cents: number; units: number }>('SELECT id, retailer_id, member_id, currency, total_cents, units FROM orders WHERE id = ?', [orderId])!;

    // Identity matching runs whenever identity facts may have changed.
    const prevMember = o.member_id;
    const decision = matchOrder(db, orderId, settings);
    const memberId = db.value<number | null>('SELECT member_id FROM orders WHERE id = ?', [orderId]) ?? null;
    refreshSearchText(db, orderId);
    if (decision?.status === 'auto' && memberId !== prevMember) sink.push({ kind: 'match_auto', key: `match:${orderId}:${memberId}`, orderId, memberId, at, retailerId: p.retailer, detail: { confidence: decision.confidence } });
    if (decision?.status === 'review') sink.push({ kind: 'match_review', key: `review:${orderId}`, orderId, at, retailerId: p.retailer, detail: { confidence: decision.confidence } });

    const ord = { ...o, member_id: memberId };
    if (created) sink.push({ kind: 'order_created', key: `new:${orderId}`, memberId, ...evBase, detail: { total: o.total_cents, units: o.units } });
    else sink.push({ kind: 'order_updated', key: `upd:${orderId}:${fp}`, memberId, ...evBase, detail: { type: p.type } });
    for (const e of sink.events) if (e.orderId === orderId && e.memberId === undefined) e.memberId = memberId;

    const feedKind: Record<MessageType, ActivityKind> = {
      order_confirmation: created ? 'new_order' : 'order_confirmed', order_update: 'order_confirmed', shipping: p.shipments.length ? 'tracking_found' : 'shipped',
      out_for_delivery: 'out_for_delivery', delivery: 'delivered', cancellation: state.cancelState === 'full' ? 'canceled' : 'partial_cancel', partial_cancellation: 'partial_cancel',
      review_hold: 'review_hold', backorder: 'order_confirmed', delay: 'shipped', return: 'refund', refund: 'refund', unknown: 'order_confirmed',
    };
    const carrierLabel = p.shipments[0]?.carrier ? ` · ${p.shipments[0].carrier.toUpperCase()}` : '';
    const label = p.type === 'order_confirmation' ? (created ? 'New order' : 'Order confirmed') : p.type === 'shipping' && p.shipments.length ? `Tracking found${carrierLabel}` : TYPE_LABEL[p.type];
    activity(db, feedKind[p.type], ord, label, at, `feed:${orderId}:${fp}`, p.type === 'order_confirmation' ? o.total_cents : p.refundCents ?? null, p.type === 'order_confirmation' ? o.units : null);
    return { orderId, created, duplicate: false };
  });
}
