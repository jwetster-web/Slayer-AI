import type { EmailEnvelope, UnwrappedEmail } from '../../shared/types';
import { RETAILERS, domainMatches, domainOf } from '../retailers/registry';
import { htmlToLines, parseHtml, textToLines } from '../parsing/html';

const MARKERS = [
  /-{3,}\s*Forwarded message\s*-{3,}/i,
  /Begin forwarded message\s*:/i,
  /-{3,}\s*Original Message\s*-{3,}/i,
  /-{3,}\s*Weitergeleitete Nachricht\s*-{3,}/i,
  /-{3,}\s*Message transf[ée]r[ée]\s*-{3,}/i,
  /^\s*Forwarded Message\s*$/im,
];

const HEADER = /^\s*\*?(From|De|Von|Date|Sent|Gesendet|Datum|Envoy[ée]|Subject|Betreff|Objet|To|An|À|Cc)\s*\*?\s*:\s*(.*)$/i;

const ALL_RETAIL_DOMAINS = RETAILERS.flatMap((r) => r.senderDomains);

function isRetailSender(addr: string): boolean {
  return domainMatches(domainOf(addr), ALL_RETAIL_DOMAINS);
}

function parseAddrField(v: string): { address: string; name?: string } {
  const angle = v.match(/^(.*?)\s*[<\[]\s*(?:mailto:)?([^<>\[\]\s]+@[^<>\[\]\s]+)\s*[>\]]/);
  if (angle) return { name: angle[1].replace(/["*]/g, '').trim() || undefined, address: angle[2].toLowerCase() };
  const bare = v.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return { address: bare ? bare[0].toLowerCase() : '', name: bare ? undefined : v.trim() };
}

export function parseForwardDate(v: string): string | undefined {
  const s = v
    .replace(/\bat\b/i, ' ')
    .replace(/\s+um\s+/i, ' ')
    .replace(/(\d)(st|nd|rd|th)\b/, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  const noTz = new Date(s.replace(/\s+[A-Z]{2,5}$/, ''));
  return Number.isNaN(noTz.getTime()) ? undefined : noTz.toISOString();
}

interface Headers {
  from?: { address: string; name?: string };
  date?: string;
  subject?: string;
  to?: string[];
}

function readHeaders(lines: string[], start: number): { headers: Headers; end: number } {
  const h: Headers = {};
  let i = start;
  let seen = 0;
  for (; i < lines.length && i < start + 14; i++) {
    const m = lines[i].match(HEADER);
    if (!m) {
      if (seen > 0 && lines[i].trim()) break;
      continue;
    }
    seen++;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (['from', 'de', 'von'].includes(key)) h.from = parseAddrField(val);
    else if (['date', 'sent', 'gesendet', 'datum', 'envoyé', 'envoye'].includes(key)) h.date = parseForwardDate(val);
    else if (['subject', 'betreff', 'objet'].includes(key)) h.subject = val;
    else if (['to', 'an', 'à'].includes(key)) h.to = val.split(/[,;]/).map((x) => parseAddrField(x).address).filter(Boolean);
  }
  return { headers: h, end: i };
}

/** Cuts an HTML body after the forward header block that follows `markerRe`. */
function sliceHtmlAfterHeaders(html: string, markerRe: RegExp): string | undefined {
  const m = html.match(markerRe);
  if (!m || m.index === undefined) return undefined;
  const from = m.index + m[0].length;
  const region = html.slice(from, from + 6000);
  const labelRe = /(?:^|>|\n|<br\s*\/?>)\s*(?:<[^>]+>\s*)*(From|De|Von|Date|Sent|Gesendet|Datum|Subject|Betreff|Objet|To|An|Cc)\s*:/gi;
  let lastEnd = -1;
  let prev = -1;
  for (const lm of region.matchAll(labelRe)) {
    const idx = lm.index ?? 0;
    if (prev >= 0 && idx - prev > 900) break;
    prev = idx;
    lastEnd = idx + lm[0].length;
  }
  if (lastEnd < 0) return html.slice(from);
  const rest = region.slice(lastEnd);
  const br = rest.search(/<br\s*\/?>|<\/div>|<\/p>|<\/tr>|\n\s*\n/i);
  const cut = from + lastEnd + (br >= 0 ? br : 0);
  const tail = html.slice(cut).replace(/^(<br\s*\/?>|<\/div>|<\/p>|<\/tr>|\s)+/i, '');
  return tail;
}

/**
 * Finds the original retailer message inside forwarded chains (inline forwards
 * from Gmail, Outlook and Apple Mail). Forward-as-attachment is handled by the
 * MIME layer before this is called.
 */
export function unwrapForwarded(env: EmailEnvelope, depth = 0): UnwrappedEmail {
  const base: UnwrappedEmail = { ...env, forwarded: depth > 0, forwardDepth: depth };
  if (depth >= 6 || isRetailSender(env.from)) return base;

  const lines = env.text ? textToLines(env.text) : env.html ? htmlToLines(parseHtml(env.html)) : [];
  let markerIdx = -1;
  let marker: RegExp | undefined;
  for (let i = 0; i < lines.length && markerIdx < 0; i++) {
    for (const re of MARKERS) {
      if (re.test(lines[i])) {
        markerIdx = i;
        marker = re;
        break;
      }
    }
  }
  // Outlook sometimes omits the marker: a bare header block "From: ... Sent: ..." in the body.
  if (markerIdx < 0) {
    for (let i = 0; i < lines.length - 2; i++) {
      if (/^\s*\*?From\s*\*?\s*:/i.test(lines[i]) && /^\s*\*?(Sent|Date)\s*\*?\s*:/i.test(lines[i + 1] ?? '') && isRetailSender(parseAddrField(lines[i].replace(/^\s*\*?From\s*\*?\s*:/i, '')).address)) {
        markerIdx = i - 1;
        marker = /\bFrom\s*:/i;
        break;
      }
    }
  }
  if (markerIdx < 0 || !marker) return base;

  const { headers, end } = readHeaders(lines, markerIdx + 1);
  if (!headers.from?.address) return base;

  const innerText = env.text ? textToLines(env.text).slice(end).join('\n') : undefined;
  const innerHtml = env.html ? sliceHtmlAfterHeaders(env.html, marker) : undefined;
  const inner: EmailEnvelope = {
    messageId: undefined,
    from: headers.from.address,
    fromName: headers.from.name,
    to: headers.to ?? env.to,
    subject: headers.subject ?? env.subject.replace(/^\s*(fwd?|wg|tr)\s*:\s*/i, ''),
    date: headers.date ?? env.date,
    html: innerHtml,
    text: innerText ?? (innerHtml ? undefined : env.text),
    inlineImages: env.inlineImages,
  };
  const deeper = unwrapForwarded(inner, depth + 1);
  return { ...deeper, forwarded: true, forwardedBy: env.from, forwardDepth: Math.max(deeper.forwardDepth, depth + 1) };
}
