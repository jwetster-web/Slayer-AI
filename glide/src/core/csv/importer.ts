// CSV import for buying profiles, Discord mappings and checkout-bot order logs.
//
// Payment card data is never imported: card/CVV/expiry columns are dropped at
// parse time, and any column whose values look like card numbers (Luhn-valid
// 13–19 digits) is dropped too, whatever its header says.

import Papa from 'papaparse';
import type { ParsedOrderEmail, RetailerId } from '../../shared/types';
import { audit } from '../audit';
import { now, type Db } from '../db/database';
import { nameKey, normalizeEmail } from '../identity/normalize';
import { createProfile, linkEmail, linkProfileAddress, setAddressOwner, upsertAddress, upsertEmail, upsertMember } from '../identity/store';
import { applyParsedEmail } from '../orders/ingest';
import { parseAmount } from '../parsing/money';
import { classifyTracking } from '../tracking/carriers';

export const FIELDS = [
  'discordId', 'discordUsername', 'profileName', 'email', 'firstName', 'lastName', 'phone', 'address1', 'address2', 'city', 'state', 'zip', 'country',
  'retailer', 'orderNumber', 'orderDate', 'product', 'sku', 'quantity', 'price', 'total', 'trackingNumber', 'carrier', 'status',
] as const;
export type Field = (typeof FIELDS)[number];
export type Mapping = Partial<Record<Field, string>>;

const ALIASES: Record<Field, string[]> = {
  discordId: ['discordid', 'discorduserid', 'userid', 'memberid', 'discordidnumber', 'snowflake'],
  discordUsername: ['discord', 'discordusername', 'discordname', 'username', 'discordtag', 'member', 'membername', 'user'],
  profileName: ['profilename', 'profile', 'profiletitle', 'name', 'profileid', 'fullname', 'recipient', 'recipientname', 'shippingname', 'customername', 'shiptoname'],
  email: ['email', 'emailaddress', 'mail', 'accountemail', 'shippingemail', 'profileemail'],
  firstName: ['firstname', 'shippingfirstname', 'fname', 'first', 'givenname'],
  lastName: ['lastname', 'shippinglastname', 'lname', 'last', 'surname', 'familyname'],
  phone: ['phone', 'phonenumber', 'shippingphone', 'mobile', 'tel', 'telephone'],
  address1: ['address', 'address1', 'addressline1', 'shippingaddress', 'shippingaddress1', 'street', 'shippingline1', 'shippingaddressline1', 'line1'],
  address2: ['address2', 'addressline2', 'shippingaddress2', 'apt', 'unit', 'shippingline2', 'shippingaddressline2', 'line2', 'apartment'],
  city: ['city', 'shippingcity', 'town'],
  state: ['state', 'shippingstate', 'province', 'region', 'stateprovince', 'shippingprovince'],
  zip: ['zip', 'zipcode', 'postal', 'postalcode', 'shippingzip', 'shippingpostcode', 'postcode', 'shippingzipcode', 'shippingpostalcode'],
  country: ['country', 'shippingcountry', 'countrycode'],
  retailer: ['retailer', 'store', 'site', 'website', 'module', 'shop'],
  orderNumber: ['ordernumber', 'orderid', 'order', 'orderno', 'ordernum'],
  orderDate: ['date', 'orderdate', 'time', 'timestamp', 'checkoutdate', 'createdat', 'checkouttime'],
  product: ['product', 'productname', 'item', 'itemname', 'title', 'producttitle'],
  sku: ['sku', 'pid', 'productid', 'tcin', 'itemnumber', 'dpci', 'asin'],
  quantity: ['quantity', 'qty', 'units'],
  price: ['price', 'unitprice', 'itemprice', 'priceeach'],
  total: ['total', 'ordertotal', 'totalprice', 'grandtotal', 'amount'],
  trackingNumber: ['tracking', 'trackingnumber', 'trackingno', 'trackingid'],
  carrier: ['carrier', 'shippingcarrier', 'courier'],
  status: ['status', 'orderstatus', 'checkoutstatus', 'result'],
};

/** Known bot/export presets: header renames applied before alias matching. */
export const PRESETS: Record<string, { label: string; rename: Record<string, Field> }> = {
  pokeslayerz: { label: 'PokeSlayerz export', rename: {} },
  valor: { label: 'Valor (profile export)', rename: { 'profile name': 'profileName', 'shipping first name': 'firstName', 'shipping last name': 'lastName', 'shipping address': 'address1', 'shipping address 2': 'address2', 'shipping city': 'city', 'shipping state': 'state', 'shipping zip': 'zip', 'shipping country': 'country', 'shipping phone': 'phone' } },
  sniped: { label: 'Sniped (profile export)', rename: { profile: 'profileName', 'first name': 'firstName', 'last name': 'lastName', 'address line 1': 'address1', 'address line 2': 'address2', 'zip code': 'zip' } },
};

const SENSITIVE = /^(card|cc|credit|debit|cvv|cvc|cvv2|csc|securitycode|exp|expiry|expiration|expmonth|expyear|cardexp|cardholder|nameoncard|cardtype|cardnumber|ccnumber|pan|iban|routing|accountnumber|password|pass)/;

const key = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

function luhn(d: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** Trims a cell, collapses stray tabs/spaces and unwraps Excel text guards such as ="34476" (keeps ZIP leading zeros). */
export function cleanCell(v: unknown): string {
  let t = (v ?? '').toString().trim();
  const guarded = t.match(/^="(.*)"$/s);
  if (guarded) t = guarded[1].replace(/""/g, '"').trim();
  return t.replace(/[\t ]+/g, ' ');
}

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  dropped: { header: string; reason: string }[];
  detectedPreset: string | null;
  mapping: Mapping;
  kind: 'profiles' | 'orders';
}

export function parseCsv(text: string, preset?: string): ParsedCsv {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() });
  const dropped: ParsedCsv['dropped'] = [];
  let headers = (res.meta.fields ?? []).filter(Boolean);
  // Drop sensitive columns by header.
  for (const h of headers) if (SENSITIVE.test(key(h)) && !/^(express|expected)/.test(key(h))) dropped.push({ header: h, reason: 'payment/credential data is never imported' });
  // Drop columns whose values look like card numbers.
  for (const h of headers) {
    if (dropped.some((d) => d.header === h)) continue;
    const vals = res.data.slice(0, 200).map((r) => (r[h] ?? '').replace(/[\s-]/g, '')).filter(Boolean);
    const cardLike = vals.filter((v) => /^\d{13,19}$/.test(v) && luhn(v)).length;
    if (vals.length && cardLike / vals.length > 0.5) dropped.push({ header: h, reason: 'values look like payment card numbers' });
  }
  const droppedSet = new Set(dropped.map((d) => d.header));
  headers = headers.filter((h) => !droppedSet.has(h));
  const rows = res.data.map((r) => {
    const o: Record<string, string> = {};
    for (const h of headers) o[h] = cleanCell(r[h]);
    return o;
  });
  const lower = headers.map((h) => h.toLowerCase());
  const detectedPreset = preset ?? (lower.includes('shipping first name') && lower.includes('profile name') ? 'valor' : lower.includes('address line 1') && lower.includes('profile') ? 'sniped' : lower.includes('discordid') || lower.includes('discord id') || (lower.includes('discord_username') && lower.includes('full_name')) ? 'pokeslayerz' : null);
  const mapping = autoMap(headers, detectedPreset ?? undefined);
  return { headers, rows, dropped, detectedPreset, mapping, kind: mapping.orderNumber ? 'orders' : 'profiles' };
}

export function autoMap(headers: string[], preset?: string): Mapping {
  const m: Mapping = {};
  const rename = preset ? PRESETS[preset]?.rename ?? {} : {};
  for (const h of headers) {
    const f = rename[h.toLowerCase()];
    if (f && !m[f]) m[f] = h;
  }
  for (const f of FIELDS) {
    if (m[f]) continue;
    const hit = headers.find((h) => ALIASES[f].includes(key(h)) && !Object.values(m).includes(h));
    if (hit) m[f] = hit;
  }
  // "name" only means profile name when explicit first/last columns exist or no profile column was found.
  return m;
}

const val = (row: Record<string, string>, m: Mapping, f: Field) => (m[f] ? row[m[f]!] ?? '' : '').trim();

export function retailerFromText(t: string): RetailerId {
  const s = t.toLowerCase();
  if (/pok[eé]mon|pkc/.test(s)) {
    if (/\b(uk|gb|united kingdom)\b/.test(s)) return 'pokemoncenter_uk';
    if (/\b(ca|canada)\b/.test(s)) return 'pokemoncenter_ca';
    if (/\b(de|germany|deutschland)\b/.test(s)) return 'pokemoncenter_de';
    return 'pokemoncenter_us';
  }
  const table: [RegExp, RetailerId][] = [[/target/, 'target'], [/walmart/, 'walmart'], [/amazon/, 'amazon'], [/best\s*buy|bestbuy/, 'bestbuy'], [/costco/, 'costco'], [/sam'?s/, 'samsclub'], [/gamestop/, 'gamestop'], [/hot\s*topic/, 'hottopic'], [/barnes/, 'barnesnoble'], [/macy/, 'macys'], [/lego/, 'lego'], [/mattel/, 'mattel'], [/shopify/, 'shopify']];
  for (const [re, id] of table) if (re.test(s)) return id;
  return 'custom';
}

export interface PreviewRow {
  index: number;
  action: 'create' | 'update' | 'skip';
  summary: string;
  issues: string[];
  suggestions: string[];
}

export interface ImportPreview {
  kind: 'profiles' | 'orders';
  total: number;
  creates: number;
  updates: number;
  skips: number;
  missing: number;
  duplicates: number;
  rows: PreviewRow[];
  dropped: ParsedCsv['dropped'];
}

export function previewImport(db: Db, csv: ParsedCsv, mapping: Mapping, kind = csv.kind): ImportPreview {
  const out: PreviewRow[] = [];
  const seen = new Set<string>();
  for (const [i, row] of csv.rows.entries()) {
    const issues: string[] = [];
    const suggestions: string[] = [];
    if (kind === 'orders') {
      const num = val(row, mapping, 'orderNumber');
      const ret = retailerFromText(val(row, mapping, 'retailer'));
      if (!num) issues.push('missing order number');
      if (!val(row, mapping, 'retailer')) issues.push('missing retailer');
      if (/fail|decline|error|oos|out of stock/i.test(val(row, mapping, 'status'))) {
        out.push({ index: i, action: 'skip', summary: `${ret} #${num}: not a successful checkout`, issues, suggestions });
        continue;
      }
      const exists = num && db.get('SELECT 1 FROM orders WHERE retailer_id = ? AND order_number = ?', [ret, num.toUpperCase()]);
      out.push({ index: i, action: issues.length ? 'skip' : exists ? 'skip' : 'create', summary: `${ret} #${num || '?'} · ${val(row, mapping, 'product') || 'item'}`, issues: exists ? [...issues, 'order already exists'] : issues, suggestions });
      continue;
    }
    const discordId = val(row, mapping, 'discordId');
    const username = val(row, mapping, 'discordUsername');
    const pname = val(row, mapping, 'profileName') || [val(row, mapping, 'firstName'), val(row, mapping, 'lastName')].filter(Boolean).join(' ');
    const email = normalizeEmail(val(row, mapping, 'email'));
    if (!discordId && !username) issues.push('missing Discord ID/username');
    if (!pname && !email) issues.push('missing profile name or email');
    if (discordId && !/^\d{15,22}$/.test(discordId)) issues.push('Discord ID is not a valid snowflake');
    // One member can have several rows for the same name at different addresses; only exact repeats are duplicates.
    const dupKey = `${discordId || username}|${pname.toLowerCase()}|${val(row, mapping, 'address1').toLowerCase()}|${val(row, mapping, 'address2').toLowerCase()}|${val(row, mapping, 'zip')}`;
    if (seen.has(dupKey)) {
      out.push({ index: i, action: 'skip', summary: `${pname} (duplicate row in file)`, issues: ['duplicate row'], suggestions });
      continue;
    }
    seen.add(dupKey);
    const member = discordId ? db.get<{ id: number; username: string }>('SELECT id, username FROM members WHERE discord_id = ?', [discordId]) : username ? db.get<{ id: number; username: string }>('SELECT id, username FROM members WHERE username = ? COLLATE NOCASE', [username]) : undefined;
    let action: PreviewRow['action'] = 'create';
    if (member) {
      const existing = db.get('SELECT 1 FROM profiles WHERE member_id = ? AND (name = ? COLLATE NOCASE OR name_key = ?)', [member.id, pname, nameKey(pname).key]);
      if (existing) action = 'update';
    }
    if (email) {
      const e = db.get<{ member_id: number | null; status: string }>('SELECT member_id, status FROM emails WHERE address = ?', [email]);
      if (e?.member_id && member && e.member_id !== member.id && e.status === 'verified') issues.push('email is verified for a different member');
      if (e?.member_id && !member) suggestions.push(`email already belongs to member #${e.member_id}`);
    }
    out.push({ index: i, action: issues.some((x) => x.startsWith('missing')) ? 'skip' : action, summary: `${member ? `@${member.username}` : `new member ${username || discordId}`} · ${pname || email}`, issues, suggestions });
  }
  return {
    kind,
    total: out.length,
    creates: out.filter((r) => r.action === 'create').length,
    updates: out.filter((r) => r.action === 'update').length,
    skips: out.filter((r) => r.action === 'skip').length,
    missing: out.filter((r) => r.issues.some((x) => x.startsWith('missing'))).length,
    duplicates: out.filter((r) => r.issues.includes('duplicate row') || r.issues.includes('order already exists')).length,
    rows: out,
    dropped: csv.dropped,
  };
}

function track(db: Db, batchId: number, table: string, rowKey: string | number, op: 'insert' | 'update', before?: unknown) {
  db.run('INSERT INTO import_changes (batch_id, table_name, row_key, op, before_json) VALUES (?, ?, ?, ?, ?)', [batchId, table, String(rowKey), op, before ? JSON.stringify(before) : null]);
}

export function applyImport(db: Db, csv: ParsedCsv, mapping: Mapping, filename: string, actor: string, kind = csv.kind) {
  const preview = previewImport(db, csv, mapping, kind);
  return db.tx(() => {
    const batchId = db.run('INSERT INTO import_batches (kind, filename, status, created_at) VALUES (?, ?, ?, ?)', [kind, filename, 'applied', now()]).lastId;
    let created = 0;
    if (kind === 'orders') {
      const groups = new Map<string, Record<string, string>[]>();
      for (const p of preview.rows) {
        if (p.action !== 'create') continue;
        const row = csv.rows[p.index];
        const k = `${retailerFromText(val(row, mapping, 'retailer'))}|${val(row, mapping, 'orderNumber').toUpperCase()}`;
        groups.set(k, [...(groups.get(k) ?? []), row]);
      }
      for (const [k, rows] of groups) {
        const [retailer, orderNumber] = k.split('|') as [RetailerId, string];
        const r0 = rows[0];
        const dateRaw = val(r0, mapping, 'orderDate');
        const placedAt = dateRaw && !Number.isNaN(new Date(dateRaw).getTime()) ? new Date(dateRaw).toISOString() : now();
        const items = rows.map((r) => {
          const qty = Math.max(1, Number(val(r, mapping, 'quantity')) || 1);
          const price = parseAmount(val(r, mapping, 'price') || '') ?? undefined;
          return { title: val(r, mapping, 'product') || 'Item', sku: val(r, mapping, 'sku') || undefined, quantity: qty, unitPriceCents: price, lineTotalCents: price !== undefined ? price * qty : undefined };
        });
        const totalRaw = parseAmount(val(r0, mapping, 'total') || '');
        const trk = val(r0, mapping, 'trackingNumber');
        const parsed: ParsedOrderEmail = {
          retailer, type: 'order_confirmation', orderNumber, placedAt, currency: 'USD',
          totalCents: totalRaw ?? undefined, items, shipments: [], warnings: [],
          customerEmail: normalizeEmail(val(r0, mapping, 'email')) ?? undefined,
          recipientName: [val(r0, mapping, 'firstName'), val(r0, mapping, 'lastName')].filter(Boolean).join(' ') || undefined,
          phone: val(r0, mapping, 'phone') || undefined,
          shippingAddress: val(r0, mapping, 'address1') && val(r0, mapping, 'zip') ? { line1: val(r0, mapping, 'address1'), line2: val(r0, mapping, 'address2') || undefined, city: val(r0, mapping, 'city'), state: val(r0, mapping, 'state') || undefined, postal: val(r0, mapping, 'zip'), country: val(r0, mapping, 'country') || undefined } : undefined,
        };
        const res = applyParsedEmail({ db, occurredAt: placedAt, source: 'import' }, parsed);
        if (res.created) {
          track(db, batchId, 'orders', res.orderId, 'insert');
          created++;
        }
        if (trk) {
          const t = classifyTracking(trk, (val(r0, mapping, 'carrier').toLowerCase() || undefined) as never);
          if (t) applyParsedEmail({ db, occurredAt: placedAt, source: 'import' }, { ...parsed, type: 'shipping', items: [], shipments: [{ trackingNumber: t.number, carrier: t.carrier }] });
        }
      }
    } else {
      for (const p of preview.rows) {
        if (p.action === 'skip') continue;
        const row = csv.rows[p.index];
        const discordId = val(row, mapping, 'discordId') || null;
        const username = val(row, mapping, 'discordUsername') || discordId!;
        const before = discordId ? db.get('SELECT id FROM members WHERE discord_id = ?', [discordId]) : db.get('SELECT id FROM members WHERE username = ? COLLATE NOCASE', [username]);
        const m = upsertMember(db, { discordId, username }, actor);
        if (m.created && !before) track(db, batchId, 'members', m.id, 'insert');
        const first = val(row, mapping, 'firstName') || null;
        const last = val(row, mapping, 'lastName') || null;
        const pname = val(row, mapping, 'profileName') || [first, last].filter(Boolean).join(' ') || val(row, mapping, 'email');
        let profileId = db.value<number>('SELECT id FROM profiles WHERE member_id = ? AND name = ? COLLATE NOCASE', [m.id, pname]);
        if (!profileId) {
          profileId = createProfile(db, { name: pname, firstName: first, lastName: last, phone: val(row, mapping, 'phone') || null, memberId: m.id, source: 'import' }, actor);
          track(db, batchId, 'profiles', profileId, 'insert');
          created++;
        }
        const email = normalizeEmail(val(row, mapping, 'email'));
        if (email) {
          const existed = db.get<{ id: number; member_id: number | null; profile_id: number | null; status: string }>('SELECT id, member_id, profile_id, status FROM emails WHERE address = ?', [email]);
          const eid = upsertEmail(db, email)!;
          if (!existed) track(db, batchId, 'emails', eid, 'insert');
          else track(db, batchId, 'emails', eid, 'update', { member_id: existed.member_id, profile_id: existed.profile_id, status: existed.status });
          if (!(existed?.status === 'verified' && existed.member_id && existed.member_id !== m.id)) linkEmail(db, eid, m.id, profileId, 'verified', actor);
        }
        if (val(row, mapping, 'address1') && val(row, mapping, 'zip')) {
          const aid = upsertAddress(db, { line1: val(row, mapping, 'address1'), line2: val(row, mapping, 'address2') || undefined, city: val(row, mapping, 'city'), state: val(row, mapping, 'state') || undefined, postal: val(row, mapping, 'zip'), country: val(row, mapping, 'country') || undefined });
          const owned = db.get('SELECT 1 FROM address_owners WHERE address_id = ? AND member_id = ?', [aid, m.id]);
          setAddressOwner(db, aid, m.id, 'verified', actor);
          if (!owned) track(db, batchId, 'address_owners', `${aid}:${m.id}`, 'insert');
          linkProfileAddress(db, profileId, aid);
        }
      }
    }
    const stats = { created, ...{ creates: preview.creates, updates: preview.updates, skips: preview.skips, dropped: csv.dropped.map((d) => d.header) } };
    db.run('UPDATE import_batches SET stats_json = ? WHERE id = ?', [JSON.stringify(stats), batchId]);
    audit(db, actor, 'import_applied', 'import_batch', batchId, { kind, filename, ...stats });
    return { batchId, ...stats };
  });
}

export function rollbackImport(db: Db, batchId: number, actor: string) {
  db.tx(() => {
    const b = db.get<{ status: string }>('SELECT status FROM import_batches WHERE id = ?', [batchId]);
    if (!b || b.status !== 'applied') throw new Error('batch not applied');
    const changes = db.all<{ table_name: string; row_key: string; op: string; before_json: string | null }>('SELECT * FROM import_changes WHERE batch_id = ? ORDER BY id DESC', [batchId]);
    for (const c of changes) {
      if (c.op === 'insert') {
        if (c.table_name === 'address_owners') {
          const [a, m] = c.row_key.split(':').map(Number);
          db.run('DELETE FROM address_owners WHERE address_id = ? AND member_id = ?', [a, m]);
        } else if (['members', 'profiles', 'emails', 'orders'].includes(c.table_name)) {
          db.run(`DELETE FROM ${c.table_name} WHERE id = ?`, [Number(c.row_key)]);
        }
      } else if (c.op === 'update' && c.table_name === 'emails' && c.before_json) {
        const bj = JSON.parse(c.before_json);
        db.run('UPDATE emails SET member_id = ?, profile_id = ?, status = ? WHERE id = ?', [bj.member_id, bj.profile_id, bj.status, Number(c.row_key)]);
      }
    }
    db.run("UPDATE import_batches SET status = 'rolled_back', rolled_back_at = ? WHERE id = ?", [now(), batchId]);
    audit(db, actor, 'import_rolled_back', 'import_batch', batchId);
  });
}

export function listImportBatches(db: Db) {
  return db.all<{ id: number; kind: string; filename: string; status: string; statsJson: string; createdAt: string; rolledBackAt: string | null }>(
    'SELECT id, kind, filename, status, stats_json AS statsJson, created_at AS createdAt, rolled_back_at AS rolledBackAt FROM import_batches ORDER BY id DESC LIMIT 100',
  );
}
