// Retailer adapters. Each adapter decides whether a message belongs to its
// retailer and may adjust the generic extraction. Adding a retailer means
// adding a RetailerMeta entry and (optionally) an adapter here; the ingestion
// core does not change.

import type { MessageType, ParsedOrderEmail, RetailerId, UnwrappedEmail } from '../../shared/types';
import { RETAILERS, domainMatches, domainOf, retailer, type RetailerMeta } from '../retailers/registry';
import {
  classifyMessageType,
  extractAddress,
  extractCustomerEmail,
  extractEstimatedDelivery,
  extractItemsFromHtml,
  extractItemsFromLines,
  extractOrderNumber,
  extractPhone,
  extractTotals,
  extractTracking,
  shipmentsFrom,
} from './extract';
import { HTMLElement, htmlToLines, parseHtml, textToLines } from './html';

export interface ParsedDoc {
  root: HTMLElement | null;
  lines: string[];
  haystack: string;
}

export interface CustomTemplateRules {
  orderNumber?: string;
  total?: string;
  currency?: string;
  typeBySubject?: { pattern: string; type: MessageType }[];
}

export interface RetailerAdapter {
  id: RetailerId;
  /** Higher wins. 0 = not this retailer. */
  detect(env: UnwrappedEmail, doc: ParsedDoc): number;
  /** Optional post-processing of the generic result. */
  refine?(result: ParsedOrderEmail, env: UnwrappedEmail, doc: ParsedDoc): ParsedOrderEmail;
  currencyFor?(doc: ParsedDoc): string;
}

export function buildDoc(env: UnwrappedEmail): ParsedDoc {
  const root = env.html ? parseHtml(env.html) : null;
  const lines = root ? htmlToLines(root) : textToLines(env.text ?? '');
  const haystack = `${env.subject}\n${lines.join('\n')}\n${env.html ? env.html.slice(0, 200000) : ''}`;
  return { root, lines, haystack };
}

function baseDetect(meta: RetailerMeta) {
  return (env: UnwrappedEmail, doc: ParsedDoc) => {
    let score = 0;
    if (meta.senderDomains.length && domainMatches(domainOf(env.from), meta.senderDomains)) score += 10;
    for (const re of meta.brandMarkers) if (re.test(doc.haystack)) score += 2;
    return score;
  };
}

function pokemonRegionScore(id: RetailerId, doc: ParsedDoc): number {
  const h = doc.haystack;
  const uk = /en-gb|£|united kingdom|\bUK\b/i.test(h);
  const ca = /en-ca|fr-ca|CA\$|C\$|canada/i.test(h);
  const de = /de-de|€|deutschland|bestellbest|vielen dank/i.test(h);
  switch (id) {
    case 'pokemoncenter_uk': return uk ? 6 : -5;
    case 'pokemoncenter_ca': return ca ? 6 : -5;
    case 'pokemoncenter_de': return de ? 6 : -5;
    case 'pokemoncenter_us': return uk || ca || de ? -2 : 1;
    default: return 0;
  }
}

const adapters: RetailerAdapter[] = RETAILERS.filter((r) => r.id !== 'custom').map((meta) => {
  const detect = baseDetect(meta);
  const a: RetailerAdapter = { id: meta.id, detect };
  if (meta.id.startsWith('pokemoncenter')) {
    a.detect = (env, doc) => {
      const s = detect(env, doc);
      return s > 0 ? s + pokemonRegionScore(meta.id, doc) : 0;
    };
  }
  if (meta.id === 'shopify') {
    // Shopify stores send from their own domains; recognise them by markup instead.
    // Capped below a sender-domain match (10) so a named retailer that happens to be hosted on Shopify
    // (e.g. Mattel Creations) is always labelled as itself; "Shopify" is only the fallback for unnamed stores.
    a.detect = (_env, doc) => {
      let s = 0;
      for (const re of meta.brandMarkers) if (re.test(doc.haystack)) s += 4;
      return Math.min(s, 8);
    };
  }
  if (meta.id === 'amazon') {
    a.refine = (r) => {
      // Amazon item rows rarely carry SKUs; ASINs appear in product links.
      r.items = r.items.map((it) => {
        const asin = it.productUrl?.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/)?.[1];
        return asin && !it.sku ? { ...it, sku: asin } : it;
      });
      return r;
    };
  }
  if (meta.id === 'target') {
    a.refine = (r, _env, doc) => {
      // Target prints DPCI (###-##-####) per item; prefer it as SKU when present.
      r.items = r.items.map((it) => {
        if (it.sku) return it;
        const line = doc.lines.find((l) => l.includes(it.title));
        const dpci = line?.match(/\b(\d{3}-\d{2}-\d{4})\b/)?.[1];
        return dpci ? { ...it, sku: dpci } : it;
      });
      return r;
    };
  }
  return a;
});

export function registerAdapter(adapter: RetailerAdapter) {
  const i = adapters.findIndex((a) => a.id === adapter.id);
  if (i >= 0) adapters[i] = adapter;
  else adapters.push(adapter);
}

export function detectRetailer(env: UnwrappedEmail, doc: ParsedDoc): { id: RetailerId; score: number } | null {
  let best: { id: RetailerId; score: number } | null = null;
  for (const a of adapters) {
    const s = a.detect(env, doc);
    if (s > 0 && (!best || s > best.score)) best = { id: a.id, score: s };
  }
  // A single weak brand mention (e.g. a newsletter mentioning Target) is not enough.
  return best && best.score >= 4 ? best : null;
}

export interface CustomTemplate {
  id: number;
  name: string;
  retailerId: RetailerId;
  senderPattern: string;
  subjectPattern?: string | null;
  rules: CustomTemplateRules;
}

export type ParseOutcome =
  | { status: 'parsed'; result: ParsedOrderEmail }
  | { status: 'ignored'; reason: string; retailer?: RetailerId; type?: MessageType }
  | { status: 'failed'; reason: string; retailer: RetailerId; type: MessageType };

function safeRegex(src: string | undefined, flags = 'i'): RegExp | null {
  if (!src) return null;
  try {
    return new RegExp(src, flags);
  } catch {
    return null;
  }
}

export function parseRetailEmail(env: UnwrappedEmail, templates: CustomTemplate[] = []): ParseOutcome {
  const doc = buildDoc(env);
  const template = templates.find((t) => {
    const s = safeRegex(t.senderPattern);
    const sub = safeRegex(t.subjectPattern ?? undefined);
    return s?.test(env.from) && (!sub || sub.test(env.subject));
  });
  const detected = template ? { id: template.retailerId, score: 100 } : detectRetailer(env, doc);
  if (!detected) return { status: 'ignored', reason: 'not a recognised retailer message' };
  const meta = retailer(detected.id);
  const adapter = adapters.find((a) => a.id === detected.id);

  let type = classifyMessageType(env.subject, doc.lines);
  for (const rule of template?.rules.typeBySubject ?? []) {
    if (safeRegex(rule.pattern)?.test(env.subject)) type = rule.type;
  }
  if (type === 'unknown') return { status: 'ignored', reason: 'no order event in message', retailer: detected.id };

  const orderPatterns = [safeRegex(template?.rules.orderNumber), ...meta.orderNumber].filter(Boolean) as RegExp[];
  const orderNumber = extractOrderNumber(orderPatterns, env.subject, doc.lines);
  if (!orderNumber) return { status: 'failed', reason: 'order number not found', retailer: detected.id, type };

  const currency = template?.rules.currency ?? adapter?.currencyFor?.(doc) ?? meta.currency;
  const totals = extractTotals(doc.lines, currency);
  const customTotal = safeRegex(template?.rules.total);
  if (customTotal) {
    const m = doc.lines.join('\n').match(customTotal);
    if (m?.[1]) totals.totalCents = Math.round(parseFloat(m[1].replace(/[^\d.]/g, '')) * 100);
  }
  let items = doc.root ? extractItemsFromHtml(doc.root, currency) : [];
  if (!items.length) items = extractItemsFromLines(doc.lines, currency);

  const ref = env.date ? new Date(env.date) : new Date();
  const tracking = ['shipping', 'out_for_delivery', 'delivery', 'order_update', 'delay', 'partial_cancellation'].includes(type)
    ? extractTracking(doc.root, doc.lines)
    : [];
  const est = extractEstimatedDelivery(doc.lines, ref);
  const shipping = extractAddress(doc.lines, 'shipping') ?? undefined;
  const billing = extractAddress(doc.lines, 'billing') ?? undefined;

  const warnings: string[] = [];
  if (type === 'order_confirmation' && !items.length) warnings.push('no line items found');
  if (type === 'order_confirmation' && totals.totalCents === undefined) warnings.push('order total not found');
  const itemSum = items.reduce((s, it) => s + (it.lineTotalCents ?? 0), 0);
  if (totals.subtotalCents && itemSum && Math.abs(itemSum - totals.subtotalCents) > 2) warnings.push(`item sum ${itemSum} differs from subtotal ${totals.subtotalCents}`);

  let result: ParsedOrderEmail = {
    retailer: detected.id,
    type,
    orderNumber,
    placedAt: type === 'order_confirmation' ? env.date : undefined,
    currency: totals.currency ?? currency,
    subtotalCents: totals.subtotalCents,
    taxCents: totals.taxCents,
    shippingCents: totals.shippingCents,
    discountCents: totals.discountCents,
    totalCents: totals.totalCents,
    refundCents: type === 'refund' || type === 'return' || type === 'cancellation' || type === 'partial_cancellation' ? totals.refundCents : undefined,
    items,
    shipments: shipmentsFrom(tracking, est),
    shippingAddress: shipping,
    billingAddress: billing,
    recipientName: shipping?.name,
    customerEmail: extractCustomerEmail(doc.lines, meta.senderDomains) ?? env.to[0],
    phone: extractPhone(doc.lines),
    warnings,
  };
  if (adapter?.refine) result = adapter.refine(result, env, doc);
  return { status: 'parsed', result };
}
