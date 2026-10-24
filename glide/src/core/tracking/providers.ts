// Carrier tracking through official carrier APIs. Each provider needs the
// user's own developer credentials (configured in Settings → Shipping).
// Without credentials, packages are tracked from shipping emails only and the
// UI shows when each status was last verified. Nothing here invents events.
//
// Endpoint shapes follow each carrier's public developer documentation; they
// must be validated with live credentials before relying on them.

import type { Carrier, PackageStatus } from '../../shared/types';
import { now, type Db } from '../db/database';
import { EventSink } from '../events';
import { addTrackingEvent } from '../orders/ingest';
import { recomputeOrder } from '../orders/state';
import { statusFromText } from './carriers';

export interface TrackingEvent {
  status: PackageStatus;
  description: string;
  location: string | null;
  occurredAt: string;
}

export interface TrackingResult {
  trackingNumber: string;
  events: TrackingEvent[];
  estimatedDelivery?: string;
}

export interface ProviderCredentials {
  clientId?: string;
  clientSecret?: string;
  apiKey?: string;
  accountNumber?: string;
}

type Fetch = typeof fetch;

export interface TrackingProvider {
  id: string;
  name: string;
  carriers: Carrier[];
  track(numbers: string[], creds: ProviderCredentials, fetcher?: Fetch): Promise<TrackingResult[]>;
}

async function oauthClientCredentials(url: string, creds: ProviderCredentials, fetcher: Fetch, extraBody = '', basic = true): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  let body = `grant_type=client_credentials${extraBody}`;
  if (basic) headers.Authorization = `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`;
  else body += `&client_id=${encodeURIComponent(creds.clientId ?? '')}&client_secret=${encodeURIComponent(creds.clientSecret ?? '')}`;
  const res = await fetcher(url, { method: 'POST', headers, body });
  const j = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || !j.access_token) throw new Error(`carrier auth failed (${res.status})`);
  return j.access_token;
}

const iso = (d: string | undefined, t?: string) => {
  if (!d) return now();
  // UPS dates are YYYYMMDD + HHMMSS.
  if (/^\d{8}$/.test(d)) {
    const tt = (t ?? '000000').padEnd(6, '0');
    return new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${tt.slice(0, 2)}:${tt.slice(2, 4)}:${tt.slice(4, 6)}`).toISOString();
  }
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? now() : x.toISOString();
};

export const UPS: TrackingProvider = {
  id: 'ups',
  name: 'UPS Tracking API',
  carriers: ['ups'],
  async track(numbers, creds, fetcher = fetch) {
    const token = await oauthClientCredentials('https://onlinetools.ups.com/security/v1/oauth/token', creds, fetcher);
    const out: TrackingResult[] = [];
    for (const n of numbers) {
      const res = await fetcher(`https://onlinetools.ups.com/api/track/v1/details/${encodeURIComponent(n)}?locale=en_US`, {
        headers: { Authorization: `Bearer ${token}`, transId: `glide-${Date.now()}`, transactionSrc: 'glide' },
      });
      if (!res.ok) continue;
      const j = (await res.json()) as any;
      const pkg = j?.trackResponse?.shipment?.[0]?.package?.[0];
      if (!pkg) continue;
      out.push({
        trackingNumber: n,
        estimatedDelivery: pkg.deliveryDate?.[0]?.date ? iso(pkg.deliveryDate[0].date) : undefined,
        events: (pkg.activity ?? []).map((a: any) => ({
          status: statusFromText(`${a.status?.description ?? ''} ${a.status?.type === 'D' ? 'delivered' : ''}`),
          description: a.status?.description ?? 'Update',
          location: [a.location?.address?.city, a.location?.address?.stateProvince].filter(Boolean).join(', ') || null,
          occurredAt: iso(a.date, a.time),
        })),
      });
    }
    return out;
  },
};

export const FEDEX: TrackingProvider = {
  id: 'fedex',
  name: 'FedEx Track API',
  carriers: ['fedex'],
  async track(numbers, creds, fetcher = fetch) {
    const token = await oauthClientCredentials('https://apis.fedex.com/oauth/token', creds, fetcher, '', false);
    const res = await fetcher('https://apis.fedex.com/track/v1/trackingnumbers', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-locale': 'en_US' },
      body: JSON.stringify({ includeDetailedScans: true, trackingInfo: numbers.slice(0, 30).map((n) => ({ trackingNumberInfo: { trackingNumber: n } })) }),
    });
    if (!res.ok) throw new Error(`FedEx track failed (${res.status})`);
    const j = (await res.json()) as any;
    return (j?.output?.completeTrackResults ?? []).map((r: any) => {
      const t = r.trackResults?.[0] ?? {};
      return {
        trackingNumber: r.trackingNumber,
        estimatedDelivery: t.estimatedDeliveryTimeWindow?.window?.ends ?? undefined,
        events: (t.scanEvents ?? []).map((e: any) => ({
          status: statusFromText(`${e.eventDescription ?? ''} ${e.eventType === 'DL' ? 'delivered' : e.eventType === 'OD' ? 'out for delivery' : ''}`),
          description: e.eventDescription ?? 'Update',
          location: [e.scanLocation?.city, e.scanLocation?.stateOrProvinceCode].filter(Boolean).join(', ') || null,
          occurredAt: iso(e.date),
        })),
      };
    });
  },
};

export const USPS: TrackingProvider = {
  id: 'usps',
  name: 'USPS Tracking API (v3)',
  carriers: ['usps'],
  async track(numbers, creds, fetcher = fetch) {
    const res = await fetcher('https://apis.usps.com/oauth2/v3/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', client_id: creds.clientId, client_secret: creds.clientSecret }),
    });
    const tok = (await res.json()) as { access_token?: string };
    if (!res.ok || !tok.access_token) throw new Error(`USPS auth failed (${res.status})`);
    const out: TrackingResult[] = [];
    for (const n of numbers) {
      const r = await fetcher(`https://apis.usps.com/tracking/v3/tracking/${encodeURIComponent(n)}?expand=DETAIL`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
      if (!r.ok) continue;
      const j = (await r.json()) as any;
      out.push({
        trackingNumber: n,
        estimatedDelivery: j.expectedDeliveryTimeStamp ?? undefined,
        events: (j.trackingEvents ?? []).map((e: any) => ({
          status: statusFromText(e.eventType ?? ''),
          description: e.eventType ?? 'Update',
          location: [e.eventCity, e.eventState].filter(Boolean).join(', ') || null,
          occurredAt: iso(e.eventTimestamp),
        })),
      });
    }
    return out;
  },
};

export const DHL: TrackingProvider = {
  id: 'dhl',
  name: 'DHL Shipment Tracking – Unified',
  carriers: ['dhl'],
  async track(numbers, creds, fetcher = fetch) {
    const out: TrackingResult[] = [];
    for (const n of numbers) {
      const r = await fetcher(`https://api-eu.dhl.com/track/shipments?trackingNumber=${encodeURIComponent(n)}`, { headers: { 'DHL-API-Key': creds.apiKey ?? '' } });
      if (!r.ok) continue;
      const j = (await r.json()) as any;
      const s = j?.shipments?.[0];
      if (!s) continue;
      out.push({
        trackingNumber: n,
        estimatedDelivery: s.estimatedTimeOfDelivery ?? undefined,
        events: (s.events ?? []).map((e: any) => ({
          status: statusFromText(`${e.statusCode ?? ''} ${e.description ?? e.status ?? ''}`),
          description: e.description ?? e.status ?? 'Update',
          location: e.location?.address?.addressLocality ?? null,
          occurredAt: iso(e.timestamp),
        })),
      });
    }
    return out;
  },
};

const STAGE: Record<string, PackageStatus> = {
  InfoReceived: 'label_created', PickedUp: 'in_transit', Departure: 'in_transit', Arrival: 'in_transit', InTransit: 'in_transit',
  AvailableForPickup: 'out_for_delivery', OutForDelivery: 'out_for_delivery', Delivered: 'delivered', DeliveryFailure: 'exception',
  Exception: 'exception', Returning: 'returned', Returned: 'returned', Expired: 'exception',
};

/**
 * 17TRACK: one API key tracks every carrier (UPS, FedEx, USPS, Amazon Logistics, OnTrac, DHL…).
 * Numbers must be registered once before their info can be read; re-registering is harmless.
 */
export const SEVENTEEN_TRACK: TrackingProvider = {
  id: '17track',
  name: '17TRACK (all carriers, one API key)',
  carriers: ['ups', 'fedex', 'usps', 'dhl', 'ontrac', 'lasership', 'amazon', 'royalmail', 'canadapost', 'other'],
  async track(numbers, creds, fetcher = fetch) {
    const headers = { '17token': creds.apiKey ?? '', 'Content-Type': 'application/json' };
    const out: TrackingResult[] = [];
    for (let i = 0; i < numbers.length; i += 40) {
      const body = JSON.stringify(numbers.slice(i, i + 40).map((number) => ({ number })));
      const reg = await fetcher('https://api.17track.net/track/v2.2/register', { method: 'POST', headers, body });
      if (reg.status === 401 || reg.status === 403) throw new Error(`17TRACK rejected the API key (${reg.status})`);
      const res = await fetcher('https://api.17track.net/track/v2.2/gettrackinfo', { method: 'POST', headers, body });
      if (!res.ok) throw new Error(`17TRACK track failed (${res.status})`);
      const j = (await res.json()) as any;
      for (const a of j?.data?.accepted ?? []) {
        const info = a.track_info ?? {};
        const events = (info.tracking?.providers ?? []).flatMap((p: any) => p.events ?? []);
        const latest = info.latest_status?.status as string | undefined;
        out.push({
          trackingNumber: a.number,
          estimatedDelivery: info.time_metrics?.estimated_delivery_date?.to ?? info.time_metrics?.estimated_delivery_date?.from ?? undefined,
          events: events.length
            ? events.map((e: any) => {
                const fromText = statusFromText(e.description ?? '');
                return {
                  status: fromText !== 'unknown' ? fromText : STAGE[e.stage ?? e.sub_status?.split('_')[0] ?? ''] ?? 'in_transit',
                  description: e.description ?? 'Update',
                  location: e.location || null,
                  occurredAt: iso(e.time_utc ?? e.time_iso),
                };
              })
            : latest && STAGE[latest]
              ? [{ status: STAGE[latest], description: latest.replace(/([a-z])([A-Z])/g, '$1 $2'), location: null, occurredAt: iso(info.latest_event?.time_utc ?? info.latest_event?.time_iso) }]
              : [],
        });
      }
    }
    return out;
  },
};

export const PROVIDERS: TrackingProvider[] = [UPS, FEDEX, USPS, DHL, SEVENTEEN_TRACK];

/** The carrier's own API when configured, otherwise 17TRACK when it has a key. */
export function providerFor(carrier: string, hasCreds: (id: string) => boolean): TrackingProvider | undefined {
  return PROVIDERS.find((x) => x.id !== SEVENTEEN_TRACK.id && x.carriers.includes(carrier as Carrier) && hasCreds(x.id)) ?? (hasCreds(SEVENTEEN_TRACK.id) ? SEVENTEEN_TRACK : undefined);
}

export interface RefreshDeps {
  db: Db;
  credentialsFor: (providerId: string) => ProviderCredentials | null;
  fetcher?: Fetch;
  sink?: EventSink;
  limit?: number;
}

/** Polls configured carrier APIs for packages that are due. Returns the number of packages updated. */
export async function refreshDuePackages(deps: RefreshDeps): Promise<{ checked: number; updated: number; skipped: number }> {
  const { db } = deps;
  const sink = deps.sink ?? new EventSink();
  const due = db.all<{ id: number; order_id: number; tracking_number: string; carrier: string; check_failures: number }>(
    "SELECT id, order_id, tracking_number, carrier, check_failures FROM packages WHERE status NOT IN ('delivered','returned') AND (next_check_at IS NULL OR next_check_at <= ?) ORDER BY next_check_at LIMIT ?",
    [now(), deps.limit ?? 40],
  );
  let checked = 0;
  let updated = 0;
  let skipped = 0;
  const byProvider = new Map<TrackingProvider, typeof due>();
  for (const p of due) {
    const prov = providerFor(p.carrier, (id) => !!deps.credentialsFor(id));
    if (!prov) {
      skipped++;
      continue;
    }
    byProvider.set(prov, [...(byProvider.get(prov) ?? []), p]);
  }
  for (const [prov, pkgs] of byProvider) {
    let results: TrackingResult[] = [];
    try {
      results = await prov.track(pkgs.map((p) => p.tracking_number), deps.credentialsFor(prov.id)!, deps.fetcher);
    } catch {
      for (const p of pkgs) {
        const backoff = Math.min(24, 2 ** (p.check_failures + 1));
        db.run('UPDATE packages SET check_failures = check_failures + 1, next_check_at = ? WHERE id = ?', [new Date(Date.now() + backoff * 3600000).toISOString(), p.id]);
      }
      continue;
    }
    for (const p of pkgs) {
      checked++;
      const r = results.find((x) => x.trackingNumber.toUpperCase() === p.tracking_number.toUpperCase());
      db.tx(() => {
        let changed = false;
        for (const e of r?.events ?? []) {
          if (addTrackingEvent(db, p.id, e.status, e.description, e.occurredAt, 'carrier_api', e.location)) {
            changed = true;
            if (e.status === 'delivered') sink.push({ kind: 'delivered', key: `del:${p.id}`, orderId: p.order_id, packageId: p.id, at: e.occurredAt });
            if (e.status === 'out_for_delivery') sink.push({ kind: 'out_for_delivery', key: `ofd:${p.id}`, orderId: p.order_id, packageId: p.id, at: e.occurredAt });
          }
        }
        const status = db.value<string>('SELECT status FROM packages WHERE id = ?', [p.id]);
        if (status === 'delivered') db.run('UPDATE order_items SET delivered_qty = MAX(delivered_qty, shipped_qty) WHERE order_id = ? AND (SELECT COUNT(*) FROM packages WHERE order_id = ? AND status <> ?) = 0', [p.order_id, p.order_id, 'delivered']);
        // Out-for-delivery packages are re-checked hourly so "delivered" shows up the same day.
        const nextIn = status === 'out_for_delivery' ? 1 : 3;
        db.run('UPDATE packages SET last_verified_at = ?, check_failures = 0, next_check_at = ?, estimated_delivery = COALESCE(?, estimated_delivery) WHERE id = ?', [now(), new Date(Date.now() + nextIn * 3600000).toISOString(), r?.estimatedDelivery ?? null, p.id]);
        if (changed) {
          recomputeOrder(db, p.order_id);
          updated++;
        }
      });
    }
  }
  return { checked, updated, skipped };
}
