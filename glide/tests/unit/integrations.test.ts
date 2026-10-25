import { describe, expect, it } from 'vitest';
import { flushOutbox, formatNotification, syncGuildMembers } from '../../src/core/discord/discord';
import { refreshDuePackages, UPS } from '../../src/core/tracking/providers';
import { runAutomations } from '../../src/core/automation/rules';
import { classifyTracking, validUps, validUspsImpb, statusFromText } from '../../src/core/tracking/carriers';
import { normalizeAddress, baseEmail, nameKey, compareNames } from '../../src/core/identity/normalize';
import { DEFAULT_SETTINGS } from '../../src/shared/types';
import { renderSampleEmail } from '../../src/core/sample/retailerEmails';
import { ingest, memDb } from './helpers';

type Call = { url: string; init?: RequestInit };
function mockFetch(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url, init);
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body, text: async () => JSON.stringify(r.body) } as Response;
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('Discord', () => {
  it('imports guild members with stable IDs and records username changes', async () => {
    const db = memDb();
    const page1 = [{ user: { id: '111111111111111111', username: 'alpha', global_name: 'Alpha', avatar: 'abc' } }, { user: { id: '222222222222222222', username: 'botty', bot: true } }];
    const { f } = mockFetch((url) => ({ body: url.includes('after=0') ? page1 : [] }));
    const r = await syncGuildMembers(db, { botToken: 't', guildId: '1' }, f);
    expect(r.total).toBe(1);
    const renamed = [{ user: { id: '111111111111111111', username: 'alpha_v2', global_name: 'Alpha' } }];
    const m2 = mockFetch(() => ({ body: renamed }));
    await syncGuildMembers(db, { botToken: 't', guildId: '1' }, m2.f);
    expect(db.value('SELECT username FROM members')).toBe('alpha_v2');
    expect(db.value('SELECT username FROM discord_name_history')).toBe('alpha');
    expect(db.value('SELECT COUNT(*) FROM members')).toBe(1);
  });

  it('never puts addresses, emails or tracking numbers into notifications', () => {
    const msg = JSON.stringify(formatNotification('admin_channel', { event: 'order_created', retailer: 'Target', orderNumber: '1', totalCents: 100, currency: 'USD', units: 1, member: 'alpha' }));
    expect(msg).not.toMatch(/@example|Main St|1Z[0-9A-Z]{16}/);
  });

  it('flushes the outbox to the admin channel and DMs, retrying failures', async () => {
    const db = memDb();
    db.run("INSERT INTO notifications_outbox (channel_kind, target, payload_json, dedupe_key, status, created_at) VALUES ('admin_channel', 'admin', '{\"event\":\"delivered\",\"retailer\":\"Target\",\"orderNumber\":\"1\",\"totalCents\":100}', 'a', 'pending', '2026')");
    db.run("INSERT INTO notifications_outbox (channel_kind, target, payload_json, dedupe_key, status, created_at) VALUES ('member_dm', '111111111111111111', '{\"event\":\"delivered\",\"retailer\":\"Target\",\"orderNumber\":\"1\",\"totalCents\":100}', 'b', 'pending', '2026')");
    const { f, calls } = mockFetch((url) => ({ body: url.endsWith('/users/@me/channels') ? { id: '999' } : { id: 'm' } }));
    const sent = await flushOutbox(db, { botToken: 't', guildId: '1', adminChannelId: '555555555555555555' }, f);
    expect(sent).toBe(2);
    expect(calls.map((c) => c.url)).toEqual(['https://discord.com/api/v10/channels/555555555555555555/messages', 'https://discord.com/api/v10/users/@me/channels', 'https://discord.com/api/v10/channels/999/messages']);
    expect(db.value("SELECT COUNT(*) FROM notifications_outbox WHERE status = 'sent'")).toBe(2);
  });
});

describe('carrier tracking', () => {
  it('validates check digits and classifies carriers', () => {
    expect(validUps('1Z999AA10123456784')).toBe(true);
    expect(validUps('1Z999AA10123456785')).toBe(false);
    expect(validUspsImpb('9400111202555842332669')).toBe(true);
    expect(validUspsImpb('9400111202555842332668')).toBe(false);
    expect(classifyTracking('1Z999AA10123456784')?.carrier).toBe('ups');
    expect(classifyTracking('TBA123456789012')?.carrier).toBe('amazon');
    expect(statusFromText('Your package was delivered')).toBe('delivered');
    expect(statusFromText('Out for delivery today')).toBe('out_for_delivery');
    expect(statusFromText('Package will be delivered tomorrow')).not.toBe('delivered');
  });

  it('refreshes packages through a carrier API and updates order state', async () => {
    const db = memDb();
    const spec = { retailer: 'target' as const, orderNumber: '912001234567890', date: new Date('2026-10-20T16:00:00Z'), to: 'a@b.com', items: [{ title: 'Pokémon TCG: Elite Trainer Box', sku: 'ETB', qty: 1, unitCents: 4999 }], address: { name: 'A B', line1: '1 Main St', city: 'X', state: 'IL', postal: '62704' }, taxCents: 0, shippingCents: 0 };
    await ingest(db, renderSampleEmail({ ...spec, type: 'order_confirmation' }).raw);
    await ingest(db, renderSampleEmail({ ...spec, type: 'shipping', tracking: [{ number: '1Z999AA10123456784', carrier: 'ups' }] }).raw);
    db.run('UPDATE packages SET next_check_at = NULL');
    const { f } = mockFetch((url) =>
      url.includes('oauth')
        ? { body: { access_token: 'tok' } }
        : { body: { trackResponse: { shipment: [{ package: [{ activity: [{ status: { description: 'Delivered', type: 'D' }, location: { address: { city: 'Springfield', stateProvince: 'IL' } }, date: '20261023', time: '143000' }] }] }] } } },
    );
    const r = await refreshDuePackages({ db, credentialsFor: (id) => (id === 'ups' ? { clientId: 'c', clientSecret: 's' } : null), fetcher: f });
    expect(r.updated).toBe(1);
    expect(db.value('SELECT status FROM packages')).toBe('delivered');
    expect(db.value('SELECT fulfillment_status FROM orders')).toBe('delivered');
    expect(db.value("SELECT COUNT(*) FROM tracking_events WHERE source = 'carrier_api'")).toBe(1);
    expect(UPS.carriers).toContain('ups');
  });

  it('skips packages whose carrier has no configured credentials (no fabricated updates)', async () => {
    const db = memDb();
    db.run("INSERT INTO orders (id, retailer_id, order_number, placed_at, currency, last_activity_at, created_at, updated_at) VALUES (1, 'target', 'X', '2026', 'USD', '2026', '2026', '2026')");
    db.run("INSERT INTO packages (order_id, tracking_number, carrier, status, created_at) VALUES (1, '1Z999AA10123456784', 'ups', 'in_transit', '2026')");
    const r = await refreshDuePackages({ db, credentialsFor: () => null });
    expect(r).toEqual({ checked: 0, updated: 0, skipped: 1, errors: [] });
    expect(db.value('SELECT status FROM packages')).toBe('in_transit');
  });
});

describe('automation', () => {
  it('runs each rule at most once per event', async () => {
    const db = memDb();
    db.run("UPDATE automation_rules SET enabled = 1 WHERE key = 'H_new_order_admin'");
    db.run("INSERT INTO orders (id, retailer_id, order_number, placed_at, currency, last_activity_at, created_at, updated_at) VALUES (1, 'target', 'X', '2026', 'USD', '2026', '2026', '2026')");
    const ev = [{ kind: 'order_created' as const, key: 'new:1', orderId: 1, at: '2026-10-20T00:00:00Z' }];
    const s = { ...DEFAULT_SETTINGS, discordEnabled: true };
    await runAutomations(db, ev, s);
    await runAutomations(db, ev, s);
    expect(db.value("SELECT COUNT(*) FROM notifications_outbox")).toBe(1);
  });
});

describe('normalization', () => {
  it('normalizes address formatting variants to one canonical key, keeping units distinct', () => {
    const a = normalizeAddress({ line1: '1427 Maple Ridge Drive', line2: 'Apartment 4B', city: 'Springfield', state: 'Illinois', postal: '62704-1234' });
    const b = normalizeAddress({ line1: '1427 maple ridge dr. #4b', city: 'SPRINGFIELD', state: 'IL', postal: '62704' });
    const c = normalizeAddress({ line1: '1427 Maple Ridge Dr Apt 5B', city: 'Springfield', state: 'IL', postal: '62704' });
    expect(a.canonicalKey).toBe(b.canonicalKey);
    expect(a.canonicalKey).not.toBe(c.canonicalKey);
    expect(a.streetKey).toBe(c.streetKey);
  });
  it('canonicalizes Gmail dots/plus tags and nicknames', () => {
    expect(baseEmail('Jordan.Rivers+target@googlemail.com')).toBe('jordanrivers@gmail.com');
    expect(baseEmail('jordan+x@mydomain.com')).toBe('jordan@mydomain.com');
    expect(compareNames(nameKey('Mike Rivers'), nameKey('Michael Rivers'))).toBe('nickname');
  });
});
