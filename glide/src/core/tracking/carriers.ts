import type { Carrier, PackageStatus } from '../../shared/types';

export interface CarrierMeta {
  id: Carrier;
  name: string;
  url: (n: string) => string | null;
}

export const CARRIERS: Record<Carrier, CarrierMeta> = {
  ups: { id: 'ups', name: 'UPS', url: (n) => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}` },
  fedex: { id: 'fedex', name: 'FedEx', url: (n) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}` },
  usps: { id: 'usps', name: 'USPS', url: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(n)}` },
  dhl: { id: 'dhl', name: 'DHL', url: (n) => `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${encodeURIComponent(n)}` },
  ontrac: { id: 'ontrac', name: 'OnTrac', url: (n) => `https://www.ontrac.com/tracking/?number=${encodeURIComponent(n)}` },
  lasership: { id: 'lasership', name: 'LaserShip', url: (n) => `https://www.ontrac.com/tracking/?number=${encodeURIComponent(n)}` },
  amazon: { id: 'amazon', name: 'Amazon Logistics', url: (n) => `https://track.amazon.com/tracking/${encodeURIComponent(n)}` },
  royalmail: { id: 'royalmail', name: 'Royal Mail', url: (n) => `https://www.royalmail.com/track-your-item#/tracking-results/${encodeURIComponent(n)}` },
  canadapost: { id: 'canadapost', name: 'Canada Post', url: (n) => `https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=${encodeURIComponent(n)}` },
  other: { id: 'other', name: 'Carrier', url: () => null },
};

export function carrierName(c: string): string {
  return CARRIERS[c as Carrier]?.name ?? c.toUpperCase();
}

export function trackingUrl(carrier: Carrier, n: string): string | null {
  return CARRIERS[carrier]?.url(n) ?? null;
}

/** UPS 1Z check digit (mod 10 over the 15 characters after "1Z"). */
export function validUps(n: string): boolean {
  if (!/^1Z[0-9A-Z]{16}$/.test(n)) return false;
  const body = n.slice(2, 17);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    let v = /\d/.test(c) ? Number(c) : (c.charCodeAt(0) - 63) % 10;
    if (i % 2 === 1) v *= 2;
    sum += v;
  }
  return (10 - (sum % 10)) % 10 === Number(n[17]);
}

/** USPS IMpb (20/22 digit) mod-10 check digit. */
export function validUspsImpb(n: string): boolean {
  if (!/^\d{20,22}$/.test(n)) return false;
  const digits = n.slice(0, -1).split('').reverse().map(Number);
  let sum = 0;
  digits.forEach((d, i) => (sum += i % 2 === 0 ? d * 3 : d));
  return (10 - (sum % 10)) % 10 === Number(n[n.length - 1]);
}

/** FedEx 12-digit Express check digit (weights 1,7,3 from the right of the first 11). */
export function validFedex12(n: string): boolean {
  if (!/^\d{12}$/.test(n)) return false;
  const weights = [1, 7, 3];
  const body = n.slice(0, 11).split('').reverse().map(Number);
  let sum = 0;
  body.forEach((d, i) => (sum += d * weights[i % 3]));
  return (sum % 11) % 10 === Number(n[11]);
}

export interface DetectedTracking {
  number: string;
  carrier: Carrier;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Classifies a candidate tracking number. `hint` is a carrier name seen near
 * the number in the email (e.g. "UPS", "FedEx").
 */
export function classifyTracking(raw: string, hint?: Carrier): DetectedTracking | null {
  const n = raw.replace(/[\s-]/g, '').toUpperCase();
  if (/^1Z[0-9A-Z]{16}$/.test(n)) return { number: n, carrier: 'ups', confidence: validUps(n) ? 'high' : 'medium' };
  if (/^TBA\d{12}$/.test(n)) return { number: n, carrier: 'amazon', confidence: 'high' };
  if (/^1LS\d{12,15}$/.test(n) || /^L[A-Z]\d{8}$/.test(n)) return { number: n, carrier: 'lasership', confidence: 'medium' };
  if (/^[CD]\d{14}$/.test(n)) return { number: n, carrier: 'ontrac', confidence: 'medium' };
  if (/^[A-Z]{2}\d{9}GB$/.test(n)) return { number: n, carrier: 'royalmail', confidence: 'high' };
  if (/^[A-Z]{2}\d{9}CA$/.test(n)) return { number: n, carrier: 'canadapost', confidence: 'high' };
  if (/^[A-Z]{2}\d{9}US$/.test(n)) return { number: n, carrier: 'usps', confidence: 'high' };
  if (/^(JJD|JVGL|GM)\d{10,20}$/.test(n)) return { number: n, carrier: 'dhl', confidence: 'medium' };
  if (/^9[1-5]\d{18,20}$/.test(n)) {
    if (hint === 'fedex') return { number: n, carrier: 'fedex', confidence: 'medium' };
    return { number: n, carrier: 'usps', confidence: validUspsImpb(n) ? 'high' : 'medium' };
  }
  if (/^\d{20}$/.test(n) && hint === 'usps') return { number: n, carrier: 'usps', confidence: 'medium' };
  if (/^\d{16}$/.test(n) && hint === 'canadapost') return { number: n, carrier: 'canadapost', confidence: 'medium' };
  if (/^\d{12}$/.test(n)) {
    if (hint && hint !== 'fedex') return { number: n, carrier: hint, confidence: 'low' };
    return { number: n, carrier: 'fedex', confidence: validFedex12(n) ? 'high' : hint === 'fedex' ? 'medium' : 'low' };
  }
  if (/^\d{15}$/.test(n) || /^\d{20}$/.test(n) || /^\d{22}$/.test(n)) {
    if (hint) return { number: n, carrier: hint, confidence: 'medium' };
    return { number: n, carrier: 'fedex', confidence: 'low' };
  }
  if (/^\d{10,11}$/.test(n) && hint === 'dhl') return { number: n, carrier: 'dhl', confidence: 'medium' };
  if (hint && /^[A-Z0-9]{8,30}$/.test(n) && /\d{6,}/.test(n)) return { number: n, carrier: hint, confidence: 'low' };
  return null;
}

export function carrierHint(text: string): Carrier | undefined {
  const t = text.toLowerCase();
  if (/\bups\b|united parcel/.test(t)) return 'ups';
  if (/fed\s?ex/.test(t)) return 'fedex';
  if (/\busps\b|postal service/.test(t)) return 'usps';
  if (/\bdhl\b/.test(t)) return 'dhl';
  if (/ontrac/.test(t)) return 'ontrac';
  if (/lasership/.test(t)) return 'lasership';
  if (/royal mail/.test(t)) return 'royalmail';
  if (/canada post|postes canada/.test(t)) return 'canadapost';
  if (/amazon logistics/.test(t)) return 'amazon';
  return undefined;
}

/** Extracts tracking numbers from carrier tracking links. */
export function trackingFromUrl(url: string): DetectedTracking | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const q = (k: string) => u.searchParams.get(k);
  let carrier: Carrier | undefined;
  let num: string | null = null;
  if (host.endsWith('ups.com')) {
    carrier = 'ups';
    num = q('tracknum') ?? q('trackNums') ?? q('InquiryNumber1') ?? u.pathname.match(/1Z[0-9A-Z]{16}/i)?.[0] ?? null;
  } else if (host.endsWith('fedex.com')) {
    carrier = 'fedex';
    num = q('trknbr') ?? q('tracknumbers') ?? q('tracknumber') ?? null;
  } else if (host.endsWith('usps.com')) {
    carrier = 'usps';
    num = q('tLabels') ?? q('qtc_tLabels1') ?? null;
  } else if (host.endsWith('dhl.com') || host.endsWith('dhl.de')) {
    carrier = 'dhl';
    num = q('tracking-id') ?? q('AWB') ?? q('piececode') ?? null;
  } else if (host.endsWith('ontrac.com')) {
    carrier = 'ontrac';
    num = q('number') ?? q('tracking') ?? null;
  } else if (host.endsWith('royalmail.com')) {
    carrier = 'royalmail';
    num = url.match(/[A-Z]{2}\d{9}GB/)?.[0] ?? null;
  }
  if (!carrier || !num) return null;
  const first = num.split(',')[0].trim();
  return classifyTracking(first, carrier) ?? { number: first.toUpperCase(), carrier, confidence: 'medium' };
}

const STATUS_ORDER: PackageStatus[] = ['unknown', 'label_created', 'in_transit', 'delayed', 'exception', 'out_for_delivery', 'delivered', 'returned'];

export function packageStatusRank(s: PackageStatus): number {
  return STATUS_ORDER.indexOf(s);
}

/** Maps carrier/plain-language text to a normalized package status. */
export function statusFromText(text: string): PackageStatus {
  const t = text.toLowerCase();
  if (/return(ed)? to sender|returning to sender/.test(t)) return 'returned';
  if (/\bdelivered\b|zugestellt|livr[ée]/.test(t) && !/not delivered|undeliverable|attempted|will be delivered|to be delivered|out for delivery/.test(t)) return 'delivered';
  if (/out for delivery|in zustellung|en cours de livraison/.test(t)) return 'out_for_delivery';
  if (/exception|undeliverable|attempted|damaged|lost|address issue|action required/.test(t)) return 'exception';
  if (/delay|running late|weather|rescheduled/.test(t)) return 'delayed';
  if (/in transit|on (its|the) way|departed|arrived|shipped|picked up|processed|accepted|unterwegs|en route/.test(t)) return 'in_transit';
  if (/label created|shipping label|pre-shipment|information received|awaiting item/.test(t)) return 'label_created';
  return 'unknown';
}
