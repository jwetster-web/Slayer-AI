// Minimal RFC 5322 message builder used for fixtures and sample data.

import { randomUUID } from 'node:crypto';

export interface BuildMimeInput {
  from: string;
  to: string;
  subject: string;
  date: Date;
  html?: string;
  text?: string;
  messageId?: string;
  attachRfc822?: string;
}

const enc = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`);

function encAddr(a: string): string {
  const m = a.match(/^(.*?)\s*<([^>]+)>$/);
  return m ? `${enc(m[1].replace(/"/g, ''))} <${m[2]}>` : a;
}

function b64lines(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
}

export function buildMime(m: BuildMimeInput): string {
  const boundary = `----glide${randomUUID().replace(/-/g, '')}`;
  const headers = [
    `From: ${encAddr(m.from)}`,
    `To: ${m.to}`,
    `Subject: ${enc(m.subject)}`,
    `Date: ${m.date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: ${m.messageId ?? `<${randomUUID()}@sample.glide.local>`}`,
    'MIME-Version: 1.0',
  ];
  const parts: string[] = [];
  if (m.text) parts.push(`Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64lines(m.text)}`);
  if (m.html) parts.push(`Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64lines(m.html)}`);
  if (m.attachRfc822) {
    const alt = `${boundary}alt`;
    const body = `Content-Type: multipart/alternative; boundary="${alt}"\r\n\r\n${parts.map((p) => `--${alt}\r\n${p}`).join('\r\n')}\r\n--${alt}--`;
    const att = `Content-Type: message/rfc822\r\nContent-Disposition: attachment; filename="forwarded.eml"\r\n\r\n${m.attachRfc822}`;
    return `${headers.join('\r\n')}\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n--${boundary}\r\n${body}\r\n--${boundary}\r\n${att}\r\n--${boundary}--\r\n`;
  }
  return `${headers.join('\r\n')}\r\nContent-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n${parts.map((p) => `--${boundary}\r\n${p}`).join('\r\n')}\r\n--${boundary}--\r\n`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Wraps an original message the way Gmail's inline "Forward" does. */
export function gmailForward(orig: { fromName: string; from: string; to: string; subject: string; date: Date; html: string }, by: string, to: string, at: Date): string {
  const d = orig.date.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).replace(/, (\d{4}),/, ', $1 at');
  const html = `<div dir="ltr"><br><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>From: <strong class="gmail_sendername" dir="auto">${esc(orig.fromName)}</strong> <span dir="auto">&lt;${orig.from}&gt;</span><br>Date: ${d}<br>Subject: ${esc(orig.subject)}<br>To: &lt;${orig.to}&gt;<br></div><br><br>${orig.html}</div></div>`;
  return buildMime({ from: by, to, subject: `Fwd: ${orig.subject}`, date: at, html });
}

/** Outlook-style inline forward (header block without the dashed marker). */
export function outlookForward(orig: { fromName: string; from: string; to: string; subject: string; date: Date; html: string }, by: string, to: string, at: Date): string {
  const d = orig.date.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  const html = `<div>FYI</div><hr style="display:inline-block;width:98%"><div id="divRplyFwdMsg" dir="ltr"><font face="Calibri, sans-serif" style="font-size:11pt"><b>From:</b> ${esc(orig.fromName)} &lt;${orig.from}&gt;<br><b>Sent:</b> ${d}<br><b>To:</b> ${orig.to} &lt;${orig.to}&gt;<br><b>Subject:</b> ${esc(orig.subject)}</font><div>&nbsp;</div></div>${orig.html}`;
  return buildMime({ from: by, to, subject: `FW: ${orig.subject}`, date: at, html });
}
