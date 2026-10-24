// Mail coverage check: a read-only, headers-only pass over an inbox that shows
// which order-looking messages GLIDE downloaded, parsed, skipped or never saw —
// including mail that lives outside the synced folders (e.g. Gmail filters
// that archive order emails out of the Inbox).

import { type Db } from '../db/database';
import { classifyMessageType } from '../parsing/extract';
import { unrelayAddress } from '../retailers/registry';
import { isLikelyRetail, resolveMailboxes, type AccountRow, type FetchedMessage, type MailClient } from './imapSync';

export interface CoverageRow {
  mailbox: string;
  uid: number;
  date: string | null;
  from: string;
  subject: string;
  type: string;
  /** downloaded = parsed / failed / ignored; skipped = never downloaded; outside = not in a synced folder. */
  state: 'parsed' | 'failed' | 'ignored' | 'duplicate' | 'skipped' | 'pending' | 'outside';
  reason: string | null;
}

export interface CoverageMailbox {
  mailbox: string;
  synced: boolean;
  messages: number;
  orderLike: number;
  parsed: number;
  failed: number;
  ignored: number;
  skipped: number;
  pending: number;
  outside: number;
}

export interface CoverageReport {
  days: number;
  mailboxes: CoverageMailbox[];
  rows: CoverageRow[];
  availableMailboxes: string[];
}

export async function mailCoverage(db: Db, account: AccountRow, client: MailClient, days = 30): Promise<CoverageReport> {
  await client.connect();
  try {
    const synced = await resolveMailboxes(client, account);
    let available: string[] = [];
    let allMail: string | null = null;
    if (client.list) {
      const boxes = await client.list();
      available = boxes.map((b) => b.path);
      allMail = boxes.find((b) => b.specialUse === '\\All' || b.flags?.has('\\All'))?.path ?? null;
    }
    const toScan = [...synced, ...(allMail && !synced.includes(allMail) ? [allMail] : [])];
    const since = new Date(Date.now() - days * 86400000);
    const syncedIds = new Set<string>();
    const report: CoverageReport = { days, mailboxes: [], rows: [], availableMailboxes: available };

    for (const mailbox of toScan) {
      const isSynced = synced.includes(mailbox);
      const mb = await client.mailboxOpen(mailbox, { readOnly: true });
      const uv = String(mb.uidValidity);
      const uids = ((await client.search({ since }, { uid: true })) || []).sort((a, b) => a - b);
      const cp = db.get<{ uid_validity: string; last_uid: number }>('SELECT uid_validity, last_uid FROM sync_checkpoints WHERE account_id = ? AND mailbox = ?', [account.id, mailbox]);
      const box: CoverageMailbox = { mailbox, synced: isSynced, messages: uids.length, orderLike: 0, parsed: 0, failed: 0, ignored: 0, skipped: 0, pending: 0, outside: 0 };
      for (let i = 0; i < uids.length; i += 400) {
        const envs: (FetchedMessage & { envelope?: { messageId?: string } })[] = await client.fetchAll(uids.slice(i, i + 400).join(','), { uid: true, envelope: true, internalDate: true }, { uid: true });
        for (const m of envs) {
          const subject = m.envelope?.subject ?? '';
          const from = m.envelope?.from?.[0]?.address ?? '';
          const msgId = m.envelope?.messageId;
          if (isSynced && msgId) syncedIds.add(msgId);
          const type = classifyMessageType(subject, []);
          if (type === 'unknown') continue;
          box.orderLike++;
          let state: CoverageRow['state'];
          let reason: string | null = null;
          if (!isSynced) {
            if (msgId && syncedIds.has(msgId)) continue;
            state = 'outside';
            reason = `only in "${mailbox}", which GLIDE doesn't sync`;
          } else {
            const sm = db.get<{ parse_status: string; parse_error: string | null }>('SELECT parse_status, parse_error FROM source_messages WHERE account_id = ? AND mailbox = ? AND uid_validity = ? AND uid = ?', [account.id, mailbox, uv, m.uid]);
            if (sm) {
              state = sm.parse_status as CoverageRow['state'];
              reason = sm.parse_error;
            } else if (!cp || cp.uid_validity !== uv || m.uid > cp.last_uid) {
              state = 'pending';
              reason = 'not synced yet';
            } else {
              state = 'skipped';
              reason = isLikelyRetail(m) ? 'downloaded but not recorded' : 'sender/subject not recognised as retail';
            }
          }
          box[state === 'duplicate' ? 'parsed' : state]++;
          if (state !== 'parsed' && state !== 'duplicate') {
            const real = unrelayAddress(from);
            report.rows.push({ mailbox, uid: m.uid, date: m.internalDate ? new Date(m.internalDate).toISOString() : null, from: real ? `${real} (via relay)` : from, subject, type, state, reason });
          }
        }
      }
      report.mailboxes.push(box);
    }
    report.rows = report.rows.slice(0, 500);
    return report;
  } finally {
    try {
      await client.logout();
    } catch {
      // already closed
    }
  }
}
