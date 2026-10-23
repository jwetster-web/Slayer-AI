import { createHash } from 'node:crypto';
import type { ParsedAddress } from '../../shared/types';

// ---------------------------------------------------------------------------
// Address normalization. Deterministic USPS-style rules so the same physical
// address written different ways produces the same canonical key, while
// different units in the same building stay distinct.

const SUFFIX: Record<string, string> = {
  ALLEY: 'ALY', ANNEX: 'ANX', AVENUE: 'AVE', AV: 'AVE', AVEN: 'AVE', BAYOU: 'BYU', BEACH: 'BCH', BEND: 'BND',
  BLUFF: 'BLF', BOULEVARD: 'BLVD', BOUL: 'BLVD', BRANCH: 'BR', BRIDGE: 'BRG', BROOK: 'BRK', BYPASS: 'BYP',
  CAUSEWAY: 'CSWY', CENTER: 'CTR', CENTRE: 'CTR', CIRCLE: 'CIR', CIRC: 'CIR', CLIFF: 'CLF', CLUB: 'CLB',
  COMMON: 'CMN', CORNER: 'COR', COURSE: 'CRSE', COURT: 'CT', COVE: 'CV', CREEK: 'CRK', CRESCENT: 'CRES',
  CROSSING: 'XING', DRIVE: 'DR', DRV: 'DR', ESTATE: 'EST', ESTATES: 'ESTS', EXPRESSWAY: 'EXPY', EXTENSION: 'EXT',
  FALLS: 'FLS', FERRY: 'FRY', FIELD: 'FLD', FIELDS: 'FLDS', FLAT: 'FLT', FORD: 'FRD', FOREST: 'FRST', FORGE: 'FRG',
  FORK: 'FRK', FORT: 'FT', FREEWAY: 'FWY', GARDEN: 'GDN', GARDENS: 'GDNS', GATEWAY: 'GTWY', GLEN: 'GLN',
  GREEN: 'GRN', GROVE: 'GRV', HARBOR: 'HBR', HAVEN: 'HVN', HEIGHTS: 'HTS', HIGHWAY: 'HWY', HILL: 'HL', HILLS: 'HLS',
  HOLLOW: 'HOLW', ISLAND: 'IS', JUNCTION: 'JCT', KEY: 'KY', KNOLL: 'KNL', LAKE: 'LK', LAKES: 'LKS', LANDING: 'LNDG',
  LANE: 'LN', LIGHT: 'LGT', LOOP: 'LOOP', MANOR: 'MNR', MEADOW: 'MDW', MEADOWS: 'MDWS', MILL: 'ML', MISSION: 'MSN',
  MOUNT: 'MT', MOUNTAIN: 'MTN', ORCHARD: 'ORCH', OVAL: 'OVAL', PARK: 'PARK', PARKWAY: 'PKWY', PKY: 'PKWY',
  PASS: 'PASS', PATH: 'PATH', PIKE: 'PIKE', PINE: 'PNE', PINES: 'PNES', PLACE: 'PL', PLAIN: 'PLN', PLAINS: 'PLNS',
  PLAZA: 'PLZ', POINT: 'PT', POINTE: 'PT', PORT: 'PRT', PRAIRIE: 'PR', RANCH: 'RNCH', RIDGE: 'RDG', RIVER: 'RIV',
  ROAD: 'RD', ROUTE: 'RTE', ROW: 'ROW', RUN: 'RUN', SHORE: 'SHR', SHORES: 'SHRS', SPRING: 'SPG', SPRINGS: 'SPGS',
  SQUARE: 'SQ', STATION: 'STA', STREET: 'ST', STR: 'ST', STRT: 'ST', SUMMIT: 'SMT', TERRACE: 'TER', TRACE: 'TRCE',
  TRAIL: 'TRL', TURNPIKE: 'TPKE', UNION: 'UN', VALLEY: 'VLY', VIEW: 'VW', VILLAGE: 'VLG', VILLE: 'VL', VISTA: 'VIS',
  WALK: 'WALK', WAY: 'WAY', WELLS: 'WLS',
};

const DIRECTION: Record<string, string> = {
  NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW',
};

const UNIT_DESIGNATORS = [
  'APARTMENT', 'APT', 'SUITE', 'STE', 'UNIT', 'BUILDING', 'BLDG', 'FLOOR', 'FL', 'ROOM', 'RM', 'DEPARTMENT', 'DEPT',
  'LOT', 'SPACE', 'SPC', 'TRAILER', 'TRLR', 'HANGAR', 'HNGR', 'PIER', 'SLIP', 'BOX', 'NO',
];

const STATES: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA', COLORADO: 'CO', CONNECTICUT: 'CT',
  DELAWARE: 'DE', 'DISTRICT OF COLUMBIA': 'DC', FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL',
  INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD',
  MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN', MISSISSIPPI: 'MS', MISSOURI: 'MO', MONTANA: 'MT',
  NEBRASKA: 'NE', NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR', PENNSYLVANIA: 'PA',
  'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT',
  VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV', WISCONSIN: 'WI', WYOMING: 'WY',
  'PUERTO RICO': 'PR', GUAM: 'GU', ONTARIO: 'ON', QUEBEC: 'QC', 'BRITISH COLUMBIA': 'BC', ALBERTA: 'AB',
  MANITOBA: 'MB', SASKATCHEWAN: 'SK', 'NOVA SCOTIA': 'NS', 'NEW BRUNSWICK': 'NB', 'NEWFOUNDLAND AND LABRADOR': 'NL',
  'PRINCE EDWARD ISLAND': 'PE',
};

const COUNTRY_ALIASES: Record<string, string> = {
  US: 'US', USA: 'US', 'UNITED STATES': 'US', 'UNITED STATES OF AMERICA': 'US', AMERICA: 'US',
  UK: 'GB', GB: 'GB', 'UNITED KINGDOM': 'GB', ENGLAND: 'GB', SCOTLAND: 'GB', WALES: 'GB', 'GREAT BRITAIN': 'GB',
  CA: 'CA', CANADA: 'CA', DE: 'DE', GERMANY: 'DE', DEUTSCHLAND: 'DE',
};

export interface NormalizedAddress {
  canonicalKey: string;
  streetKey: string;
  line1: string;
  line2: string | null;
  unit: string | null;
  city: string;
  state: string | null;
  postal: string;
  country: string;
}

const clean = (s: string | undefined | null) =>
  (s ?? '')
    .toUpperCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,;:'"`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function detectCountry(country: string | undefined, postal: string): string {
  const c = clean(country);
  if (c && COUNTRY_ALIASES[c]) return COUNTRY_ALIASES[c];
  if (c.length === 2) return c;
  const p = postal.toUpperCase().replace(/\s+/g, '');
  if (/^\d{5}(-?\d{4})?$/.test(p)) return 'US';
  if (/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(p)) return 'CA';
  if (/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(p)) return 'GB';
  return c || 'US';
}

function normalizePostal(postal: string, country: string): string {
  const p = postal.toUpperCase().replace(/\s+/g, '');
  if (country === 'US') return (p.match(/^\d{5}/)?.[0] ?? p).padStart(5, '0');
  return p.replace(/-/g, '');
}

function normalizeStreetTokens(tokens: string[]): string[] {
  return tokens.map((t, i) => {
    if (DIRECTION[t]) return DIRECTION[t];
    // Only the last word (or one before a trailing direction) is a suffix.
    const isSuffixPosition = i === tokens.length - 1 || (i === tokens.length - 2 && DIRECTION[tokens[i + 1]] !== undefined) ||
      (i === tokens.length - 2 && ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'].includes(tokens[i + 1]));
    if (isSuffixPosition && SUFFIX[t]) return SUFFIX[t];
    return t;
  });
}

/** Splits "123 MAIN ST APT 4B" into street + unit identifier "4B". */
export function splitUnit(line: string): { street: string; unit: string | null } {
  const s = clean(line).replace(/#\s*/g, ' # ').replace(/\s+/g, ' ').trim();
  const tokens = s.split(' ');
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '#' || UNIT_DESIGNATORS.includes(t)) {
      // "NO" only counts as a designator when followed by a number.
      if (t === 'NO' && !/\d/.test(tokens[i + 1] ?? '')) continue;
      const rest = tokens.slice(i + 1).filter((x) => x !== '#' && !UNIT_DESIGNATORS.includes(x));
      if (rest.length === 0) continue;
      return { street: tokens.slice(0, i).join(' '), unit: rest.join('') };
    }
  }
  return { street: s, unit: null };
}

function normalizeUnit(u: string | null): string | null {
  if (!u) return null;
  const v = clean(u)
    .split(' ')
    .filter((x) => x !== '#' && !UNIT_DESIGNATORS.includes(x))
    .join('')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/^0+(?=\d)/, '');
  return v || null;
}

export function normalizeAddress(a: ParsedAddress): NormalizedAddress {
  const rawPostal = a.postal ?? '';
  const country = detectCountry(a.country, rawPostal);
  const postal = normalizePostal(rawPostal, country);
  const l1 = splitUnit(a.line1);
  let unit = normalizeUnit(l1.unit);
  let line2: string | null = null;
  if (a.line2 && clean(a.line2)) {
    const l2 = clean(a.line2);
    const asUnit = normalizeUnit(l2);
    // Line 2 is either a unit ("APT 4B", "#4B", "4B") or extra info (company, c/o).
    if (/^(#|APT|APARTMENT|SUITE|STE|UNIT|FL|FLOOR|RM|ROOM|BLDG|BUILDING|LOT|SPC|NO\s*\d)/.test(l2) || /^[A-Z]?\d+[A-Z]?(-\d+)?$/.test(l2.replace(/\s/g, ''))) {
      unit = unit ?? asUnit;
    } else {
      line2 = l2;
    }
  }
  const streetTokens = normalizeStreetTokens(l1.street.split(' ').filter(Boolean));
  const street = streetTokens.join(' ');
  let state: string | null = clean(a.state) || null;
  if (state && STATES[state]) state = STATES[state];
  const city = clean(a.city);
  const streetKey = `${country}|${postal}|${street}`;
  const canonicalKey = `${streetKey}|${unit ?? ''}`;
  return {
    canonicalKey,
    streetKey,
    line1: unit ? `${street} #${unit}` : street,
    line2,
    unit,
    city,
    state,
    postal,
    country,
  };
}

export function addressRawHash(a: ParsedAddress): string {
  const s = [a.line1, a.line2, a.city, a.state, a.postal, a.country].map((x) => clean(x)).join('|');
  return createHash('sha256').update(s).digest('hex').slice(0, 32);
}

/** Parses a single-string address like "123 Main St, Apt 4, Springfield, IL 62701". */
export function parseAddressString(input: string): ParsedAddress | null {
  const parts = input.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  let country: string | undefined;
  let tail = last;
  if (COUNTRY_ALIASES[clean(last)] && parts.length > 2) {
    country = last;
    parts.pop();
    tail = parts[parts.length - 1];
  }
  const m = tail.match(/^(.*?)[\s,]*([A-Za-z]{2}|[A-Za-z ]{3,})?\s+(\d{5}(?:-\d{4})?|[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d|[A-Za-z]{1,2}\d[A-Za-z\d]?\s?\d[A-Za-z]{2})$/);
  let city = '';
  let state: string | undefined;
  let postal = '';
  if (m) {
    postal = m[3];
    state = m[2]?.trim();
    city = m[1]?.trim() ?? '';
    parts.pop();
    if (!city && parts.length > 1) city = parts.pop()!;
  } else {
    return null;
  }
  const line1 = parts.shift() ?? '';
  const line2 = parts.join(' ') || undefined;
  if (!line1) return null;
  return { line1, line2, city, state, postal, country };
}

// ---------------------------------------------------------------------------
// Names, phones, emails

const NICKNAMES: Record<string, string> = {
  MIKE: 'MICHAEL', MIKEY: 'MICHAEL', MICK: 'MICHAEL', BOB: 'ROBERT', ROB: 'ROBERT', BOBBY: 'ROBERT', BILL: 'WILLIAM',
  WILL: 'WILLIAM', BILLY: 'WILLIAM', JIM: 'JAMES', JIMMY: 'JAMES', JAMIE: 'JAMES', TOM: 'THOMAS', TOMMY: 'THOMAS',
  CHRIS: 'CHRISTOPHER', DAN: 'DANIEL', DANNY: 'DANIEL', DAVE: 'DAVID', MATT: 'MATTHEW', NICK: 'NICHOLAS',
  TONY: 'ANTHONY', JOE: 'JOSEPH', JOEY: 'JOSEPH', ALEX: 'ALEXANDER', SAM: 'SAMUEL', BEN: 'BENJAMIN', JON: 'JONATHAN',
  JOHNNY: 'JOHN', JACK: 'JOHN', STEVE: 'STEVEN', STEPH: 'STEPHANIE', KATE: 'KATHERINE', KATIE: 'KATHERINE',
  LIZ: 'ELIZABETH', BETH: 'ELIZABETH', JEN: 'JENNIFER', JENNY: 'JENNIFER', ANDY: 'ANDREW', DREW: 'ANDREW',
  ED: 'EDWARD', EDDIE: 'EDWARD', GREG: 'GREGORY', JEFF: 'JEFFREY', JOSH: 'JOSHUA', KEN: 'KENNETH', LARRY: 'LAWRENCE',
  PAT: 'PATRICK', PETE: 'PETER', RICK: 'RICHARD', RICH: 'RICHARD', DICK: 'RICHARD', RON: 'RONALD', TIM: 'TIMOTHY',
  ZACH: 'ZACHARY', ABBY: 'ABIGAIL', SUE: 'SUSAN', MAGGIE: 'MARGARET', MEG: 'MARGARET',
};

export interface NameKey {
  key: string | null; // FIRST LAST
  first: string | null;
  last: string | null;
  canonicalFirst: string | null;
}

export function nameKey(name: string | null | undefined): NameKey {
  const tokens = clean(name)
    .replace(/[^A-Z\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !['MR', 'MRS', 'MS', 'DR', 'JR', 'SR', 'II', 'III', 'IV'].includes(t));
  if (tokens.length === 0) return { key: null, first: null, last: null, canonicalFirst: null };
  const first = tokens[0];
  const last = tokens.length > 1 ? tokens[tokens.length - 1] : null;
  const canonicalFirst = NICKNAMES[first] ?? first;
  return { key: last ? `${first} ${last}` : first, first, last, canonicalFirst };
}

export type NameSimilarity = 'exact' | 'nickname' | 'initial' | 'last_only' | 'none';

export function compareNames(a: NameKey, b: NameKey): NameSimilarity {
  if (!a.key || !b.key) return 'none';
  if (a.key === b.key) return 'exact';
  if (!a.last || !b.last || a.last !== b.last) return 'none';
  if (a.canonicalFirst && a.canonicalFirst === b.canonicalFirst) return 'nickname';
  if (a.first && b.first && a.first[0] === b.first[0] && (a.first.length === 1 || b.first.length === 1)) return 'initial';
  return 'last_only';
}

export function phoneKey(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '');
  if (d.length < 7) return null;
  return d.length > 10 ? d.slice(-10) : d;
}

export function maskPhone(phone: string | null | undefined): string | null {
  const k = phoneKey(phone);
  return k ? `•••-•••-${k.slice(-4)}` : null;
}

const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.de',
  'mail.com', 'zoho.com', 'yandex.com', 'hey.com', 'fastmail.com', 'comcast.net', 'verizon.net', 'att.net',
  'sbcglobal.net', 'cox.net', 'charter.net', 'web.de', 't-online.de', 'btinternet.com', 'sky.com',
]);

export function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase().replace(/^mailto:/, '');
  if (!/^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,}$/.test(e)) return null;
  return e;
}

/** Canonical mailbox: strips +tags everywhere and dots for Gmail. */
export function baseEmail(email: string): string {
  const [local, domainRaw] = email.toLowerCase().split('@');
  const domain = domainRaw === 'googlemail.com' ? 'gmail.com' : domainRaw;
  let l = local.split('+')[0];
  if (domain === 'gmail.com') l = l.replace(/\./g, '');
  return `${l}@${domain}`;
}

export function emailDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() ?? '';
}

export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain.toLowerCase());
}

export function maskEmail(email: string): string {
  const [l, d] = email.split('@');
  if (!d) return '•••';
  return `${l.slice(0, 2)}${'•'.repeat(Math.max(1, Math.min(6, l.length - 2)))}@${d}`;
}

export function maskName(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => (w.length <= 1 ? w : `${w[0]}${'•'.repeat(Math.min(5, w.length - 1))}`))
    .join(' ');
}
