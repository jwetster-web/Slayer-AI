// CSV exports (UTF-8 with BOM so Excel opens them correctly). Cells that
// begin with = + - @ are prefixed to prevent spreadsheet formula injection.

import type { AppSettings, OrderFilter } from '../../shared/types';
import type { Db } from '../db/database';
import { orderWhere } from '../queries/filters';

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return '﻿' + [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n') + '\r\n';
}

const money = (c: number | null | undefined) => (c === null || c === undefined ? '' : (c / 100).toFixed(2));

/** One row per line item. */
export function exportOrdersCsv(db: Db, filter: OrderFilter): string {
  const w = orderWhere(filter);
  const rows = db.all<Record<string, unknown>>(
    `SELECT o.placed_at, r.name AS retailer, o.order_number, m.discord_id, m.username, p.name AS profile, o.purchase_email,
       o.fulfillment_status, o.cancel_state, o.review_status, o.currency, o.total_cents, o.net_cents, o.tax_cents, o.shipping_cents, o.discount_cents,
       oi.title, oi.sku, oi.upc, oi.quantity, oi.canceled_qty, oi.unit_price_cents, oi.line_total_cents, oi.status AS item_status,
       (SELECT GROUP_CONCAT(pk.carrier || ':' || pk.tracking_number, ' ') FROM packages pk WHERE pk.order_id = o.id) AS tracking
     FROM orders o JOIN retailers r ON r.id = o.retailer_id LEFT JOIN members m ON m.id = o.member_id LEFT JOIN profiles p ON p.id = o.profile_id
     LEFT JOIN order_items oi ON oi.order_id = o.id ${w.sql} ORDER BY o.placed_at, o.id, oi.id`,
    w.params,
  );
  return toCsv(
    ['Placed At', 'Retailer', 'Order Number', 'Discord ID', 'Discord Username', 'Profile', 'Purchase Email', 'Fulfillment', 'Cancellation', 'Review', 'Currency', 'Order Total', 'Order Net', 'Tax', 'Shipping', 'Discount', 'Item', 'SKU', 'UPC', 'Qty', 'Canceled Qty', 'Unit Price', 'Line Total', 'Item Status', 'Tracking'],
    rows.map((r) => [r.placed_at, r.retailer, r.order_number, r.discord_id, r.username, r.profile, r.purchase_email, r.fulfillment_status, r.cancel_state, r.review_status, r.currency, money(r.total_cents as number), money(r.net_cents as number), money(r.tax_cents as number), money(r.shipping_cents as number), money(r.discount_cents as number), r.title, r.sku, r.upc, r.quantity, r.canceled_qty, money(r.unit_price_cents as number), money(r.line_total_cents as number), r.item_status, r.tracking]),
  );
}

export function exportMembersCsv(db: Db, filter: OrderFilter, _settings?: AppSettings): string {
  const w = orderWhere(filter);
  const join = w.sql ? w.sql.replace(/^WHERE /, 'AND ') : '';
  const rows = db.all<Record<string, unknown>>(
    `SELECT m.discord_id, m.username, m.display_name, COUNT(o.id) AS orders, COALESCE(SUM(o.cancel_state <> 'full'), 0) AS successful,
       COALESCE(SUM(o.units - o.canceled_units), 0) AS units, COALESCE(SUM(o.total_cents), 0) AS gross, COALESCE(SUM(o.net_cents), 0) AS net, MAX(o.placed_at) AS last_order
     FROM members m LEFT JOIN orders o ON o.member_id = m.id ${join} WHERE m.merged_into_id IS NULL GROUP BY m.id ORDER BY net DESC`,
    w.params,
  );
  return toCsv(['Discord ID', 'Username', 'Display Name', 'Orders', 'Successful Orders', 'Units', 'Gross', 'Net', 'Last Order'], rows.map((r) => [r.discord_id, r.username, r.display_name, r.orders, r.successful, r.units, money(r.gross as number), money(r.net as number), r.last_order]));
}

export interface InvoiceLine {
  placedAt: string;
  retailer: string;
  orderNumber: string;
  title: string;
  quantity: number;
  unitCents: number;
  lineCents: number;
  currency: string;
}

export function memberInvoice(db: Db, memberId: number, from?: string, to?: string) {
  const member = db.get<{ discord_id: string | null; username: string; display_name: string | null }>('SELECT discord_id, username, display_name FROM members WHERE id = ?', [memberId]);
  if (!member) throw new Error('member not found');
  const params: (string | number)[] = [memberId];
  let cond = '';
  if (from) {
    cond += ' AND o.placed_at >= ?';
    params.push(from);
  }
  if (to) {
    cond += ' AND o.placed_at < ?';
    params.push(to);
  }
  const lines = db.all<InvoiceLine>(
    `SELECT o.placed_at AS placedAt, r.name AS retailer, o.order_number AS orderNumber, oi.title, oi.quantity - oi.canceled_qty AS quantity,
       oi.unit_price_cents AS unitCents, (oi.quantity - oi.canceled_qty) * oi.unit_price_cents AS lineCents, o.currency
     FROM orders o JOIN retailers r ON r.id = o.retailer_id JOIN order_items oi ON oi.order_id = o.id
     WHERE o.member_id = ? AND o.cancel_state <> 'full' AND oi.quantity > oi.canceled_qty ${cond} ORDER BY o.placed_at`,
    params,
  );
  const totals = new Map<string, number>();
  for (const l of lines) totals.set(l.currency, (totals.get(l.currency) ?? 0) + l.lineCents);
  const csv = toCsv(
    ['Discord ID', 'Member', 'Date', 'Retailer', 'Order', 'Item', 'Qty', 'Unit Price', 'Line Total', 'Currency'],
    [
      ...lines.map((l) => [member.discord_id, member.display_name ?? member.username, l.placedAt.slice(0, 10), l.retailer, l.orderNumber, l.title, l.quantity, money(l.unitCents), money(l.lineCents), l.currency]),
      ...[...totals].map(([cur, c]) => [member.discord_id, member.display_name ?? member.username, '', '', '', `TOTAL (${cur}, pre-tax item value)`, lines.filter((l) => l.currency === cur).reduce((s, l) => s + l.quantity, 0), '', money(c), cur]),
    ],
  );
  return { member, lines, totals: Object.fromEntries(totals), csv };
}
