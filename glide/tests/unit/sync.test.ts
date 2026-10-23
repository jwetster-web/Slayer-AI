import { describe, expect, it } from 'vitest';
import { syncAccount, type FetchedMessage, type MailClient } from '../../src/core/email/imapSync';
import { buildAuthUrl, pkcePair, refreshTokens } from '../../src/core/email/oauth';
import { renderSampleEmail } from '../../src/core/sample/retailerEmails';
import { buildMime } from '../../src/core/sample/mime';
import { memDb } from './helpers';

class FakeImap implements MailClient {
  readOnlyOpens = 0;
  writes = 0;
  fetchedSources: number[] = [];
  constructor(public messages: { uid: number; raw: string; from: string; subject: string }[], public uidValidity = 7) {}
  async connect() {}
  async logout() {}
  async mailboxOpen(_p: string, o: { readOnly: true }) {
    if (o.readOnly) this.readOnlyOpens++;
    return { uidValidity: BigInt(this.uidValidity), exists: this.messages.length };
  }
  async search(q: Record<string, unknown>) {
    const uidQ = q.uid as string | undefined;
    const min = uidQ ? Number(uidQ.split(':')[0]) : 0;
    const uids = this.messages.map((m) => m.uid).filter((u) => u >= min);
    // Real servers return the highest UID for "N:*" even when N is larger.
    return uids.length ? uids : [this.messages[this.messages.length - 1].uid];
  }
  async fetchAll(range: string, q: Record<string, unknown>): Promise<FetchedMessage[]> {
    const want = new Set(range.split(',').map(Number));
    return this.messages.filter((m) => want.has(m.uid)).map((m) => {
      if (q.source) this.fetchedSources.push(m.uid);
      return { uid: m.uid, envelope: { from: [{ address: m.from }], subject: m.subject }, source: q.source ? Buffer.from(m.raw) : undefined, internalDate: new Date('2026-10-20T16:00:00Z') };
    });
  }
}

function mailbox(n: number) {
  const msgs = [];
  for (let i = 1; i <= n; i++) {
    if (i % 4 === 0) {
      const raw = buildMime({ from: 'friend@example.com', to: 'me@example.com', subject: 'Weekend plans', date: new Date(), text: 'hi' });
      msgs.push({ uid: i * 3, raw, from: 'friend@example.com', subject: 'Weekend plans' });
      continue;
    }
    const r = renderSampleEmail({ retailer: 'target', type: 'order_confirmation', orderNumber: `91200000000${String(i).padStart(4, '0')}`, date: new Date('2026-10-20T16:00:00Z'), to: 'buyer@example.com', items: [{ title: 'Pokémon TCG: Elite Trainer Box', sku: 'ETB', qty: 1, unitCents: 4999 }], address: { name: 'A B', line1: '1 Main St', city: 'X', state: 'IL', postal: '62704' }, taxCents: 0, shippingCents: 0 });
    msgs.push({ uid: i * 3, raw: r.raw, from: r.from, subject: r.subject });
  }
  return msgs;
}

function account(db: ReturnType<typeof memDb>) {
  const id = db.run("INSERT INTO email_accounts (label, kind, address, created_at) VALUES ('Test', 'imap', 'me@example.com', '2026-10-01T00:00:00Z')").lastId;
  return db.get<any>('SELECT * FROM email_accounts WHERE id = ?', [id]);
}

describe('IMAP sync engine', () => {
  it('Scenario 8: recovers after a crash mid-sync without duplicates or lost checkpoints', async () => {
    const db = memDb();
    const acct = account(db);
    const server = new FakeImap(mailbox(20));
    let count = 0;
    await expect(
      syncAccount(db, acct, server, { batchSize: 5, afterMessage: () => { if (++count === 9) throw new Error('simulated crash'); } }),
    ).rejects.toThrow('simulated crash');
    const cp = db.get<any>('SELECT * FROM sync_checkpoints');
    expect(cp.last_uid).toBe(27); // 9th message (uid 27) was committed before the crash
    const ordersAfterCrash = db.value<number>('SELECT COUNT(*) FROM orders');
    expect(ordersAfterCrash).toBe(7);

    const summary = await syncAccount(db, acct, server, { batchSize: 5 });
    expect(db.value<number>('SELECT COUNT(*) FROM orders')).toBe(15);
    expect(summary.ordersCreated).toBe(8);
    expect(db.get<any>('SELECT last_uid FROM sync_checkpoints').last_uid).toBe(60);
    // A third run finds nothing new.
    const again = await syncAccount(db, acct, server, { batchSize: 5 });
    expect(again.processed).toBe(0);
    expect(db.value<number>('SELECT COUNT(*) FROM orders')).toBe(15);
    // Read-only: every open used readOnly; non-retail bodies were never downloaded.
    expect(server.readOnlyOpens).toBe(3);
    expect(server.fetchedSources.some((u) => u % 12 === 0)).toBe(false);
    expect(db.value("SELECT status FROM email_accounts")).toBe('connected');
  });

  it('starts over safely when UIDVALIDITY changes', async () => {
    const db = memDb();
    const acct = account(db);
    await syncAccount(db, acct, new FakeImap(mailbox(4), 7));
    const before = db.value<number>('SELECT COUNT(*) FROM orders');
    await syncAccount(db, acct, new FakeImap(mailbox(4), 8));
    expect(db.value<number>('SELECT COUNT(*) FROM orders')).toBe(before);
    expect(db.get<any>('SELECT uid_validity FROM sync_checkpoints').uid_validity).toBe('8');
  });

  it('marks the account as needing re-auth on login failures', async () => {
    const db = memDb();
    const acct = account(db);
    const bad: MailClient = { ...new FakeImap([]), connect: async () => { throw new Error('AUTHENTICATIONFAILED Invalid credentials'); }, logout: async () => {}, mailboxOpen: async () => ({ uidValidity: 1 }), search: async () => [], fetchAll: async () => [] };
    await expect(syncAccount(db, acct, bad)).rejects.toThrow();
    expect(db.value('SELECT status FROM email_accounts')).toBe('needs_auth');
  });
});

describe('OAuth', () => {
  it('builds a PKCE authorization URL', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThan(40);
    const u = new URL(buildAuthUrl('gmail', { clientId: 'cid' }, 'http://127.0.0.1:5555/callback', 'st', challenge));
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('scope')).toContain('https://mail.google.com/');
    expect(u.searchParams.get('access_type')).toBe('offline');
  });

  it('refreshes expired tokens and keeps the refresh token', async () => {
    let called = 0;
    const fetcher = async (_url: string, init: { body: string }) => {
      called++;
      expect(init.body).toContain('grant_type=refresh_token');
      return { ok: true, status: 200, json: async () => ({ access_token: 'new', expires_in: 3600 }) };
    };
    const t = await refreshTokens('outlook', { clientId: 'cid' }, { accessToken: 'old', refreshToken: 'rt', expiresAt: Date.now() - 1000 }, fetcher);
    expect(called).toBe(1);
    expect(t.accessToken).toBe('new');
    expect(t.refreshToken).toBe('rt');
    const fresh = await refreshTokens('outlook', { clientId: 'cid' }, t, fetcher);
    expect(called).toBe(1);
    expect(fresh.accessToken).toBe('new');
  });
});
