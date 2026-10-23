// Builds a complete sample workspace by generating realistic retailer emails
// and running them through the real ingestion pipeline. Sample workspaces are
// separate database files flagged is_sample, so sample data can never mix
// with production metrics.

import { existsSync, mkdirSync } from 'node:fs';
import type { Carrier, RetailerId } from '../../shared/types';
import { now, type Db } from '../db/database';
import { processRawMessage } from '../email/process';
import { EventSink } from '../events';
import { createProfile, linkEmail, linkProfileAddress, setAddressOwner, upsertAddress, upsertEmail, upsertMember } from '../identity/store';
import { cacheProductImages } from '../products/images';
import { runAutomations } from '../automation/rules';
import { setMeta, updateSettings } from '../workspace';
import { sampleProductArt } from './art';
import { SAMPLE_IMAGE_HOST, SAMPLE_PRODUCTS, sampleImageUrl, type SampleProduct } from './catalog';
import { gmailForward } from './mime';
import { currencyFor, renderSampleEmail, type SampleAddress, type SampleEmailSpec, type SampleItem } from './retailerEmails';

export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T>(arr: readonly T[]) => arr[Math.floor(next() * arr.length)],
    chance: (p: number) => next() < p,
    weighted: <T>(items: readonly T[], w: (t: T) => number) => {
      const total = items.reduce((s, i) => s + w(i), 0);
      let r = next() * total;
      for (const i of items) {
        r -= w(i);
        if (r <= 0) return i;
      }
      return items[items.length - 1];
    },
    digits: (n: number) => Array.from({ length: n }, () => Math.floor(next() * 10)).join(''),
  };
}
type Rng = ReturnType<typeof rng>;

const FIRST = ['Jordan', 'Alex', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Jamie', 'Avery', 'Quinn', 'Drew', 'Skyler', 'Reese', 'Rowan', 'Emerson', 'Hayden', 'Parker', 'Logan', 'Cameron', 'Devon', 'Jesse', 'Kai', 'Marley', 'Sage', 'Blake', 'Elliot', 'Finley', 'Harper', 'Jules', 'Kendall', 'Lane'];
const LAST = ['Rivers', 'Nguyen', 'Patel', 'Garcia', 'Kim', 'Okafor', 'Silva', 'Novak', 'Haddad', 'Brennan', 'Castillo', 'Delgado', 'Fischer', 'Ito', 'Kowalski', 'Larsen', 'Moreau', 'Oyelaran', 'Petrov', 'Quintero', 'Sato', 'Tanaka', 'Vance', 'Whitaker', 'Yilmaz', 'Zhou', 'Abbott', 'Becker', 'Cho', 'Duarte'];
const HANDLE_A = ['Shiny', 'Pika', 'Holo', 'Volt', 'Mint', 'Ember', 'Frost', 'Nova', 'Drift', 'Echo', 'Rare', 'Prism', 'Lunar', 'Solar', 'Turbo', 'Ghost', 'Neon', 'Crystal'];
const HANDLE_B = ['Hunter', 'Slayer', 'Vault', 'Pull', 'Chase', 'Binder', 'Sleeve', 'Flip', 'Rip', 'Stack', 'Cook', 'Snipe', 'Grail', 'Booster', 'Trainer', 'Master'];
const STREETS = ['Maple Ridge', 'Cedar Hollow', 'Lakeview', 'Sunset', 'Willow Creek', 'Harbor Point', 'Juniper', 'Aspen Grove', 'Riverbend', 'Magnolia', 'Stonebridge', 'Briarwood', 'Copper Hill', 'Meadowlark', 'Foxglove'];
const SUFFIXES = ['Drive', 'Street', 'Avenue', 'Lane', 'Court', 'Road', 'Boulevard', 'Way', 'Place', 'Terrace'];
const CITIES: { city: string; state: string; zip: string }[] = [
  { city: 'Springfield', state: 'IL', zip: '627' }, { city: 'Columbus', state: 'OH', zip: '432' }, { city: 'Austin', state: 'TX', zip: '787' },
  { city: 'Denver', state: 'CO', zip: '802' }, { city: 'Raleigh', state: 'NC', zip: '276' }, { city: 'Portland', state: 'OR', zip: '972' },
  { city: 'Tampa', state: 'FL', zip: '336' }, { city: 'Phoenix', state: 'AZ', zip: '850' }, { city: 'Madison', state: 'WI', zip: '537' },
  { city: 'Boise', state: 'ID', zip: '837' }, { city: 'Richmond', state: 'VA', zip: '232' }, { city: 'Omaha', state: 'NE', zip: '681' },
];

const RETAILER_WEIGHTS: [RetailerId, number][] = [
  ['target', 30], ['walmart', 20], ['pokemoncenter_us', 18], ['amazon', 7], ['bestbuy', 6], ['costco', 4], ['samsclub', 4],
  ['pokemoncenter_uk', 4], ['pokemoncenter_ca', 4], ['pokemoncenter_de', 3],
];

function orderNumber(r: Rng, retailer: RetailerId, n: number): string {
  switch (retailer) {
    case 'target': return `9120${String(10000000000 + n * 7919).slice(-11)}`;
    case 'walmart': return `200${r.digits(4)}-${String(10000000 + n).slice(-8)}`;
    case 'amazon': return `11${r.int(1, 4)}-${r.digits(7)}-${String(1000000 + n).slice(-7)}`;
    case 'bestbuy': return `BBY01-806${String(100000000 + n).slice(-9)}`;
    case 'costco':
    case 'samsclub': return `${r.int(1, 9)}${String(100000000 + n).slice(-9)}`;
    default: return `P${String(100000000 + n * 13).slice(-9)}`;
  }
}

function upsCheck(body15: string): number {
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const c = body15[i];
    let v = /\d/.test(c) ? Number(c) : (c.charCodeAt(0) - 63) % 10;
    if (i % 2 === 1) v *= 2;
    sum += v;
  }
  return (10 - (sum % 10)) % 10;
}

function uspsCheck(body: string): number {
  const d = body.split('').reverse().map(Number);
  let s = 0;
  d.forEach((x, i) => (s += i % 2 === 0 ? x * 3 : x));
  return (10 - (s % 10)) % 10;
}

function fedexCheck(body11: string): number {
  const w = [1, 7, 3];
  const d = body11.split('').reverse().map(Number);
  let s = 0;
  d.forEach((x, i) => (s += x * w[i % 3]));
  return (s % 11) % 10;
}

function tracking(r: Rng, retailer: RetailerId): { number: string; carrier: Carrier } {
  if (retailer === 'pokemoncenter_uk') return { number: `RM${r.digits(9)}GB`, carrier: 'royalmail' };
  if (retailer === 'pokemoncenter_de') return { number: `JJD${r.digits(16)}`, carrier: 'dhl' };
  const c = r.weighted(['ups', 'usps', 'fedex'] as Carrier[], (x) => (x === 'ups' ? 5 : x === 'usps' ? 4 : 2));
  if (c === 'ups') {
    const body = `${r.pick(['A', 'E', 'W', 'X'])}${r.pick(['0', '1', '2', '3'])}${r.digits(1)}${r.pick(['A', 'E', 'Y'])}${r.pick(['A', 'Y'])}${r.digits(10)}`;
    return { number: `1Z${body}${upsCheck(body)}`, carrier: 'ups' };
  }
  if (c === 'usps') {
    const body = `9400${r.digits(17)}`;
    return { number: `${body}${uspsCheck(body)}`, carrier: 'usps' };
  }
  const body = r.digits(11);
  return { number: `${body}${fedexCheck(body)}`, carrier: 'fedex' };
}

function hashDigits(s: string, n: number): string {
  let h = 2166136261;
  let out = '';
  for (let i = 0; out.length < n; i++) {
    h ^= s.charCodeAt(i % s.length) + i;
    h = Math.imul(h, 16777619) >>> 0;
    out += String(h % 10);
  }
  return out;
}
const asin = (slug: string) => `B0${hashDigits(slug, 8)}`;
const upcFor = (slug: string) => `0820650${hashDigits(slug, 5)}`;

interface SampleProfile {
  memberId: number;
  name: string;
  email: string;
  address: SampleAddress;
}

export interface SampleOptions {
  orders?: number;
  days?: number;
  seed?: number;
  imageDir: string;
  now?: Date;
  onProgress?: (done: number, total: number, phase: string) => void;
}

export async function generateSampleWorkspace(db: Db, opts: SampleOptions) {
  const r = rng(opts.seed ?? 20271027);
  const nowDate = opts.now ?? new Date();
  const days = opts.days ?? 45;
  const totalOrders = opts.orders ?? 1000;
  // Illustrative FX rates so sample multi-currency orders roll up; editable in Settings.
  const settings = updateSettings(db, { fxRates: { GBP: 1.27, EUR: 1.08, CAD: 0.72 } });
  const sink = new EventSink();

  // Members, profiles, emails and addresses (as if imported from a profile CSV).
  const profiles: SampleProfile[] = [];
  const members: number[] = [];
  const usedHandles = new Set<string>();
  const sharedPool: SampleAddress[] = [];
  db.tx(() => {
    for (let i = 0; i < 64; i++) {
      let handle = `${r.pick(HANDLE_A)}${r.pick(HANDLE_B)}`;
      while (usedHandles.has(handle)) handle = `${handle}${r.int(1, 99)}`;
      usedHandles.add(handle);
      const discordId = `${r.int(1, 9)}${r.digits(17)}`;
      const memberId = upsertMember(db, { discordId, username: handle.toLowerCase(), displayName: handle }, 'sample').id;
      members.push(memberId);
      const catchAll = r.chance(0.35) ? `${handle.toLowerCase()}-drops.test` : null;
      const nProfiles = r.weighted([1, 2, 3, 4], (n) => [5, 4, 2, 1][n - 1]);
      const last = r.pick(LAST);
      for (let p = 0; p < nProfiles; p++) {
        const first = p === 0 ? r.pick(FIRST) : r.chance(0.6) ? r.pick(FIRST) : FIRST[(i + p) % FIRST.length];
        const name = `${first} ${p > 1 && r.chance(0.5) ? r.pick(LAST) : last}`;
        const city = r.pick(CITIES);
        let address: SampleAddress;
        if (sharedPool.length && r.chance(0.08)) address = { ...r.pick(sharedPool), name };
        else {
          address = {
            name,
            line1: `${r.int(100, 9899)} ${r.pick(STREETS)} ${r.pick(SUFFIXES)}`,
            line2: r.chance(0.3) ? `Apt ${r.int(1, 30)}${r.pick(['', 'A', 'B', 'C'])}` : undefined,
            city: city.city,
            state: city.state,
            postal: `${city.zip}${r.digits(2)}`,
          };
          if (r.chance(0.15)) sharedPool.push(address);
        }
        const email = catchAll ? `${first.toLowerCase()}${r.int(10, 999)}@${catchAll}` : `${first.toLowerCase()}.${last.toLowerCase()}${r.int(1, 99)}@gmail.com`;
        const verified = r.chance(0.88);
        const pid = createProfile(db, { name: `${handle} ${['Main', 'Alt', 'Backup', 'Family'][p]}`, firstName: first, lastName: name.split(' ')[1], memberId: verified ? memberId : null, phone: `555${r.digits(7)}`, source: verified ? 'import' : 'sample' }, 'sample');
        if (verified) {
          const eid = upsertEmail(db, email)!;
          linkEmail(db, eid, memberId, pid, 'verified', 'sample');
          const aid = upsertAddress(db, address);
          setAddressOwner(db, aid, memberId, 'verified', 'sample');
          linkProfileAddress(db, pid, aid);
        }
        profiles.push({ memberId, name, email, address });
      }
    }
    // Campaign signups for conversion analytics.
    const cid = db.run('INSERT INTO campaigns (name, starts_at, ends_at, retailer_ids_json, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      'Sample Drop Week', new Date(nowDate.getTime() - 14 * 86400000).toISOString(), nowDate.toISOString(), '[]', 'Sample campaign', now(),
    ]).lastId;
    for (const m of members) if (r.chance(0.8)) db.run('INSERT OR IGNORE INTO campaign_signups (campaign_id, member_id, signed_up_at) VALUES (?, ?, ?)', [cid, m, now()]);
  });

  const accounts = ['Cook Inbox Alpha', 'Cook Inbox Bravo', 'Forwarding Hub', 'Member Forwards'].map((label, i) =>
    db.run("INSERT INTO email_accounts (label, kind, address, auth_kind, status, created_at) VALUES (?, 'import', ?, 'none', 'idle', ?)", [label, `inbox${i + 1}@sample.test`, now()]).lastId,
  );

  // Drop days get most of the volume.
  const dropDays = new Set<number>();
  for (let d = 0; d < days; d++) if (d % 7 === 2 || d % 7 === 5 || r.chance(0.1)) dropDays.add(d);
  const start = nowDate.getTime() - days * 86400000;

  interface Planned { spec: SampleEmailSpec; account: number; forward: boolean }
  const planned: Planned[] = [];
  for (let n = 0; n < totalOrders; n++) {
    const dayIdx = r.chance(0.8) ? r.pick([...dropDays]) : r.int(0, days - 1);
    const hour = r.chance(0.7) ? r.pick([9, 10, 11, 12, 15]) : r.int(0, 23);
    const placed = new Date(start + dayIdx * 86400000 + hour * 3600000 + r.int(0, 3599) * 1000);
    if (placed > nowDate) continue;
    const retailer = r.weighted(RETAILER_WEIGHTS, ([, w]) => w)[0];
    const buyer = r.pick(profiles);
    const unknownEmail = r.chance(0.08);
    const newAddress = r.chance(0.04);
    const items: SampleItem[] = [];
    const nItems = r.weighted([1, 2, 3], (k) => [6, 3, 1][k - 1]);
    const chosen = new Set<SampleProduct>();
    while (chosen.size < nItems) chosen.add(r.weighted(SAMPLE_PRODUCTS, (p) => p.weight));
    const fx = currencyFor(retailer) === 'GBP' ? 0.82 : currencyFor(retailer) === 'EUR' ? 0.93 : currencyFor(retailer) === 'CAD' ? 1.37 : 1;
    for (const p of chosen) {
      items.push({ title: p.title, sku: retailer === 'amazon' ? asin(p.slug) : `${p.slug.slice(0, 18).toUpperCase()}`, upc: ['target', 'walmart', 'bestbuy'].includes(retailer) ? upcFor(p.slug) : undefined, qty: r.weighted([1, 2, 3, 4], (k) => [4, 4, 2, 1][k - 1]), unitCents: Math.round(p.priceCents * fx), imageUrl: sampleImageUrl(p) });
    }
    const sub = items.reduce((s, i) => s + i.qty * i.unitCents, 0);
    const address = newAddress
      ? { name: buyer.name, line1: `${r.int(100, 9899)} ${r.pick(STREETS)} ${r.pick(SUFFIXES)}`, city: r.pick(CITIES).city, state: r.pick(CITIES).state, postal: `${r.pick(CITIES).zip}${r.digits(2)}` }
      : r.chance(0.15)
        ? { ...buyer.address, line1: buyer.address.line1.replace(/Drive$/, 'Dr').replace(/Street$/, 'St').replace(/Avenue$/, 'Ave'), line2: buyer.address.line2?.replace('Apt ', '#') }
        : buyer.address;
    const intl = retailer === 'pokemoncenter_uk'
      ? { ...address, city: 'London', state: '', postal: `SW${r.int(1, 20)} ${r.int(1, 9)}AA`, country: 'United Kingdom' }
      : retailer === 'pokemoncenter_de'
        ? { ...address, line1: `Hauptstraße ${r.int(1, 120)}`, line2: undefined, city: 'Berlin', state: '', postal: `10${r.digits(3)}`, country: 'Germany' }
        : retailer === 'pokemoncenter_ca'
          ? { ...address, city: 'Toronto', state: 'ON', postal: `M5V ${r.int(1, 9)}A${r.int(1, 9)}`, country: 'Canada' }
          : address;
    const base: SampleEmailSpec = {
      retailer,
      type: 'order_confirmation',
      orderNumber: orderNumber(r, retailer, n + 1),
      date: placed,
      to: unknownEmail ? `${buyer.name.split(' ')[0].toLowerCase()}.${r.digits(4)}@gmail.com` : buyer.email,
      items: [...items],
      address: intl,
      taxCents: Math.round(sub * (retailer.startsWith('pokemoncenter_uk') || retailer === 'pokemoncenter_de' ? 0 : 0.0825)),
      shippingCents: sub > 3500 ? 0 : 599,
      discountCents: retailer === 'target' && r.chance(0.2) ? Math.round(sub * 0.05) : undefined,
    };
    const account = r.pick(accounts.slice(0, 2));
    planned.push({ spec: base, account, forward: r.chance(0.07) });

    // Lifecycle
    const t = (h: number) => new Date(placed.getTime() + h * 3600000);
    const ageH = (nowDate.getTime() - placed.getTime()) / 3600000;
    const roll = r.next();
    const push = (spec: Partial<SampleEmailSpec>, atH: number) => {
      if (atH >= ageH) return false;
      planned.push({ spec: { ...base, ...spec, date: t(atH) }, account, forward: false });
      return true;
    };
    const holdFirst = r.chance(0.06);
    if (holdFirst) push({ type: 'review_hold' }, r.int(1, 6));
    if (roll < (holdFirst ? 0.45 : 0.16)) {
      push({ type: 'cancellation' }, r.int(6, 40));
      if (r.chance(0.5)) push({ type: 'refund', refundCents: sub + base.taxCents + base.shippingCents - (base.discountCents ?? 0) }, r.int(48, 96));
      continue;
    }
    if (items.length > 1 && r.chance(0.12)) {
      const cancelIdx = r.int(0, items.length - 1);
      if (push({ type: 'partial_cancellation', items: items.map((it, i) => ({ ...it, canceled: i === cancelIdx })) }, r.int(4, 30))) items.splice(cancelIdx, 1);
    }
    const shipH = r.int(20, 80);
    const pkgs = items.length > 1 && r.chance(0.3) ? [tracking(r, retailer), tracking(r, retailer)] : [tracking(r, retailer)];
    push({ type: 'shipping', tracking: pkgs, items, estDelivery: t(shipH + r.int(48, 120)) }, shipH);
    const ofdH = shipH + r.int(40, 110);
    if (r.chance(0.6)) push({ type: 'out_for_delivery', tracking: pkgs, items }, ofdH);
    if (r.chance(0.97)) push({ type: 'delivery', tracking: pkgs, items }, ofdH + r.int(2, 9));
  }

  planned.sort((a, b) => a.spec.date.getTime() - b.spec.date.getTime());
  const total = planned.length;
  let done = 0;
  for (const p of planned) {
    const rendered = renderSampleEmail(p.spec);
    await processRawMessage({ db, settings, sink }, Buffer.from(rendered.raw), { kind: 'import', accountId: p.account, importRef: `sample:${done}` }, p.spec.date.toISOString());
    if (p.forward) {
      const fwd = gmailForward({ fromName: rendered.fromName, from: rendered.from, to: p.spec.to, subject: rendered.subject, date: p.spec.date, html: rendered.html }, p.spec.to, 'hub@sample.test', new Date(p.spec.date.getTime() + 600000));
      await processRawMessage({ db, settings, sink }, Buffer.from(fwd), { kind: 'import', accountId: accounts[2], importRef: `sample-fwd:${done}` }, new Date(p.spec.date.getTime() + 600000).toISOString());
    }
    done++;
    if (done % 50 === 0) opts.onProgress?.(done, total, 'Processing sample emails');
  }

  // Sample art goes through the real image cache, served from generated SVGs.
  if (!existsSync(opts.imageDir)) mkdirSync(opts.imageDir, { recursive: true });
  const bySlug = new Map(SAMPLE_PRODUCTS.map((p) => [sampleImageUrl(p), p]));
  let cached = 1;
  while (cached > 0) {
    cached = await cacheProductImages(db, opts.imageDir, async (url) => {
      const p = url.startsWith(SAMPLE_IMAGE_HOST) ? bySlug.get(url) : undefined;
      return p ? { data: Buffer.from(sampleProductArt(p)), contentType: 'image/svg+xml' } : null;
    }, 200);
  }
  db.run("UPDATE email_accounts SET last_sync_at = ?, status = 'connected', processed_count = (SELECT COUNT(*) FROM source_messages s WHERE s.account_id = email_accounts.id)", [now()]);
  await runAutomations(db, sink.events, settings);
  setMeta(db, 'setup_complete', '1');
  opts.onProgress?.(total, total, 'Done');
  return { messages: total, orders: db.value<number>('SELECT COUNT(*) FROM orders') ?? 0 };
}
