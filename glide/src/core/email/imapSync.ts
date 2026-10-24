// Incremental, read-only IMAP synchronization.
//
// - Mailboxes are opened read-only (EXAMINE) and bodies fetched with
//   BODY.PEEK, so messages are never marked read or modified.
// - Progress is checkpointed per (account, mailbox, UIDVALIDITY) after every
//   message; a crash at any point resumes from the last committed UID and
//   message-level idempotency prevents duplicates.
// - Only envelopes are downloaded for every message; full sources are
//   fetched just for likely retail messages.

import { DEFAULT_SETTINGS, type AppSettings, type SyncProgress } from '../../shared/types';
import { redact } from '../audit';
import { now, type Db } from '../db/database';
import { EventSink } from '../events';
import { RETAILERS, domainMatches, domainOf } from '../retailers/registry';
import type { DataCipher } from '../secrets';
import { loadTemplates, processRawMessage } from './process';

export interface MailboxInfo {
  uidValidity: bigint | number | string;
  exists?: number;
}

export interface FetchedMessage {
  uid: number;
  source?: Buffer;
  envelope?: { from?: { address?: string; name?: string }[]; subject?: string; date?: Date | string };
  internalDate?: Date | string;
}

/** The subset of the imapflow client used by the sync engine (lets tests use a fake server). */
export interface MailClient {
  connect(): Promise<void>;
  mailboxOpen(path: string, opts: { readOnly: true }): Promise<MailboxInfo>;
  search(query: Record<string, unknown>, opts: { uid: true }): Promise<number[] | false | undefined>;
  fetchAll(range: string, query: Record<string, unknown>, opts: { uid: true }): Promise<FetchedMessage[]>;
  logout(): Promise<void>;
  list?(): Promise<{ path: string; specialUse?: string; flags?: Set<string> }[]>;
}

/**
 * Folders to sync. An account left on the default ["INBOX"] syncs the server's "All Mail" folder
 * when it has one (Gmail): order mail is often archived by filters or forwarded from the account
 * itself, and none of that is in the Inbox. All Mail already contains the Inbox but not Spam/Trash.
 */
export async function resolveMailboxes(client: MailClient, account: AccountRow): Promise<string[]> {
  const configured: string[] = JSON.parse(account.mailboxes_json || '["INBOX"]');
  if (configured.length !== 1 || configured[0].toUpperCase() !== 'INBOX' || !client.list) return configured;
  const boxes = await client.list();
  const all = boxes.find((b) => b.specialUse === '\\All' || b.flags?.has('\\All'));
  return all ? [all.path] : configured;
}

export interface AccountRow {
  id: number;
  label: string;
  mailboxes_json: string;
  backfill_days: number;
  created_at: string;
}

const RETAIL_DOMAINS = [...RETAILERS.flatMap((r) => r.senderDomains), 'ups.com', 'fedex.com', 'usps.com', 'dhl.com', 'ontrac.com', 'lasership.com'];
const SUBJECT_HINT = /\b(fwd?|fw|wg|tr)\s*:|forward|order|shipped|shipping|shipment|deliver|on (its|the) way|arriv|package|parcel|pick\s*up|cancel+ed|refund|tracking|receipt|purchase|confirm|thank(s| you) for|bestell|versand|commande|review/i;

export function isLikelyRetail(m: FetchedMessage): boolean {
  const from = m.envelope?.from?.[0]?.address ?? '';
  if (domainMatches(domainOf(from), RETAIL_DOMAINS)) return true;
  return SUBJECT_HINT.test(m.envelope?.subject ?? '');
}

export interface SyncOptions {
  settings?: AppSettings;
  cipher?: DataCipher | null;
  sink?: EventSink;
  batchSize?: number;
  signal?: AbortSignal;
  onProgress?: (p: SyncProgress) => void;
  /** Test hook: called after each message is committed. */
  afterMessage?: (uid: number) => void;
}

export interface SyncSummary {
  processed: number;
  scanned: number;
  ordersCreated: number;
  ordersUpdated: number;
  failures: number;
}

const SOURCE_CHUNK = 10;

/** A transient failure: the sync stops cleanly and resumes from the last checkpoint on the next run. */
export class RetryableSyncError extends Error {}

/** Provider throttling / dropped-connection errors that are worth retrying after a pause. */
export function isThrottleError(e: unknown): boolean {
  const x = e as { message?: string; responseText?: string; code?: string } | null;
  const msg = `${x?.message ?? ''} ${x?.responseText ?? ''} ${x?.code ?? ''}`;
  return /throttl|rate.?limit|too many|try again|bandwidth|limit exceeded|over ?quota|unavailable|temporar|ECONNRESET|ETIMEDOUT|EPIPE|socket|NoConnection|connection (closed|not available)/i.test(msg);
}

export const RETRY_DELAYS_MS = [5000, 20000, 60000];

async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal, delays = RETRY_DELAYS_MS): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= delays.length || !isThrottleError(e) || signal?.aborted) throw e;
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}

function getCheckpoint(db: Db, accountId: number, mailbox: string) {
  return db.get<{ uid_validity: string; last_uid: number }>('SELECT uid_validity, last_uid FROM sync_checkpoints WHERE account_id = ? AND mailbox = ?', [accountId, mailbox]);
}

function setCheckpoint(db: Db, accountId: number, mailbox: string, uidValidity: string, lastUid: number) {
  db.run(
    `INSERT INTO sync_checkpoints (account_id, mailbox, uid_validity, last_uid, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id, mailbox) DO UPDATE SET uid_validity = excluded.uid_validity, last_uid = MAX(CASE WHEN sync_checkpoints.uid_validity = excluded.uid_validity THEN sync_checkpoints.last_uid ELSE 0 END, excluded.last_uid), updated_at = excluded.updated_at`,
    [accountId, mailbox, uidValidity, lastUid, now()],
  );
}

export async function syncAccount(db: Db, account: AccountRow, client: MailClient, opts: SyncOptions = {}): Promise<SyncSummary> {
  const settings = opts.settings ?? DEFAULT_SETTINGS;
  const sink = opts.sink ?? new EventSink();
  const templates = loadTemplates(db);
  const batchSize = opts.batchSize ?? 40;
  const summary: SyncSummary = { processed: 0, scanned: 0, ordersCreated: 0, ordersUpdated: 0, failures: 0 };
  const progress = (phase: SyncProgress['phase'], extra: Partial<SyncProgress> = {}) =>
    opts.onProgress?.({ accountId: account.id, accountLabel: account.label, phase, processed: summary.processed, ordersCreated: summary.ordersCreated, ordersUpdated: summary.ordersUpdated, failures: summary.failures, ...extra });

  db.run("UPDATE email_accounts SET status = 'syncing' WHERE id = ?", [account.id]);
  progress('connecting');
  try {
    await client.connect();
    const mailboxes = await withRetry(() => resolveMailboxes(client, account), opts.signal);
    for (const mailbox of mailboxes) {
      if (opts.signal?.aborted) break;
      const mb = await client.mailboxOpen(mailbox, { readOnly: true });
      const uv = String(mb.uidValidity);
      const cp = getCheckpoint(db, account.id, mailbox);
      const lastUid = cp && cp.uid_validity === uv ? cp.last_uid : 0;
      progress('listing', { mailbox });
      let query: Record<string, unknown>;
      if (lastUid > 0) query = { uid: `${lastUid + 1}:*` };
      else if (account.backfill_days > 0) query = { since: new Date(Date.now() - account.backfill_days * 86400000) };
      else query = { since: new Date(new Date(account.created_at).getTime() - 86400000) };
      const found = (await withRetry(() => client.search(query, { uid: true }), opts.signal)) || [];
      const uids = found.filter((u) => u > lastUid).sort((a, b) => a - b);
      if (!cp || cp.uid_validity !== uv) setCheckpoint(db, account.id, mailbox, uv, lastUid);
      for (let i = 0; i < uids.length; i += batchSize) {
        if (opts.signal?.aborted) break;
        const batch = uids.slice(i, i + batchSize);
        const envs = await withRetry(() => client.fetchAll(batch.join(','), { uid: true, envelope: true, internalDate: true }, { uid: true }), opts.signal);
        const wanted = envs.filter(isLikelyRetail).map((m) => m.uid);
        const sources = new Map<number, FetchedMessage>();
        // Bodies are pulled in small chunks so a large backlog doesn't trip the provider's bandwidth throttling.
        for (let j = 0; j < wanted.length; j += SOURCE_CHUNK) {
          const chunk = wanted.slice(j, j + SOURCE_CHUNK);
          for (const m of await withRetry(() => client.fetchAll(chunk.join(','), { uid: true, source: true, internalDate: true }, { uid: true }), opts.signal)) sources.set(m.uid, m);
        }
        // A throttled server can return fewer bodies than asked for. Retry those one by one, and never
        // move the checkpoint past a message we wanted but could not download.
        for (const uid of wanted) {
          if (sources.get(uid)?.source) continue;
          const [m] = await withRetry(() => client.fetchAll(String(uid), { uid: true, source: true, internalDate: true }, { uid: true }), opts.signal);
          if (m?.source) sources.set(uid, m);
          else throw new RetryableSyncError(`message ${uid} could not be downloaded; will retry next sync`);
        }
        for (const uid of batch) {
          if (opts.signal?.aborted) break;
          summary.scanned++;
          const m = sources.get(uid);
          if (m?.source) {
            const received = m.internalDate ? new Date(m.internalDate).toISOString() : undefined;
            const r = await processRawMessage({ db, settings, cipher: opts.cipher, sink, templates }, m.source, { kind: 'imap', accountId: account.id, mailbox, uidValidity: uv, uid }, received);
            if (r.status !== 'already_processed') {
              summary.processed++;
              if (r.status === 'failed') {
                summary.failures++;
                sink.push({ kind: 'parser_failure', key: `pf:${r.sourceMessageId}`, retailerId: r.retailer, at: now(), detail: { reason: r.reason } });
              }
              if (r.status === 'parsed' && r.orderCreated) summary.ordersCreated++;
              else if (r.status === 'parsed') summary.ordersUpdated++;
            }
          }
          setCheckpoint(db, account.id, mailbox, uv, uid);
          opts.afterMessage?.(uid);
        }
        db.run('UPDATE email_accounts SET processed_count = processed_count + ? WHERE id = ?', [batch.length, account.id]);
        progress('processing', { mailbox, total: uids.length, message: `${Math.min(i + batchSize, uids.length)}/${uids.length}` });
      }
    }
    db.run("UPDATE email_accounts SET status = 'connected', last_sync_at = ?, last_error = NULL WHERE id = ?", [now(), account.id]);
    progress('done');
  } catch (e) {
    const msg = redact((e as Error).message ?? String(e), 300);
    const status = /auth|login|credential|invalid_grant|AUTHENTICATIONFAILED/i.test(msg) ? 'needs_auth' : e instanceof RetryableSyncError || isThrottleError(e) ? 'throttled' : 'error';
    db.run('UPDATE email_accounts SET status = ?, last_error = ?, error_count = error_count + 1 WHERE id = ?', [status, msg, account.id]);
    progress('error', { message: msg });
    throw e;
  } finally {
    try {
      await client.logout();
    } catch {
      // connection already closed
    }
  }
  return summary;
}

export interface ImapConnection {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass?: string;
  accessToken?: string;
}

/** Creates a real imapflow client. Kept separate so tests never touch the network. */
export async function createImapClient(c: ImapConnection): Promise<MailClient> {
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: c.accessToken ? { user: c.user, accessToken: c.accessToken } : { user: c.user, pass: c.pass ?? '' },
    logger: false,
    emitLogs: false,
    clientInfo: { name: 'GLIDE Order Command Center', version: '0.1.0' },
  } as never);
  return client as unknown as MailClient;
}

export const KNOWN_IMAP: Record<string, { host: string; port: number; secure: boolean }> = {
  gmail: { host: 'imap.gmail.com', port: 993, secure: true },
  outlook: { host: 'outlook.office365.com', port: 993, secure: true },
  yahoo: { host: 'imap.mail.yahoo.com', port: 993, secure: true },
  icloud: { host: 'imap.mail.me.com', port: 993, secure: true },
  aol: { host: 'imap.aol.com', port: 993, secure: true },
  fastmail: { host: 'imap.fastmail.com', port: 993, secure: true },
};

export function guessImapHost(address: string): { host: string; port: number; secure: boolean } | null {
  const d = domainOf(address);
  if (d === 'gmail.com' || d === 'googlemail.com') return KNOWN_IMAP.gmail;
  if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com'].includes(d)) return KNOWN_IMAP.outlook;
  if (d.startsWith('yahoo.') || d === 'ymail.com') return KNOWN_IMAP.yahoo;
  if (['icloud.com', 'me.com', 'mac.com'].includes(d)) return KNOWN_IMAP.icloud;
  if (d === 'aol.com') return KNOWN_IMAP.aol;
  if (d === 'fastmail.com') return KNOWN_IMAP.fastmail;
  return null;
}
