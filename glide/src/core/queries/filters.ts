import type { AppSettings, OrderFilter } from '../../shared/types';
import type { SQLInputValue } from 'node:sqlite';

export interface Where {
  sql: string;
  params: SQLInputValue[];
}

function inList(col: string, vals: (string | number)[], params: SQLInputValue[]): string {
  params.push(...vals);
  return `${col} IN (${vals.map(() => '?').join(',')})`;
}

/** Builds the WHERE clause for orders (alias `o`) from a UI filter. */
export function orderWhere(f: OrderFilter = {}): Where {
  const parts: string[] = [];
  const params: SQLInputValue[] = [];
  if (f.retailers?.length) parts.push(inList('o.retailer_id', f.retailers, params));
  if (f.memberIds?.length) parts.push(inList('o.member_id', f.memberIds, params));
  if (f.profileIds?.length) parts.push(inList('o.profile_id', f.profileIds, params));
  if (f.emailAccountIds?.length) parts.push(inList('o.email_account_id', f.emailAccountIds, params));
  if (f.fulfillment?.length) parts.push(inList('o.fulfillment_status', f.fulfillment, params));
  if (f.cancel?.length) parts.push(inList('o.cancel_state', f.cancel, params));
  if (f.review?.length) parts.push(inList('o.review_status', f.review, params));
  if (f.match?.length) parts.push(inList('o.match_status', f.match, params));
  if (f.productIds?.length) {
    parts.push(`EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND ${inList('oi.product_id', f.productIds, params)})`);
  }
  if (f.from) {
    parts.push('o.placed_at >= ?');
    params.push(f.from);
  }
  if (f.to) {
    parts.push('o.placed_at < ?');
    params.push(f.to);
  }
  if (f.search?.trim()) {
    for (const term of f.search.trim().toLowerCase().split(/\s+/).slice(0, 6)) {
      parts.push('o.search_text LIKE ?');
      params.push(`%${term}%`);
    }
  }
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
}

/** SQL expression converting a row's currency to the display currency, or NULL when no rate is configured. */
export function fxExpr(settings: Pick<AppSettings, 'displayCurrency' | 'fxRates'>, col = 'o.currency'): string {
  const cases = [`WHEN '${settings.displayCurrency.replace(/'/g, '')}' THEN 1.0`];
  for (const [cur, rate] of Object.entries(settings.fxRates ?? {})) {
    if (/^[A-Z]{3}$/.test(cur) && Number.isFinite(rate) && rate > 0 && cur !== settings.displayCurrency) cases.push(`WHEN '${cur}' THEN ${Number(rate)}`);
  }
  return `(CASE ${col} ${cases.join(' ')} ELSE NULL END)`;
}

/** Offset in minutes for bucketing UTC timestamps into the user's local day. */
export function tzOffsetMinutes(tz: string, at = new Date()): number {
  try {
    const local = new Date(at.toLocaleString('en-US', { timeZone: tz }));
    const utc = new Date(at.toLocaleString('en-US', { timeZone: 'UTC' }));
    return Math.round((local.getTime() - utc.getTime()) / 60000);
  } catch {
    return 0;
  }
}
