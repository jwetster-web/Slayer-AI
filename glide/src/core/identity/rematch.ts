// Re-matching orders to members/profiles after the identity data changes
// (a member/address import) or after address extraction improved: fills in
// shipping addresses from stored emails, then re-runs the matcher on every
// order that isn't locked by a manual assignment.

import type { AppSettings } from '../../shared/types';
import { now, type Db } from '../db/database';
import { reparseStored } from '../email/process';
import type { DataCipher } from '../secrets';
import { matchOrder } from './matcher';
import { normalizeAddress } from './normalize';
import { upsertAddress } from './store';

/** Re-reads stored emails of orders that have no shipping address. Returns how many got one. */
export async function backfillOrderAddresses(db: Db, cipher: DataCipher | null): Promise<number> {
  const orders = db.all<{ id: number }>('SELECT id FROM orders WHERE shipping_address_id IS NULL');
  let filled = 0;
  for (const o of orders) {
    const msgs = db.all<{ id: number }>('SELECT sm.id FROM source_messages sm JOIN source_message_blobs b ON b.message_id = sm.id WHERE sm.order_id = ? ORDER BY sm.id', [o.id]);
    for (const m of msgs) {
      const hit = (await reparseStored(db, m.id, cipher)).find((p) => p.shippingAddress);
      if (!hit?.shippingAddress) continue;
      db.tx(() => {
        const aid = upsertAddress(db, hit.shippingAddress!);
        db.run('UPDATE orders SET shipping_address_id = ?, recipient_name = COALESCE(recipient_name, ?), updated_at = ? WHERE id = ? AND shipping_address_id IS NULL', [aid, hit.recipientName ?? hit.shippingAddress!.name ?? null, now(), o.id]);
      });
      filled++;
      break;
    }
  }
  return filled;
}

/** Re-runs automatic matching on every order not locked by a manual assignment. */
export function rematchOrders(db: Db, settings: AppSettings): { checked: number; matched: number; review: number } {
  const ids = db.all<{ id: number }>("SELECT id FROM orders WHERE match_locked = 0 AND match_status IN ('unmatched', 'review', 'auto')").map((r) => r.id);
  let matched = 0;
  let review = 0;
  db.tx(() => {
    for (const id of ids) {
      const d = matchOrder(db, id, settings);
      if (d?.status === 'auto') matched++;
      else if (d?.status === 'review') review++;
    }
  });
  return { checked: ids.length, matched, review };
}

export function addressBackfillDone(db: Db): boolean {
  return !!db.value("SELECT value FROM workspace_meta WHERE key = 'address_backfill_v2'");
}

export function markAddressBackfillDone(db: Db) {
  db.run("INSERT INTO workspace_meta (key, value) VALUES ('address_backfill_v2', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [now()]);
}

/**
 * Re-keys stored addresses with the current normalizer and merges rows that now
 * turn out to be the same place ("29TH AVENUE RD" = "29TH AVE RD"). Returns how many were merged.
 */
export function rekeyAddresses(db: Db): { rekeyed: number; merged: number } {
  let rekeyed = 0;
  let merged = 0;
  db.tx(() => {
    const rows = db.all<{ id: number; canonical_key: string; line1: string; line2: string | null; city: string; state: string | null; postal: string; country: string }>(
      'SELECT id, canonical_key, line1, line2, city, state, postal, country FROM addresses ORDER BY id',
    );
    for (const r of rows) {
      const n = normalizeAddress({ line1: r.line1, line2: r.line2 ?? undefined, city: r.city, state: r.state ?? undefined, postal: r.postal, country: r.country });
      if (n.canonicalKey === r.canonical_key) continue;
      const into = db.value<number>('SELECT id FROM addresses WHERE canonical_key = ? AND id <> ?', [n.canonicalKey, r.id]);
      if (!into) {
        db.run('UPDATE addresses SET canonical_key = ?, street_key = ?, line1 = ? WHERE id = ?', [n.canonicalKey, n.streetKey, n.line1, r.id]);
        rekeyed++;
        continue;
      }
      db.run('UPDATE orders SET shipping_address_id = ? WHERE shipping_address_id = ?', [into, r.id]);
      db.run('UPDATE orders SET billing_address_id = ? WHERE billing_address_id = ?', [into, r.id]);
      db.run(
        `INSERT INTO address_owners (address_id, member_id, status, created_at) SELECT ?, member_id, status, created_at FROM address_owners WHERE address_id = ?
         ON CONFLICT(address_id, member_id) DO UPDATE SET status = CASE WHEN excluded.status = 'verified' THEN 'verified' ELSE address_owners.status END`,
        [into, r.id],
      );
      db.run('INSERT OR IGNORE INTO profile_addresses (profile_id, address_id) SELECT profile_id, ? FROM profile_addresses WHERE address_id = ?', [into, r.id]);
      db.run('UPDATE address_variants SET address_id = ? WHERE address_id = ?', [into, r.id]);
      db.run('UPDATE match_candidates SET address_id = ? WHERE address_id = ?', [into, r.id]);
      db.run('DELETE FROM addresses WHERE id = ?', [r.id]);
      merged++;
    }
  });
  return { rekeyed, merged };
}
