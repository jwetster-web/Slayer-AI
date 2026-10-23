// Money parsing for US, UK, CA and EU formats. Returns integer minor units.

const SYMBOL_CURRENCY: [RegExp, string][] = [
  [/C\$|CA\$|CAD/i, 'CAD'],
  [/US\$|USD/i, 'USD'],
  [/A\$|AUD/i, 'AUD'],
  [/£|GBP/i, 'GBP'],
  [/€|EUR/i, 'EUR'],
  [/\$/, 'USD'],
];

/** Matches a single money amount with an explicit currency marker. */
export const MONEY_RE =
  /(?:(?:US|CA|C|A)?\$|£|€|USD|CAD|GBP|EUR)\s?-?\d{1,3}(?:[,.\s]\d{3})*(?:[.,]\d{2})?(?!\d)|-?\d{1,3}(?:[.\s]\d{3})*,\d{2}\s?(?:€|EUR)|-?\d+(?:[.,]\d{2})\s?(?:€|EUR|£|USD|GBP|CAD)/gi;

export interface MoneyMatch {
  cents: number;
  currency: string;
  raw: string;
  index: number;
}

export function parseAmount(raw: string): number | null {
  let s = raw.replace(/[^\d.,\-]/g, '');
  const negative = /^-|−/.test(raw.trim()) || /\(\s*[$£€]/.test(raw) || /-\s*[$£€]/.test(raw);
  s = s.replace(/-/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let intPart: string;
  let frac = '00';
  if (lastComma > lastDot && s.length - lastComma - 1 === 2) {
    // EU style 1.234,56
    intPart = s.slice(0, lastComma).replace(/[.,]/g, '');
    frac = s.slice(lastComma + 1);
  } else if (lastDot > -1 && s.length - lastDot - 1 === 2) {
    intPart = s.slice(0, lastDot).replace(/[.,]/g, '');
    frac = s.slice(lastDot + 1);
  } else {
    intPart = s.replace(/[.,]/g, '');
  }
  if (!/^\d+$/.test(intPart || '0') || !/^\d{2}$/.test(frac)) return null;
  const cents = Number(intPart || '0') * 100 + Number(frac);
  return negative ? -cents : cents;
}

export function currencyOf(raw: string, fallback: string): string {
  for (const [re, cur] of SYMBOL_CURRENCY) if (re.test(raw)) return cur;
  return fallback;
}

export function findMoney(text: string, fallbackCurrency = 'USD'): MoneyMatch[] {
  const out: MoneyMatch[] = [];
  for (const m of text.matchAll(MONEY_RE)) {
    const raw = m[0];
    // Pull a leading minus or parenthesis from just before the match.
    const before = text.slice(Math.max(0, (m.index ?? 0) - 2), m.index ?? 0);
    const signed = /[-−(]\s?$/.test(before) ? '-' + raw : raw;
    const cents = parseAmount(signed);
    if (cents === null) continue;
    out.push({ cents, currency: currencyOf(raw, fallbackCurrency), raw, index: m.index ?? 0 });
  }
  return out;
}

export function firstMoney(text: string, fallbackCurrency = 'USD'): MoneyMatch | null {
  return findMoney(text, fallbackCurrency)[0] ?? null;
}

export { formatCents } from '../../shared/format';
