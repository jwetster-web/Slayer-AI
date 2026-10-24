// Carrier notification emails (UPS My Choice, FedEx Delivery Manager, USPS
// Informed Delivery, DHL…). They carry no retailer order number, so they are
// matched to packages GLIDE already knows by tracking number and applied as
// tracking events — package monitoring that needs no carrier API credentials.

import type { Carrier, PackageStatus, UnwrappedEmail } from '../../shared/types';
import type { Db } from '../db/database';
import type { EventSink } from '../events';
import { addTrackingEvent } from '../orders/ingest';
import { recomputeOrder } from '../orders/state';
import { buildDoc } from '../parsing/adapters';
import { extractTracking } from '../parsing/extract';
import { domainMatches, domainOf } from '../retailers/registry';
import { statusFromText } from './carriers';

const CARRIER_DOMAINS: [Carrier, string[]][] = [
  ['ups', ['ups.com']],
  ['fedex', ['fedex.com']],
  ['usps', ['usps.com', 'usps.gov']],
  ['dhl', ['dhl.com', 'dhl.de']],
  ['ontrac', ['ontrac.com']],
  ['lasership', ['lasership.com']],
];

export interface CarrierUpdate {
  carrier: Carrier;
  status: PackageStatus;
  description: string;
  trackingNumbers: string[];
}

export function carrierOfSender(from: string): Carrier | null {
  const d = domainOf(from);
  return CARRIER_DOMAINS.find(([, ds]) => domainMatches(d, ds))?.[0] ?? null;
}

export function parseCarrierEmail(env: UnwrappedEmail): CarrierUpdate | null {
  const carrier = carrierOfSender(env.from);
  if (!carrier) return null;
  const doc = buildDoc(env);
  const numbers = extractTracking(doc.root, doc.lines).map((t) => t.number);
  // Digest emails list many packages with different statuses; one subject can't describe them all.
  if (!numbers.length || numbers.length > 3) return null;
  let status = statusFromText(env.subject);
  if (status === 'unknown') status = statusFromText(doc.lines.slice(0, 15).join(' '));
  if (/scheduled for delivery today|arriving today|delivery today/i.test(`${env.subject} ${doc.lines.slice(0, 15).join(' ')}`) && status !== 'delivered') status = 'out_for_delivery';
  if (status === 'unknown') return null;
  return { carrier, status, description: env.subject.slice(0, 200) || status.replace(/_/g, ' '), trackingNumbers: numbers };
}

/** Applies a carrier email to every known package with a matching tracking number. Returns the packages updated. */
export function applyCarrierUpdate(db: Db, u: CarrierUpdate, at: string, sourceMessageId: number, sink?: EventSink): { packages: number; orderIds: number[] } {
  const orderIds = new Set<number>();
  let packages = 0;
  for (const n of u.trackingNumbers) {
    const rows = db.all<{ id: number; order_id: number }>('SELECT id, order_id FROM packages WHERE upper(tracking_number) = ?', [n.toUpperCase()]);
    for (const p of rows) {
      if (!addTrackingEvent(db, p.id, u.status, u.description, at, 'email', null, String(sourceMessageId))) continue;
      packages++;
      orderIds.add(p.order_id);
      if (u.status === 'delivered') {
        db.run('UPDATE order_items SET delivered_qty = MAX(delivered_qty, shipped_qty) WHERE order_id = ? AND (SELECT COUNT(*) FROM packages WHERE order_id = ? AND status <> ?) = 0', [p.order_id, p.order_id, 'delivered']);
        sink?.push({ kind: 'delivered', key: `del:${p.id}`, orderId: p.order_id, packageId: p.id, at });
      }
      if (u.status === 'out_for_delivery') sink?.push({ kind: 'out_for_delivery', key: `ofd:${p.id}`, orderId: p.order_id, packageId: p.id, at });
    }
  }
  for (const id of orderIds) {
    db.run('UPDATE orders SET last_activity_at = MAX(COALESCE(last_activity_at, ?), ?) WHERE id = ?', [at, at, id]);
    recomputeOrder(db, id);
  }
  return { packages, orderIds: [...orderIds] };
}
