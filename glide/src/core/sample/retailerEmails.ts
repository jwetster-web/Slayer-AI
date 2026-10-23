// Synthetic retailer emails for sample mode and tests. Each retailer family
// uses a different HTML structure (item rows, div cards, column tables, plain
// blocks) so the generic parser is exercised against several real-world
// layouts. These are NOT copies of any retailer's actual templates.

import type { Carrier, MessageType, RetailerId } from '../../shared/types';
import { formatCents } from '../../shared/format';
import { buildMime } from './mime';

export interface SampleItem {
  title: string;
  sku?: string;
  qty: number;
  unitCents: number;
  imageUrl?: string;
  canceled?: boolean;
}

export interface SampleAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postal: string;
  country?: string;
}

export interface SampleEmailSpec {
  retailer: RetailerId;
  type: MessageType;
  orderNumber: string;
  date: Date;
  to: string;
  items: SampleItem[];
  address: SampleAddress;
  taxCents: number;
  shippingCents: number;
  discountCents?: number;
  tracking?: { number: string; carrier: Carrier }[];
  refundCents?: number;
  estDelivery?: Date;
}

const SENDERS: Partial<Record<RetailerId, { name: string; from: string }>> = {
  target: { name: 'Target', from: 'orders@oe.target.com' },
  walmart: { name: 'Walmart.com', from: 'help@walmart.com' },
  pokemoncenter_us: { name: 'Pokémon Center', from: 'orders@em.pokemoncenter.com' },
  pokemoncenter_uk: { name: 'Pokémon Center UK', from: 'orders@em.pokemoncenter.com' },
  pokemoncenter_ca: { name: 'Pokémon Center Canada', from: 'orders@em.pokemoncenter.com' },
  pokemoncenter_de: { name: 'Pokémon Center', from: 'orders@em.pokemoncenter.com' },
  amazon: { name: 'Amazon.com', from: 'auto-confirm@amazon.com' },
  bestbuy: { name: 'Best Buy', from: 'BestBuyInfo@emailinfo.bestbuy.com' },
  costco: { name: 'Costco.com', from: 'noreply@online.costco.com' },
  samsclub: { name: "Sam's Club", from: 'orders@email.samsclub.com' },
  gamestop: { name: 'GameStop', from: 'orders@em.gamestop.com' },
  lego: { name: 'LEGO Shop', from: 'noreply@e.lego.com' },
};

const CUR: Partial<Record<RetailerId, string>> = { pokemoncenter_uk: 'GBP', pokemoncenter_ca: 'CAD', pokemoncenter_de: 'EUR' };

export function currencyFor(r: RetailerId): string {
  return CUR[r] ?? 'USD';
}

function money(c: number, r: RetailerId): string {
  const cur = currencyFor(r);
  if (cur === 'CAD') return `CA$${(c / 100).toFixed(2)}`;
  return formatCents(c, cur);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function subjectFor(s: SampleEmailSpec): string {
  const r = s.retailer;
  const n = s.orderNumber;
  const de = r === 'pokemoncenter_de';
  const first = s.items[0]?.title ?? 'your items';
  switch (s.type) {
    case 'order_confirmation':
      if (de) return `Bestellbestätigung – Bestellung ${n}`;
      if (r === 'amazon') return `Your Amazon.com order #${n}`;
      if (r === 'target') return `Thanks for your order! #${n}`;
      if (r === 'walmart') return `Thanks for your order, ${s.address.name.split(' ')[0]}`;
      return `Your ${SENDERS[r]?.name ?? 'store'} order confirmation #${n}`;
    case 'shipping':
      if (r === 'amazon') return `Shipped: "${first.slice(0, 40)}..."`;
      if (de) return `Deine Bestellung ${n} wurde versandt`;
      return `Your order #${n} has shipped`;
    case 'out_for_delivery':
      return `Your package is out for delivery – order #${n}`;
    case 'delivery':
      if (r === 'amazon') return `Delivered: "${first.slice(0, 40)}..."`;
      return `Your order #${n} was delivered`;
    case 'cancellation':
      return `Your order #${n} has been canceled`;
    case 'partial_cancellation':
      return `An item in your order #${n} has been canceled`;
    case 'review_hold':
      return `Your order #${n} is under review`;
    case 'refund':
      return `Your refund for order #${n} has been issued`;
    default:
      return `Update on order #${n}`;
  }
}

function headline(s: SampleEmailSpec): string {
  switch (s.type) {
    case 'order_confirmation': return s.retailer === 'pokemoncenter_de' ? 'Vielen Dank für Ihre Bestellung!' : 'Thanks for your order!';
    case 'shipping': return 'Good news — your order has shipped.';
    case 'out_for_delivery': return 'Your package is out for delivery today.';
    case 'delivery': return 'Your package was delivered.';
    case 'cancellation': return "We're sorry, your order has been canceled.";
    case 'partial_cancellation': return 'One or more items in your order have been canceled.';
    case 'review_hold': return 'Your order is currently under review. We will email you once the review is complete.';
    case 'refund': return 'Your refund has been processed.';
    default: return 'Order update';
  }
}

function addressBlock(a: SampleAddress, label = 'Shipping to'): string {
  const country = a.country ? `<br>${esc(a.country)}` : '';
  const cityLine = a.country === 'GB' || a.country === 'United Kingdom' ? `${esc(a.city)}<br>${esc(a.postal)}` : a.country === 'DE' || a.country === 'Germany' ? `${esc(a.postal)} ${esc(a.city)}` : `${esc(a.city)}, ${esc(a.state)} ${esc(a.postal)}`;
  return `<p style="margin:16px 0"><strong>${label}</strong><br>${esc(a.name)}<br>${esc(a.line1)}${a.line2 ? `<br>${esc(a.line2)}` : ''}<br>${cityLine}${country}</p>`;
}

function totals(s: SampleEmailSpec): string {
  const sub = s.items.reduce((t, i) => t + i.qty * i.unitCents, 0);
  const total = sub + s.taxCents + s.shippingCents - (s.discountCents ?? 0);
  const de = s.retailer === 'pokemoncenter_de';
  const row = (l: string, v: string) => `<tr><td style="padding:2px 0">${l}</td><td align="right">${v}</td></tr>`;
  return `<table width="100%" style="margin-top:16px">${row(de ? 'Zwischensumme' : 'Subtotal', money(sub, s.retailer))}${s.discountCents ? row('Discount', '-' + money(s.discountCents, s.retailer)) : ''}${row(de ? 'Versandkosten' : 'Shipping', s.shippingCents ? money(s.shippingCents, s.retailer) : 'FREE')}${row(de ? 'MwSt.' : s.retailer === 'pokemoncenter_uk' ? 'VAT' : 'Estimated tax', money(s.taxCents, s.retailer))}<tr><td><strong>${de ? 'Gesamtsumme' : 'Order total'}</strong></td><td align="right"><strong>${money(total, s.retailer)}</strong></td></tr></table>`;
}

function trackingBlock(s: SampleEmailSpec): string {
  if (!s.tracking?.length) return '';
  const urls: Record<string, (n: string) => string> = {
    ups: (n) => `https://www.ups.com/track?tracknum=${n}`,
    fedex: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`,
    usps: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`,
    dhl: (n) => `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${n}`,
    royalmail: (n) => `https://www.royalmail.com/track-your-item#/tracking-results/${n}`,
  };
  const est = s.estDelivery ? `<p>Estimated delivery: ${s.estDelivery.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</p>` : '';
  return `${est}${s.tracking
    .map((t) => `<p>Package via ${t.carrier.toUpperCase()}<br>Tracking number: <a href="${(urls[t.carrier] ?? urls.ups)(t.number)}">${t.number}</a></p>`)
    .join('')}`;
}

// Layout A: image cell + details cell + price cell per row.
function itemsRowStyle(s: SampleEmailSpec, showPrice: boolean): string {
  return `<table width="100%" cellpadding="6">${s.items
    .map(
      (i) => `<tr>
  <td width="90"><img src="${i.imageUrl ?? ''}" width="80" height="80" alt="${esc(i.title)}"></td>
  <td><a href="https://www.example-retailer.test/p/${i.sku ?? 'item'}">${esc(i.title)}</a><br>${i.sku ? `Item #: ${i.sku}<br>` : ''}Qty: ${i.qty}${i.canceled ? '<br><b>Canceled</b>' : ''}</td>
  <td align="right">${showPrice ? `${money(i.unitCents, s.retailer)} / ea<br>${money(i.unitCents * i.qty, s.retailer)}` : ''}</td>
</tr>`,
    )
    .join('')}</table>`;
}

// Layout B: div cards.
function itemsCardStyle(s: SampleEmailSpec, showPrice: boolean): string {
  return s.items
    .map(
      (i) => `<div class="item-card" style="display:flex;padding:12px;border-bottom:1px solid #eee">
  <div><img src="${i.imageUrl ?? ''}" width="96" height="96"></div>
  <div style="padding-left:12px"><div class="product-name">${esc(i.title)}</div>
  <div>Quantity: ${i.qty}</div>${showPrice ? `<div>${money(i.unitCents * i.qty, s.retailer)}</div>` : ''}${i.canceled ? '<div>Status: Canceled</div>' : ''}</div>
</div>`,
    )
    .join('');
}

// Layout C: column header table (Item | Qty | Price).
function itemsColumnStyle(s: SampleEmailSpec, showPrice: boolean): string {
  const de = s.retailer === 'pokemoncenter_de';
  const head = `<tr><th></th><th align="left">${de ? 'Artikel' : 'Item'}</th><th>${de ? 'Menge' : 'Qty'}</th>${showPrice ? `<th align="right">${de ? 'Preis' : 'Price'}</th>` : ''}</tr>`;
  return `<table width="100%" cellpadding="6">${head}${s.items
    .map((i) => `<tr><td><img src="${i.imageUrl ?? ''}" width="72" height="72"></td><td>${esc(i.title)}${i.sku ? `<br><small>SKU: ${i.sku}</small>` : ''}${i.canceled ? '<br>Canceled' : ''}</td><td align="center">${i.qty}</td>${showPrice ? `<td align="right">${money(i.unitCents * i.qty, s.retailer)}</td>` : ''}</tr>`)
    .join('')}</table>`;
}

// Layout D: plain blocks (Amazon-like).
function itemsBlockStyle(s: SampleEmailSpec, showPrice: boolean): string {
  return s.items
    .map(
      (i) => `<table><tr><td><img src="${i.imageUrl ?? ''}" width="100" height="100"></td><td><p><a href="https://www.amazon.com/gp/product/${i.sku ?? 'B000000000'}">${esc(i.title)}</a><br>Sold by: Amazon.com Services LLC<br>Quantity: ${i.qty}${showPrice ? `<br><b>${money(i.unitCents * i.qty, s.retailer)}</b>` : ''}${i.canceled ? '<br>Canceled' : ''}</p></td></tr></table>`,
    )
    .join('');
}

const LAYOUT: Partial<Record<RetailerId, (s: SampleEmailSpec, p: boolean) => string>> = {
  target: itemsRowStyle,
  walmart: itemsCardStyle,
  pokemoncenter_us: itemsColumnStyle,
  pokemoncenter_uk: itemsColumnStyle,
  pokemoncenter_ca: itemsColumnStyle,
  pokemoncenter_de: itemsColumnStyle,
  amazon: itemsBlockStyle,
  bestbuy: itemsRowStyle,
  costco: itemsCardStyle,
  samsclub: itemsCardStyle,
  gamestop: itemsRowStyle,
  lego: itemsColumnStyle,
};

const FOOTERS: Partial<Record<RetailerId, string>> = {
  target: '© 2026 Target Brands, Inc. target.com',
  walmart: '© 2026 Walmart. walmart.com',
  pokemoncenter_us: 'Pokémon Center · pokemoncenter.com',
  pokemoncenter_uk: 'Pokémon Center UK · pokemoncenter.com/en-gb',
  pokemoncenter_ca: 'Pokémon Center Canada · pokemoncenter.com/en-ca',
  pokemoncenter_de: 'Pokémon Center · pokemoncenter.com/de-de',
  amazon: 'amazon.com',
  bestbuy: 'Best Buy · bestbuy.com',
  costco: 'Costco Wholesale · costco.com',
  samsclub: "Sam's Club · samsclub.com",
};

export function renderSampleEmailHtml(s: SampleEmailSpec): string {
  const layout = LAYOUT[s.retailer] ?? itemsRowStyle;
  const showItems = s.type !== 'review_hold' && s.type !== 'refund';
  const showPrice = s.type === 'order_confirmation' || s.type === 'cancellation' || s.type === 'partial_cancellation';
  const itemsForEmail = s.type === 'partial_cancellation' ? s.items.filter((i) => i.canceled) : s.items;
  const spec = { ...s, items: itemsForEmail };
  const de = s.retailer === 'pokemoncenter_de';
  const orderLabel = de ? 'Bestellnummer' : s.retailer === 'amazon' ? 'Order #' : 'Order number:';
  const refund = s.refundCents ? `<p>Refund total: ${money(s.refundCents, s.retailer)}</p>` : '';
  return `<!doctype html><html><head><style>body{font-family:Arial}</style></head><body>
<table width="600" align="center"><tr><td>
<img src="https://img.example-retailer.test/logo.png" width="120" height="40" alt="logo">
<h1 style="font-size:22px">${headline(s)}</h1>
<p>${orderLabel} ${s.orderNumber}</p>
<p>Order placed ${s.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</p>
${s.type === 'shipping' || s.type === 'out_for_delivery' || s.type === 'delivery' ? trackingBlock(s) : ''}
${showItems ? layout(spec, showPrice) : ''}
${s.type === 'order_confirmation' ? totals(s) : ''}
${refund}
${s.type === 'order_confirmation' || s.type === 'shipping' ? addressBlock(s.address) : ''}
<p style="color:#888;font-size:11px">${FOOTERS[s.retailer] ?? ''} · Questions? Visit our help center.</p>
</td></tr></table></body></html>`;
}

export function sampleSender(r: RetailerId) {
  return SENDERS[r] ?? { name: 'Store', from: 'orders@shop.example-retailer.test' };
}

export function renderSampleEmail(s: SampleEmailSpec): { raw: string; subject: string; html: string; from: string; fromName: string } {
  const sender = sampleSender(s.retailer);
  const html = renderSampleEmailHtml(s);
  const subject = subjectFor(s);
  const raw = buildMime({ from: `${sender.name} <${sender.from}>`, to: s.to, subject, date: s.date, html });
  return { raw, subject, html, from: sender.from, fromName: sender.name };
}
