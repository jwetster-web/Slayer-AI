// Generic, deterministic extractors shared by every retailer adapter.
// Adapters supply retailer-specific patterns; these functions do the
// structural work on HTML (preferred) or plain text.

import type { Carrier, MessageType, ParsedAddress, ParsedItem, ParsedShipment } from '../../shared/types';
import { classifyTracking, carrierHint, trackingFromUrl, trackingUrl, type DetectedTracking } from '../tracking/carriers';
import { HTMLElement, NodeType, htmlToLines, links } from './html';
import { findMoney, type MoneyMatch } from './money';

// ---------------------------------------------------------------------------
// Message type

const TYPE_RULES: [MessageType, RegExp][] = [
  ['review_hold', /(order|purchase)\s+(is\s+)?(currently\s+)?(under|in|on|being)\s+(review|hold)|review hold|we('re| are) (currently )?reviewing your order|additional verification|verify your order|order is on hold|held for review/i],
  ['partial_cancellation', /(some|one or more|part of|an item|items?|\d+ items?)\s+(in|of|from)\s+your\s+order(\s*#?\s*[\w-]+)?\s+(has|have|was|were)\s+(been\s+)?cancel|partially cancel|item(s)? (has|have) been cancel+ed|items? cancel+ed from your order/i],
  ['cancellation', /cancel+ed|cancel+ation|we had to cancel|storniert|annul[ée]e/i],
  ['refund', /\brefund(ed)?\b|r[üu]ckerstattung|credit has been issued|money back|remboursement/i],
  ['return', /return (has been )?(received|processed|started|initiated|label)|we('ve| have) received your return|r[üu]cksendung/i],
  ['out_for_delivery', /out for delivery|arriv(ing|es) today|in zustellung|en cours de livraison/i],
  ['delivery', /\bdelivered\b|has arrived|have arrived|was delivered|zugestellt|livr[ée]e?\b/i],
  ['shipping', /\bshipped\b|on (its|the) way|has been dispatched|\bdispatched\b|versandt|verschickt|is coming|tracking (number|info)|en route|has shipped|ready for delivery|about to ship|arriv(es|ing) (tomorrow|soon)|exp[ée]di[ée]/i],
  ['backorder', /back[- ]?order(ed)?|preorder update/i],
  ['delay', /\bdelay(ed)?\b|running late|taking longer/i],
  // "Thanks for your Target order", "thanks for your curbside pickup order", "Order AQTR_966 confirmed", "We got your order"…
  ['order_confirmation', /thank(s| you)\s+for\s+(your\s+|the\s+)?([\w'’&-]+\s+){0,3}(order|purchase|shopping)|order confirm|confirm(ation|ed)? (of )?(your )?order|order (has been |was |is )?(received|placed|confirmed)|we('ve| have)? (got|received) your order|here'?s your order|bestellbest[äa]tigung|vielen dank f[üu]r ihre bestellung|^ordered:|order #?\s*[A-Z0-9_-]+\s+(is\s+|has been\s+)?(confirmed|placed)|your .{0,40}order (is|has been) (confirmed|placed)|merci pour votre commande/i],
];

export function classifyMessageType(subject: string, headline: string[]): MessageType {
  for (const [type, re] of TYPE_RULES) if (re.test(subject)) return type;
  const head = headline.slice(0, 12).join('\n');
  for (const [type, re] of TYPE_RULES) if (re.test(head)) return type;
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Order number

export function extractOrderNumber(patterns: RegExp[], subject: string, lines: string[]): string | null {
  const sources = [subject, ...lines];
  for (const re of patterns) {
    for (const s of sources) {
      const m = s.match(re);
      // Every real order number has a digit; this stops "Order # has shipped" yielding "HAS".
      if (m?.[1] && /\d/.test(m[1])) return m[1].toUpperCase();
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Totals

interface Totals {
  subtotalCents?: number;
  taxCents?: number;
  shippingCents?: number;
  discountCents?: number;
  totalCents?: number;
  refundCents?: number;
  currency?: string;
}

const LABELS = {
  subtotal: /\b(sub-?total|merchandise( subtotal| total)?|items? subtotal|item\(s\) subtotal|zwischensumme)\b/i,
  tax: /\b(estimated\s+|sales\s+)?tax(es)?\b|\bvat\b|\bmwst\b|\bgst\b|\bhst\b|\bpst\b|mehrwertsteuer|ust\./i,
  shipping: /\b(shipping|delivery|handling|postage|versand(kosten)?)(\s*(&|and)\s*handling)?(\s*(fee|charges?|cost))?\b/i,
  discount: /\b(discount|promo(tion)?s?|coupon|savings|you saved|rabatt|reduction|circle (offer|reward))\b/i,
  total: /\b(order\s+total|grand\s+total|total\s+charged|total\s+paid|amount\s+charged|payment\s+total|gesamt(summe|betrag)?|total)\b/i,
  refund: /\b(refund(ed)?( total| amount)?|total refund|r[üu]ckerstattung(sbetrag)?|credit(ed)?)\b/i,
};

function amountForLabel(lines: string[], i: number, label: RegExp, currency: string): MoneyMatch | null {
  const line = lines[i];
  const m = line.match(label);
  if (!m) return null;
  const after = line.slice((m.index ?? 0) + m[0].length);
  if (/\bfree\b|kostenlos|gratuit/i.test(after) && !/\d/.test(after.replace(/free/i, ''))) return { cents: 0, currency, raw: 'FREE', index: 0 };
  const same = findMoney(after, currency);
  if (same.length) return same[same.length - 1];
  const next = lines[i + 1];
  if (next && !Object.values(LABELS).some((re) => re.test(next))) {
    if (/^\s*(free|kostenlos)\s*$/i.test(next)) return { cents: 0, currency, raw: 'FREE', index: 0 };
    const nm = findMoney(next, currency);
    if (nm.length === 1 && next.length < 30) return nm[0];
  }
  return null;
}

export function extractTotals(lines: string[], currency: string): Totals {
  const out: Totals = {};
  let totalPriority = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 160) continue;
    if (LABELS.subtotal.test(line)) {
      const a = amountForLabel(lines, i, LABELS.subtotal, currency);
      if (a && out.subtotalCents === undefined) {
        out.subtotalCents = Math.abs(a.cents);
        out.currency ??= a.currency;
      }
      continue;
    }
    if (LABELS.refund.test(line) && !/refund policy|eligible for|how to|learn more/i.test(line)) {
      const a = amountForLabel(lines, i, LABELS.refund, currency);
      if (a) out.refundCents = Math.abs(a.cents);
    }
    if (LABELS.tax.test(line) && !/tax(es)? included|incl\.? (vat|tax)|tax id|before tax/i.test(line)) {
      const a = amountForLabel(lines, i, LABELS.tax, currency);
      if (a) out.taxCents = (out.taxCents ?? 0) + Math.abs(a.cents);
      continue;
    }
    if (LABELS.shipping.test(line) && !/address|ship(ping)? to|method|speed|carrier|tracking|deliver(ing|y) to|estimate|arriv/i.test(line)) {
      const a = amountForLabel(lines, i, LABELS.shipping, currency);
      if (a && out.shippingCents === undefined) out.shippingCents = Math.abs(a.cents);
      continue;
    }
    if (LABELS.discount.test(line) && !/gift card/i.test(line)) {
      const a = amountForLabel(lines, i, LABELS.discount, currency);
      if (a) out.discountCents = (out.discountCents ?? 0) + Math.abs(a.cents);
      continue;
    }
    if (LABELS.total.test(line)) {
      const label = line.match(LABELS.total)![0].toLowerCase();
      const priority = /order|grand|charged|paid|payment|gesamt|amount/.test(label) ? 2 : 1;
      const a = amountForLabel(lines, i, LABELS.total, currency);
      if (a && priority >= totalPriority) {
        out.totalCents = Math.abs(a.cents);
        out.currency ??= a.currency;
        totalPriority = priority;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Items

const QTY_RE = /\b(?:qty|quantity|menge|anzahl|quantit[ée]|cantidad)\s*[:.]?\s*(\d{1,3})\b/i;
const QTY_X_RE = /(?:^|\s)(\d{1,3})\s*[x×]\s+\S|(?:^|\s)[x×]\s*(\d{1,3})\b/i;
const SKU_RE = /\b(?:sku|item\s*(?:#|no\.?|number)|dpci|tcin|model|artikel(?:nummer)?|art\.?-?nr\.?|product\s*(?:#|id|code)|style)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,24})\b/i;
const UPC_RE = /\b(?:upc|ean|gtin)\s*[:#]?\s*(\d{12,14})\b/i;
const NOT_TITLE = /^(qty|quantity|price|each|item|items|total|subtotal|sku|upc|sold by|ships? from|shipped by|seller|status|color|size|style|view|track|details|buy again|write a review|order|return|returns|shipping|tax|delivery|arrives?|estimated|free|menge|preis|anzahl|in stock|preorder)\b/i;
const IMG_SKIP = /logo|spacer|pixel|tracking|beacon|icon|badge|star|rating|social|facebook|twitter|instagram|youtube|tiktok|apple-?store|google-?play|banner|header|footer|divider|arrow|1x1|blank\.gif/i;
const STOP_BLOCK = /\b(sub-?total|order\s+total|grand\s+total|ship(ping)?\s+to|shipping\s+address|billing\s+address|payment\s+method|order\s+summary|order\s*(number|no\.?|#)|tracking\s*(number|#)|bestellnummer)\b/i;
/** Headline sentences ("We're sorry, your order has been canceled.") are not product names. */
const SENTENCE = /\b(your|we|we're|we've|has been|have been|thank|sorry|below|click|please)\b.*[.!]$/i;
const isTitle = (t: string) => (t.match(/[A-Za-zÀ-ÿ]/g) ?? []).length >= 4 && !NOT_TITLE.test(t) && !SENTENCE.test(t) && !/^(?=.*\d)[\dA-Z\s-]{8,}$/.test(t);

function qtyFrom(text: string): number | null {
  const m = text.match(QTY_RE);
  if (m) return Number(m[1]);
  const x = text.match(QTY_X_RE);
  if (x) return Number(x[1] ?? x[2]);
  return null;
}

function countQtyMarkers(text: string): number {
  return (text.match(new RegExp(QTY_RE.source, 'gi')) ?? []).length;
}

function itemStatus(text: string): ParsedItem['status'] | undefined {
  if (/\bcancel+ed\b|storniert/i.test(text)) return 'canceled';
  if (/\brefunded\b/i.test(text)) return 'refunded';
  if (/\breturned\b/i.test(text)) return 'returned';
  if (/back[- ]?ordered/i.test(text)) return 'backordered';
  if (/\bdelivered\b/i.test(text)) return 'delivered';
  if (/\bshipped\b/i.test(text)) return 'shipped';
  return undefined;
}

function pricesFrom(text: string, qty: number, currency: string): { unit?: number; line?: number } {
  // Drop struck-through "was/reg" prices.
  const cleaned = text.replace(/\b(was|reg\.?|regular|original(ly)?|list price|compare at|statt|uvp)\s*:?\s*(?:(?:US|CA|C)?\$|£|€)\s?\d[\d,.]*/gi, ' ');
  const money = findMoney(cleaned, currency).filter((m) => m.cents > 0);
  if (!money.length) return {};
  const eachMatch = cleaned.match(/((?:(?:US|CA|C)?\$|£|€)\s?\d[\d,.]*)\s*(?:\/\s*ea(ch)?|each|ea\.|per (item|unit)|\/\s*st[üu]ck)|(?:@|each|unit price|price)\s*:?\s*((?:(?:US|CA|C)?\$|£|€)\s?\d[\d,.]*)/i);
  if (eachMatch) {
    const unitRaw = eachMatch[1] ?? eachMatch[4];
    const unit = findMoney(unitRaw, currency)[0]?.cents;
    const others = money.map((m) => m.cents).filter((c) => c !== unit);
    const line = others.find((c) => unit && Math.abs(c - unit * qty) <= 2) ?? (unit ? unit * qty : undefined);
    return { unit, line };
  }
  if (money.length >= 2 && qty > 1) {
    const sorted = money.map((m) => m.cents).sort((a, b) => a - b);
    const small = sorted[0];
    const big = sorted[sorted.length - 1];
    if (Math.abs(small * qty - big) <= 2) return { unit: small, line: big };
  }
  const last = money[money.length - 1].cents;
  return { unit: Math.round(last / Math.max(1, qty)), line: last };
}

function cleanTitle(t: string): string {
  return t
    .replace(QTY_RE, ' ')
    .replace(SKU_RE, ' ')
    .replace(UPC_RE, ' ')
    .replace(/\s*[|]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[-–•·:\s]+|[-–•·:\s]+$/g, '')
    .trim();
}

function titleCandidates(block: HTMLElement): string[] {
  const anchors = block
    .querySelectorAll('a')
    .filter((a) => !/track|carrier|ups\.com|fedex\.com|usps\.com|dhl\./i.test(a.getAttribute('href') ?? ''))
    .map((a) => a.text.replace(/\s+/g, ' ').trim())
    .filter((t) => t.length >= 6 && isTitle(t) && !findMoney(t).length);
  const strong = block
    .querySelectorAll('strong, b, h3, h4, [class*=title], [class*=name], [class*=product]')
    .map((e) => e.text.replace(/\s+/g, ' ').trim())
    .filter((t) => t.length >= 6 && isTitle(t) && !findMoney(t).length && !QTY_RE.test(t));
  const segments = htmlToLines(block)
    .flatMap((l) => l.split(' | '))
    .map((s) => s.trim())
    .filter((t) => t.length >= 6 && isTitle(t) && !QTY_RE.test(t) && !SKU_RE.test(t) && findMoney(t).length === 0);
  return [...anchors, ...strong, ...segments.sort((a, b) => b.length - a.length)];
}

function blockImage(block: HTMLElement): string | undefined {
  for (const img of block.querySelectorAll('img')) {
    const src = img.getAttribute('src') ?? img.getAttribute('data-src') ?? '';
    if (!src || IMG_SKIP.test(src) || IMG_SKIP.test(img.getAttribute('alt') ?? '')) continue;
    const w = Number(img.getAttribute('width') ?? '0');
    const h = Number(img.getAttribute('height') ?? '0');
    if ((w && w < 30) || (h && h < 30)) continue;
    if (/^(https?:|cid:|data:image)/i.test(src)) return src;
  }
  return undefined;
}

const HEAD_ITEM = /^(items?|products?|descriptions?|artikel|produkte?|articles?|item description|product name)$/i;
const HEAD_QTY = /^(qty\.?|quantity|menge|anzahl|qt[ée]\.?|quantit[ée]|cantidad)$/i;
const HEAD_PRICE = /^(price|total|amount|item total|line total|unit price|each|preis|summe|gesamt|prix|montant|subtotal)$/i;

/** Tables with a header row ("Item | Qty | Price") and one product per following row. */
export function extractItemsFromHeaderTables(root: HTMLElement, currency: string): ParsedItem[] {
  const out: ParsedItem[] = [];
  for (const table of root.querySelectorAll('table')) {
    const rows = table.querySelectorAll('tr').filter((tr) => tr.closest('table') === table);
    let cols: { item: number; qty: number; price: number; unit: boolean } | null = null;
    for (const tr of rows) {
      const cells = tr.childNodes.filter((c) => c.nodeType === NodeType.ELEMENT_NODE && ['td', 'th'].includes(((c as HTMLElement).rawTagName || '').toLowerCase())) as HTMLElement[];
      const texts = cells.map((c) => c.text.replace(/\s+/g, ' ').trim());
      if (!cols) {
        const item = texts.findIndex((t) => HEAD_ITEM.test(t));
        const qty = texts.findIndex((t) => HEAD_QTY.test(t));
        if (item >= 0 && qty >= 0) {
          const price = texts.findIndex((t) => HEAD_PRICE.test(t));
          cols = { item, qty, price, unit: price >= 0 && /unit|each/i.test(texts[price]) };
        }
        continue;
      }
      if (STOP_BLOCK.test(texts.join(' '))) break;
      if (cells.length <= Math.max(cols.item, cols.qty)) continue;
      const qty = Number((texts[cols.qty].match(/\d{1,3}/) ?? [])[0]);
      if (!qty) continue;
      const itemLines = htmlToLines(cells[cols.item]).flatMap((l) => l.split(' | '));
      const title = itemLines.map(cleanTitle).find((t) => t.length >= 4 && !NOT_TITLE.test(t) && !SKU_RE.test(t));
      if (!title) continue;
      const rowText = texts.join(' | ');
      const money = cols.price >= 0 ? findMoney(texts[cols.price] ?? '', currency) : findMoney(rowText, currency);
      const amount = money.length ? money[money.length - 1].cents : undefined;
      const unit = amount === undefined ? undefined : cols.unit ? amount : Math.round(amount / qty);
      const line = amount === undefined ? undefined : cols.unit ? amount * qty : amount;
      out.push({
        title,
        quantity: qty,
        sku: rowText.match(SKU_RE)?.[1]?.toUpperCase(),
        upc: rowText.match(UPC_RE)?.[1],
        unitPriceCents: unit,
        lineTotalCents: line,
        imageUrl: blockImage(tr),
        status: itemStatus(rowText),
      });
    }
  }
  return out;
}

export function extractItemsFromHtml(root: HTMLElement, currency: string): ParsedItem[] {
  const fromTables = extractItemsFromHeaderTables(root, currency);
  if (fromTables.length) return dedupeItems(fromTables);
  const qtyEls: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  const visit = (n: HTMLElement) => {
    for (const c of n.childNodes) {
      if (c.nodeType === NodeType.TEXT_NODE) {
        const t = (c as unknown as { text: string }).text;
        if (QTY_RE.test(t) && !seen.has(n)) {
          seen.add(n);
          qtyEls.push(n);
        }
      } else if (c.nodeType === NodeType.ELEMENT_NODE) visit(c as HTMLElement);
    }
  };
  visit(root);

  // Some templates put "Qty:" and the number in separate elements; treat label-only nodes via parent.
  const items: ParsedItem[] = [];
  const usedBlocks = new Set<HTMLElement>();
  for (const q of qtyEls) {
    let block: HTMLElement = q;
    let el: HTMLElement | null = q.parentNode as HTMLElement | null;
    for (let depth = 0; el && depth < 10; depth++) {
      const text = el.text;
      if (countQtyMarkers(text) > 1 || text.length > 1500 || STOP_BLOCK.test(text)) break;
      block = el;
      el = el.parentNode as HTMLElement | null;
    }
    if (usedBlocks.has(block)) continue;
    usedBlocks.add(block);
    const text = htmlToLines(block).join(' | ');
    const qty = qtyFrom(text) ?? 1;
    const title = titleCandidates(block).map(cleanTitle).find((t) => t.length >= 4);
    if (!title) continue;
    const { unit, line } = pricesFrom(text, qty, currency);
    const href = block.querySelectorAll('a').map((a) => a.getAttribute('href') ?? '').find((h) => /^https?:/.test(h) && !/track|unsubscribe|help|account/i.test(h));
    items.push({
      title,
      quantity: qty,
      sku: text.match(SKU_RE)?.[1]?.toUpperCase(),
      upc: text.match(UPC_RE)?.[1],
      unitPriceCents: unit,
      lineTotalCents: line,
      imageUrl: blockImage(block),
      productUrl: href,
      status: itemStatus(text),
    });
  }
  return dedupeItems(items);
}

export function extractItemsFromLines(lines: string[], currency: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!QTY_RE.test(l)) continue;
    const qty = qtyFrom(l) ?? 1;
    // Title: this line minus the qty marker, else the nearest previous plausible line.
    let title = cleanTitle(l.replace(/(?:(?:US|CA|C)?\$|£|€)\s?\d[\d,.]*/g, ''));
    let j = i - 1;
    while ((!title || title.length < 6 || !isTitle(title)) && j >= 0 && i - j <= 3) {
      const cand = cleanTitle(lines[j]);
      if (cand.length >= 6 && isTitle(cand) && findMoney(cand).length === 0 && !STOP_BLOCK.test(cand)) title = cand;
      j--;
    }
    if (!title || title.length < 4 || !isTitle(title)) continue;
    const window = [lines[i - 1] ?? '', l, lines[i + 1] ?? ''].join(' ');
    const ctx = [l, lines[i + 1] ?? ''].join(' ');
    const { unit, line } = pricesFrom(findMoney(ctx).length ? ctx : window, qty, currency);
    items.push({
      title,
      quantity: qty,
      sku: window.match(SKU_RE)?.[1]?.toUpperCase(),
      upc: window.match(UPC_RE)?.[1],
      unitPriceCents: unit,
      lineTotalCents: line,
      status: itemStatus(l),
    });
  }
  return dedupeItems(items);
}

function dedupeItems(items: ParsedItem[]): ParsedItem[] {
  const map = new Map<string, ParsedItem>();
  for (const it of items) {
    const key = it.sku ? `sku:${it.sku}` : `t:${it.title.toLowerCase()}`;
    const prev = map.get(key);
    if (!prev) map.set(key, it);
    else if (!prev.imageUrl && it.imageUrl) map.set(key, { ...it, quantity: Math.max(prev.quantity, it.quantity) });
  }
  return [...map.values()];
}

// ---------------------------------------------------------------------------
// Addresses

const SHIP_HEADING = /^(ship(ping|ped)?\s+to|shipping\s+address|delivery\s+address|deliver(ing|y|ed)?\s+to|sending\s+to|your\s+order\s+will\s+(be\s+)?(shipped|delivered)\s+to|lieferadresse|versandadresse|lieferung\s+an|adresse de livraison)\b\s*:?/i;
const BILL_HEADING = /^(billing\s+address|bill(ed|ing)?\s+to|rechnungsadresse|adresse de facturation)\b\s*:?/i;
const CITY_US = /^(.+?),?\s+([A-Z]{2})\s*,?\s+(\d{5}(?:-\d{4})?)$/i;
const CITY_US_FULL = /^(.+?),\s*([A-Za-z ]{4,}),?\s+(\d{5}(?:-\d{4})?)$/;
const CITY_CA = /^(.+?),?\s+([A-Z]{2})\s*,?\s+([A-Z]\d[A-Z]\s?\d[A-Z]\d)$/i;
const CITY_GB_POST = /^([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/i;
const CITY_DE = /^(\d{5})\s+(.+)$/;
const COUNTRY_LINE = /^(united states( of america)?|usa|us|united kingdom|uk|great britain|canada|germany|deutschland)$/i;

export function parseAddressLines(raw: string[]): ParsedAddress | null {
  const ls = raw.map((s) => s.trim()).filter(Boolean).slice(0, 7);
  let cityIdx = -1;
  let city = '';
  let state: string | undefined;
  let postal = '';
  let country: string | undefined;
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    let m = l.match(CITY_US) ?? l.match(CITY_US_FULL);
    if (m) { cityIdx = i; city = m[1]; state = m[2]; postal = m[3]; country = 'US'; break; }
    m = l.match(CITY_CA);
    if (m) { cityIdx = i; city = m[1]; state = m[2]; postal = m[3]; country = 'CA'; break; }
    m = l.match(CITY_DE);
    if (m && i > 0) { cityIdx = i; postal = m[1]; city = m[2]; country = 'DE'; break; }
    if (CITY_GB_POST.test(l) && i > 1) {
      cityIdx = i; postal = l; city = ls[i - 1]; country = 'GB';
      ls.splice(i - 1, 1); cityIdx = i - 1; break;
    }
  }
  if (cityIdx < 1) return null;
  const before = ls.slice(0, cityIdx);
  if (ls[cityIdx + 1] && COUNTRY_LINE.test(ls[cityIdx + 1])) country = ls[cityIdx + 1];
  let name: string | undefined;
  if (before.length && !/\d/.test(before[0]) && before.length >= 2) name = before.shift();
  const line1Idx = before.findIndex((l) => /\d/.test(l));
  const line1 = line1Idx >= 0 ? before[line1Idx] : before[0];
  if (!line1) return null;
  const rest = before.filter((_, i) => i !== (line1Idx >= 0 ? line1Idx : 0));
  return { name, line1, line2: rest.join(' ') || undefined, city: city.replace(/,$/, ''), state, postal, country };
}

export function extractAddress(lines: string[], kind: 'shipping' | 'billing'): ParsedAddress | null {
  const heading = kind === 'shipping' ? SHIP_HEADING : BILL_HEADING;
  for (let i = 0; i < lines.length; i++) {
    const segs = lines[i].split(' | ');
    for (let s = 0; s < segs.length; s++) {
      const m = segs[s].match(heading);
      if (!m) continue;
      const remainder = segs[s].slice(m[0].length).trim();
      const collected: string[] = [];
      if (remainder) collected.push(...remainder.split(/,\s(?=\D)|\s{2,}/));
      collected.push(...segs.slice(s + 1));
      for (let j = i + 1; j < lines.length && collected.length < 8; j++) {
        if (SHIP_HEADING.test(lines[j]) || BILL_HEADING.test(lines[j]) || /payment|order summary|subtotal/i.test(lines[j])) break;
        collected.push(...lines[j].split(' | '));
      }
      const addr = parseAddressLines(collected);
      if (addr) return addr;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tracking

const TRACK_LABEL = /(tracking|track(ing)?\s*(number|no\.?|#|id)|sendungsnummer|sendungsverfolgung|num[ée]ro de suivi|waybill)/i;
const TOKEN = /\b([0-9A-Z]{2}[0-9A-Z -]{8,32}[0-9A-Z])\b/g;

export function extractTracking(root: HTMLElement | null, lines: string[]): DetectedTracking[] {
  const found = new Map<string, DetectedTracking>();
  const add = (t: DetectedTracking | null) => {
    if (!t) return;
    const prev = found.get(t.number);
    if (!prev || (prev.confidence !== 'high' && t.confidence === 'high')) found.set(t.number, t);
  };
  if (root) {
    for (const l of links(root)) {
      add(trackingFromUrl(l.href));
      if (/track/i.test(l.href) && l.text) {
        const c = classifyTracking(l.text, carrierHint(l.href + ' ' + l.text));
        if (c && c.confidence !== 'low') add(c);
      }
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // Unambiguous formats anywhere in the message.
    for (const m of l.matchAll(/\b(1Z[0-9A-Z]{16}|TBA\d{12}|9[2-5]\d{20}|[A-Z]{2}\d{9}(?:US|GB|CA))\b/g)) add(classifyTracking(m[1]));
    if (!TRACK_LABEL.test(l)) continue;
    const context = [lines[i - 1] ?? '', l, lines[i + 1] ?? ''].join(' ');
    const hint = carrierHint(context);
    for (const src of [l, lines[i + 1] ?? '']) {
      const label = src.match(TRACK_LABEL);
      const tail = label ? src.slice((label.index ?? 0) + label[0].length) : src;
      for (const m of tail.toUpperCase().matchAll(TOKEN)) {
        const c = classifyTracking(m[1], hint);
        if (c && (c.confidence !== 'low' || hint)) add(c);
      }
    }
  }
  return [...found.values()];
}

// ---------------------------------------------------------------------------
// Dates

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
  januar: 0, februar: 1, märz: 2, maerz: 2, mai: 4, juni: 5, juli: 6, okt: 9, dez: 11,
};

/** Parses "Oct 29", "October 29, 2026", "10/29/2026", "Wed, Oct 29". Year inferred near `ref`. */
export function parseLooseDate(text: string, ref: Date): string | undefined {
  let m = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    const day = Number(m[2]);
    let year = m[3] ? Number(m[3]) : ref.getUTCFullYear();
    if (!m[3] && month < ref.getUTCMonth() - 6) year += 1;
    return new Date(Date.UTC(year, month, day, 12)).toISOString();
  }
  m = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (m) {
    const year = Number(m[3].length === 2 ? '20' + m[3] : m[3]);
    return new Date(Date.UTC(year, Number(m[1]) - 1, Number(m[2]), 12)).toISOString();
  }
  m = text.match(/\b(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})\b/);
  if (m) return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12)).toISOString();
  return undefined;
}

export function extractEstimatedDelivery(lines: string[], ref: Date): string | undefined {
  for (const l of lines) {
    if (/(estimated|expected|arriv(es|ing)|delivery (by|date|on)|get it by|voraussichtlich|livraison pr[ée]vue)/i.test(l)) {
      const d = parseLooseDate(l, ref);
      if (d) return d;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Misc

export function extractPhone(lines: string[]): string | undefined {
  for (const l of lines) {
    const m = l.match(/(?:phone|tel(?:efon)?|mobile)\s*[:#]?\s*(\+?[\d()\-. ]{10,18}\d)/i);
    if (m) return m[1].trim();
  }
  return undefined;
}

export function extractCustomerEmail(lines: string[], retailerDomains: string[]): string | undefined {
  for (const l of lines) {
    if (!/e-?mail|sent to|account/i.test(l)) continue;
    const m = l.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    if (m && !retailerDomains.some((d) => m[0].toLowerCase().endsWith(d))) return m[0].toLowerCase();
  }
  return undefined;
}

export function shipmentsFrom(tracking: DetectedTracking[], est?: string): ParsedShipment[] {
  return tracking.map((t) => ({
    trackingNumber: t.number,
    carrier: t.carrier as Carrier,
    trackingUrl: trackingUrl(t.carrier, t.number) ?? undefined,
    estimatedDelivery: est,
  }));
}
