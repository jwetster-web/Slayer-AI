// Background worker thread: email sync, imports, sample generation, image
// caching, carrier tracking, Discord outbox and export rendering. Runs with
// its own SQLite connection so the UI and main process never block on it.

import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { runAutomations } from '../src/core/automation/rules';
import { openDb, now, type Db } from '../src/core/db/database';
import { flushOutbox, type DiscordConfig } from '../src/core/discord/discord';
import { mailCoverage } from '../src/core/email/coverage';
import { createImapClient, guessImapHost, isThrottleError, RetryableSyncError, syncAccount, type AccountRow } from '../src/core/email/imapSync';
import { splitMbox } from '../src/core/email/mime';
import { refreshTokens, type OAuthClientConfig, type OAuthTokens } from '../src/core/email/oauth';
import { loadTemplates, processRawMessage, readRawMessage, type MessageRef } from '../src/core/email/process';
import { EventSink } from '../src/core/events';
import { buildRecapData, type RecapOptions } from '../src/core/export/data';
import { renderExport, renderMp4, setFontDir, type RenderRequest } from '../src/core/export/render';
import { cacheProductImages, cacheFileName, httpImageFetcher } from '../src/core/products/images';
import { generateSampleWorkspace } from '../src/core/sample/generator';
import { DataCipher, SecretStore } from '../src/core/secrets';
import { refreshDuePackages, type ProviderCredentials } from '../src/core/tracking/providers';
import { getSettings } from '../src/core/workspace';
import type { OrderFilter } from '../src/shared/types';
import type { WorkerEvent, WorkerInit, WorkerJob, WorkerOut } from '../src/shared/worker';

process.removeAllListeners('warning');

const init = workerData as WorkerInit;
const db: Db = openDb(init.dbPath);
const cipher = new DataCipher(Buffer.from(init.key, 'hex'));
const secrets = new SecretStore(db, cipher);
setFontDir(init.fontDir);

const post = (m: WorkerOut) => parentPort!.postMessage(m);
const emit = (event: WorkerEvent) => post({ type: 'event', event });
const changed = (...scope: string[]) => emit({ kind: 'dataChanged', scope });

async function afterEvents(sink: EventSink) {
  if (!sink.events.length) return;
  await runAutomations(db, sink.events, getSettings(db));
}

async function connectionFor(a: AccountRow & { kind: string; address: string; host: string | null; port: number | null; secure: number; username: string | null; auth_kind: string }) {
  const guess = guessImapHost(a.address);
  const host = a.host || (a.kind === 'gmail' ? 'imap.gmail.com' : a.kind === 'outlook' ? 'outlook.office365.com' : guess?.host);
  if (!host) throw new Error('No IMAP server configured for this account');
  const base = { host, port: a.port || 993, secure: a.port === 143 ? false : a.secure !== 0, user: a.username || a.address };
  if (a.auth_kind === 'oauth') {
    const provider = a.kind === 'outlook' ? 'outlook' : 'gmail';
    const cfg = secrets.getJson<OAuthClientConfig>(`oauth:client:${provider}`);
    let tokens = secrets.getJson<OAuthTokens>(`account:${a.id}:oauth`);
    if (!cfg || !tokens) throw new Error('OAuth not connected — reconnect the account (invalid_grant)');
    tokens = await refreshTokens(provider, cfg, tokens);
    secrets.setJson(`account:${a.id}:oauth`, tokens);
    return { ...base, accessToken: tokens.accessToken };
  }
  const pass = secrets.get(`account:${a.id}:password`);
  if (!pass) throw new Error('Missing app password — edit the account to add it (AUTHENTICATIONFAILED)');
  return { ...base, pass };
}

const running = new Set<number>();
// After a throttling error an inbox cools down (2, 4, 8 … 30 min) instead of being hit again every poll,
// which is what keeps a provider's rate limit from escalating into a temporary lockout.
const cooldown = new Map<number, { until: number; strikes: number }>();

async function syncOne(accountId: number, force = false) {
  if (running.has(accountId)) return { skipped: true };
  const cd = cooldown.get(accountId);
  if (!force && cd && Date.now() < cd.until) return { skipped: true, coolingDownUntil: new Date(cd.until).toISOString() };
  running.add(accountId);
  try {
    const a = db.get<any>('SELECT * FROM email_accounts WHERE id = ?', [accountId]);
    if (!a || !a.enabled || a.kind === 'import') return { skipped: true };
    const conn = await connectionFor(a);
    const client = await createImapClient(conn);
    const sink = new EventSink();
    const summary = await syncAccount(db, a, client, {
      settings: getSettings(db),
      cipher,
      sink,
      onProgress: (progress) => emit({ kind: 'progress', progress }),
    });
    cooldown.delete(accountId);
    await afterEvents(sink);
    if (summary.processed) changed('orders', 'activity', 'identity');
    return summary;
  } catch (e) {
    if (e instanceof RetryableSyncError || isThrottleError(e)) {
      const strikes = (cooldown.get(accountId)?.strikes ?? 0) + 1;
      const until = Date.now() + Math.min(30, 2 ** strikes) * 60000;
      cooldown.set(accountId, { until, strikes });
      emit({ kind: 'log', level: 'warn', message: `inbox ${accountId} throttled by the mail server; pausing it until ${new Date(until).toLocaleTimeString()}` });
    }
    throw e;
  } finally {
    running.delete(accountId);
  }
}

async function importFiles(paths: string[], accountId: number | null) {
  const files: string[] = [];
  for (const p of paths) {
    if (statSync(p).isDirectory()) for (const f of readdirSync(p)) files.push(join(p, f));
    else files.push(p);
  }
  const messages: { buf: Buffer; label: string }[] = [];
  for (const f of files) {
    const ext = extname(f).toLowerCase();
    if (ext === '.eml') messages.push({ buf: readFileSync(f), label: f });
    else if (ext === '.mbox' || ext === '') for (const m of splitMbox(readFileSync(f))) messages.push({ buf: Buffer.from(m), label: f });
  }
  const sink = new EventSink();
  const counts: Record<string, number> = {};
  const settings = getSettings(db);
  const templates = loadTemplates(db);
  for (const [i, m] of messages.entries()) {
    const ref: MessageRef = { kind: 'import', accountId, importRef: `file:${createHash('sha256').update(m.buf).digest('hex')}` };
    const r = await processRawMessage({ db, settings, cipher, sink, templates }, m.buf, ref);
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    if (r.status === 'failed') sink.push({ kind: 'parser_failure', key: `pf:${r.sourceMessageId}`, retailerId: r.retailer, at: now() });
    if (i % 20 === 0 || i === messages.length - 1) emit({ kind: 'import', done: i + 1, total: messages.length, label: 'Importing messages' });
  }
  db.run(
    "INSERT OR IGNORE INTO activity_feed (at, kind, label, dedupe_key) VALUES (?, 'import', ?, ?)",
    [now(), `Imported ${messages.length} messages (${counts.parsed ?? 0} order events)`, `imp:${Date.now()}`],
  );
  await afterEvents(sink);
  changed('orders', 'activity', 'identity', 'products');
  return { messages: messages.length, counts };
}

async function cacheMemberAvatars() {
  const rows = db.all<{ id: number; avatar_url: string }>("SELECT id, avatar_url FROM members WHERE avatar_url LIKE 'https://cdn.discordapp.com/%' LIMIT 200");
  for (const r of rows) {
    const img = await httpImageFetcher(r.avatar_url);
    if (!img) continue;
    const name = cacheFileName(r.avatar_url, img.contentType);
    writeFileSync(join(init.imageDir, name), img.data);
    db.run('UPDATE members SET avatar_url = ? WHERE id = ?', [`glide-img://local/${name}`, r.id]);
  }
}

async function reprocessFailed() {
  const rows = db.all<{ id: number; account_id: number | null; mailbox: string | null; uid: number | null; uid_validity: string | null; import_ref: string | null; received_at: string }>(
    "SELECT id, account_id, mailbox, uid, uid_validity, import_ref, received_at FROM source_messages WHERE parse_status = 'failed'",
  );
  let fixed = 0;
  for (const r of rows) {
    const raw = readRawMessage(db, r.id, cipher);
    if (!raw) continue;
    const ref: MessageRef = r.uid !== null && r.mailbox && r.uid_validity && r.account_id ? { kind: 'imap', accountId: r.account_id, mailbox: r.mailbox, uidValidity: r.uid_validity, uid: r.uid } : { kind: 'import', accountId: r.account_id, importRef: r.import_ref ?? `reprocess:${r.id}` };
    db.run('DELETE FROM source_messages WHERE id = ?', [r.id]);
    const res = await processRawMessage({ db, settings: getSettings(db), cipher, templates: loadTemplates(db) }, raw, ref, r.received_at);
    if (res.status === 'parsed' || res.status === 'duplicate') fixed++;
  }
  changed('orders', 'diagnostics');
  return { attempted: rows.length, fixed };
}

async function handle(job: WorkerJob): Promise<unknown> {
  switch (job.type) {
    case 'syncAll': {
      const ids = db.all<{ id: number }>("SELECT id FROM email_accounts WHERE enabled = 1 AND kind <> 'import'").map((r) => r.id);
      const results: Record<number, unknown> = {};
      for (const id of ids) {
        try {
          results[id] = await syncOne(id);
        } catch (e) {
          results[id] = { error: (e as Error).message };
        }
      }
      changed('accounts');
      return results;
    }
    case 'syncAccount':
      try {
        return await syncOne(job.accountId, true);
      } finally {
        changed('accounts');
      }
    case 'coverage': {
      const a = db.get<any>('SELECT * FROM email_accounts WHERE id = ?', [job.accountId]);
      if (!a || a.kind === 'import') throw new Error('Coverage check needs a connected inbox');
      return mailCoverage(db, a, (await createImapClient(await connectionFor(a))) as never, job.days);
    }
    case 'importFiles':
      return importFiles(job.paths, job.accountId);
    case 'generateSample': {
      const out = await generateSampleWorkspace(db, { orders: job.orders, imageDir: init.imageDir, onProgress: (done, total, phase) => emit({ kind: 'sample', done, total, phase }) });
      changed('all');
      return out;
    }
    case 'cacheImages': {
      let n = 0;
      if (getSettings(db).fetchRemoteProductImages) n = await cacheProductImages(db, init.imageDir, httpImageFetcher, 60);
      await cacheMemberAvatars();
      if (n) changed('products', 'orders');
      return n;
    }
    case 'refreshTracking': {
      const sink = new EventSink();
      const r = await refreshDuePackages({ db, sink, credentialsFor: (id) => secrets.getJson<ProviderCredentials>(`tracking:${id}`) });
      await afterEvents(sink);
      if (r.updated) changed('orders', 'shipping', 'activity');
      return r;
    }
    case 'flushOutbox': {
      const cfg = secrets.getJson<DiscordConfig>('discord:config');
      return flushOutbox(db, getSettings(db).discordEnabled ? cfg : null);
    }
    case 'reprocessFailed':
      return reprocessFailed();
    case 'render': {
      await cacheMemberAvatars();
      const data = buildRecapData(db, job.filter as OrderFilter, getSettings(db), { ...(job.recap as RecapOptions), imageDir: init.imageDir });
      const req = job.request as RenderRequest;
      if (job.mp4) {
        await renderMp4(data, req, job.outPath);
        return { path: job.outPath, bytes: statSync(job.outPath).size };
      }
      const r = await renderExport(data, req);
      writeFileSync(job.outPath, r.buffer);
      return { path: job.outPath, bytes: r.buffer.length, mime: r.mime };
    }
  }
}

parentPort!.on('message', async (m: { id: number; job: WorkerJob }) => {
  try {
    const value = await handle(m.job);
    post({ type: 'result', id: m.id, ok: true, value });
  } catch (e) {
    post({ type: 'result', id: m.id, ok: false, error: (e as Error).message ?? String(e) });
  }
});

post({ type: 'ready' });
