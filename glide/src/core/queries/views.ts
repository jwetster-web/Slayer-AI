// Read models for the UI. Every list query is index-backed and paginated.

import type {
  ActivityRow, AddressRow, EmailAccountRow, MatchCandidateRow, MatchEvidence, MemberRow, OrderDetail, OrderEventRow, OrderFilter, OrderItemRow, OrderRow,
  PackageRow, ProductRow, ProfileRow, SourceMessageRow, TrackingEventRow,
} from '../../shared/types';
import { json, type Db } from '../db/database';
import { PRODUCT_IMAGE_SQL, productImageSql } from '../products/catalog';
import { carrierName } from '../tracking/carriers';
import { orderWhere } from './filters';

const ITEM_IMAGE = `COALESCE(${productImageSql('pp')}, oi.image_url)`;

const ORDER_COLS = `
  o.id, o.retailer_id AS retailerId, r.name AS retailerName, o.order_number AS orderNumber, o.placed_at AS placedAt, o.currency,
  o.total_cents AS totalCents, o.net_cents AS netCents, o.units - o.canceled_units AS units, o.fulfillment_status AS fulfillmentStatus,
  o.cancel_state AS cancelState, o.financial_status AS financialStatus, o.review_status AS reviewStatus, o.match_status AS matchStatus,
  o.match_confidence AS matchConfidence, o.member_id AS memberId, COALESCE(m.display_name, m.username) AS memberName, m.avatar_url AS memberAvatar,
  o.profile_id AS profileId, p.name AS profileName, o.purchase_email AS purchaseEmail,
  (SELECT ${ITEM_IMAGE} FROM order_items oi LEFT JOIN products pp ON pp.id = oi.product_id WHERE oi.order_id = o.id ORDER BY oi.line_total_cents DESC LIMIT 1) AS firstImage,
  (SELECT oi.title FROM order_items oi WHERE oi.order_id = o.id ORDER BY oi.line_total_cents DESC LIMIT 1) AS firstTitle,
  (SELECT COUNT(*) FROM packages pk WHERE pk.order_id = o.id) AS packageCount, o.last_activity_at AS lastActivityAt`;

const ORDER_FROM = `FROM orders o JOIN retailers r ON r.id = o.retailer_id LEFT JOIN members m ON m.id = o.member_id LEFT JOIN profiles p ON p.id = o.profile_id`;

const SORTS: Record<NonNullable<OrderFilter['sort']>, string> = {
  placed_desc: 'o.placed_at DESC, o.id DESC',
  placed_asc: 'o.placed_at ASC, o.id ASC',
  total_desc: 'o.total_cents DESC',
  total_asc: 'o.total_cents ASC',
  activity_desc: 'o.last_activity_at DESC, o.id DESC',
};

export function listOrders(db: Db, f: OrderFilter = {}): { rows: OrderRow[]; total: number } {
  const w = orderWhere(f);
  const total = db.value<number>(`SELECT COUNT(*) FROM orders o ${w.sql}`, w.params) ?? 0;
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 1000);
  const offset = Math.max(f.offset ?? 0, 0);
  const rows = db.all<OrderRow>(`SELECT ${ORDER_COLS} ${ORDER_FROM} ${w.sql} ORDER BY ${SORTS[f.sort ?? 'placed_desc']} LIMIT ${limit} OFFSET ${offset}`, w.params);
  return { rows, total };
}

export function getOrder(db: Db, id: number): OrderDetail | null {
  const base = db.get<OrderRow & Record<string, unknown>>(
    `SELECT ${ORDER_COLS}, o.subtotal_cents AS subtotalCents, o.tax_cents AS taxCents, o.shipping_cents AS shippingCents, o.discount_cents AS discountCents,
       o.refunded_cents AS refundedCents, o.canceled_cents AS canceledCents, o.recipient_name AS recipientName, o.phone_masked AS phoneMasked,
       o.shipping_address_id AS shippingAddressId, o.notes, o.match_evidence_json AS matchEvidenceJson, ea.label AS emailAccountLabel
     ${ORDER_FROM} LEFT JOIN email_accounts ea ON ea.id = o.email_account_id WHERE o.id = ?`,
    [id],
  );
  if (!base) return null;
  const items = db.all<OrderItemRow>(
    `SELECT oi.id, oi.product_id AS productId, oi.title, oi.sku, oi.upc, ${ITEM_IMAGE} AS imageUrl, pp.category, oi.quantity,
       oi.canceled_qty AS canceledQty, oi.shipped_qty AS shippedQty, oi.delivered_qty AS deliveredQty, oi.unit_price_cents AS unitPriceCents,
       oi.line_total_cents AS lineTotalCents, oi.status
     FROM order_items oi LEFT JOIN products pp ON pp.id = oi.product_id WHERE oi.order_id = ? ORDER BY oi.id`,
    [id],
  );
  const packages = db
    .all<{ id: number; tracking_number: string; carrier: string; tracking_url: string | null; status: string; estimated_delivery: string | null; delivered_at: string | null; last_verified_at: string | null }>(
      'SELECT * FROM packages WHERE order_id = ? ORDER BY id',
      [id],
    )
    .map<PackageRow>((p) => ({
      id: p.id,
      trackingNumber: p.tracking_number,
      carrier: p.carrier as PackageRow['carrier'],
      carrierName: carrierName(p.carrier),
      trackingUrl: p.tracking_url,
      status: p.status as PackageRow['status'],
      estimatedDelivery: p.estimated_delivery,
      deliveredAt: p.delivered_at,
      lastVerifiedAt: p.last_verified_at,
      events: db.all<TrackingEventRow>('SELECT id, status, description, location, occurred_at AS occurredAt, source FROM tracking_events WHERE package_id = ? ORDER BY occurred_at DESC, id DESC', [p.id]),
    }));
  const events = db
    .all<{ id: number; kind: string; label: string; occurred_at: string; source: string; detail_json: string | null }>('SELECT id, kind, label, occurred_at, source, detail_json FROM order_events WHERE order_id = ? ORDER BY occurred_at, id', [id])
    .map<OrderEventRow>((e) => ({ id: e.id, kind: e.kind, label: e.label, occurredAt: e.occurred_at, source: e.source, detail: json(e.detail_json, null) }));
  const sources = db.all<Omit<SourceMessageRow, 'forwarded'> & { forwarded: number }>(
    `SELECT s.id, s.subject, s.from_addr AS fromAddr, s.sent_at AS sentAt, s.message_type AS messageType, ea.label AS accountLabel, s.forwarded, s.parse_status AS parseStatus
     FROM order_sources os JOIN source_messages s ON s.id = os.source_message_id LEFT JOIN email_accounts ea ON ea.id = s.account_id WHERE os.order_id = ? ORDER BY s.sent_at`,
    [id],
  ).map((s) => ({ ...s, forwarded: !!s.forwarded }));
  const addrId = base.shippingAddressId as number | null;
  return {
    ...(base as unknown as OrderRow),
    subtotalCents: base.subtotalCents as number,
    taxCents: base.taxCents as number,
    shippingCents: base.shippingCents as number,
    discountCents: base.discountCents as number,
    refundedCents: base.refundedCents as number,
    canceledCents: base.canceledCents as number,
    recipientName: (base.recipientName as string) ?? null,
    phoneMasked: (base.phoneMasked as string) ?? null,
    shippingAddress: addrId ? getAddress(db, addrId) : null,
    emailAccountLabel: (base.emailAccountLabel as string) ?? null,
    notes: (base.notes as string) ?? '',
    matchEvidence: json<MatchEvidence[]>(base.matchEvidenceJson, []),
    items,
    packages,
    events,
    sources,
  };
}

export function getAddress(db: Db, id: number): AddressRow | null {
  const a = db.get<Omit<AddressRow, 'verified'> & { verified: number }>(
    `SELECT a.id, a.line1, a.line2, a.city, a.state, a.postal, a.country, a.verified,
       (SELECT COUNT(*) FROM address_variants v WHERE v.address_id = a.id) AS variantCount,
       (SELECT COUNT(*) FROM address_owners ao WHERE ao.address_id = a.id) AS ownerCount
     FROM addresses a WHERE a.id = ?`,
    [id],
  );
  return a ? { ...a, verified: !!a.verified } : null;
}

export function listMembers(db: Db, opts: { search?: string; limit?: number; offset?: number; sort?: 'spend' | 'orders' | 'recent' | 'name' } = {}): { rows: MemberRow[]; total: number } {
  const params: (string | number)[] = [];
  let where = 'WHERE m.merged_into_id IS NULL';
  if (opts.search?.trim()) {
    const q = `%${opts.search.trim()}%`;
    where += ` AND (m.username LIKE ? OR m.display_name LIKE ? OR m.discord_id LIKE ? OR EXISTS (SELECT 1 FROM profiles p WHERE p.member_id = m.id AND p.name LIKE ?)
      OR EXISTS (SELECT 1 FROM emails e WHERE e.member_id = m.id AND e.address LIKE ?) OR EXISTS (SELECT 1 FROM discord_name_history h WHERE h.member_id = m.id AND h.username LIKE ?))`;
    params.push(q, q, q, q, q, q);
  }
  const total = db.value<number>(`SELECT COUNT(*) FROM members m ${where}`, params) ?? 0;
  const order = { spend: 'netCents DESC', orders: 'orderCount DESC', recent: 'lastActivityAt DESC', name: 'm.username COLLATE NOCASE' }[opts.sort ?? 'spend'];
  const rows = db
    .all<MemberRow & { tags_json: string }>(
      `SELECT m.id, m.discord_id AS discordId, m.username, m.display_name AS displayName, m.avatar_url AS avatarUrl, m.tags_json,
         (SELECT COUNT(*) FROM profiles p WHERE p.member_id = m.id) AS profileCount,
         (SELECT COUNT(*) FROM emails e WHERE e.member_id = m.id) AS emailCount,
         (SELECT COUNT(*) FROM address_owners ao WHERE ao.member_id = m.id) AS addressCount,
         COUNT(o.id) AS orderCount, COALESCE(SUM(o.cancel_state <> 'full'), 0) AS successfulOrders,
         COALESCE(SUM(o.units - o.canceled_units), 0) AS units, COALESCE(SUM(o.total_cents), 0) AS grossCents, COALESCE(SUM(o.net_cents), 0) AS netCents,
         MAX(o.placed_at) AS lastActivityAt
       FROM members m LEFT JOIN orders o ON o.member_id = m.id ${where} GROUP BY m.id ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...params, Math.min(opts.limit ?? 200, 1000), opts.offset ?? 0],
    )
    .map((r) => ({ ...r, tags: json<string[]>(r.tags_json, []) }));
  return { rows, total };
}

export interface MemberDetail extends MemberRow {
  notes: string;
  nameHistory: { username: string; displayName: string | null; observedAt: string }[];
  profiles: ProfileRow[];
  emails: { id: number; address: string; status: string; profileId: number | null }[];
  addresses: (AddressRow & { ownerStatus: string; sharedWith: string[] })[];
  retailers: { retailerId: string; name: string; orders: number; netCents: number }[];
}

export function getMember(db: Db, id: number): MemberDetail | null {
  const row = listMembersById(db, id);
  if (!row) return null;
  const notes = db.value<string>('SELECT notes FROM members WHERE id = ?', [id]) ?? '';
  return {
    ...row,
    notes,
    nameHistory: db.all('SELECT username, display_name AS displayName, observed_at AS observedAt FROM discord_name_history WHERE member_id = ? ORDER BY observed_at DESC', [id]),
    profiles: listProfiles(db, { memberId: id }).rows,
    emails: db.all('SELECT id, address, status, profile_id AS profileId FROM emails WHERE member_id = ? ORDER BY status, address', [id]),
    addresses: db.all<{ address_id: number; status: string }>('SELECT address_id, status FROM address_owners WHERE member_id = ?', [id]).map((ao) => ({
      ...getAddress(db, ao.address_id)!,
      ownerStatus: ao.status,
      sharedWith: db.all<{ n: string }>('SELECT COALESCE(m.display_name, m.username) AS n FROM address_owners x JOIN members m ON m.id = x.member_id WHERE x.address_id = ? AND x.member_id <> ?', [ao.address_id, id]).map((r) => r.n),
    })),
    retailers: db.all('SELECT o.retailer_id AS retailerId, r.name, COUNT(*) AS orders, SUM(o.net_cents) AS netCents FROM orders o JOIN retailers r ON r.id = o.retailer_id WHERE o.member_id = ? GROUP BY o.retailer_id ORDER BY netCents DESC', [id]),
  };
}

function listMembersById(db: Db, id: number): MemberRow | null {
  const r = db.get<MemberRow & { tags_json: string }>(
    `SELECT m.id, m.discord_id AS discordId, m.username, m.display_name AS displayName, m.avatar_url AS avatarUrl, m.tags_json,
       (SELECT COUNT(*) FROM profiles p WHERE p.member_id = m.id) AS profileCount,
       (SELECT COUNT(*) FROM emails e WHERE e.member_id = m.id) AS emailCount,
       (SELECT COUNT(*) FROM address_owners ao WHERE ao.member_id = m.id) AS addressCount,
       COUNT(o.id) AS orderCount, COALESCE(SUM(o.cancel_state <> 'full'), 0) AS successfulOrders, COALESCE(SUM(o.units - o.canceled_units), 0) AS units,
       COALESCE(SUM(o.total_cents), 0) AS grossCents, COALESCE(SUM(o.net_cents), 0) AS netCents, MAX(o.placed_at) AS lastActivityAt
     FROM members m LEFT JOIN orders o ON o.member_id = m.id WHERE m.id = ? GROUP BY m.id`,
    [id],
  );
  return r ? { ...r, tags: json<string[]>(r.tags_json, []) } : null;
}

export function listProfiles(db: Db, opts: { search?: string; memberId?: number; unassigned?: boolean; limit?: number; offset?: number } = {}): { rows: ProfileRow[]; total: number } {
  const params: (string | number)[] = [];
  const conds: string[] = [];
  if (opts.memberId) {
    conds.push('p.member_id = ?');
    params.push(opts.memberId);
  }
  if (opts.unassigned) conds.push('p.member_id IS NULL');
  if (opts.search?.trim()) {
    const q = `%${opts.search.trim()}%`;
    conds.push('(p.name LIKE ? OR p.first_name LIKE ? OR p.last_name LIKE ? OR EXISTS (SELECT 1 FROM emails e WHERE e.profile_id = p.id AND e.address LIKE ?))');
    params.push(q, q, q, q);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const total = db.value<number>(`SELECT COUNT(*) FROM profiles p ${where}`, params) ?? 0;
  const rows = db
    .all<ProfileRow & { emails_csv: string | null; retailers_csv: string | null }>(
      `SELECT p.id, p.name, p.first_name AS firstName, p.last_name AS lastName, p.member_id AS memberId, COALESCE(m.display_name, m.username) AS memberName,
         (SELECT GROUP_CONCAT(e.address, ',') FROM emails e WHERE e.profile_id = p.id) AS emails_csv,
         (SELECT COUNT(*) FROM profile_addresses pa WHERE pa.profile_id = p.id) AS addressCount,
         (SELECT COUNT(*) FROM orders o WHERE o.profile_id = p.id) AS orderCount,
         (SELECT GROUP_CONCAT(DISTINCT o.retailer_id) FROM orders o WHERE o.profile_id = p.id) AS retailers_csv
       FROM profiles p LEFT JOIN members m ON m.id = p.member_id ${where} ORDER BY p.name COLLATE NOCASE LIMIT ? OFFSET ?`,
      [...params, Math.min(opts.limit ?? 300, 2000), opts.offset ?? 0],
    )
    .map(({ emails_csv, retailers_csv, ...r }) => ({ ...r, emails: emails_csv ? emails_csv.split(',') : [], retailers: retailers_csv ? retailers_csv.split(',') : [] }));
  return { rows, total };
}

export function listProducts(db: Db, opts: { search?: string; category?: string; limit?: number; offset?: number } = {}): { rows: ProductRow[]; total: number } {
  const params: (string | number)[] = [];
  const conds: string[] = [];
  if (opts.search?.trim()) {
    const q = `%${opts.search.trim()}%`;
    conds.push('(p.title LIKE ? OR p.sku LIKE ? OR p.upc LIKE ?)');
    params.push(q, q, q);
  }
  if (opts.category) {
    conds.push('p.category = ?');
    params.push(opts.category);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const total = db.value<number>(`SELECT COUNT(*) FROM products p ${where}`, params) ?? 0;
  const rows = db.all<ProductRow>(
    `SELECT p.id, p.retailer_id AS retailerId, p.sku, p.upc, p.title, p.brand, p.category, ${PRODUCT_IMAGE_SQL} AS imageUrl, p.url,
       COALESCE((SELECT SUM(oi.quantity - oi.canceled_qty) FROM order_items oi WHERE oi.product_id = p.id), 0) AS units,
       (SELECT COUNT(DISTINCT oi.order_id) FROM order_items oi WHERE oi.product_id = p.id) AS orderCount,
       (SELECT pr.price_cents FROM product_prices pr WHERE pr.product_id = p.id ORDER BY pr.observed_at DESC LIMIT 1) AS lastPriceCents,
       (SELECT pr.currency FROM product_prices pr WHERE pr.product_id = p.id ORDER BY pr.observed_at DESC LIMIT 1) AS currency
     FROM products p ${where} ORDER BY units DESC, p.title LIMIT ? OFFSET ?`,
    [...params, Math.min(opts.limit ?? 300, 2000), opts.offset ?? 0],
  );
  return { rows, total };
}

export function productDetail(db: Db, id: number) {
  const p = listProductsById(db, id);
  if (!p) return null;
  return {
    ...p,
    images: db.all<{ id: number; source: string; url: string | null; localPath: string | null }>('SELECT id, source, url, local_path AS localPath FROM product_images WHERE product_id = ? ORDER BY id', [id]),
    prices: db.all<{ priceCents: number; currency: string; observedAt: string; retailerId: string }>('SELECT price_cents AS priceCents, currency, observed_at AS observedAt, retailer_id AS retailerId FROM product_prices WHERE product_id = ? ORDER BY observed_at', [id]),
  };
}

function listProductsById(db: Db, id: number): ProductRow | null {
  return (
    db.get<ProductRow>(
      `SELECT p.id, p.retailer_id AS retailerId, p.sku, p.upc, p.title, p.brand, p.category, ${PRODUCT_IMAGE_SQL} AS imageUrl, p.url,
         COALESCE((SELECT SUM(oi.quantity - oi.canceled_qty) FROM order_items oi WHERE oi.product_id = p.id), 0) AS units,
         (SELECT COUNT(DISTINCT oi.order_id) FROM order_items oi WHERE oi.product_id = p.id) AS orderCount,
         (SELECT pr.price_cents FROM product_prices pr WHERE pr.product_id = p.id ORDER BY pr.observed_at DESC LIMIT 1) AS lastPriceCents,
         (SELECT pr.currency FROM product_prices pr WHERE pr.product_id = p.id ORDER BY pr.observed_at DESC LIMIT 1) AS currency
       FROM products p WHERE p.id = ?`,
      [id],
    ) ?? null
  );
}

export function listEmailAccounts(db: Db): EmailAccountRow[] {
  return db
    .all<Omit<EmailAccountRow, 'enabled'> & { enabled: number }>(
      `SELECT a.id, a.label, a.kind, a.address, a.host, a.port, a.enabled, a.status, a.last_sync_at AS lastSyncAt, a.last_error AS lastError,
         a.processed_count AS processedCount, a.error_count AS errorCount, a.owner_member_id AS ownerMemberId, a.backfill_days AS backfillDays,
         (SELECT COUNT(*) FROM orders o WHERE o.email_account_id = a.id) AS orderCount
       FROM email_accounts a ORDER BY a.label`,
    )
    .map((a) => ({ ...a, enabled: !!a.enabled }));
}

export function listActivity(db: Db, opts: { limit?: number; afterId?: number; kinds?: string[]; retailers?: string[]; memberId?: number } = {}): ActivityRow[] {
  const conds: string[] = [];
  const params: (string | number)[] = [];
  if (opts.afterId) {
    conds.push('a.id > ?');
    params.push(opts.afterId);
  }
  if (opts.kinds?.length) {
    conds.push(`a.kind IN (${opts.kinds.map(() => '?').join(',')})`);
    params.push(...opts.kinds);
  }
  if (opts.retailers?.length) {
    conds.push(`a.retailer_id IN (${opts.retailers.map(() => '?').join(',')})`);
    params.push(...opts.retailers);
  }
  if (opts.memberId) {
    conds.push('a.member_id = ?');
    params.push(opts.memberId);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  return db.all<ActivityRow>(
    `SELECT a.id, a.at, a.kind, a.retailer_id AS retailerId, r.name AS retailerName, a.order_id AS orderId,
       COALESCE(a.member_id, o.member_id) AS memberId, COALESCE(m.display_name, m.username) AS memberName, a.amount_cents AS amountCents, a.currency, a.units, a.label
     FROM activity_feed a LEFT JOIN retailers r ON r.id = a.retailer_id LEFT JOIN orders o ON o.id = a.order_id
     LEFT JOIN members m ON m.id = COALESCE(a.member_id, o.member_id) ${where} ORDER BY a.at DESC, a.id DESC LIMIT ?`,
    [...params, Math.min(opts.limit ?? 100, 1000)],
  );
}

export function listCandidates(db: Db, opts: { status?: string; kind?: string; limit?: number } = {}): MatchCandidateRow[] {
  const conds = ['c.status = ?'];
  const params: (string | number)[] = [opts.status ?? 'pending'];
  if (opts.kind) {
    conds.push('c.kind = ?');
    params.push(opts.kind);
  }
  return db
    .all<{ id: number; kind: MatchCandidateRow['kind']; status: MatchCandidateRow['status']; confidence: number; order_id: number | null; member_id: number | null; other_member_id: number | null; email: string | null; addr: string | null; order_label: string | null; member_name: string | null; other_name: string | null; alternatives_json: string; evidence_json: string; created_at: string }>(
      `SELECT c.*, e.address AS email, (a.line1 || ', ' || a.city || ' ' || a.postal) AS addr,
         (r.name || ' #' || o.order_number) AS order_label, COALESCE(m.display_name, m.username) AS member_name, COALESCE(m2.display_name, m2.username) AS other_name
       FROM match_candidates c LEFT JOIN emails e ON e.id = c.email_id LEFT JOIN addresses a ON a.id = c.address_id
       LEFT JOIN orders o ON o.id = c.order_id LEFT JOIN retailers r ON r.id = o.retailer_id
       LEFT JOIN members m ON m.id = c.member_id LEFT JOIN members m2 ON m2.id = c.other_member_id
       WHERE ${conds.join(' AND ')} ORDER BY c.created_at DESC LIMIT ?`,
      [...params, Math.min(opts.limit ?? 200, 1000)],
    )
    .map((c) => {
      const titles: Record<string, string> = {
        order_assignment: `Assign ${c.order_label ?? 'order'}`,
        email_link: `New email ${c.email ?? ''}`,
        address_link: `Address ${c.addr ?? ''}`,
        member_merge: `Possible duplicate: ${c.member_name} ↔ ${c.other_name}`,
        profile_link: 'Link profile',
        new_profile: 'New buying profile',
      };
      const summaries: Record<string, string> = {
        order_assignment: `Proposed owner ${c.member_name ?? 'unknown'} at ${(c.confidence * 100).toFixed(0)}% confidence`,
        email_link: `Link to ${c.member_name ?? 'member'}?`,
        address_link: `Verify as ${c.member_name ?? 'member'}’s address?`,
        member_merge: 'Merge these member records?',
        profile_link: '',
        new_profile: '',
      };
      return {
        id: c.id,
        kind: c.kind,
        status: c.status,
        confidence: c.confidence,
        title: titles[c.kind] ?? c.kind,
        summary: summaries[c.kind] ?? '',
        orderId: c.order_id,
        proposedMemberId: c.member_id,
        proposedMemberName: c.member_name,
        alternatives: json(c.alternatives_json, []),
        evidence: json(c.evidence_json, []),
        createdAt: c.created_at,
      };
    });
}

export function discoverySummary(db: Db) {
  return {
    unmatchedOrders: db.value<number>("SELECT COUNT(*) FROM orders WHERE match_status IN ('unmatched','review')") ?? 0,
    pendingReviews: db.value<number>("SELECT COUNT(*) FROM match_candidates WHERE status = 'pending'") ?? 0,
    newEmails: db.value<number>("SELECT COUNT(*) FROM emails WHERE status <> 'verified'") ?? 0,
    unverifiedAddresses: db.value<number>('SELECT COUNT(*) FROM addresses WHERE verified = 0') ?? 0,
    sharedAddresses: db.value<number>("SELECT COUNT(*) FROM (SELECT address_id FROM address_owners GROUP BY address_id HAVING COUNT(*) > 1)") ?? 0,
    discoveredProfiles: db.value<number>("SELECT COUNT(*) FROM profiles WHERE source = 'discovered'") ?? 0,
    addressVariants: db.value<number>('SELECT COUNT(*) FROM (SELECT address_id FROM address_variants GROUP BY address_id HAVING COUNT(*) > 1)') ?? 0,
  };
}

export function sharedAddresses(db: Db, limit = 100) {
  return db.all<{ addressId: number; line1: string; city: string; postal: string; members: string }>(
    `SELECT a.id AS addressId, a.line1, a.city, a.postal, GROUP_CONCAT(COALESCE(m.display_name, m.username), ', ') AS members
     FROM address_owners ao JOIN addresses a ON a.id = ao.address_id JOIN members m ON m.id = ao.member_id
     GROUP BY a.id HAVING COUNT(*) > 1 ORDER BY a.id DESC LIMIT ?`,
    [limit],
  );
}

export function auditLog(db: Db, limit = 200, entity?: string) {
  return db.all<{ id: number; at: string; actor: string; action: string; entity: string; entityId: string | null; detail: string | null }>(
    `SELECT id, at, actor, action, entity, entity_id AS entityId, detail_json AS detail FROM audit_log ${entity ? 'WHERE entity = ?' : ''} ORDER BY id DESC LIMIT ?`,
    entity ? [entity, limit] : [limit],
  );
}

export function parserFailures(db: Db, limit = 100) {
  return db.all<{ id: number; retailerId: string | null; messageType: string; reason: string | null; sample: string | null; createdAt: string; accountLabel: string | null }>(
    `SELECT s.id, s.retailer_id AS retailerId, s.message_type AS messageType, s.parse_error AS reason, s.redacted_sample AS sample, s.created_at AS createdAt, ea.label AS accountLabel
     FROM source_messages s LEFT JOIN email_accounts ea ON ea.id = s.account_id WHERE s.parse_status = 'failed' ORDER BY s.id DESC LIMIT ?`,
    [limit],
  );
}

export function shipmentOverview(db: Db, limit = 300) {
  const counts = db.all<{ status: string; count: number }>('SELECT status, COUNT(*) AS count FROM packages GROUP BY status');
  const rows = db.all<{ id: number; orderId: number; trackingNumber: string; carrier: string; status: string; trackingUrl: string | null; estimatedDelivery: string | null; deliveredAt: string | null; lastEventAt: string | null; lastVerifiedAt: string | null; orderNumber: string; retailerName: string; memberName: string | null; lastEvent: string | null }>(
    `SELECT pk.id, pk.order_id AS orderId, pk.tracking_number AS trackingNumber, pk.carrier, pk.status, pk.tracking_url AS trackingUrl, pk.estimated_delivery AS estimatedDelivery,
       pk.delivered_at AS deliveredAt, pk.last_event_at AS lastEventAt, pk.last_verified_at AS lastVerifiedAt, o.order_number AS orderNumber, r.name AS retailerName,
       COALESCE(m.display_name, m.username) AS memberName,
       (SELECT te.description FROM tracking_events te WHERE te.package_id = pk.id ORDER BY te.occurred_at DESC LIMIT 1) AS lastEvent
     FROM packages pk JOIN orders o ON o.id = pk.order_id JOIN retailers r ON r.id = o.retailer_id LEFT JOIN members m ON m.id = o.member_id
     ORDER BY COALESCE(pk.last_event_at, pk.created_at) DESC LIMIT ?`,
    [limit],
  );
  return { counts, rows };
}
