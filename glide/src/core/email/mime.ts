import { createHash } from 'node:crypto';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import type { EmailEnvelope } from '../../shared/types';

export interface MimeResult {
  envelope: EmailEnvelope;
  /** Messages attached as message/rfc822 (forward-as-attachment). */
  attached: EmailEnvelope[];
  contentHash: string;
}

function addrList(a: AddressObject | AddressObject[] | undefined): string[] {
  if (!a) return [];
  const arr = Array.isArray(a) ? a : [a];
  return arr.flatMap((x) => x.value.map((v) => (v.address ?? '').toLowerCase())).filter(Boolean);
}

function toEnvelope(m: ParsedMail): EmailEnvelope {
  const inline: Record<string, string> = {};
  for (const att of m.attachments ?? []) {
    if (att.contentId && att.contentType?.startsWith('image/') && att.size < 2_000_000) {
      inline[att.contentId.replace(/[<>]/g, '')] = `data:${att.contentType};base64,${att.content.toString('base64')}`;
    }
  }
  const from = m.from?.value?.[0];
  return {
    messageId: m.messageId ?? undefined,
    from: (from?.address ?? '').toLowerCase(),
    fromName: from?.name || undefined,
    to: addrList(m.to),
    subject: m.subject ?? '',
    date: m.date ? m.date.toISOString() : undefined,
    html: typeof m.html === 'string' ? m.html : undefined,
    text: m.text ?? undefined,
    inlineImages: Object.keys(inline).length ? inline : undefined,
  };
}

export async function parseMime(raw: Buffer | string): Promise<MimeResult> {
  const buf = typeof raw === 'string' ? Buffer.from(raw) : raw;
  const m = await simpleParser(buf, { skipTextToHtml: true, skipImageLinks: true });
  const attached: EmailEnvelope[] = [];
  for (const att of m.attachments ?? []) {
    if (att.contentType === 'message/rfc822') {
      try {
        const inner = await simpleParser(att.content, { skipTextToHtml: true, skipImageLinks: true });
        attached.push(toEnvelope(inner));
      } catch {
        // Ignore malformed attached messages; the outer message is still processed.
      }
    }
  }
  return { envelope: toEnvelope(m), attached, contentHash: createHash('sha256').update(buf).digest('hex') };
}

/** Splits an mbox file into raw RFC822 messages ("From " separator lines, mboxrd unescaping). */
export function* splitMbox(data: Buffer | string): Generator<string> {
  const text = typeof data === 'string' ? data : data.toString('utf8');
  const lines = text.split(/\r?\n/);
  let cur: string[] = [];
  let started = false;
  for (const line of lines) {
    if (/^From \S+.*\d{4}\s*$/.test(line) || /^From \S+ +\w{3} \w{3}/.test(line)) {
      if (started && cur.length) yield cur.join('\r\n');
      cur = [];
      started = true;
      continue;
    }
    if (!started) {
      if (line.trim() === '') continue;
      started = true;
    }
    cur.push(line.replace(/^>(>*From )/, '$1'));
  }
  if (cur.length && cur.some((l) => l.trim())) yield cur.join('\r\n');
}
