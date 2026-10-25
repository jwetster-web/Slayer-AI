// Ownerless orders grouped by where they ship, so one decision ("this address is
// @member's") assigns every order to it — and teaches the matcher for next time.

import type { AppSettings } from '../../shared/types';
import { audit } from '../audit';
import type { Db } from '../db/database';
import { assignOrder } from './matcher';
import { setAddressOwner } from './store';

export interface AddressGroup {
  addressId: number;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postal: string;
  orders: number;
  totalCents: number;
  lastOrderAt: string | null;
  recipients: string[];
  owners: { memberId: number; name: string; status: string }[];
}

export function unmatchedAddressGroups(db: Db, limit = 200): AddressGroup[] {
  const rows = db.all<{ addressId: number; line1: string; line2: string | null; city: string; state: string | null; postal: string; orders: number; totalCents: number; lastOrderAt: string | null; recipients: string | null }>(
    `SELECT a.id AS addressId, a.line1, a.line2, a.city, a.state, a.postal, COUNT(o.id) AS orders, COALESCE(SUM(o.net_cents), 0) AS totalCents,
            MAX(COALESCE(o.placed_at, o.created_at)) AS lastOrderAt, GROUP_CONCAT(DISTINCT o.recipient_name) AS recipients
     FROM orders o JOIN addresses a ON a.id = o.shipping_address_id
     WHERE o.member_id IS NULL AND o.match_locked = 0
     GROUP BY a.id ORDER BY orders DESC, lastOrderAt DESC LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({
    ...r,
    recipients: (r.recipients ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6),
    owners: db.all<{ memberId: number; name: string; status: string }>(
      'SELECT m.id AS memberId, COALESCE(m.display_name, m.username) AS name, ao.status FROM address_owners ao JOIN members m ON m.id = ao.member_id WHERE ao.address_id = ? ORDER BY ao.status DESC',
      [r.addressId],
    ),
  }));
}

/** Marks the address as the member's (verified) and assigns every ownerless order shipping there. */
export function assignAddressToMember(db: Db, addressId: number, memberId: number, actor: string, settings: AppSettings): { orders: number } {
  const ids = db.all<{ id: number }>('SELECT id FROM orders WHERE shipping_address_id = ? AND member_id IS NULL AND match_locked = 0', [addressId]).map((r) => r.id);
  db.tx(() => {
    setAddressOwner(db, addressId, memberId, 'verified', actor);
    for (const id of ids) assignOrder(db, id, memberId, actor, settings);
    audit(db, actor, 'address_assigned', 'address', addressId, { memberId, orders: ids.length });
  });
  return { orders: ids.length };
}
