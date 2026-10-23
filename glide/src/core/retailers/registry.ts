import type { RetailerId } from '../../shared/types';

export interface RetailerMeta {
  id: RetailerId;
  name: string;
  shortName: string;
  region: 'US' | 'GB' | 'CA' | 'DE' | 'INTL';
  currency: string;
  color: string;
  /** Sender domains (lowercase, suffix match). */
  senderDomains: string[];
  /** Words in the subject/body that identify this retailer when the sender is generic (e.g. forwarded). */
  brandMarkers: RegExp[];
  /** Order number pattern(s); first capture group is the number. */
  orderNumber: RegExp[];
  primary: boolean;
}

const ORDER_LABEL = String.raw`(?:order\s*(?:number|no\.?|num(?:ber)?|#|id)?|bestellnummer|bestellung)\s*[:#]?\s*`;

export const RETAILERS: RetailerMeta[] = [
  {
    id: 'target', name: 'Target', shortName: 'Target', region: 'US', currency: 'USD', color: '#e8152b', primary: true,
    senderDomains: ['target.com', 'oe.target.com', 'em.target.com', 'e.target.com'],
    brandMarkers: [/\btarget\.com\b/i, /\bTarget Circle\b/i, /©\s*\d{4}\s*Target Brands/i],
    orderNumber: [new RegExp(ORDER_LABEL + String.raw`(\d{12,15})\b`, 'i'), /#\s*(\d{12,15})\b/],
  },
  {
    id: 'walmart', name: 'Walmart', shortName: 'Walmart', region: 'US', currency: 'USD', color: '#0071dc', primary: true,
    senderDomains: ['walmart.com', 'email.walmart.com', 'ord.walmart.com'],
    brandMarkers: [/\bwalmart\.com\b/i, /\bWalmart\+/i, /©\s*\d{4}\s*Walmart/i],
    orderNumber: [new RegExp(ORDER_LABEL + String.raw`(\d{7,8}-\d{7,8}|\d{13,15})\b`, 'i'), /#\s*(\d{7,8}-\d{7,8})\b/],
  },
  {
    id: 'pokemoncenter_us', name: 'Pokémon Center', shortName: 'PKC US', region: 'US', currency: 'USD', color: '#ffcb05', primary: true,
    senderDomains: ['pokemoncenter.com', 'em.pokemoncenter.com', 'email.pokemoncenter.com'],
    brandMarkers: [/pok[eé]mon\s*center/i],
    orderNumber: [new RegExp(ORDER_LABEL + String.raw`(P\d{9,10}|\d{9,12})\b`, 'i')],
  },
  {
    id: 'pokemoncenter_uk', name: 'Pokémon Center UK', shortName: 'PKC UK', region: 'GB', currency: 'GBP', color: '#ffcb05', primary: true,
    senderDomains: ['pokemoncenter.com'],
    brandMarkers: [/pok[eé]mon\s*center\s*(uk|united kingdom)/i, /uk\.pokemoncenter\.com/i, /pokemoncenter\.com\/en-gb/i],
    orderNumber: [new RegExp(ORDER_LABEL + String.raw`(P\d{9,10}|\d{9,12})\b`, 'i')],
  },
  {
    id: 'pokemoncenter_ca', name: 'Pokémon Center Canada', shortName: 'PKC CA', region: 'CA', currency: 'CAD', color: '#ffcb05', primary: true,
    senderDomains: ['pokemoncenter.com'],
    brandMarkers: [/pok[eé]mon\s*center\s*canada/i, /pokemoncenter\.com\/en-ca/i, /pokemoncenter\.com\/fr-ca/i],
    orderNumber: [new RegExp(ORDER_LABEL + String.raw`(P\d{9,10}|\d{9,12})\b`, 'i')],
  },
  {
    id: 'pokemoncenter_de', name: 'Pokémon Center Germany', shortName: 'PKC DE', region: 'DE', currency: 'EUR', color: '#ffcb05', primary: true,
    senderDomains: ['pokemoncenter.com'],
    brandMarkers: [/pokemoncenter\.com\/de-de/i, /pok[eé]mon\s*center\s*(deutschland|germany)/i, /Bestellbest[äa]tigung/i],
    orderNumber: [new RegExp(ORDER_LABEL + String.raw`(P\d{9,10}|\d{9,12})\b`, 'i')],
  },
  {
    id: 'amazon', name: 'Amazon', shortName: 'Amazon', region: 'US', currency: 'USD', color: '#ff9900', primary: true,
    senderDomains: ['amazon.com', 'amazon.co.uk', 'amazon.ca', 'amazon.de'],
    brandMarkers: [/\bamazon\.(com|co\.uk|ca|de)\b/i],
    orderNumber: [/(\d{3}-\d{7}-\d{7})/],
  },
  {
    id: 'bestbuy', name: 'Best Buy', shortName: 'Best Buy', region: 'US', currency: 'USD', color: '#0046be', primary: true,
    senderDomains: ['bestbuy.com', 'emailinfo.bestbuy.com', 'em.bestbuy.com'],
    brandMarkers: [/\bbestbuy\.com\b/i, /\bBest Buy\b/],
    orderNumber: [/(BBY01-\d{9,12})/i],
  },
  {
    id: 'costco', name: 'Costco', shortName: 'Costco', region: 'US', currency: 'USD', color: '#e31837', primary: true,
    senderDomains: ['costco.com', 'online.costco.com', 'digital.costco.com'],
    brandMarkers: [/\bcostco\.com\b/i, /\bCostco Wholesale\b/i],
    orderNumber: [new RegExp(ORDER_LABEL + String.raw`(\d{9,12})\b`, 'i')],
  },
  {
    id: 'samsclub', name: "Sam's Club", shortName: "Sam's", region: 'US', currency: 'USD', color: '#0067a0', primary: true,
    senderDomains: ['samsclub.com', 'email.samsclub.com'],
    brandMarkers: [/\bsamsclub\.com\b/i, /\bSam'?s Club\b/i],
    orderNumber: [new RegExp(ORDER_LABEL + String.raw`(\d{9,13})\b`, 'i')],
  },
  {
    id: 'gamestop', name: 'GameStop', shortName: 'GameStop', region: 'US', currency: 'USD', color: '#e2231a', primary: false,
    senderDomains: ['gamestop.com', 'em.gamestop.com'],
    brandMarkers: [/\bgamestop\.com\b/i],
    orderNumber: [new RegExp(ORDER_LABEL + String.raw`([A-Z0-9]{8,14})\b`, 'i')],
  },
  {
    id: 'hottopic', name: 'Hot Topic', shortName: 'Hot Topic', region: 'US', currency: 'USD', color: '#c8102e', primary: false,
    senderDomains: ['hottopic.com', 'em.hottopic.com'],
    brandMarkers: [/\bhottopic\.com\b/i],
    orderNumber: [new RegExp(ORDER_LABEL + String.raw`([A-Z]{0,3}\d{8,12})\b`, 'i')],
  },
  {
    id: 'barnesnoble', name: 'Barnes & Noble', shortName: 'B&N', region: 'US', currency: 'USD', color: '#2a5934', primary: false,
    senderDomains: ['barnesandnoble.com', 'bn.com', 'email.bn.com'],
    brandMarkers: [/barnes\s*(&|and)\s*noble/i],
    orderNumber: [new RegExp(ORDER_LABEL + String.raw`(\d{10,13})\b`, 'i')],
  },
  {
    id: 'macys', name: "Macy's", shortName: "Macy's", region: 'US', currency: 'USD', color: '#e21a2c', primary: false,
    senderDomains: ['macys.com', 'emails.macys.com', 'oes.macys.com'],
    brandMarkers: [/\bmacys\.com\b/i],
    orderNumber: [new RegExp(ORDER_LABEL + String.raw`(\d{9,12})\b`, 'i')],
  },
  {
    id: 'lego', name: 'LEGO', shortName: 'LEGO', region: 'US', currency: 'USD', color: '#e3000b', primary: false,
    senderDomains: ['lego.com', 'e.lego.com', 'shop.lego.com'],
    brandMarkers: [/\blego\.com\b/i],
    orderNumber: [new RegExp(ORDER_LABEL + String.raw`(T\d{8,11})\b`, 'i')],
  },
  {
    id: 'shopify', name: 'Shopify Store', shortName: 'Shopify', region: 'INTL', currency: 'USD', color: '#95bf47', primary: false,
    senderDomains: ['shopify.com', 'myshopify.com'],
    brandMarkers: [/cdn\.shopify\.com/i, /myshopify\.com/i, /shopifyemail/i],
    orderNumber: [/(?:order|bestellung)\s*#\s*([A-Z0-9-]{3,14})\b/i],
  },
  {
    id: 'custom', name: 'Other Retailer', shortName: 'Other', region: 'INTL', currency: 'USD', color: '#8b93a7', primary: false,
    senderDomains: [],
    brandMarkers: [],
    orderNumber: [new RegExp(ORDER_LABEL + String.raw`([A-Z0-9-]{5,20})\b`, 'i')],
  },
];

export const RETAILER_MAP = new Map(RETAILERS.map((r) => [r.id, r]));

export function retailer(id: string): RetailerMeta {
  return RETAILER_MAP.get(id as RetailerId) ?? RETAILER_MAP.get('custom')!;
}

export function domainOf(addr: string): string {
  const m = addr.toLowerCase().match(/@([a-z0-9.-]+)/);
  return m ? m[1] : '';
}

export function domainMatches(domain: string, candidates: string[]): boolean {
  return candidates.some((c) => domain === c || domain.endsWith('.' + c));
}
