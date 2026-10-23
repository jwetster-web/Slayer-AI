// Analytics engine. All metrics derive from the same order fields so they
// stay mathematically consistent (see docs/METRICS.md):
//   live        = not fully canceled (still alive, whatever its shipping state)
//   success %   = live / orders
//   gross       = Σ order totals as placed
//   net         = Σ (total − max(canceled value, refunded))
//   fulfillment = delivered / live

import type { AnalyticsBundle, AppSettings, BreakdownRow, CampaignStats, KpiSummary, OrderFilter, SeriesPoint } from '../../shared/types';
import type { Db } from '../db/database';
import { PRODUCT_IMAGE_SQL } from '../products/catalog';
import { fxExpr, orderWhere, tzOffsetMinutes } from '../queries/filters';

const LIVE = "o.cancel_state <> 'full'";
const IN_TRANSIT = "o.fulfillment_status IN ('shipped','partially_shipped','out_for_delivery','partially_delivered','delayed','exception')";
const AWAITING = "o.fulfillment_status IN ('ordered','processing','backordered')";

export function kpis(db: Db, filter: OrderFilter, settings: AppSettings): KpiSummary {
  const w = orderWhere(filter);
  const fx = fxExpr(settings);
  const r = db.get<Record<string, number>>(
    `SELECT COUNT(*) AS orders,
       SUM(${LIVE}) AS live,
       SUM(o.cancel_state = 'full') AS canceled,
       SUM(o.cancel_state = 'partial') AS partial,
       SUM(${LIVE} AND ${AWAITING}) AS awaiting,
       SUM(${LIVE} AND ${IN_TRANSIT}) AS transit,
       SUM(o.fulfillment_status = 'delivered') AS delivered,
       SUM(o.review_status = 'hold') AS holds,
       SUM(EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.returned_qty > 0)) AS returns,
       SUM(o.refunded_cents > 0) AS refunds,
       COALESCE(SUM(o.units), 0) AS units,
       COALESCE(SUM(o.units - o.canceled_units), 0) AS net_units,
       COALESCE(SUM(o.total_cents * ${fx}), 0) AS gross,
       COALESCE(SUM(o.canceled_cents * ${fx}), 0) AS canceled_cents,
       COALESCE(SUM(o.refunded_cents * ${fx}), 0) AS refunded,
       COALESCE(SUM(o.net_cents * ${fx}), 0) AS net,
       COALESCE(SUM(o.tax_cents * ${fx}), 0) AS tax,
       COALESCE(SUM(o.shipping_cents * ${fx}), 0) AS ship,
       SUM(${fx} IS NULL) AS unconverted,
       SUM(${fx} IS NOT NULL) AS converted,
       COUNT(DISTINCT CASE WHEN ${LIVE} THEN o.member_id END) AS buyers,
       COALESCE(SUM(CASE WHEN o.member_id IS NOT NULL THEN o.net_cents * ${fx} END), 0) AS member_net,
       COALESCE(SUM(CASE WHEN o.member_id IS NOT NULL THEN o.units - o.canceled_units END), 0) AS member_units
     FROM orders o ${w.sql}`,
    w.params,
  )!;
  const n = (k: string) => Math.round(Number(r[k] ?? 0));
  const orders = n('orders');
  const live = n('live');
  const buyers = n('buyers');
  return {
    orders,
    successfulOrders: live,
    canceledOrders: n('canceled'),
    partiallyCanceledOrders: n('partial'),
    liveOrders: live,
    awaitingShipment: n('awaiting'),
    inTransitOrders: n('transit'),
    deliveredOrders: n('delivered'),
    reviewHolds: n('holds'),
    returns: n('returns'),
    refunds: n('refunds'),
    units: n('units'),
    netUnits: n('net_units'),
    grossCents: n('gross'),
    canceledCents: n('canceled_cents'),
    refundedCents: n('refunded'),
    netCents: n('net'),
    taxCents: n('tax'),
    shippingCents: n('ship'),
    avgOrderCents: n('converted') ? Math.round(n('gross') / n('converted')) : 0,
    successRate: orders ? live / orders : 0,
    cancellationRate: orders ? n('canceled') / orders : 0,
    fulfillmentRate: live ? n('delivered') / live : 0,
    activeBuyers: buyers,
    avgSpendPerMemberCents: buyers ? Math.round(n('member_net') / buyers) : 0,
    avgUnitsPerMember: buyers ? n('member_units') / buyers : 0,
    currency: settings.displayCurrency,
    mixedCurrency: n('unconverted') > 0,
  };
}

export type Granularity = 'hour' | 'day' | 'week' | 'month';

export function timeline(db: Db, filter: OrderFilter, settings: AppSettings, g: Granularity = 'day'): SeriesPoint[] {
  const w = orderWhere(filter);
  const fx = fxExpr(settings);
  const off = tzOffsetMinutes(settings.timezone);
  const local = `datetime(o.placed_at, '${off >= 0 ? '+' : ''}${off} minutes')`;
  const fmt = g === 'hour' ? `strftime('%Y-%m-%d %H:00', ${local})` : g === 'month' ? `strftime('%Y-%m', ${local})` : g === 'week' ? `date(${local}, 'weekday 0', '-6 days')` : `date(${local})`;
  return db.all<SeriesPoint>(
    `SELECT ${fmt} AS bucket, COUNT(*) AS orders, CAST(COALESCE(SUM(o.total_cents * ${fx}), 0) AS INTEGER) AS grossCents,
       CAST(COALESCE(SUM(o.net_cents * ${fx}), 0) AS INTEGER) AS netCents, COALESCE(SUM(o.units - o.canceled_units), 0) AS units,
       SUM(o.cancel_state = 'full') AS canceled
     FROM orders o ${w.sql} GROUP BY bucket ORDER BY bucket`,
    w.params,
  );
}

function breakdown(db: Db, filter: OrderFilter, settings: AppSettings, keyExpr: string, labelExpr: string, join = '', extraWhere = '', limit = 100, imageExpr = 'NULL'): BreakdownRow[] {
  const w = orderWhere(filter);
  const fx = fxExpr(settings);
  const where = w.sql ? `${w.sql}${extraWhere ? ` AND ${extraWhere}` : ''}` : extraWhere ? `WHERE ${extraWhere}` : '';
  return db.all<BreakdownRow>(
    `SELECT CAST(${keyExpr} AS TEXT) AS key, ${labelExpr} AS label, COUNT(*) AS orders, SUM(${LIVE}) AS successfulOrders,
       COALESCE(SUM(o.units - o.canceled_units), 0) AS units, CAST(COALESCE(SUM(o.total_cents * ${fx}), 0) AS INTEGER) AS grossCents,
       CAST(COALESCE(SUM(o.net_cents * ${fx}), 0) AS INTEGER) AS netCents, SUM(o.cancel_state = 'full') AS canceled, ${imageExpr} AS imageUrl
     FROM orders o ${join} ${where} GROUP BY ${keyExpr} ORDER BY netCents DESC, orders DESC LIMIT ${limit}`,
    w.params,
  );
}

export function byRetailer(db: Db, f: OrderFilter, s: AppSettings) {
  return breakdown(db, f, s, 'o.retailer_id', 'r.name', 'JOIN retailers r ON r.id = o.retailer_id');
}

export function byMember(db: Db, f: OrderFilter, s: AppSettings, limit = 50) {
  return breakdown(db, f, s, 'o.member_id', 'COALESCE(m.display_name, m.username)', 'JOIN members m ON m.id = o.member_id', '', limit, 'm.avatar_url');
}

export function byProfile(db: Db, f: OrderFilter, s: AppSettings, limit = 50) {
  return breakdown(db, f, s, 'o.profile_id', 'p.name', 'JOIN profiles p ON p.id = o.profile_id', '', limit);
}

export function byProduct(db: Db, filter: OrderFilter, settings: AppSettings, limit = 200): BreakdownRow[] {
  const w = orderWhere(filter);
  const fx = fxExpr(settings);
  return db.all<BreakdownRow>(
    `SELECT CAST(p.id AS TEXT) AS key, p.title AS label, COUNT(DISTINCT o.id) AS orders,
       COUNT(DISTINCT CASE WHEN oi.quantity > oi.canceled_qty THEN o.id END) AS successfulOrders,
       COALESCE(SUM(oi.quantity - oi.canceled_qty), 0) AS units,
       CAST(COALESCE(SUM(oi.line_total_cents * ${fx}), 0) AS INTEGER) AS grossCents,
       CAST(COALESCE(SUM((oi.quantity - oi.canceled_qty) * oi.unit_price_cents * ${fx}), 0) AS INTEGER) AS netCents,
       COALESCE(SUM(oi.canceled_qty), 0) AS canceled, ${PRODUCT_IMAGE_SQL} AS imageUrl
     FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
     ${w.sql} GROUP BY p.id ORDER BY units DESC, netCents DESC LIMIT ${limit}`,
    w.params,
  );
}

export function statusDistribution(db: Db, filter: OrderFilter) {
  const w = orderWhere(filter);
  return db.all<{ status: string; count: number }>(`SELECT o.fulfillment_status AS status, COUNT(*) AS count FROM orders o ${w.sql} GROUP BY o.fulfillment_status ORDER BY count DESC`, w.params);
}

export function heatmap(db: Db, filter: OrderFilter, settings: AppSettings) {
  const w = orderWhere(filter);
  const off = tzOffsetMinutes(settings.timezone);
  const local = `datetime(o.placed_at, '${off >= 0 ? '+' : ''}${off} minutes')`;
  return db.all<{ dow: number; hour: number; orders: number }>(
    `SELECT CAST(strftime('%w', ${local}) AS INTEGER) AS dow, CAST(strftime('%H', ${local}) AS INTEGER) AS hour, COUNT(*) AS orders FROM orders o ${w.sql} GROUP BY dow, hour`,
    w.params,
  );
}

export function cancellationBreakdown(db: Db, filter: OrderFilter) {
  const w = orderWhere(filter);
  const r = db.get<Record<string, number>>(
    `SELECT SUM(o.cancel_state = 'full' AND NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.kind = 'review_hold')) AS full_direct,
       SUM(o.cancel_state = 'full' AND EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.kind = 'review_hold')) AS after_hold,
       SUM(o.cancel_state = 'partial') AS partial
     FROM orders o ${w.sql}`,
    w.params,
  )!;
  return [
    { label: 'Canceled by retailer', count: Number(r.full_direct ?? 0) },
    { label: 'Canceled after review hold', count: Number(r.after_hold ?? 0) },
    { label: 'Partially canceled', count: Number(r.partial ?? 0) },
  ];
}

export function inactiveMembers(db: Db, days = 30, limit = 50) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return db.all<{ memberId: number; name: string; lastOrderAt: string | null }>(
    `SELECT m.id AS memberId, COALESCE(m.display_name, m.username) AS name, MAX(o.placed_at) AS lastOrderAt
     FROM members m LEFT JOIN orders o ON o.member_id = m.id AND o.cancel_state <> 'full'
     WHERE m.merged_into_id IS NULL GROUP BY m.id HAVING lastOrderAt IS NULL OR lastOrderAt < ? ORDER BY lastOrderAt DESC LIMIT ?`,
    [since, limit],
  );
}

export function analyticsBundle(db: Db, filter: OrderFilter, settings: AppSettings, g: Granularity = 'day'): AnalyticsBundle {
  return {
    kpis: kpis(db, filter, settings),
    timeline: timeline(db, filter, settings, g),
    byRetailer: byRetailer(db, filter, settings),
    byMember: byMember(db, filter, settings),
    byProduct: byProduct(db, filter, settings, 60),
    byProfile: byProfile(db, filter, settings, 30),
    byStatus: statusDistribution(db, filter),
    heatmap: heatmap(db, filter, settings),
    cancellationReasons: cancellationBreakdown(db, filter),
    inactiveMembers: inactiveMembers(db),
  };
}

export function campaignStats(db: Db, campaignId: number): CampaignStats | null {
  const c = db.get<{ id: number; name: string; starts_at: string | null; ends_at: string | null; retailer_ids_json: string }>('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
  if (!c) return null;
  const retailers: string[] = JSON.parse(c.retailer_ids_json || '[]');
  const params: (string | number)[] = [campaignId];
  let cond = '';
  if (c.starts_at) {
    cond += ' AND o.placed_at >= ?';
    params.push(c.starts_at);
  }
  if (c.ends_at) {
    cond += ' AND o.placed_at < ?';
    params.push(c.ends_at);
  }
  if (retailers.length) {
    cond += ` AND o.retailer_id IN (${retailers.map(() => '?').join(',')})`;
    params.push(...retailers);
  }
  const signups = db.value<number>('SELECT COUNT(*) FROM campaign_signups WHERE campaign_id = ?', [campaignId]) ?? 0;
  const success =
    db.value<number>(
      `SELECT COUNT(DISTINCT s.member_id) FROM campaign_signups s JOIN orders o ON o.member_id = s.member_id AND o.cancel_state <> 'full' WHERE s.campaign_id = ?${cond}`,
      params,
    ) ?? 0;
  return { campaignId, name: c.name, signups, membersWithSuccess: success, conversionRate: signups ? success / signups : 0 };
}
