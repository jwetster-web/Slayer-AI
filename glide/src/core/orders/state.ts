// Derives order-level state from items, packages and payments. Fulfillment,
// cancellation, money and review are independent fields: a review hold is
// never treated as a cancellation, and a partially canceled order can still
// be fully delivered.

import type { CancelState, FinancialStatus, FulfillmentStatus, PackageStatus } from '../../shared/types';
import type { Db } from '../db/database';

export interface DerivedState {
  fulfillment: FulfillmentStatus;
  cancelState: CancelState;
  financial: FinancialStatus;
  units: number;
  canceledUnits: number;
  canceledCents: number;
  refundedCents: number;
  netCents: number;
}

interface Item {
  quantity: number;
  canceled_qty: number;
  shipped_qty: number;
  delivered_qty: number;
  returned_qty: number;
  backordered: number;
  unit_price_cents: number;
  line_total_cents: number;
}

export function deriveState(
  order: { total_cents: number },
  items: Item[],
  packages: { status: PackageStatus }[],
  refundedCents: number,
): DerivedState {
  const units = items.reduce((s, i) => s + i.quantity, 0);
  const canceledUnits = items.reduce((s, i) => s + i.canceled_qty, 0);
  const active = units - canceledUnits;
  const shipped = items.reduce((s, i) => s + Math.min(i.shipped_qty, i.quantity - i.canceled_qty), 0);
  const delivered = items.reduce((s, i) => s + Math.min(i.delivered_qty, i.quantity - i.canceled_qty), 0);
  const returned = items.reduce((s, i) => s + i.returned_qty, 0);

  const cancelState: CancelState = units > 0 && active <= 0 ? 'full' : canceledUnits > 0 ? 'partial' : 'none';
  // Canceled value: line value of canceled units (pre-tax); a full cancellation voids the whole total.
  const lineCanceled = items.reduce((s, i) => s + i.canceled_qty * (i.unit_price_cents || Math.round(i.line_total_cents / Math.max(1, i.quantity))), 0);
  const canceledCents = cancelState === 'full' ? Math.max(order.total_cents, lineCanceled) : Math.min(lineCanceled, order.total_cents || lineCanceled);
  // Refunds tied to a cancellation are not subtracted twice: net = total − max(canceled, refunded).
  const netCents = Math.max(0, order.total_cents - Math.max(canceledCents, refundedCents));
  const financial: FinancialStatus = refundedCents <= 0 ? 'charged' : refundedCents >= order.total_cents && order.total_cents > 0 ? 'refunded' : 'partially_refunded';

  const live = packages.filter((p) => p.status !== 'returned');
  let fulfillment: FulfillmentStatus = 'ordered';
  if (cancelState === 'full') fulfillment = 'canceled';
  else if (active > 0 && returned >= active) fulfillment = 'returned';
  else if (active > 0 && delivered >= active) fulfillment = 'delivered';
  else if (live.length) {
    const all = (s: PackageStatus) => live.every((p) => p.status === s);
    const any = (s: PackageStatus) => live.some((p) => p.status === s);
    if (all('delivered') && shipped >= active) fulfillment = 'delivered';
    else if (any('exception')) fulfillment = 'exception';
    else if (any('out_for_delivery')) fulfillment = 'out_for_delivery';
    else if (any('delivered') || delivered > 0) fulfillment = 'partially_delivered';
    else if (any('delayed')) fulfillment = 'delayed';
    else if (shipped > 0 && shipped < active) fulfillment = 'partially_shipped';
    else fulfillment = 'shipped';
  } else if (delivered > 0) fulfillment = 'partially_delivered';
  else if (shipped > 0) fulfillment = shipped >= active ? 'shipped' : 'partially_shipped';
  else if (items.some((i) => i.backordered && i.quantity > i.canceled_qty)) fulfillment = 'backordered';

  return { fulfillment, cancelState, financial, units, canceledUnits, canceledCents, refundedCents, netCents };
}

export function recomputeOrder(db: Db, orderId: number): DerivedState {
  const order = db.get<{ total_cents: number; subtotal_cents: number; tax_cents: number; shipping_cents: number; discount_cents: number }>(
    'SELECT total_cents, subtotal_cents, tax_cents, shipping_cents, discount_cents FROM orders WHERE id = ?',
    [orderId],
  )!;
  const items = db.all<Item>('SELECT quantity, canceled_qty, shipped_qty, delivered_qty, returned_qty, backordered, unit_price_cents, line_total_cents FROM order_items WHERE order_id = ?', [orderId]);
  // If no confirmation total was ever seen, fall back to the sum of known lines.
  let total = order.total_cents;
  if (!total) {
    const sum = items.reduce((s, i) => s + (i.line_total_cents || i.unit_price_cents * i.quantity), 0);
    total = sum + order.tax_cents + order.shipping_cents - order.discount_cents;
    if (total > 0) db.run('UPDATE orders SET total_cents = ?, subtotal_cents = CASE WHEN subtotal_cents = 0 THEN ? ELSE subtotal_cents END WHERE id = ?', [total, sum, orderId]);
  }
  const packages = db.all<{ status: PackageStatus }>('SELECT status FROM packages WHERE order_id = ?', [orderId]);
  const refunded = db.value<number>("SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE order_id = ? AND kind = 'refund'", [orderId]) ?? 0;
  const s = deriveState({ total_cents: total }, items, packages, refunded);
  db.run(
    `UPDATE orders SET fulfillment_status = ?, cancel_state = ?, financial_status = ?, units = ?, canceled_units = ?,
       canceled_cents = ?, refunded_cents = ?, net_cents = ? WHERE id = ?`,
    [s.fulfillment, s.cancelState, s.financial, s.units, s.canceledUnits, s.canceledCents, s.refundedCents, s.netCents, orderId],
  );
  db.run(
    `UPDATE order_items SET status = CASE
        WHEN canceled_qty >= quantity THEN 'canceled'
        WHEN returned_qty > 0 AND returned_qty >= quantity - canceled_qty THEN 'returned'
        WHEN delivered_qty > 0 AND delivered_qty >= quantity - canceled_qty THEN 'delivered'
        WHEN shipped_qty > 0 AND shipped_qty >= quantity - canceled_qty THEN 'shipped'
        WHEN canceled_qty > 0 THEN 'partially_canceled'
        WHEN shipped_qty > 0 THEN 'partially_shipped'
        WHEN backordered = 1 THEN 'backordered'
        ELSE 'ordered' END
     WHERE order_id = ?`,
    [orderId],
  );
  refreshSearchText(db, orderId);
  return s;
}

export function refreshSearchText(db: Db, orderId: number) {
  const o = db.get<{ order_number: string; retailer_id: string; purchase_email: string | null; recipient_name: string | null; member_id: number | null; profile_id: number | null; notes: string }>(
    'SELECT order_number, retailer_id, purchase_email, recipient_name, member_id, profile_id, notes FROM orders WHERE id = ?',
    [orderId],
  );
  if (!o) return;
  const parts: (string | null | undefined)[] = [o.order_number, o.retailer_id, o.purchase_email, o.recipient_name, o.notes];
  if (o.member_id) {
    const m = db.get<{ username: string; display_name: string | null; discord_id: string | null }>('SELECT username, display_name, discord_id FROM members WHERE id = ?', [o.member_id]);
    parts.push(m?.username, m?.display_name, m?.discord_id);
  }
  if (o.profile_id) parts.push(db.value<string>('SELECT name FROM profiles WHERE id = ?', [o.profile_id]));
  for (const r of db.all<{ title: string; sku: string | null; upc: string | null }>('SELECT title, sku, upc FROM order_items WHERE order_id = ?', [orderId])) parts.push(r.title, r.sku, r.upc);
  for (const r of db.all<{ tracking_number: string }>('SELECT tracking_number FROM packages WHERE order_id = ?', [orderId])) parts.push(r.tracking_number);
  db.run('UPDATE orders SET search_text = ? WHERE id = ?', [parts.filter(Boolean).join(' ').toLowerCase(), orderId]);
}
