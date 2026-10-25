// Marking packages / orders delivered by hand, one at a time or in bulk
// ("everything that shipped more than N days ago"). Recorded with source
// 'manual' and labelled as such, so it is never mistaken for a carrier scan.

import { audit } from '../audit';
import { now, type Db } from '../db/database';
import { addTrackingEvent, deliverItemsForPackage, orderEvent } from './ingest';
import { recomputeOrder } from './state';

export interface MarkDeliveredScope {
  /** Specific packages (per-row action). */
  packageIds?: number[];
  /** Specific orders without packages. */
  orderIds?: number[];
  /** Bulk: anything whose last shipping update is at least this many days old. */
  olderThanDays?: number;
  /** Bulk: also orders that never got a shipping email (placed at least `olderThanDays` ago). */
  includeUnshipped?: boolean;
}

const LABEL = 'Marked delivered by you';

export function deliveredCandidates(db: Db, scope: MarkDeliveredScope): { packageIds: number[]; orderIds: number[] } {
  const open = "status NOT IN ('delivered','returned')";
  if (scope.packageIds?.length || scope.orderIds?.length) {
    const p = scope.packageIds ?? [];
    const o = scope.orderIds ?? [];
    return {
      packageIds: p.length ? db.all<{ id: number }>(`SELECT id FROM packages WHERE ${open} AND id IN (${p.map(() => '?').join(',')})`, p).map((r) => r.id) : [],
      orderIds: o.length ? db.all<{ id: number }>(`SELECT id FROM orders WHERE fulfillment_status NOT IN ('delivered','canceled','returned') AND id IN (${o.map(() => '?').join(',')})`, o).map((r) => r.id) : [],
    };
  }
  if (scope.olderThanDays === undefined) return { packageIds: [], orderIds: [] };
  const cutoff = new Date(Date.now() - Math.max(0, scope.olderThanDays) * 86400000).toISOString();
  const packageIds = db
    .all<{ id: number }>(`SELECT id FROM packages WHERE ${open} AND COALESCE(last_event_at, created_at) <= ?`, [cutoff])
    .map((r) => r.id);
  // Orders with no package to go by: shipped ones by their last activity, never-shipped ones only when asked.
  const statuses = scope.includeUnshipped ? "('ordered','shipped','partially_shipped','backordered')" : "('shipped','partially_shipped')";
  const orderIds = db
    .all<{ id: number }>(
      `SELECT o.id FROM orders o WHERE o.fulfillment_status IN ${statuses} AND o.cancel_state <> 'full'
         AND NOT EXISTS (SELECT 1 FROM packages p WHERE p.order_id = o.id AND p.status <> 'returned')
         AND COALESCE(o.last_activity_at, o.placed_at, o.created_at) <= ?`,
      [cutoff],
    )
    .map((r) => r.id);
  return { packageIds, orderIds };
}

export function markDelivered(db: Db, scope: MarkDeliveredScope, actor: string): { packages: number; orders: number } {
  const { packageIds, orderIds } = deliveredCandidates(db, scope);
  const at = now();
  const touched = new Set<number>();
  db.tx(() => {
    for (const id of packageIds) {
      const orderId = db.value<number>('SELECT order_id FROM packages WHERE id = ?', [id]);
      if (!orderId) continue;
      if (addTrackingEvent(db, id, 'delivered', LABEL, at, 'manual')) {
        deliverItemsForPackage(db, orderId, id);
        touched.add(orderId);
      }
    }
    for (const orderId of orderIds) {
      db.run('UPDATE order_items SET shipped_qty = MAX(shipped_qty, quantity - canceled_qty), delivered_qty = quantity - canceled_qty WHERE order_id = ?', [orderId]);
      orderEvent(db, orderId, 'delivery', LABEL, at, 'manual', null, null, `manual-delivered:${orderId}`);
      touched.add(orderId);
    }
    for (const orderId of touched) recomputeOrder(db, orderId);
    audit(db, actor, 'mark_delivered', 'orders', null, { packages: packageIds.length, orders: orderIds.length, scope });
  });
  return { packages: packageIds.length, orders: orderIds.length };
}
