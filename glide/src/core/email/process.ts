// Processes one raw email end-to-end: store provenance, unwrap forwards,
// parse, and apply to orders. Safe to call repeatedly for the same message.

import { gzipSync, gunzipSync } from 'node:zlib';
import { DEFAULT_SETTINGS, type AppSettings, type EmailEnvelope, type ParsedOrderEmail, type UnwrappedEmail } from '../../shared/types';
import { redact } from '../audit';
import { now, type Db } from '../db/database';
import { EventSink } from '../events';
import { applyParsedEmail } from '../orders/ingest';
import { parseRetailEmail, type CustomTemplate, type ParseOutcome } from '../parsing/adapters';
import { domainOf } from '../retailers/registry';
import type { DataCipher } from '../secrets';
import { applyCarrierUpdate, carrierOfSender, parseCarrierEmail, type CarrierUpdate } from '../tracking/carrierEmail';
import { unwrapForwarded } from './forwarded';
import { parseMime } from './mime';

export type MessageRef =
  | { kind: 'imap'; accountId: number; mailbox: string; uidValidity: string; uid: number }
  | { kind: 'import'; accountId: number | null; importRef: string };

export interface ProcessDeps {
  db: Db;
  settings?: AppSettings;
  cipher?: DataCipher | null;
  sink?: EventSink;
  templates?: CustomTemplate[];
}

export type ProcessStatus = 'already_processed' | 'ignored' | 'parsed' | 'duplicate' | 'failed';

export interface ProcessResult {
  status: ProcessStatus;
  sourceMessageId?: number;
  orderId?: number;
  orderCreated?: boolean;
  retailer?: string;
  type?: string;
  reason?: string;
}

export function loadTemplates(db: Db): CustomTemplate[] {
  return db
    .all<{ id: number; name: string; retailer_id: string; sender_pattern: string; subject_pattern: string | null; rules_json: string }>('SELECT * FROM parser_templates WHERE enabled = 1')
    .map((t) => ({ id: t.id, name: t.name, retailerId: t.retailer_id as never, senderPattern: t.sender_pattern, subjectPattern: t.subject_pattern, rules: JSON.parse(t.rules_json) }));
}

function alreadyProcessed(db: Db, ref: MessageRef): boolean {
  if (ref.kind === 'imap') return !!db.get('SELECT 1 FROM source_messages WHERE account_id = ? AND mailbox = ? AND uid_validity = ? AND uid = ?', [ref.accountId, ref.mailbox, ref.uidValidity, ref.uid]);
  return !!db.get('SELECT 1 FROM source_messages WHERE import_ref = ?', [ref.importRef]);
}

/** Picks the retail message among the outer envelope and any forwarded-as-attachment messages. */
function candidates(outer: EmailEnvelope, attached: EmailEnvelope[]): UnwrappedEmail[] {
  const list: UnwrappedEmail[] = attached.map((a) => ({ ...unwrapForwarded(a, 1), forwarded: true, forwardedBy: outer.from }));
  list.push(unwrapForwarded(outer));
  return list;
}

export async function processRawMessage(deps: ProcessDeps, raw: Buffer, ref: MessageRef, receivedAt?: string): Promise<ProcessResult> {
  const { db } = deps;
  const settings = deps.settings ?? DEFAULT_SETTINGS;
  if (alreadyProcessed(db, ref)) return { status: 'already_processed' };

  let outcome: ParseOutcome = { status: 'ignored', reason: 'empty' };
  let inner: UnwrappedEmail | null = null;
  let outer: EmailEnvelope | null = null;
  let contentHash = '';
  try {
    const mime = await parseMime(raw);
    outer = mime.envelope;
    contentHash = mime.contentHash;
    for (const c of candidates(mime.envelope, mime.attached)) {
      const o = parseRetailEmail(c, deps.templates ?? []);
      if (o.status === 'parsed' || (o.status === 'failed' && outcome.status !== 'parsed') || !inner) {
        outcome = o;
        inner = c;
      }
      if (o.status === 'parsed') break;
    }
  } catch (e) {
    outcome = { status: 'failed', reason: `MIME parse error: ${(e as Error).message}`, retailer: 'custom', type: 'unknown' };
  }
  // Not a retailer email: it may be a carrier notice (UPS/FedEx/USPS…) about a package we already track.
  let carrierUpdate: CarrierUpdate | null = null;
  // Carrier / package-service mail is kept even when it can't be applied yet, so it can be reviewed and reprocessed.
  const fromCarrier = outcome.status === 'ignored' && !!inner && !!carrierOfSender(inner.from);
  if (outcome.status === 'ignored' && inner) {
    try {
      carrierUpdate = parseCarrierEmail(inner);
    } catch {
      carrierUpdate = null;
    }
  }

  const rec = receivedAt ?? now();
  return db.tx(() => {
    if (alreadyProcessed(db, ref)) return { status: 'already_processed' as const };
    const isRetail = outcome.status !== 'ignored' || !!carrierUpdate || fromCarrier;
    const retailerId = outcome.status === 'parsed' ? outcome.result.retailer : outcome.retailer ?? null;
    const type = outcome.status === 'parsed' ? outcome.result.type : outcome.type ?? 'unknown';
    // Non-retail mail keeps only what is needed for idempotency: no subject, sender domain only.
    // Mail from a recognised retailer that wasn't an order event keeps its subject so missed orders can be diagnosed.
    const keepMeta = isRetail || !!retailerId;
    const fromAddr = keepMeta ? inner?.from ?? outer?.from ?? '' : domainOf(outer?.from ?? '');
    const subject = keepMeta ? inner?.subject ?? outer?.subject ?? '' : '';
    const sample = outcome.status === 'failed' ? redact([inner?.subject ?? '', ...(inner?.text ?? inner?.html?.replace(/<[^>]+>/g, ' ') ?? '').split(/\s+/).slice(0, 120)].join(' '), 600) : null;
    const id = db.run(
      `INSERT INTO source_messages (account_id, mailbox, uid, uid_validity, import_ref, message_id_header, original_message_id, content_hash, from_addr, subject, sent_at, received_at,
         forwarded, forwarded_by, retailer_id, message_type, parse_status, parse_error, redacted_sample, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ref.accountId ?? null,
        ref.kind === 'imap' ? ref.mailbox : null,
        ref.kind === 'imap' ? ref.uid : null,
        ref.kind === 'imap' ? ref.uidValidity : null,
        ref.kind === 'import' ? ref.importRef : null,
        isRetail ? outer?.messageId ?? null : null,
        isRetail && inner && !inner.forwarded ? inner.messageId ?? null : null,
        contentHash || 'none',
        fromAddr,
        subject,
        inner?.date ?? outer?.date ?? null,
        rec,
        inner?.forwarded ? 1 : 0,
        isRetail && inner?.forwarded ? inner.forwardedBy ?? null : null,
        retailerId,
        type,
        outcome.status,
        outcome.status === 'parsed' ? (outcome.result.warnings.join('; ') || null) : outcome.reason,
        sample,
        now(),
      ],
    ).lastId;

    if (isRetail && settings.storeRawEmails) {
      const gz = gzipSync(raw);
      const enc = settings.encryptRawEmails && deps.cipher ? deps.cipher.encrypt(gz) : gz;
      db.run('INSERT INTO source_message_blobs (message_id, encrypted, data) VALUES (?, ?, ?)', [id, settings.encryptRawEmails && deps.cipher ? 1 : 0, enc]);
    }

    if (carrierUpdate) {
      const r = applyCarrierUpdate(db, carrierUpdate, inner?.date ?? outer?.date ?? rec, id, deps.sink);
      const t = carrierUpdate.status === 'delivered' ? 'delivery' : carrierUpdate.status === 'out_for_delivery' ? 'out_for_delivery' : carrierUpdate.status === 'delayed' ? 'delay' : 'shipping';
      db.run('UPDATE source_messages SET parse_status = ?, message_type = ?, order_id = ?, parse_error = ? WHERE id = ?', [r.packages ? 'parsed' : 'ignored', t, r.orderIds[0] ?? null, r.packages ? null : 'carrier notice for a package GLIDE is not tracking', id]);
      return { status: r.packages ? ('parsed' as const) : ('ignored' as const), sourceMessageId: id, orderId: r.orderIds[0], type: t };
    }
    if (outcome.status !== 'parsed') {
      return { status: outcome.status, sourceMessageId: id, reason: outcome.reason, retailer: retailerId ?? undefined, type };
    }
    const occurredAt = inner?.date ?? outer?.date ?? rec;
    const r = applyParsedEmail({ db, settings, sourceMessageId: id, accountId: ref.accountId, occurredAt, sink: deps.sink }, outcome.result);
    db.run('UPDATE source_messages SET order_id = ?, parse_status = ? WHERE id = ?', [r.orderId, r.duplicate ? 'duplicate' : 'parsed', id]);
    if (r.duplicate) {
      const first = db.value<number>("SELECT MIN(id) FROM source_messages WHERE order_id = ? AND id <> ? AND message_type = ? AND parse_status = 'parsed'", [r.orderId, id, type]);
      if (first) db.run('UPDATE source_messages SET duplicate_of_id = ? WHERE id = ?', [first, id]);
    }
    return { status: r.duplicate ? 'duplicate' : 'parsed', sourceMessageId: id, orderId: r.orderId, orderCreated: r.created, retailer: retailerId ?? undefined, type };
  });
}

export function readRawMessage(db: Db, sourceMessageId: number, cipher?: DataCipher | null): Buffer | null {
  const b = db.get<{ encrypted: number; data: Uint8Array }>('SELECT encrypted, data FROM source_message_blobs WHERE message_id = ?', [sourceMessageId]);
  if (!b) return null;
  let buf: Buffer = Buffer.from(b.data);
  if (b.encrypted) {
    if (!cipher) return null;
    buf = cipher.decrypt(buf);
  }
  return gunzipSync(buf);
}

/** Re-parses a stored raw message with the current parsers (for repairs); returns every parsed candidate. */
export async function reparseStored(db: Db, sourceMessageId: number, cipher?: DataCipher | null): Promise<ParsedOrderEmail[]> {
  const raw = readRawMessage(db, sourceMessageId, cipher);
  if (!raw) return [];
  try {
    const mime = await parseMime(raw);
    const out: ParsedOrderEmail[] = [];
    for (const c of candidates(mime.envelope, mime.attached)) {
      const o = parseRetailEmail(c, loadTemplates(db));
      if (o.status === 'parsed') out.push(o.result);
    }
    return out;
  } catch {
    return [];
  }
}
