import { describe, expect, it } from 'vitest';
import { applyImport, cleanCell, parseCsv, previewImport } from '../../src/core/csv/importer';
import { syncAccount, type FetchedMessage, type MailClient } from '../../src/core/email/imapSync';
import { classifyMessageType, extractOrderNumber } from '../../src/core/parsing/extract';
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
