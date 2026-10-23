import { describe, expect, it } from 'vitest';
import { parseMime } from '../../src/core/email/mime';
import { unwrapForwarded } from '../../src/core/email/forwarded';
import { parseRetailEmail } from '../../src/core/parsing/adapters';
import { renderSampleEmail, type SampleEmailSpec } from '../../src/core/sample/retailerEmails';
import { gmailForward, outlookForward } from '../../src/core/sample/mime';
import type { RetailerId } from '../../src/shared/types';

const base = (retailer: RetailerId, over: Partial<SampleEmailSpec> = {}): SampleEmailSpec => ({
  retailer,
  type: 'order_confirmation',
  orderNumber: retailer === 'walmart' ? '2000123-45678901' : retailer === 'amazon' ? '112-1234567-7654321' : retailer.startsWith('pokemon') ? 'P001234567' : retailer === 'bestbuy' ? 'BBY01-806123456789' : retailer === 'costco' || retailer === 'samsclub' ? '1234567890' : '912001234567890',
  date: new Date('2026-10-20T16:32:18Z'),
  to: 'buyer14@example.com',
  items: [
    { title: 'Pokémon TCG: Scarlet & Violet Elite Trainer Box', sku: 'ETB-001', qty: 2, unitCents: 4999, imageUrl: 'https://img.test/etb.png' },
    { title: 'Pokémon TCG: Booster Bundle (6 Packs)', qty: 1, unitCents: 2694, imageUrl: 'https://img.test/bb.png' },
  ],
  address: { name: 'Jordan Rivers', line1: '1427 Maple Ridge Drive', line2: 'Apt 4B', city: 'Springfield', state: 'IL', postal: '62704' },
  taxCents: 1102,
  shippingCents: 0,
  ...over,
});

async function parse(raw: string) {
  const m = await parseMime(raw);
  return parseRetailEmail(unwrapForwarded(m.envelope));
}

describe('retailer email parsing', () => {
  const retailers: RetailerId[] = ['target', 'walmart', 'pokemoncenter_us', 'amazon', 'bestbuy', 'costco', 'samsclub'];
  for (const r of retailers) {
    it(`parses a ${r} order confirmation`, async () => {
      const spec = base(r);
      const out = await parse(renderSampleEmail(spec).raw);
      expect(out.status).toBe('parsed');
      if (out.status !== 'parsed') return;
      const p = out.result;
      expect(p.retailer).toBe(r);
      expect(p.type).toBe('order_confirmation');
      expect(p.orderNumber).toBe(spec.orderNumber.toUpperCase());
      expect(p.items).toHaveLength(2);
      const etb = p.items.find((i) => /Elite Trainer/.test(i.title))!;
      expect(etb.quantity).toBe(2);
      expect(etb.lineTotalCents).toBe(9998);
      expect(etb.imageUrl).toBe('https://img.test/etb.png');
      expect(p.subtotalCents).toBe(9998 + 2694);
      expect(p.taxCents).toBe(1102);
      expect(p.shippingCents).toBe(0);
      expect(p.totalCents).toBe(9998 + 2694 + 1102);
      expect(p.shippingAddress?.postal).toBe('62704');
      expect(p.shippingAddress?.line1).toMatch(/1427 Maple Ridge/);
      expect(p.recipientName).toBe('Jordan Rivers');
      expect(p.customerEmail).toBe('buyer14@example.com');
    });
  }

  it('detects Pokémon Center region and currency (UK, DE)', async () => {
    const uk = await parse(renderSampleEmail(base('pokemoncenter_uk', { address: { name: 'Sam Hill', line1: '10 Downing Street', city: 'London', state: '', postal: 'SW1A 2AA', country: 'United Kingdom' } })).raw);
    expect(uk.status).toBe('parsed');
    if (uk.status === 'parsed') {
      expect(uk.result.retailer).toBe('pokemoncenter_uk');
      expect(uk.result.currency).toBe('GBP');
      expect(uk.result.shippingAddress?.postal.replace(' ', '')).toBe('SW1A2AA');
    }
    const de = await parse(renderSampleEmail(base('pokemoncenter_de', { address: { name: 'Max Muster', line1: 'Hauptstraße 5', city: 'Berlin', state: '', postal: '10115', country: 'Germany' } })).raw);
    expect(de.status).toBe('parsed');
    if (de.status === 'parsed') {
      expect(de.result.retailer).toBe('pokemoncenter_de');
      expect(de.result.currency).toBe('EUR');
      expect(de.result.totalCents).toBe(9998 + 2694 + 1102);
      expect(de.result.items[0].quantity).toBe(2);
    }
  });

  it('parses shipping emails with two tracking numbers', async () => {
    const out = await parse(renderSampleEmail(base('target', { type: 'shipping', tracking: [{ number: '1Z999AA10123456784', carrier: 'ups' }, { number: '9400111899223197428490', carrier: 'usps' }] })).raw);
    expect(out.status).toBe('parsed');
    if (out.status !== 'parsed') return;
    expect(out.result.type).toBe('shipping');
    expect(out.result.shipments.map((s) => s.trackingNumber).sort()).toEqual(['1Z999AA10123456784', '9400111899223197428490']);
    expect(out.result.shipments.find((s) => s.trackingNumber?.startsWith('1Z'))?.carrier).toBe('ups');
  });

  it('classifies cancellation, partial cancellation, review hold and refund', async () => {
    const types: [SampleEmailSpec['type'], string][] = [
      ['cancellation', 'cancellation'],
      ['partial_cancellation', 'partial_cancellation'],
      ['review_hold', 'review_hold'],
      ['refund', 'refund'],
      ['delivery', 'delivery'],
      ['out_for_delivery', 'out_for_delivery'],
    ];
    for (const [t, expected] of types) {
      const out = await parse(renderSampleEmail(base('walmart', { type: t, refundCents: t === 'refund' ? 2694 : undefined, items: base('walmart').items.map((i, n) => ({ ...i, canceled: n === 1 })) })).raw);
      expect(out.status, t).toBe('parsed');
      if (out.status === 'parsed') expect(out.result.type).toBe(expected);
    }
  });

  it('unwraps Gmail and Outlook inline forwards to the original retailer message', async () => {
    const r = renderSampleEmail(base('target'));
    const orig = { fromName: r.fromName, from: r.from, to: 'buyer14@example.com', subject: r.subject, date: new Date('2026-10-20T16:32:18Z'), html: r.html };
    for (const fwd of [gmailForward(orig, 'forwarder@example.org', 'hub@example.org', new Date('2026-10-20T17:00:00Z')), outlookForward(orig, 'forwarder@example.org', 'hub@example.org', new Date('2026-10-20T17:00:00Z'))]) {
      const m = await parseMime(fwd);
      const inner = unwrapForwarded(m.envelope);
      expect(inner.forwarded).toBe(true);
      expect(inner.from).toBe('orders@oe.target.com');
      expect(inner.subject).toBe(r.subject);
      const out = parseRetailEmail(inner);
      expect(out.status).toBe('parsed');
      if (out.status === 'parsed') {
        expect(out.result.orderNumber).toBe('912001234567890');
        expect(out.result.items).toHaveLength(2);
        expect(out.result.customerEmail).toBe('buyer14@example.com');
      }
    }
  });

  it('ignores non-retail email', async () => {
    const raw = 'From: friend@example.com\r\nTo: me@example.com\r\nSubject: lunch?\r\nDate: Mon, 20 Oct 2026 12:00:00 +0000\r\n\r\nWant to grab lunch? Order number 12345 lol';
    const out = await parse(raw);
    expect(out.status).toBe('ignored');
  });
});
