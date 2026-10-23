// Aggregates real recorded orders into the dataset every export template
// draws from. Nothing here is estimated or padded: quantities are units that
// survived cancellation, money uses the same definitions as Analytics.

import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { AppSettings, KpiSummary, OrderFilter, ProductCategory, SeriesPoint } from '../../shared/types';
import { kpis, timeline } from '../analytics/engine';
import type { Db } from '../db/database';
import { maskName } from '../identity/normalize';
import { productImageSql, titleKey } from '../products/catalog';
import { fxExpr, orderWhere } from '../queries/filters';
import { retailer as retailerMeta } from '../retailers/registry';

export interface RecapProduct {
  id: number;
  title: string;
  category: ProductCategory;
  units: number;
  orders: number;
  image: string | null; // data URI
  retailers: string[];
}

export interface RecapRetailer {
  id: string;
  name: string;
  shortName: string;
  color: string;
  orders: number;
  live: number;
  canceled: number;
  units: number;
  netCents: number;
  grossCents: number;
  successRate: number;
}

export interface RecapLeader {
  rank: number;
  memberId: number;
  name: string;
  avatar: string | null;
  netCents: number;
  orders: number;
  units: number;
}

export interface RecapShipments {
  packages: number;
  labelCreated: number;
  inTransit: number;
  outForDelivery: number;
  delivered: number;
  exceptions: number;
  outstanding: number;
  avgTransitDays: number | null;
  byCarrier: { carrier: string; count: number }[];
}

export interface RecapData {
  brandName: string;
  tagline: string;
  accent: string;
  logo: string | null;
  dateLabel: string;
  rangeLabel: string;
  isSample: boolean;
  kpis: KpiSummary;
  retailers: RecapRetailer[];
  products: RecapProduct[];
  leaders: RecapLeader[];
  shipments: RecapShipments;
  timeline: SeriesPoint[];
}

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };

/** Turns a stored image reference into a data URI usable by the rasterizer. Remote, uncached images are skipped. */
export function imageToDataUri(ref: string | null, imageDir: string): string | null {
  if (!ref) return null;
  if (ref.startsWith('data:image/')) return ref;
  const local = ref.startsWith('glide-img://local/') ? join(imageDir, ref.slice('glide-img://local/'.length)) : existsSync(ref) ? ref : null;
  if (!local || !existsSync(local)) return null;
  const mime = MIME[extname(local).toLowerCase()];
  if (!mime) return null;
  return `data:${mime};base64,${readFileSync(local).toString('base64')}`;
}

export interface RecapOptions {
  imageDir: string;
  maskNames?: boolean;
  productLimit?: number;
  leaderLimit?: number;
  logoPath?: string | null;
  dateLabel?: string;
  isSample?: boolean;
  /** Keep glide-img:// references instead of inlining (for fast in-app previews). */
  urlImages?: boolean;
}

export function buildRecapData(db: Db, filter: OrderFilter, settings: AppSettings, opts: RecapOptions): RecapData {
  const w = orderWhere(filter);
  const fx = fxExpr(settings);
  const k = kpis(db, filter, settings);
  const img = (ref: string | null) => (opts.urlImages ? (ref && (ref.startsWith('glide-img://') || ref.startsWith('data:image/')) ? ref : null) : imageToDataUri(ref, opts.imageDir));
  const retailers = db
    .all<Omit<RecapRetailer, 'name' | 'shortName' | 'color' | 'successRate'>>(
      `SELECT o.retailer_id AS id, COUNT(*) AS orders, SUM(o.cancel_state <> 'full') AS live, SUM(o.cancel_state = 'full') AS canceled,
         COALESCE(SUM(o.units - o.canceled_units), 0) AS units, CAST(COALESCE(SUM(o.net_cents * ${fx}), 0) AS INTEGER) AS netCents,
         CAST(COALESCE(SUM(o.total_cents * ${fx}), 0) AS INTEGER) AS grossCents
       FROM orders o ${w.sql} GROUP BY o.retailer_id ORDER BY netCents DESC`,
      w.params,
    )
    .map((r) => {
      const m = retailerMeta(r.id);
      return { ...r, name: m.name, shortName: m.shortName, color: m.color, successRate: r.orders ? r.live / r.orders : 0 };
    });
  const rawProducts = db
    .all<{ id: number; title: string; category: ProductCategory; units: number; orders: number; image: string | null; retailers: string | null }>(
      `SELECT p.id, p.title, p.category, SUM(oi.quantity - oi.canceled_qty) AS units, COUNT(DISTINCT o.id) AS orders,
         COALESCE(${productImageSql('p')}, MAX(oi.image_url)) AS image, GROUP_CONCAT(DISTINCT o.retailer_id) AS retailers
       FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
       ${w.sql ? `${w.sql} AND` : 'WHERE'} o.cancel_state <> 'full' AND oi.quantity > oi.canceled_qty
       GROUP BY p.id ORDER BY units DESC, p.title LIMIT ?`,
      [...w.params, opts.productLimit ?? 400],
    )
    .map((p) => ({ ...p, image: img(p.image), retailers: p.retailers ? p.retailers.split(',') : [] }));
  // The same item bought at different retailers (without a shared UPC) is two catalog
  // entries. Recaps combine entries whose normalized titles are identical — exact
  // matches only, never "similar" titles — keeping the best-selling entry's image.
  const grouped = new Map<string, RecapProduct>();
  for (const p of rawProducts) {
    const k = titleKey(p.title);
    const g = grouped.get(k);
    if (!g) grouped.set(k, { ...p });
    else {
      g.units += p.units;
      g.orders += p.orders;
      g.retailers = [...new Set([...g.retailers, ...p.retailers])];
      if (!g.image && p.image) g.image = p.image;
    }
  }
  const products = [...grouped.values()].sort((a, b) => b.units - a.units || a.title.localeCompare(b.title));
  const leaders = db
    .all<{ memberId: number; name: string; avatar: string | null; netCents: number; orders: number; units: number }>(
      `SELECT m.id AS memberId, COALESCE(m.display_name, m.username) AS name, m.avatar_url AS avatar,
         CAST(COALESCE(SUM(o.net_cents * ${fx}), 0) AS INTEGER) AS netCents, SUM(o.cancel_state <> 'full') AS orders, COALESCE(SUM(o.units - o.canceled_units), 0) AS units
       FROM orders o JOIN members m ON m.id = o.member_id ${w.sql} GROUP BY m.id HAVING netCents > 0 ORDER BY netCents DESC LIMIT ?`,
      [...w.params, opts.leaderLimit ?? 10],
    )
    .map((l, i) => ({
      ...l,
      rank: i + 1,
      name: opts.maskNames ? maskName(l.name) : l.name,
      avatar: opts.maskNames ? null : l.avatar && !l.avatar.startsWith('http') ? img(l.avatar) : null,
    }));
  const pk = db.get<Record<string, number>>(
    `SELECT COUNT(*) AS packages, SUM(pk.status = 'label_created') AS labelCreated, SUM(pk.status IN ('in_transit','delayed')) AS inTransit,
       SUM(pk.status = 'out_for_delivery') AS ofd, SUM(pk.status = 'delivered') AS delivered, SUM(pk.status = 'exception') AS exceptions,
       AVG(CASE WHEN pk.status = 'delivered' AND pk.delivered_at IS NOT NULL THEN julianday(pk.delivered_at) - julianday((SELECT MIN(te.occurred_at) FROM tracking_events te WHERE te.package_id = pk.id)) END) AS transit
     FROM packages pk JOIN orders o ON o.id = pk.order_id ${w.sql}`,
    w.params,
  )!;
  const byCarrier = db.all<{ carrier: string; count: number }>(`SELECT pk.carrier, COUNT(*) AS count FROM packages pk JOIN orders o ON o.id = pk.order_id ${w.sql} GROUP BY pk.carrier ORDER BY count DESC`, w.params);
  const n = (x: unknown) => Number(x ?? 0);
  const shipments: RecapShipments = {
    packages: n(pk.packages),
    labelCreated: n(pk.labelCreated),
    inTransit: n(pk.inTransit),
    outForDelivery: n(pk.ofd),
    delivered: n(pk.delivered),
    exceptions: n(pk.exceptions),
    outstanding: n(pk.packages) - n(pk.delivered),
    avgTransitDays: pk.transit === null || pk.transit === undefined ? null : Math.round(Number(pk.transit) * 10) / 10,
    byCarrier,
  };
  const from = filter.from ? new Date(filter.from) : null;
  const to = filter.to ? new Date(new Date(filter.to).getTime() - 1) : null;
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const rangeLabel = from && to ? (fmt(from) === fmt(to) ? fmt(from) : `${fmt(from)} – ${fmt(to)}`) : from ? `Since ${fmt(from)}` : 'All time';
  return {
    brandName: settings.brandName,
    tagline: settings.brandTagline,
    accent: settings.accentColor,
    logo: opts.logoPath ? (opts.urlImages ? `glide-img://local/${basename(opts.logoPath)}` : imageToDataUri(opts.logoPath, opts.imageDir)) : null,
    dateLabel: opts.dateLabel ?? rangeLabel,
    rangeLabel,
    isSample: !!opts.isSample,
    kpis: k,
    retailers,
    products,
    leaders,
    shipments,
    timeline: timeline(db, filter, settings, 'day'),
  };
}
