import { describe, expect, it } from 'vitest';
import { applyImport, cleanCell, parseCsv, previewImport } from '../../src/core/csv/importer';
import { syncAccount, type FetchedMessage, type MailClient } from '../../src/core/email/imapSync';
import { attachAltImages, classifyMessageType, extractItemsFromHtml, extractOrderNumber } from '../../src/core/parsing/extract';
import { parseHtml } from '../../src/core/parsing/html';
import { deriveState } from '../../src/core/orders/state';
import { resolveProduct } from '../../src/core/products/catalog';
import { borrowImagesByTitle } from '../../src/core/products/repair';
import { parseRetailEmail } from '../../src/core/parsing/adapters';
import { domainOf, unrelayAddress } from '../../src/core/retailers/registry';
import { buildMime } from '../../src/core/sample/mime';
import { renderSampleEmail } from '../../src/core/sample/retailerEmails';
import { ingest, memDb } from './helpers';

const item = [{ title: 'Pokémon TCG: Elite Trainer Box', sku: 'ETB', qty: 1, unitCents: 4999 }];
const addr = { name: 'A B', line1: '1 Main St', city: 'X', state: 'IL', postal: '62704' };

describe('relay senders', () => {
  it('decodes iCloud Hide My Email and DuckDuckGo aliases to the real retailer domain', () => {
    expect(unrelayAddress('orders_at_oe1_target_com_m2x330qtcf23yp_cc9j9599@icloud.com')).toBe('orders@oe1.target.com');
    expect(domainOf('help_at_walmart_com_b7wcfdz5v8z365_70g85924@icloud.com')).toBe('walmart.com');
    expect(domainOf('orders_at_mattel_com_f4k3s7r622w1y3_h2hf3885@icloud.com')).toBe('mattel.com');
    expect(domainOf('orders_at_target.com_abc123@duck.com')).toBe('target.com');
    expect(unrelayAddress('jane_at_home@gmail.com')).toBeNull();
    expect(domainOf('orders@oe.target.com')).toBe('oe.target.com');
  });
});

describe('order confirmation detection', () => {
  it.each([
    'Thanks for your Target order!',
    'Chloe, thanks for your curbside pickup order',
    'Thanks for your delivery order, Daniel',
    'Order AQTR_9667661 confirmed',
    'We got your order!',
    "Thanks for shopping with us! Here's your order #:102003829549829.",
    'Your Mattel Creations Order #CHP10513288 is confirmed',
  ])('%s', (subject) => expect(classifyMessageType(subject, [])).toBe('order_confirmation'));

  it('treats "arrives today" as out for delivery', () => {
    expect(classifyMessageType('Your order arrives today! Order #902003811279155', [])).toBe('out_for_delivery');
    expect(classifyMessageType('Your order arrives tomorrow! Order #902003811375184', [])).toBe('shipping');
  });

  it('never takes a word as the order number', () => {
    expect(extractOrderNumber([/(?:order)\s*#\s*([A-Z0-9-]{3,14})\b/i], 'Your Mattel Creations Order # has shipped', ['Order #CHP10513288'])).toBe('CHP10513288');
    expect(extractOrderNumber([/(?:order)\s*#\s*([A-Z0-9-]{3,14})\b/i], 'Your Order # has shipped', [])).toBeNull();
  });
});

describe('retailer labels', () => {
  it('labels Mattel Creations as Mattel even though its emails are Shopify-built', () => {
    const html = '<html><body><img src="https://cdn.shopify.com/s/files/logo.png"><p>Mattel Creations</p><p>Order #CHP10513288</p><p>Thank you for your purchase!</p><p>Total $85.99</p></body></html>';
    const r = parseRetailEmail({ from: 'orders_at_mattel_com_f4k3s7r622w1y3_h2hf3885@icloud.com', to: ['me@example.com'], subject: 'Your Mattel Creations Order #CHP10513288 is confirmed', html, date: '2026-10-20T16:00:00Z' } as never);
    expect(r.status).toBe('parsed');
    if (r.status === 'parsed') {
      expect(r.result.retailer).toBe('mattel');
      expect(r.result.orderNumber).toBe('CHP10513288');
    }
  });

  it('still labels an unnamed Shopify store as Shopify', () => {
    const html = '<html><body><img src="https://cdn.shopify.com/s/files/logo.png"><a href="https://cards.myshopify.com/orders/1">View order</a><p>Order #1042 confirmed</p><p>Total $20.00</p></body></html>';
    const r = parseRetailEmail({ from: 'store@smallcardshop.com', to: ['me@example.com'], subject: 'Order #1042 confirmed', html, date: '2026-10-20T16:00:00Z' } as never);
    expect(r.status === 'parsed' && r.result.retailer).toBe('shopify');
  });
});

describe('carrier notification emails', () => {
  it('moves a tracked package to out for delivery, then delivered, from UPS emails', async () => {
    const db = memDb();
    const ship = renderSampleEmail({ retailer: 'target', type: 'shipping', orderNumber: '912003760125368', date: new Date('2026-10-20T16:00:00Z'), to: 'buyer@example.com', items: item, address: addr, taxCents: 0, shippingCents: 0, tracking: [{ number: '1ZWY06570307748706', carrier: 'ups' }] });
    await ingest(db, ship.raw);
    expect(db.value('SELECT status FROM packages')).not.toBe('out_for_delivery');
    const ofd = buildMime({ from: 'mcinfo@ups.com', to: 'me@example.com', subject: 'UPS Update: Package Scheduled for Delivery Today', date: new Date('2026-10-22T12:00:00Z'), text: 'Tracking Number: 1ZWY06570307748706\nScheduled Delivery: Today' });
    const r1 = await ingest(db, ofd);
    expect(r1.status).toBe('parsed');
    expect(db.value('SELECT status FROM packages')).toBe('out_for_delivery');
    const del = buildMime({ from: 'mcinfo@ups.com', to: 'me@example.com', subject: 'UPS Update: Your Package Has Been Delivered', date: new Date('2026-10-22T18:00:00Z'), text: 'Tracking Number: 1ZWY06570307748706\nDelivered' });
    await ingest(db, del);
    expect(db.value('SELECT status FROM packages')).toBe('delivered');
    expect(db.value('SELECT fulfillment_status FROM orders')).toBe('delivered');
  });
});

describe('IMAP throttling', () => {
  it('does not advance past a retail message whose body the server failed to return', async () => {
    const db = memDb();
    const id = db.run("INSERT INTO email_accounts (label, kind, address, created_at) VALUES ('T', 'imap', 'me@example.com', '2026-10-01T00:00:00Z')").lastId;
    const acct = db.get<any>('SELECT * FROM email_accounts WHERE id = ?', [id]);
    const msgs = [1, 2, 3].map((i) => {
      const r = renderSampleEmail({ retailer: 'target', type: 'order_confirmation', orderNumber: `91200000000000${i}`, date: new Date('2026-10-20T16:00:00Z'), to: 'b@example.com', items: item, address: addr, taxCents: 0, shippingCents: 0 });
      return { uid: i, raw: r.raw, from: r.from, subject: r.subject };
    });
    let dropUid2 = true;
    const client: MailClient = {
      async connect() {},
      async logout() {},
      async mailboxOpen() {
        return { uidValidity: 9 };
      },
      async search() {
        return msgs.map((m) => m.uid);
      },
      async fetchAll(range, q): Promise<FetchedMessage[]> {
        const want = new Set(range.split(',').map(Number));
        return msgs
          .filter((m) => want.has(m.uid) && !(q.source && dropUid2 && m.uid === 2))
          .map((m) => ({ uid: m.uid, envelope: { from: [{ address: m.from }], subject: m.subject }, source: q.source ? Buffer.from(m.raw) : undefined }));
      },
    };
    await expect(syncAccount(db, acct, client)).rejects.toThrow(/could not be downloaded/);
    expect(db.value('SELECT last_uid FROM sync_checkpoints')).toBe(0);
    expect(db.value('SELECT status FROM email_accounts')).toBe('throttled');
    dropUid2 = false;
    await syncAccount(db, acct, client);
    expect(db.value('SELECT COUNT(*) FROM orders')).toBe(3);
  });
});

describe('address CSV (DISCORD_USERNAME, FULL_NAME, ADDRESS … ZIP as ="…")', () => {
  const csv = [
    'DISCORD_USERNAME,FULL_NAME,ADDRESS,ADDRESS_2,CITY,STATE,ZIP,COUNTRY',
    'pikafan,Sam Rivera,12 Oak St,,Springfield,IL,"=""62704""",US',
    'pikafan,Sam Rivera,40 Elm Ave,Apt 3,Springfield,IL,"=""62701""",US',
    'pikafan,Sam Rivera,40 Elm Ave,Apt 3,Springfield,IL,"=""62701""",US',
    'cardguy,Lee\tPark,"5 Main St, Ste 2",,Boston,MA,"=""02134""",US',
  ].join('\n');

  it('unwraps Excel text guards and keeps leading zeros', () => {
    expect(cleanCell('="02134"')).toBe('02134');
    expect(cleanCell('Lee\tPark')).toBe('Lee Park');
  });

  it('maps the columns, keeps every distinct address and imports them', () => {
    const db = memDb();
    const parsed = parseCsv(csv);
    expect(parsed.kind).toBe('profiles');
    expect(parsed.mapping).toMatchObject({ discordUsername: 'DISCORD_USERNAME', profileName: 'FULL_NAME', address1: 'ADDRESS', address2: 'ADDRESS_2', zip: 'ZIP' });
    const p = previewImport(db, parsed, parsed.mapping);
    expect(p.rows.map((r) => r.action)).toEqual(['create', 'create', 'skip', 'create']);
    applyImport(db, parsed, parsed.mapping, 'addresses.csv', 'test');
    expect(db.value('SELECT COUNT(*) FROM members')).toBe(2);
    expect(db.value("SELECT COUNT(*) FROM address_owners ao JOIN members m ON m.id = ao.member_id WHERE m.username = 'pikafan'")).toBe(2);
    expect(db.all<{ postal: string }>('SELECT postal FROM addresses').map((a) => a.postal)).toContain('02134');
  });
});

describe('second pass: All Mail, Pokémon Center, eBay, Sam\'s Club', () => {
  it('syncs Gmail "All Mail" when the account is on the default Inbox', async () => {
    const { resolveMailboxes } = await import('../../src/core/email/imapSync');
    const list = async () => [{ path: 'INBOX' }, { path: '[Gmail]/All Mail', specialUse: '\\All' }, { path: '[Gmail]/Spam', specialUse: '\\Junk' }];
    const client = { list } as never;
    expect(await resolveMailboxes(client, { mailboxes_json: '["INBOX"]' } as never)).toEqual(['[Gmail]/All Mail']);
    expect(await resolveMailboxes(client, { mailboxes_json: '["INBOX","Orders"]' } as never)).toEqual(['INBOX', 'Orders']);
    expect(await resolveMailboxes({ list: async () => [{ path: 'INBOX' }] } as never, { mailboxes_json: '["INBOX"]' } as never)).toEqual(['INBOX']);
  });

  it('recognises Pokémon Center mail sent from em.pokemon.com', () => {
    const r = parseRetailEmail({ from: 'info@em.pokemon.com', to: ['me@example.com'], subject: 'Thank you for shopping at PokemonCenter.com!', text: 'Pokémon Center\nOrder Number: P001234567\nOrder Total: $54.99', date: '2026-10-20T16:00:00Z' } as never);
    expect(r.status === 'parsed' && r.result.retailer).toBe('pokemoncenter_us');
    expect(r.status === 'parsed' && r.result.orderNumber).toBe('P001234567');
  });

  it('parses eBay order confirmations', () => {
    const r = parseRetailEmail({ from: 'ebay@ebay.com', to: ['me@example.com'], subject: 'Order confirmed: Pokemon TCG: 30th Ce...', text: 'Order number: 12-13579-24680\nTotal $89.99', date: '2026-10-20T16:00:00Z' } as never);
    expect(r.status === 'parsed' && [r.result.retailer, r.result.orderNumber]).toEqual(['ebay', '12-13579-24680']);
  });

  it("reads Sam's Club order numbers and pickup milestones", () => {
    expect(classifyMessageType('Ready for pickup: items from order #800000070883055', [])).toBe('out_for_delivery');
    expect(classifyMessageType('Picked up at 11:47 am: items from order #8000000-70883055', [])).toBe('delivery');
    const r = parseRetailEmail({ from: 'no-reply@transaction.samsclub.com', to: ['me@example.com'], subject: 'Chloe, thanks for your curbside pickup order', text: "Sam's Club\nOrder #8000000-70883055\nTotal $120.00", date: '2026-10-20T16:00:00Z' } as never);
    expect(r.status === 'parsed' && r.result.orderNumber).toBe('8000000-70883055');
  });
});

describe('product images and delivered status', () => {
  it('takes item photos from alt text and skips placeholder bags', () => {
    const html = `<html><body>
      <table><tr><td><img src="https://target.scene7.com/is/image/Target/gray-bag?scl=1&fmt=png-alpha" width="80"></td><td>Pokémon TCG Elite Trainer Box</td><td>Qty: 1</td><td>$49.99</td></tr></table>
      <img alt="quantity 2 item One Piece Card Game Gift Collection Heroines" title="One Piece Card Game Gift Collection Heroines" src="https://i5.walmartimages.com/seo/one-piece.jpeg" width="120">
      <p>Order #1001 confirmed</p></body></html>`;
    const root = parseHtml(html);
    const items = attachAltImages(root, [
      { title: 'One Piece Card Game Gift Collection Heroines', quantity: 2 },
      { title: 'Pokémon TCG Elite Trainer Box', quantity: 1 },
    ] as never);
    expect(items[0].imageUrl).toBe('https://i5.walmartimages.com/seo/one-piece.jpeg');
    expect(items[1].imageUrl).toBeUndefined();
  });

  it('marks an order delivered from a "Delivered" email even with no item list or tracking', () => {
    expect(deriveState({ total_cents: 0 }, [], [], 0, 'delivered').fulfillment).toBe('delivered');
    expect(deriveState({ total_cents: 0 }, [], [], 0, null).fulfillment).toBe('ordered');
  });

  it('reuses an image only for the identical product title', () => {
    const db = memDb();
    const a = resolveProduct(db, 'target', { title: 'Pokémon Trading Card Game: 30th Celebration Booster Bundle', quantity: 1, imageUrl: 'https://img.example/a.jpg' } as never);
    const b = resolveProduct(db, 'pokemoncenter_us', { title: 'Pokémon TCG: 30th Celebration Booster Bundle', quantity: 1 } as never);
    const c = resolveProduct(db, 'pokemoncenter_us', { title: 'Pokémon TCG: 30th Celebration Booster Bundle (6 Packs)', quantity: 1 } as never);
    expect(borrowImagesByTitle(db)).toBe(1);
    expect(db.value('SELECT primary_image_id IS NOT NULL FROM products WHERE id = ?', [b])).toBe(1);
    expect(db.value('SELECT primary_image_id IS NULL FROM products WHERE id = ?', [c])).toBe(1);
    expect(a).not.toBe(b);
  });

  it('applies Fetch Package "delivered" notices to the tracked package', async () => {
    const db = memDb();
    const ship = renderSampleEmail({ retailer: 'target', type: 'shipping', orderNumber: '912003760125368', date: new Date('2026-10-20T16:00:00Z'), to: 'buyer@example.com', items: item, address: addr, taxCents: 0, shippingCents: 0, tracking: [{ number: '1ZWY06570307748706', carrier: 'ups' }] });
    await ingest(db, ship.raw);
    const fetchMail = buildMime({ from: 'notifications@fetchpackage.com', to: 'me@example.com', subject: 'Mission accomplished, your package has been delivered!', date: new Date('2026-10-22T18:00:00Z'), text: 'Carrier: UPS\nTracking number: 1ZWY06570307748706' });
    await ingest(db, fetchMail);
    expect(db.value('SELECT status FROM packages')).toBe('delivered');
    expect(db.value('SELECT fulfillment_status FROM orders')).toBe('delivered');
  });

  it('drops "See all" and "3 items" as product titles', () => {
    const html = '<html><body><table><tr><td><a href="https://walmart.com/x">See all</a></td><td>Qty 3</td><td>$10.00</td></tr></table></body></html>';
    expect(extractItemsFromHtml(parseHtml(html), 'USD').map((i) => i.title)).not.toContain('See all');
  });
});

describe('mark delivered by hand', () => {
  it('bulk-marks old shipments delivered, leaves recent ones, and labels it as manual', async () => {
    const { deliveredCandidates, markDelivered } = await import('../../src/core/orders/manualDelivery');
    const db = memDb();
    const mk = async (n: string, trk: string, date: string) => {
      const s = renderSampleEmail({ retailer: 'target', type: 'shipping', orderNumber: n, date: new Date(date), to: 'b@example.com', items: item, address: addr, taxCents: 0, shippingCents: 0, tracking: [{ number: trk, carrier: 'ups' }] });
      await ingest(db, s.raw);
    };
    const old = new Date(Date.now() - 20 * 86400000).toISOString();
    const recent = new Date(Date.now() - 2 * 86400000).toISOString();
    await mk('912003760000001', '1ZWY06570307748706', old);
    await mk('912003760000002', '1ZWY06570305680630', recent);
    expect(deliveredCandidates(db, { olderThanDays: 10 }).packageIds).toHaveLength(1);
    expect(markDelivered(db, { olderThanDays: 10 }, 'test')).toEqual({ packages: 1, orders: 0 });
    expect(db.all<{ n: string; f: string }>('SELECT order_number n, fulfillment_status f FROM orders ORDER BY n').map((r) => r.f)).toEqual(['delivered', 'shipped']);
    expect(db.value("SELECT source FROM tracking_events WHERE status = 'delivered'")).toBe('manual');
    // Running it again changes nothing.
    expect(markDelivered(db, { olderThanDays: 10 }, 'test')).toEqual({ packages: 0, orders: 0 });
  });
});

describe('Shippo tracking', () => {
  const shippoJson = (status: string) => ({
    carrier: 'ups', tracking_number: '1ZWY06570307748706', eta: '2026-10-22T20:00:00Z',
    tracking_status: status === 'DELIVERED' ? { status: 'DELIVERED', status_details: 'Delivered, front door', status_date: '2026-10-22T18:04:00Z', location: { city: 'Ocala', state: 'FL' } } : { status: 'TRANSIT', substatus: { code: 'out_for_delivery' }, status_details: 'Out For Delivery Today', status_date: '2026-10-22T08:00:00Z', location: { city: 'Ocala', state: 'FL' } },
    tracking_history: [
      { status: 'PRE_TRANSIT', status_details: 'Shipper created a label', status_date: '2026-10-19T10:00:00Z', location: null },
      { status: 'TRANSIT', substatus: { code: 'package_departed' }, status_details: 'Departed from Facility', status_date: '2026-10-20T03:00:00Z', location: { city: 'Atlanta', state: 'GA' } },
    ],
  });

  it('moves a UPS package through out for delivery to delivered using the Shippo API', async () => {
    const { refreshDuePackages } = await import('../../src/core/tracking/providers');
    const db = memDb();
    const ship = renderSampleEmail({ retailer: 'target', type: 'shipping', orderNumber: '912003760125368', date: new Date('2026-10-19T16:00:00Z'), to: 'b@example.com', items: item, address: addr, taxCents: 0, shippingCents: 0, tracking: [{ number: '1ZWY06570307748706', carrier: 'ups' }] });
    await ingest(db, ship.raw);
    const calls: { url: string; auth: string }[] = [];
    let phase = 'TRANSIT';
    const fetcher = (async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, auth: init.headers.Authorization });
      return new Response(JSON.stringify(shippoJson(phase)), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as never;
    const creds = (id: string) => (id === 'shippo' ? { apiKey: 'shippo_live_abc' } : null);
    let r = await refreshDuePackages({ db, credentialsFor: creds, fetcher });
    expect(r).toMatchObject({ checked: 1, updated: 1, errors: [] });
    expect(calls[0]).toEqual({ url: 'https://api.goshippo.com/tracks/ups/1ZWY06570307748706', auth: 'ShippoToken shippo_live_abc' });
    expect(db.value('SELECT status FROM packages')).toBe('out_for_delivery');
    expect(db.value('SELECT fulfillment_status FROM orders')).toBe('out_for_delivery');
    phase = 'DELIVERED';
    db.run('UPDATE packages SET next_check_at = NULL');
    r = await refreshDuePackages({ db, credentialsFor: creds, fetcher });
    expect(db.value('SELECT status FROM packages')).toBe('delivered');
    expect(db.value('SELECT fulfillment_status FROM orders')).toBe('delivered');
    expect(db.value("SELECT location FROM tracking_events WHERE status = 'delivered' AND source = 'carrier_api'")).toBe('Ocala, FL');
  });

  it('reports a rejected or test token instead of failing silently', async () => {
    const { refreshDuePackages } = await import('../../src/core/tracking/providers');
    const db = memDb();
    const ship = renderSampleEmail({ retailer: 'target', type: 'shipping', orderNumber: '912003760125369', date: new Date('2026-10-19T16:00:00Z'), to: 'b@example.com', items: item, address: addr, taxCents: 0, shippingCents: 0, tracking: [{ number: '1ZWY06570305680630', carrier: 'ups' }] });
    await ingest(db, ship.raw);
    const r = await refreshDuePackages({ db, credentialsFor: (id) => (id === 'shippo' ? { apiKey: 'shippo_test_123' } : null), fetcher: (async () => new Response('{}')) as never });
    expect(r.errors[0]).toMatch(/test tokens/);
  });
});

describe('Target "Delivers to" addresses', () => {
  it('reads a one-line "Name, Street, City, ST ZIP" address under "Delivers to:"', async () => {
    const { extractAddress } = await import('../../src/core/parsing/extract');
    expect(extractAddress(['Shipping', 'Delivers to:', 'Sam Rivera, 10930 17TH PL W, Everett, WA 98204', 'Pokémon Trading Card Game: Booster Bundle'], 'shipping')).toMatchObject({ name: 'Sam Rivera', line1: '10930 17TH PL W', city: 'Everett', state: 'WA', postal: '98204', country: 'US' });
  });
});
