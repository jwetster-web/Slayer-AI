import { describe, expect, it } from 'vitest';
import { getSettings } from '../../src/core/workspace';
import { renderSampleEmail, type SampleEmailSpec } from '../../src/core/sample/retailerEmails';
import { gmailForward, outlookForward } from '../../src/core/sample/mime';
import { createProfile, linkEmail, setAddressOwner, upsertAddress, upsertEmail, upsertMember } from '../../src/core/identity/store';
import { resolveCandidate } from '../../src/core/identity/matcher';
import type { Db } from '../../src/core/db/database';
import { ingest, memDb } from './helpers';

const ADDR = { name: 'Jordan Rivers', line1: '1427 Maple Ridge Drive', line2: 'Apt 4B', city: 'Springfield', state: 'IL', postal: '62704' };

function spec(over: Partial<SampleEmailSpec> = {}): SampleEmailSpec {
  return {
    retailer: 'target',
    type: 'order_confirmation',
    orderNumber: '912001234567890',
    date: new Date('2026-10-20T16:32:18Z'),
    to: 'buyer14@example.com',
    items: [
      { title: 'Pokémon TCG: Scarlet & Violet Elite Trainer Box', sku: 'ETB-001', qty: 2, unitCents: 4999, imageUrl: 'https://img.test/etb.png' },
      { title: 'Pokémon TCG: Booster Bundle (6 Packs)', sku: 'BB-002', qty: 1, unitCents: 2694, imageUrl: 'https://img.test/bb.png' },
      { title: 'Pokémon TCG: Collector Tin', sku: 'TIN-003', qty: 3, unitCents: 2699, imageUrl: 'https://img.test/tin.png' },
    ],
    address: ADDR,
    taxCents: 1102,
    shippingCents: 0,
    ...over,
  };
}

/** A member with one verified profile, email and address. */
function seedMember(db: Db, o: { discordId: string; username: string; name: string; email?: string; address?: typeof ADDR }) {
  const m = upsertMember(db, { discordId: o.discordId, username: o.username }).id;
  const [first, last] = o.name.split(' ');
  const p = createProfile(db, { name: `${o.username} main`, firstName: first, lastName: last, memberId: m, source: 'import' });
  if (o.email) linkEmail(db, upsertEmail(db, o.email)!, m, p, 'verified', 'admin');
  if (o.address) {
    const a = upsertAddress(db, o.address);
    setAddressOwner(db, a, m, 'verified', 'admin');
    db.run('INSERT OR IGNORE INTO profile_addresses (profile_id, address_id) VALUES (?, ?)', [p, a]);
  }
  return { memberId: m, profileId: p };
}

const order = (db: Db, n = '912001234567890') => db.get<any>("SELECT * FROM orders WHERE order_number = ?", [n]);

describe('acceptance scenarios', () => {
  it('Scenario 1: returning buyer at a verified address is auto-matched and spending updates', async () => {
    const db = memDb();
    const { memberId, profileId } = seedMember(db, { discordId: '111111111111111111', username: 'ExampleUser', name: 'Jordan Rivers', email: 'old@example.com', address: { ...ADDR, line1: '1427 Maple Ridge Dr', line2: '#4B' } });
    const r = await ingest(db, renderSampleEmail(spec()).raw);
    expect(r.status).toBe('parsed');
    const o = order(db);
    expect(o.member_id).toBe(memberId);
    expect(o.profile_id).toBe(profileId);
    expect(o.match_status).toBe('auto');
    expect(o.match_confidence).toBeGreaterThan(0.9);
    expect(o.total_cents).toBe(9998 + 2694 + 8097 + 1102);
    expect(o.units).toBe(6);
    const spend = db.value<number>('SELECT SUM(net_cents) FROM orders WHERE member_id = ?', [memberId]);
    expect(spend).toBe(o.total_cents);
    expect(r.sink.events.some((e) => e.kind === 'order_created')).toBe(true);
    expect(r.sink.events.some((e) => e.kind === 'match_auto')).toBe(true);
  });

  it('Scenario 2: purchase emails are not identifiers — the order matches by address and the email is not tied to the buyer', async () => {
    const db = memDb();
    const { memberId } = seedMember(db, { discordId: '222', username: 'ExampleUser', name: 'Jordan Rivers', email: 'old@example.com', address: ADDR });
    await ingest(db, renderSampleEmail(spec({ to: 'brand-new@example.com' })).raw);
    const o = order(db);
    expect(o.member_id).toBe(memberId);
    expect(JSON.parse(o.match_evidence_json).some((e: { signal: string }) => e.signal.startsWith('email'))).toBe(false);
    expect(db.value("SELECT member_id FROM emails WHERE address = 'brand-new@example.com'") ?? null).toBeNull();
    expect(db.value("SELECT COUNT(*) FROM match_candidates WHERE kind = 'email_link'")).toBe(0);
  });

  it('Scenario 2a: a member\'s own (rotated) checkout email at an unknown address does not assign the order to them', async () => {
    const db = memDb();
    seedMember(db, { discordId: '221', username: 'Rotator', name: 'Sam Lee', email: 'drop-account@example.com', address: ADDR });
    await ingest(db, renderSampleEmail(spec({ to: 'drop-account@example.com', address: { ...ADDR, name: 'Pat Doe', line1: '9 Elsewhere Rd', postal: '60601', city: 'Chicago' } })).raw);
    expect(order(db).member_id).toBeNull();
  });

  it('Scenario 2b: an unknown email and name shipping to a member-only verified address is assigned by the address', async () => {
    const db = memDb();
    const m = seedMember(db, { discordId: '223', username: 'ExampleUser', name: 'Jordan Rivers', email: 'old@example.com', address: ADDR });
    await ingest(db, renderSampleEmail(spec({ to: 'someone@example.com', address: { ...ADDR, name: 'Casey Stone' } })).raw);
    const o = order(db);
    expect(o.member_id).toBe(m.memberId);
    expect(o.match_status).toBe('auto');
    expect(JSON.parse(o.match_evidence_json).some((e: { signal: string }) => e.signal === 'address')).toBe(true);
  });

  it('Scenario 2c: a match over 50% (exact profile name, new address) is auto-assigned', async () => {
    const db = memDb();
    const m = seedMember(db, { discordId: '224', username: 'OtherUser', name: 'Jordan Rivers', email: 'old2@example.com', address: { ...ADDR, line1: '9 Elsewhere Rd', postal: '60601', city: 'Chicago' } });
    await ingest(db, renderSampleEmail(spec({ to: 'someone@example.com', address: { ...ADDR, name: 'Jordan Rivers' } })).raw);
    const o = order(db);
    expect(o.member_id).toBe(m.memberId);
    expect(o.match_status).toBe('auto');
  });

  it('Scenario 3: shared household keeps members separate and never double-attributes', async () => {
    const db = memDb();
    const a = seedMember(db, { discordId: '301', username: 'Alex', name: 'Alex Rivers', email: 'alex@example.com', address: ADDR });
    const b = seedMember(db, { discordId: '302', username: 'Blair', name: 'Blair Rivers', email: 'blair@example.com', address: ADDR });
    // Alex's name at the shared address → Alex.
    await ingest(db, renderSampleEmail(spec({ orderNumber: '912000000000001', to: 'alex@example.com', address: { ...ADDR, name: 'Alex Rivers' } })).raw);
    expect(order(db, '912000000000001').member_id).toBe(a.memberId);
    // Unknown email, unknown name, shared address → review, not assigned to both.
    await ingest(db, renderSampleEmail(spec({ orderNumber: '912000000000002', to: 'mystery@example.com', address: { ...ADDR, name: 'Pat Doe' } })).raw);
    const o2 = order(db, '912000000000002');
    expect(o2.member_id).toBeNull();
    expect(['review', 'unmatched']).toContain(o2.match_status);
    // Blair's name at the shared address → Blair (over 50%, and Alex is well behind).
    await ingest(db, renderSampleEmail(spec({ orderNumber: '912000000000003', to: 'other@example.com', address: { ...ADDR, name: 'Blair Rivers' } })).raw);
    expect(order(db, '912000000000003').member_id).toBe(b.memberId);
    // Each order belongs to exactly one member; the stranger's order to nobody.
    expect(db.value<number>('SELECT COUNT(*) FROM orders WHERE member_id IS NOT NULL')).toBe(2);
  });

  it('Scenario 4: duplicate forwarding yields one canonical order with multiple sources', async () => {
    const db = memDb();
    const r = renderSampleEmail(spec());
    const orig = { fromName: r.fromName, from: r.from, to: 'buyer14@example.com', subject: r.subject, date: new Date('2026-10-20T16:32:18Z'), html: r.html };
    const a = await ingest(db, r.raw, null);
    const b = await ingest(db, gmailForward(orig, 'fwd1@example.org', 'hub1@example.org', new Date('2026-10-20T17:00:00Z')));
    const c = await ingest(db, outlookForward(orig, 'fwd2@example.org', 'hub2@example.org', new Date('2026-10-20T17:05:00Z')));
    expect(a.status).toBe('parsed');
    expect(b.status).toBe('duplicate');
    expect(c.status).toBe('duplicate');
    expect(db.value<number>('SELECT COUNT(*) FROM orders')).toBe(1);
    const o = order(db);
    expect(db.value<number>('SELECT COUNT(*) FROM order_sources WHERE order_id = ?', [o.id])).toBe(3);
    expect(o.units).toBe(6);
    expect(db.value<number>('SELECT COUNT(*) FROM order_items WHERE order_id = ?', [o.id])).toBe(3);
  });

  it('Scenario 5: confirmation then shipping email with two packages', async () => {
    const db = memDb();
    await ingest(db, renderSampleEmail(spec()).raw);
    await ingest(db, renderSampleEmail(spec({ type: 'shipping', date: new Date('2026-10-21T10:00:00Z'), tracking: [{ number: '1Z999AA10123456784', carrier: 'ups' }, { number: '9400111899223197428490', carrier: 'usps' }] })).raw);
    const o = order(db);
    expect(db.value<number>('SELECT COUNT(*) FROM orders')).toBe(1);
    const pk = db.all<any>('SELECT * FROM packages WHERE order_id = ? ORDER BY tracking_number', [o.id]);
    expect(pk.map((p) => p.tracking_number)).toEqual(['1Z999AA10123456784', '9400111899223197428490']);
    expect(pk.map((p) => p.carrier)).toEqual(['ups', 'usps']);
    expect(pk.every((p) => p.status === 'in_transit')).toBe(true);
    expect(o.fulfillment_status).toBe('shipped');
    expect(db.value<number>('SELECT COUNT(*) FROM tracking_events')).toBe(2);
    // Delivery for one package → partially delivered; then the other → delivered.
    await ingest(db, renderSampleEmail(spec({ type: 'delivery', date: new Date('2026-10-23T15:00:00Z'), tracking: [{ number: '1Z999AA10123456784', carrier: 'ups' }] })).raw);
    expect(order(db).fulfillment_status).toBe('partially_delivered');
    await ingest(db, renderSampleEmail(spec({ type: 'delivery', date: new Date('2026-10-24T15:00:00Z'), tracking: [{ number: '9400111899223197428490', carrier: 'usps' }] })).raw);
    expect(order(db).fulfillment_status).toBe('delivered');
  });

  it('Scenario 6: partial cancellation keeps gross, reduces net and units, separate item states', async () => {
    const db = memDb();
    await ingest(db, renderSampleEmail(spec()).raw);
    const s = spec({ type: 'partial_cancellation', date: new Date('2026-10-20T20:00:00Z') });
    s.items = s.items.map((i) => (i.sku === 'BB-002' ? { ...i, canceled: true } : i));
    await ingest(db, renderSampleEmail(s).raw);
    const o = order(db);
    const gross = 9998 + 2694 + 8097 + 1102;
    expect(o.total_cents).toBe(gross);
    expect(o.cancel_state).toBe('partial');
    expect(o.canceled_units).toBe(1);
    expect(o.canceled_cents).toBe(2694);
    expect(o.net_cents).toBe(gross - 2694);
    const items = db.all<any>('SELECT sku, status, canceled_qty FROM order_items WHERE order_id = ? ORDER BY sku', [o.id]);
    expect(items).toEqual([
      { sku: 'BB-002', status: 'canceled', canceled_qty: 1 },
      { sku: 'ETB-001', status: 'ordered', canceled_qty: 0 },
      { sku: 'TIN-003', status: 'ordered', canceled_qty: 0 },
    ]);
    // The same cancellation forwarded again changes nothing.
    await ingest(db, renderSampleEmail(s).raw);
    expect(order(db).canceled_units).toBe(1);
  });

  it('review hold is not a cancellation; a later shipment clears it', async () => {
    const db = memDb();
    await ingest(db, renderSampleEmail(spec()).raw);
    await ingest(db, renderSampleEmail(spec({ type: 'review_hold' })).raw);
    let o = order(db);
    expect(o.review_status).toBe('hold');
    expect(o.cancel_state).toBe('none');
    await ingest(db, renderSampleEmail(spec({ type: 'shipping', tracking: [{ number: '1Z999AA10123456784', carrier: 'ups' }] })).raw);
    o = order(db);
    expect(o.review_status).toBe('cleared');
  });

  it('full cancellation then refund does not double-subtract', async () => {
    const db = memDb();
    await ingest(db, renderSampleEmail(spec()).raw);
    await ingest(db, renderSampleEmail(spec({ type: 'cancellation' })).raw);
    const gross = 9998 + 2694 + 8097 + 1102;
    let o = order(db);
    expect(o.cancel_state).toBe('full');
    expect(o.fulfillment_status).toBe('canceled');
    expect(o.net_cents).toBe(0);
    await ingest(db, renderSampleEmail(spec({ type: 'refund', refundCents: gross })).raw);
    o = order(db);
    expect(o.refunded_cents).toBe(gross);
    expect(o.net_cents).toBe(0);
    expect(o.financial_status).toBe('refunded');
  });

  it('Unmatched by address: one decision assigns every order to that address and future ones too', async () => {
    const db = memDb();
    const m = seedMember(db, { discordId: '501', username: 'Casey', name: 'Casey Lane' });
    const HOME = { name: 'Pat Q', line1: '1815 Carleton Ave', city: 'Bay Shore', state: 'NY', postal: '11706' };
    for (const n of ['912000000000101', '912000000000102']) await ingest(db, renderSampleEmail(spec({ orderNumber: n, to: 'x@example.com', address: HOME })).raw);
    const { unmatchedAddressGroups, assignAddressToMember } = await import('../../src/core/identity/byAddress');
    const groups = unmatchedAddressGroups(db);
    expect(groups).toHaveLength(1);
    expect(groups[0].orders).toBe(2);
    expect(assignAddressToMember(db, groups[0].addressId, m.memberId, 'admin', getSettings(db))).toEqual({ orders: 2 });
    expect(db.value('SELECT COUNT(*) FROM orders WHERE member_id = ?', [m.memberId])).toBe(2);
    await ingest(db, renderSampleEmail(spec({ orderNumber: '912000000000103', to: 'y@example.com', address: { ...HOME, name: 'Someone Else' } })).raw);
    expect(order(db, '912000000000103').member_id).toBe(m.memberId);
  });

  it('Near-miss address (street typo or wrong ZIP) is suggested for review, never auto-assigned', async () => {
    const db = memDb();
    const m = seedMember(db, { discordId: '502', username: 'Jon', name: 'Jon Elias', address: { name: 'Jon Elias', line1: '5312 Poplar Vallley Court', line2: '', city: 'Centreville', state: 'VA', postal: '20120' } });
    await ingest(db, renderSampleEmail(spec({ orderNumber: '912000000000201', to: 'z@example.com', address: { name: 'Pat Q', line1: '5312 Poplar Valley Ct', city: 'Centreville', state: 'VA', postal: '20120' } })).raw);
    const o = order(db, '912000000000201');
    expect(o.member_id).toBeNull();
    expect(o.match_status).toBe('review');
    const cand = db.get<any>("SELECT * FROM match_candidates WHERE kind = 'order_assignment' AND order_id = ?", [o.id]);
    expect(cand.member_id).toBe(m.memberId);
    expect(cand.evidence_json).toContain('address_similar');
  });

  it('Discord sync attaches the Discord ID to a member imported by username instead of duplicating them', () => {
    const db = memDb();
    const imported = upsertMember(db, { username: 'pikafan' }).id;
    const synced = upsertMember(db, { discordId: '123456789012345678', username: 'PikaFan' });
    expect(synced).toEqual({ id: imported, created: false });
    expect(db.value('SELECT discord_id FROM members WHERE id = ?', [imported])).toBe('123456789012345678');
    expect(db.value('SELECT COUNT(*) FROM members')).toBe(1);
  });

  it('Stale filter finds open orders with no update in N days', async () => {
    const db = memDb();
    await ingest(db, renderSampleEmail(spec({ orderNumber: '912000000000301', date: new Date(Date.now() - 20 * 86400000) })).raw);
    await ingest(db, renderSampleEmail(spec({ orderNumber: '912000000000302', date: new Date(Date.now() - 2 * 86400000) })).raw);
    db.run('UPDATE orders SET last_activity_at = placed_at');
    const { listOrders } = await import('../../src/core/queries/views');
    expect(listOrders(db, { staleDays: 10 }).rows.map((r) => r.orderNumber)).toEqual(['912000000000301']);
  });
});
