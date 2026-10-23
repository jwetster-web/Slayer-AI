// IPC handlers. The renderer's API type is derived from this object
// (`Handlers`), so the contract can never drift between processes.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { app, BrowserWindow, dialog, shell } from 'electron';
import { analyticsBundle, campaignStats, kpis, type Granularity } from '../src/core/analytics/engine';
import { audit } from '../src/core/audit';
import { listRules, ruleExecutions, setRuleEnabled } from '../src/core/automation/rules';
import { backupNow, exportAllTables, forgetMember, listBackups } from '../src/core/backup';
import { exportMembersCsv, exportOrdersCsv, memberInvoice, toCsv } from '../src/core/csv/exporter';
import { applyImport, listImportBatches, parseCsv, previewImport, rollbackImport, PRESETS, FIELDS, type Mapping, type ParsedCsv } from '../src/core/csv/importer';
import { invoicePdf } from '../src/core/csv/invoicePdf';
import { now, json } from '../src/core/db/database';
import { syncGuildMembers, testConnection, type DiscordConfig } from '../src/core/discord/discord';
import { guessImapHost } from '../src/core/email/imapSync';
import { runLoopbackFlow, type OAuthClientConfig, type OAuthProvider } from '../src/core/email/oauth';
import { buildRecapData, type RecapOptions } from '../src/core/export/data';
import { buildSvg, CANVAS_PRESETS, ffmpegAvailable, type RenderRequest } from '../src/core/export/render';
import { TEMPLATES, defaultCustomProject, type CustomProject } from '../src/core/export/templates';
import { assignOrder, resolveCandidate, scanDuplicateMembers } from '../src/core/identity/matcher';
import { assignProfile, createProfile, mergeMembers, splitProfiles, upsertMember } from '../src/core/identity/store';
import { addTrackingEvent } from '../src/core/orders/ingest';
import { recomputeOrder, refreshSearchText } from '../src/core/orders/state';
import { addProductImage, CATEGORY_LABEL } from '../src/core/products/catalog';
import {
  auditLog, discoverySummary, getMember, getOrder, listActivity, listCandidates, listEmailAccounts, listMembers, listOrders, listProducts, listProfiles,
  parserFailures, productDetail, sharedAddresses, shipmentOverview,
} from '../src/core/queries/views';
import { RETAILERS } from '../src/core/retailers/registry';
import { classifyTracking, trackingUrl } from '../src/core/tracking/carriers';
import { PROVIDERS, type ProviderCredentials } from '../src/core/tracking/providers';
import { getMeta, getSettings, setMeta, updateSettings } from '../src/core/workspace';
import type { AppSettings, Carrier, OrderFilter, SyncHealth } from '../src/shared/types';
import type { WorkerJob } from '../src/shared/worker';
import type { WorkspaceManager } from './workspaces';

export interface HandlerContext {
  ws: WorkspaceManager;
  runJob: (job: WorkerJob) => Promise<unknown>;
  restartWorker: () => Promise<void>;
  window: () => BrowserWindow | null;
  fontDir: string;
  sync: { paused: boolean; lastSyncAt: string | null; setPaused(p: boolean): void; trigger(): void };
  logs: { at: string; level: string; message: string }[];
}

const ACTOR = 'admin';

export function createHandlers(ctx: HandlerContext) {
  const cur = () => {
    if (!ctx.ws.current) throw new Error('No workspace is open');
    return ctx.ws.current;
  };
  const db = () => cur().db;
  const settings = () => getSettings(db());
  const csvCache = new Map<string, { csv: ParsedCsv; filename: string }>();

  async function saveDialog(defaultName: string, filters: Electron.FileFilter[]) {
    const win = ctx.window();
    const r = win ? await dialog.showSaveDialog(win, { defaultPath: join(app.getPath('documents'), defaultName), filters }) : await dialog.showSaveDialog({ defaultPath: defaultName, filters });
    return r.canceled ? null : r.filePath ?? null;
  }

  function recapOptions(o: Partial<RecapOptions> = {}): RecapOptions {
    const w = cur();
    const logo = getMeta(w.db, 'brand_logo');
    return { imageDir: w.imageDir, isSample: w.info.isSample, logoPath: logo ? join(w.imageDir, logo) : null, ...o };
  }

  return {
    // -- App ----------------------------------------------------------------
    'app.info': async () => ({
      version: app.getVersion(),
      platform: process.platform,
      electron: process.versions.electron,
      workspace: ctx.ws.current?.info ?? null,
      ffmpeg: !!(await ffmpegAvailable()),
      retailers: RETAILERS.map((r) => ({ id: r.id, name: r.name, shortName: r.shortName, color: r.color, primary: r.primary })),
      categories: CATEGORY_LABEL,
    }),
    'app.openExternal': async (url: string) => {
      if (!/^https:\/\//i.test(url)) throw new Error('Only https links can be opened');
      await shell.openExternal(url);
    },
    'app.showItem': (path: string) => shell.showItemInFolder(path),
    'dialog.openFiles': async (opts: { filters?: Electron.FileFilter[]; directory?: boolean; multi?: boolean } = {}) => {
      const props: ('openFile' | 'openDirectory' | 'multiSelections')[] = [opts.directory ? 'openDirectory' : 'openFile'];
      if (opts.multi) props.push('multiSelections');
      const win = ctx.window();
      const r = win ? await dialog.showOpenDialog(win, { properties: props, filters: opts.filters }) : await dialog.showOpenDialog({ properties: props, filters: opts.filters });
      return r.canceled ? [] : r.filePaths;
    },

    // -- Workspaces ---------------------------------------------------------
    'workspace.list': () => ctx.ws.list(),
    'workspace.current': () => (ctx.ws.current ? { ...ctx.ws.current.info, setupComplete: getMeta(db(), 'setup_complete') === '1' } : null),
    'workspace.create': async (name: string, sample: boolean, sampleOrders = 1000) => {
      const info = ctx.ws.create(name || (sample ? 'Sample Workspace' : 'PokeSlayerz'), sample);
      ctx.ws.open(info.id);
      await ctx.restartWorker();
      if (sample) await ctx.runJob({ type: 'generateSample', orders: sampleOrders });
      return ctx.ws.current!.info;
    },
    'workspace.open': async (id: string) => {
      ctx.ws.open(id);
      await ctx.restartWorker();
      return ctx.ws.current!.info;
    },
    'workspace.rename': (id: string, name: string) => ctx.ws.rename(id, name),
    'workspace.delete': async (id: string) => {
      const wasCurrent = ctx.ws.current?.info.id === id;
      ctx.ws.delete(id);
      if (wasCurrent) await ctx.restartWorker();
    },
    'workspace.completeSetup': () => setMeta(db(), 'setup_complete', '1'),

    // -- Settings -----------------------------------------------------------
    'settings.get': () => settings(),
    'settings.update': (patch: Partial<AppSettings>) => {
      const s = updateSettings(db(), patch);
      audit(db(), ACTOR, 'settings_updated', 'settings', null, { keys: Object.keys(patch) });
      return s;
    },
    'settings.setLogo': (filePath: string | null) => {
      const w = cur();
      if (!filePath) {
        setMeta(w.db, 'brand_logo', '');
        return null;
      }
      const name = `brand-logo${extname(filePath).toLowerCase()}`;
      copyFileSync(filePath, join(w.imageDir, name));
      setMeta(w.db, 'brand_logo', name);
      return `glide-img://local/${name}?v=${Date.now()}`;
    },
    'settings.getLogo': () => {
      const l = getMeta(db(), 'brand_logo');
      return l ? `glide-img://local/${l}` : null;
    },

    // -- Orders -------------------------------------------------------------
    'orders.list': (f: OrderFilter) => listOrders(db(), f),
    'orders.get': (id: number) => getOrder(db(), id),
    'orders.assign': (orderId: number, memberId: number | null) => assignOrder(db(), orderId, memberId, ACTOR, settings()),
    'orders.setNotes': (orderId: number, notes: string) => {
      db().run('UPDATE orders SET notes = ? WHERE id = ?', [notes.slice(0, 5000), orderId]);
      refreshSearchText(db(), orderId);
    },
    'orders.addTracking': (orderId: number, number: string, carrier?: Carrier) => {
      const t = classifyTracking(number, carrier);
      if (!t) throw new Error('Unrecognized tracking number');
      const d = db();
      d.tx(() => {
        const id = d.run('INSERT OR IGNORE INTO packages (order_id, tracking_number, carrier, tracking_url, status, next_check_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [orderId, t.number, t.carrier, trackingUrl(t.carrier, t.number), 'label_created', now(), now()]).lastId;
        if (id) addTrackingEvent(d, id, 'label_created', 'Tracking added manually', now(), 'manual');
        d.run("INSERT INTO order_events (order_id, kind, label, occurred_at, source, detail_json) VALUES (?, 'manual', ?, ?, 'manual', ?)", [orderId, `Tracking ${t.number} added`, now(), JSON.stringify({ carrier: t.carrier })]);
        d.run('UPDATE order_items SET shipped_qty = quantity - canceled_qty WHERE order_id = ? AND shipped_qty = 0', [orderId]);
        recomputeOrder(d, orderId);
      });
      audit(d, ACTOR, 'tracking_added', 'order', orderId, { carrier: t.carrier });
      return t;
    },
    'orders.correct': (orderId: number, action: 'mark_delivered' | 'mark_canceled' | 'clear_hold' | 'set_hold' | 'uncancel') => {
      const d = db();
      d.tx(() => {
        if (action === 'mark_delivered') {
          d.run('UPDATE order_items SET shipped_qty = quantity - canceled_qty, delivered_qty = quantity - canceled_qty WHERE order_id = ?', [orderId]);
          for (const p of d.all<{ id: number }>("SELECT id FROM packages WHERE order_id = ? AND status <> 'delivered'", [orderId])) addTrackingEvent(d, p.id, 'delivered', 'Marked delivered manually', now(), 'manual');
        }
        if (action === 'mark_canceled') d.run('UPDATE order_items SET canceled_qty = quantity - shipped_qty WHERE order_id = ?', [orderId]);
        if (action === 'uncancel') d.run('UPDATE order_items SET canceled_qty = 0 WHERE order_id = ?', [orderId]);
        if (action === 'clear_hold') d.run("UPDATE orders SET review_status = 'cleared' WHERE id = ?", [orderId]);
        if (action === 'set_hold') d.run("UPDATE orders SET review_status = 'hold' WHERE id = ?", [orderId]);
        d.run("INSERT INTO order_events (order_id, kind, label, occurred_at, source) VALUES (?, 'manual', ?, ?, 'manual')", [orderId, `Manual correction: ${action.replace('_', ' ')}`, now()]);
        recomputeOrder(d, orderId);
      });
      audit(d, ACTOR, `order_${action}`, 'order', orderId);
    },
    'orders.source': (sourceId: number) => {
      const d = db();
      const s = d.get<{ subject: string; from_addr: string; sent_at: string; forwarded: number; forwarded_by: string | null; parse_status: string; parse_error: string | null }>('SELECT subject, from_addr, sent_at, forwarded, forwarded_by, parse_status, parse_error FROM source_messages WHERE id = ?', [sourceId]);
      if (!s) return null;
      // Raw HTML is shown in a script-less sandboxed frame; remote images stay blocked by CSP.
      return { ...s, rawAvailable: !!d.get('SELECT 1 FROM source_message_blobs WHERE message_id = ?', [sourceId]) };
    },
    'orders.sourceBody': async (sourceId: number) => {
      const { readRawMessage } = await import('../src/core/email/process');
      const { parseMime } = await import('../src/core/email/mime');
      const raw = readRawMessage(db(), sourceId, cur().cipher);
      if (!raw) return null;
      const m = await parseMime(raw);
      return { html: m.envelope.html ?? null, text: m.envelope.text ?? null };
    },
    'orders.exportCsv': async (f: OrderFilter) => {
      const path = await saveDialog(`glide-orders-${new Date().toISOString().slice(0, 10)}.csv`, [{ name: 'CSV', extensions: ['csv'] }]);
      if (!path) return null;
      writeFileSync(path, exportOrdersCsv(db(), f));
      return path;
    },

    // -- Members & profiles -------------------------------------------------
    'members.list': (opts: Parameters<typeof listMembers>[1]) => listMembers(db(), opts),
    'members.get': (id: number) => getMember(db(), id),
    'members.create': (m: { discordId?: string; username: string; displayName?: string }) => upsertMember(db(), { discordId: m.discordId || null, username: m.username, displayName: m.displayName || null }, ACTOR),
    'members.update': (id: number, patch: { notes?: string; tags?: string[]; displayName?: string; discordId?: string }) => {
      const d = db();
      if (patch.notes !== undefined) d.run('UPDATE members SET notes = ? WHERE id = ?', [patch.notes, id]);
      if (patch.tags !== undefined) d.run('UPDATE members SET tags_json = ? WHERE id = ?', [JSON.stringify(patch.tags.slice(0, 20)), id]);
      if (patch.displayName !== undefined) d.run('UPDATE members SET display_name = ? WHERE id = ?', [patch.displayName || null, id]);
      if (patch.discordId !== undefined) d.run('UPDATE members SET discord_id = ? WHERE id = ?', [patch.discordId || null, id]);
      d.run('UPDATE members SET updated_at = ? WHERE id = ?', [now(), id]);
      audit(d, ACTOR, 'member_updated', 'member', id, { keys: Object.keys(patch) });
    },
    'members.merge': (intoId: number, fromId: number) => mergeMembers(db(), intoId, fromId, ACTOR),
    'members.split': (profileIds: number[], target: { memberId?: number; username?: string }) =>
      splitProfiles(db(), profileIds, target.memberId ? { memberId: target.memberId } : { newMember: { username: target.username ?? 'new-member' } }, ACTOR),
    'members.forget': (id: number) => {
      forgetMember(db(), id);
      audit(db(), ACTOR, 'member_forgotten', 'member', id);
    },
    'members.invoice': async (memberId: number, from: string | undefined, to: string | undefined, format: 'csv' | 'pdf') => {
      const inv = memberInvoice(db(), memberId, from, to);
      const base = `statement-${(inv.member.display_name ?? inv.member.username).replace(/[^a-z0-9]+/gi, '-')}`;
      const path = await saveDialog(`${base}.${format}`, [{ name: format.toUpperCase(), extensions: [format] }]);
      if (!path) return null;
      if (format === 'csv') writeFileSync(path, inv.csv);
      else writeFileSync(path, await invoicePdf(settings().brandName, inv.member, inv.lines, inv.totals, from || to ? `${from?.slice(0, 10) ?? '…'} – ${to?.slice(0, 10) ?? '…'}` : 'All time'));
      return path;
    },
    'members.exportCsv': async (f: OrderFilter) => {
      const path = await saveDialog('glide-member-spending.csv', [{ name: 'CSV', extensions: ['csv'] }]);
      if (!path) return null;
      writeFileSync(path, exportMembersCsv(db(), f));
      return path;
    },
    'profiles.list': (opts: Parameters<typeof listProfiles>[1]) => listProfiles(db(), opts),
    'profiles.create': (p: { name: string; firstName?: string; lastName?: string; memberId?: number | null }) => createProfile(db(), { ...p, source: 'manual' }, ACTOR),
    'profiles.assign': (profileId: number, memberId: number | null) => assignProfile(db(), profileId, memberId, ACTOR),

    // -- Products -----------------------------------------------------------
    'products.list': (opts: Parameters<typeof listProducts>[1]) => listProducts(db(), opts),
    'products.get': (id: number) => productDetail(db(), id),
    'products.update': (id: number, patch: { title?: string; category?: string; sku?: string | null; upc?: string | null; brand?: string | null }) => {
      const d = db();
      const sets: string[] = [];
      const vals: (string | null | number)[] = [];
      for (const [k, v] of Object.entries(patch)) {
        if (!['title', 'category', 'sku', 'upc', 'brand'].includes(k)) continue;
        sets.push(`${k} = ?`);
        vals.push(v as string | null);
      }
      if (!sets.length) return;
      d.run(`UPDATE products SET ${sets.join(', ')}, locked = 1, updated_at = ? WHERE id = ?`, [...vals, now(), id]);
      audit(d, ACTOR, 'product_updated', 'product', id, { keys: Object.keys(patch) });
    },
    'products.setImage': (id: number, filePath: string) => {
      const w = cur();
      const ext = extname(filePath).toLowerCase();
      if (!['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) throw new Error('Unsupported image type');
      if (statSync(filePath).size > 8 * 1024 * 1024) throw new Error('Image is larger than 8 MB');
      const name = `user-${id}-${Date.now()}${ext}`;
      copyFileSync(filePath, join(w.imageDir, name));
      addProductImage(w.db, id, 'user', null, name);
      audit(w.db, ACTOR, 'product_image_set', 'product', id);
    },
    'products.setPrimaryImage': (productId: number, imageId: number) => db().run('UPDATE products SET primary_image_id = ?, locked = 1 WHERE id = ? AND EXISTS (SELECT 1 FROM product_images WHERE id = ? AND product_id = ?)', [imageId, productId, imageId, productId]),
    'products.merge': (intoId: number, fromId: number) => {
      const d = db();
      d.tx(() => {
        d.run('UPDATE order_items SET product_id = ? WHERE product_id = ?', [intoId, fromId]);
        d.run('UPDATE product_images SET product_id = ? WHERE product_id = ?', [intoId, fromId]);
        d.run('UPDATE product_prices SET product_id = ? WHERE product_id = ?', [intoId, fromId]);
        d.run('DELETE FROM products WHERE id = ?', [fromId]);
      });
      audit(d, ACTOR, 'products_merged', 'product', intoId, { fromId });
    },

    // -- Email accounts -----------------------------------------------------
    'accounts.list': () => listEmailAccounts(db()),
    'accounts.guessHost': (address: string) => guessImapHost(address),
    'accounts.add': (a: { label: string; kind: 'imap' | 'gmail' | 'outlook' | 'import'; address: string; host?: string; port?: number; secure?: boolean; username?: string; password?: string; backfillDays?: number; mailboxes?: string[]; ownerMemberId?: number | null }) => {
      const w = cur();
      const id = w.db.run(
        `INSERT INTO email_accounts (label, kind, address, host, port, secure, username, auth_kind, owner_member_id, mailboxes_json, backfill_days, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [a.label || a.address, a.kind, a.address.toLowerCase(), a.host ?? null, a.port ?? null, a.secure === false ? 0 : 1, a.username ?? null, a.kind === 'imap' ? 'password' : a.kind === 'import' ? 'none' : 'oauth', a.ownerMemberId ?? null, JSON.stringify(a.mailboxes?.length ? a.mailboxes : ['INBOX']), a.backfillDays ?? 0, a.kind === 'imap' || a.kind === 'import' ? 'idle' : 'needs_auth', now()],
      ).lastId;
      if (a.password) w.secrets.set(`account:${id}:password`, a.password);
      audit(w.db, ACTOR, 'account_added', 'email_account', id, { kind: a.kind });
      return id;
    },
    'accounts.update': (id: number, patch: { label?: string; enabled?: boolean; host?: string; port?: number; username?: string; password?: string; backfillDays?: number; mailboxes?: string[]; ownerMemberId?: number | null }) => {
      const w = cur();
      const map: Record<string, [string, unknown]> = {
        label: ['label', patch.label], enabled: ['enabled', patch.enabled === undefined ? undefined : patch.enabled ? 1 : 0], host: ['host', patch.host], port: ['port', patch.port],
        username: ['username', patch.username], backfillDays: ['backfill_days', patch.backfillDays], mailboxes: ['mailboxes_json', patch.mailboxes ? JSON.stringify(patch.mailboxes) : undefined], ownerMemberId: ['owner_member_id', patch.ownerMemberId],
      };
      for (const [, [col, v]] of Object.entries(map)) if (v !== undefined) w.db.run(`UPDATE email_accounts SET ${col} = ? WHERE id = ?`, [v as never, id]);
      if (patch.enabled === false) w.db.run("UPDATE email_accounts SET status = 'disabled' WHERE id = ?", [id]);
      if (patch.enabled === true) w.db.run("UPDATE email_accounts SET status = 'idle' WHERE id = ? AND status = 'disabled'", [id]);
      if (patch.password) {
        w.secrets.set(`account:${id}:password`, patch.password);
        w.db.run("UPDATE email_accounts SET status = 'idle', last_error = NULL WHERE id = ?", [id]);
      }
      audit(w.db, ACTOR, 'account_updated', 'email_account', id, { keys: Object.keys(patch).filter((k) => k !== 'password') });
    },
    'accounts.remove': (id: number) => {
      const w = cur();
      w.secrets.delete(`account:${id}:password`);
      w.secrets.delete(`account:${id}:oauth`);
      w.db.run('DELETE FROM email_accounts WHERE id = ?', [id]);
      audit(w.db, ACTOR, 'account_removed', 'email_account', id);
    },
    'accounts.syncNow': (id?: number) => ctx.runJob(id ? { type: 'syncAccount', accountId: id } : { type: 'syncAll' }),
    'accounts.setOAuthClient': (provider: OAuthProvider, cfg: OAuthClientConfig) => cur().secrets.setJson(`oauth:client:${provider}`, cfg),
    'accounts.getOAuthClient': (provider: OAuthProvider) => {
      const c = cur().secrets.getJson<OAuthClientConfig>(`oauth:client:${provider}`);
      return c ? { clientId: c.clientId, hasSecret: !!c.clientSecret, tenant: c.tenant ?? '' } : null;
    },
    'accounts.oauthConnect': async (accountId: number) => {
      const w = cur();
      const a = w.db.get<{ kind: string; address: string }>('SELECT kind, address FROM email_accounts WHERE id = ?', [accountId]);
      if (!a || (a.kind !== 'gmail' && a.kind !== 'outlook')) throw new Error('Not an OAuth account');
      const cfg = w.secrets.getJson<OAuthClientConfig>(`oauth:client:${a.kind}`);
      if (!cfg?.clientId) throw new Error(`Add your ${a.kind === 'gmail' ? 'Google' : 'Microsoft'} OAuth client ID first (Settings → Email)`);
      const tokens = await runLoopbackFlow(a.kind as OAuthProvider, cfg, (url) => shell.openExternal(url), { loginHint: a.address });
      w.secrets.setJson(`account:${accountId}:oauth`, tokens);
      w.db.run("UPDATE email_accounts SET status = 'idle', last_error = NULL, username = COALESCE(?, username) WHERE id = ?", [tokens.email ?? null, accountId]);
      audit(w.db, ACTOR, 'account_oauth_connected', 'email_account', accountId);
      return { email: tokens.email ?? null };
    },
    'accounts.importFiles': (paths: string[], accountId: number | null = null) => ctx.runJob({ type: 'importFiles', paths, accountId }),

    // -- Sync ---------------------------------------------------------------
    'sync.health': (): SyncHealth => {
      const d = db();
      const hourAgo = new Date(Date.now() - 3600000).toISOString();
      const dayAgo = new Date(Date.now() - 86400000).toISOString();
      const accounts = d.all<{ status: string; enabled: number; kind: string }>("SELECT status, enabled, kind FROM email_accounts WHERE kind <> 'import'");
      const lastHour = d.value<number>('SELECT COUNT(*) FROM source_messages WHERE created_at >= ?', [hourAgo]) ?? 0;
      const last10 = d.value<number>('SELECT COUNT(*) FROM source_messages WHERE created_at >= ?', [new Date(Date.now() - 600000).toISOString()]) ?? 0;
      return {
        running: !ctx.sync.paused,
        paused: ctx.sync.paused,
        accounts: accounts.length,
        healthyAccounts: accounts.filter((a) => a.enabled && (a.status === 'connected' || a.status === 'idle' || a.status === 'syncing')).length,
        lastSyncAt: d.value<string>("SELECT MAX(last_sync_at) FROM email_accounts") ?? null,
        messagesLastHour: lastHour,
        throughputPerMin: Math.round((last10 / 10) * 10) / 10,
        parserFailures24h: d.value<number>("SELECT COUNT(*) FROM source_messages WHERE parse_status = 'failed' AND created_at >= ?", [dayAgo]) ?? 0,
      };
    },
    'sync.pause': () => ctx.sync.setPaused(true),
    'sync.resume': () => {
      ctx.sync.setPaused(false);
      ctx.sync.trigger();
    },

    // -- Identity -----------------------------------------------------------
    'identity.candidates': (opts: Parameters<typeof listCandidates>[1]) => listCandidates(db(), opts),
    'identity.resolve': (id: number, approve: boolean, memberId?: number) => resolveCandidate(db(), id, approve, ACTOR, settings(), memberId),
    'identity.discovery': () => discoverySummary(db()),
    'identity.shared': () => sharedAddresses(db()),
    'identity.scanDuplicates': () => scanDuplicateMembers(db()),
    'identity.recentEmails': () => db().all<{ id: number; address: string; status: string; member: string | null; firstSeen: string }>(
      "SELECT e.id, e.address, e.status, COALESCE(m.display_name, m.username) AS member, e.first_seen AS firstSeen FROM emails e LEFT JOIN members m ON m.id = e.member_id WHERE e.status <> 'verified' ORDER BY e.first_seen DESC LIMIT 200",
    ),
    'identity.corrections': () => db().all<{ id: number; kind: string; payload: string; actor: string; createdAt: string }>('SELECT id, kind, payload_json AS payload, actor, created_at AS createdAt FROM identity_corrections ORDER BY id DESC LIMIT 200'),

    // -- Analytics ----------------------------------------------------------
    'analytics.bundle': (f: OrderFilter, g: Granularity = 'day') => analyticsBundle(db(), f, settings(), g),
    'analytics.kpis': (f: OrderFilter) => kpis(db(), f, settings()),
    'analytics.campaigns': () => db().all<{ id: number; name: string; startsAt: string | null; endsAt: string | null }>('SELECT id, name, starts_at AS startsAt, ends_at AS endsAt FROM campaigns ORDER BY id DESC').map((c) => ({ ...c, stats: campaignStats(db(), c.id) })),
    'analytics.createCampaign': (c: { name: string; startsAt?: string; endsAt?: string; retailers?: string[] }) =>
      db().run('INSERT INTO campaigns (name, starts_at, ends_at, retailer_ids_json, created_at) VALUES (?, ?, ?, ?, ?)', [c.name, c.startsAt ?? null, c.endsAt ?? null, JSON.stringify(c.retailers ?? []), now()]).lastId,
    'analytics.importSignups': (campaignId: number, filePath: string) => {
      const d = db();
      const csv = parseCsv(readFileSync(filePath, 'utf8'));
      let added = 0;
      let unknown = 0;
      d.tx(() => {
        for (const r of csv.rows) {
          const id = csv.mapping.discordId ? r[csv.mapping.discordId] : '';
          const name = csv.mapping.discordUsername ? r[csv.mapping.discordUsername] : '';
          const m = id ? d.value<number>('SELECT id FROM members WHERE discord_id = ?', [id]) : name ? d.value<number>('SELECT id FROM members WHERE username = ? COLLATE NOCASE', [name]) : undefined;
          if (!m) {
            unknown++;
            continue;
          }
          added += d.run('INSERT OR IGNORE INTO campaign_signups (campaign_id, member_id, signed_up_at) VALUES (?, ?, ?)', [campaignId, m, now()]).changes;
        }
      });
      return { added, unknown };
    },
    'analytics.deleteCampaign': (id: number) => db().run('DELETE FROM campaigns WHERE id = ?', [id]),

    // -- Activity -----------------------------------------------------------
    'activity.list': (opts: Parameters<typeof listActivity>[1]) => listActivity(db(), opts),

    // -- Shipping -----------------------------------------------------------
    'shipping.overview': () => shipmentOverview(db()),
    'shipping.refresh': () => ctx.runJob({ type: 'refreshTracking' }),
    'shipping.providers': () => PROVIDERS.map((p) => ({ id: p.id, name: p.name, carriers: p.carriers, configured: cur().secrets.has(`tracking:${p.id}`) })),
    'shipping.saveProvider': (id: string, creds: ProviderCredentials | null) => {
      if (!PROVIDERS.some((p) => p.id === id)) throw new Error('Unknown provider');
      if (creds) cur().secrets.setJson(`tracking:${id}`, creds);
      else cur().secrets.delete(`tracking:${id}`);
      audit(db(), ACTOR, creds ? 'tracking_provider_saved' : 'tracking_provider_removed', 'tracking', id);
    },

    // -- Cook Export Studio -------------------------------------------------
    'exports.templates': () => TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, supportsTransparent: t.supportsTransparent })),
    'exports.canvasPresets': () => CANVAS_PRESETS,
    'exports.defaultProject': (w: number, h: number) => defaultCustomProject(w, h),
    'exports.preview': (req: Omit<RenderRequest, 'format'>, f: OrderFilter, recap: Partial<RecapOptions> = {}) => {
      const data = buildRecapData(db(), f, settings(), recapOptions({ ...recap, urlImages: true }));
      return { svg: buildSvg(data, req), kpis: data.kpis, products: data.products.length, leaders: data.leaders.length };
    },
    'exports.render': async (req: RenderRequest & { mp4?: boolean }, f: OrderFilter, recap: Partial<RecapOptions> = {}, askPath = true) => {
      const w = cur();
      const ext = req.mp4 ? 'mp4' : req.format;
      const name = `${settings().brandName.replace(/[^a-z0-9]+/gi, '-')}-${req.template}-${req.width}x${req.height}-${new Date().toISOString().slice(0, 10)}.${ext}`;
      const path = askPath ? await saveDialog(name, [{ name: ext.toUpperCase(), extensions: [ext] }]) : join(w.exportDir, name);
      if (!path) return null;
      const res = (await ctx.runJob({ type: 'render', request: req, filter: f, recap: recapOptions(recap), outPath: path, mp4: req.mp4 })) as { path: string; bytes: number };
      w.db.run('INSERT INTO generated_reports (template, params_json, output_path, format, width, height, data_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [req.template, JSON.stringify({ filter: f, options: req.options }), res.path, ext, req.width, req.height, '', now()]);
      return res;
    },
    'exports.history': () => db().all<{ id: number; template: string; outputPath: string; format: string; width: number; height: number; createdAt: string }>('SELECT id, template, output_path AS outputPath, format, width, height, created_at AS createdAt FROM generated_reports ORDER BY id DESC LIMIT 100'),
    'exports.presets': () => db().all<{ id: number; name: string; template: string; options: string }>('SELECT id, name, template, options_json AS options FROM export_presets ORDER BY name').map((p) => ({ ...p, options: json<Record<string, unknown>>(p.options, {}) })),
    'exports.savePreset': (name: string, template: string, options: Record<string, unknown>) => db().run('INSERT INTO export_presets (name, template, options_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [name, template, JSON.stringify(options), now(), now()]).lastId,
    'exports.deletePreset': (id: number) => db().run('DELETE FROM export_presets WHERE id = ?', [id]),
    'exports.saveProject': async (project: CustomProject) => {
      const path = await saveDialog(`${project.name.replace(/[^a-z0-9]+/gi, '-')}.glidecook`, [{ name: 'GLIDE Cook project', extensions: ['glidecook'] }]);
      if (!path) return null;
      writeFileSync(path, JSON.stringify(project, null, 2));
      return path;
    },
    'exports.openProject': async () => {
      const win = ctx.window();
      const r = win ? await dialog.showOpenDialog(win, { filters: [{ name: 'GLIDE Cook project', extensions: ['glidecook'] }], properties: ['openFile'] }) : { canceled: true, filePaths: [] };
      if (r.canceled || !r.filePaths[0]) return null;
      const p = JSON.parse(readFileSync(r.filePaths[0], 'utf8')) as CustomProject;
      if (p.version !== 1 || !Array.isArray(p.elements)) throw new Error('Not a GLIDE Cook project');
      return p;
    },
    'exports.imageToDataUri': (filePath: string) => {
      const ext = extname(filePath).toLowerCase();
      const mime: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
      if (!mime[ext] || statSync(filePath).size > 6 * 1024 * 1024) throw new Error('Use a PNG/JPG/WebP/SVG under 6 MB');
      return `data:${mime[ext]};base64,${readFileSync(filePath).toString('base64')}`;
    },
    'exports.dailyRecap': async (day: string) => {
      const from = new Date(`${day}T00:00:00`);
      const to = new Date(from.getTime() + 86400000);
      return ctx.runJob({
        type: 'render',
        request: { template: 'galactic', width: 1080, height: 1350, format: 'png' },
        filter: { from: from.toISOString(), to: to.toISOString() },
        recap: recapOptions({ dateLabel: from.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) }),
        outPath: join(cur().exportDir, `daily-recap-${day}.png`),
      });
    },

    // -- CSV ----------------------------------------------------------------
    'csv.parse': (filePath: string, preset?: string) => {
      const csv = parseCsv(readFileSync(filePath, 'utf8'), preset);
      const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      csvCache.set(token, { csv, filename: basename(filePath) });
      return { token, headers: csv.headers, sample: csv.rows.slice(0, 12), rowCount: csv.rows.length, mapping: csv.mapping, dropped: csv.dropped, kind: csv.kind, detectedPreset: csv.detectedPreset, fields: FIELDS, presets: Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label })) };
    },
    'csv.preview': (token: string, mapping: Mapping, kind: 'profiles' | 'orders') => {
      const c = csvCache.get(token);
      if (!c) throw new Error('CSV session expired — choose the file again');
      const p = previewImport(db(), c.csv, mapping, kind);
      return { ...p, rows: p.rows.slice(0, 500) };
    },
    'csv.apply': (token: string, mapping: Mapping, kind: 'profiles' | 'orders') => {
      const c = csvCache.get(token);
      if (!c) throw new Error('CSV session expired — choose the file again');
      const r = applyImport(db(), c.csv, mapping, c.filename, ACTOR, kind);
      csvCache.delete(token);
      return r;
    },
    'csv.batches': () => listImportBatches(db()),
    'csv.rollback': (batchId: number) => rollbackImport(db(), batchId, ACTOR),

    // -- Automation ---------------------------------------------------------
    'automation.rules': () => listRules(db()),
    'automation.setEnabled': (id: number, enabled: boolean) => {
      setRuleEnabled(db(), id, enabled);
      audit(db(), ACTOR, enabled ? 'rule_enabled' : 'rule_disabled', 'automation_rule', id);
    },
    'automation.executions': (id: number) => ruleExecutions(db(), id),

    // -- Discord ------------------------------------------------------------
    'discord.getConfig': () => {
      const c = cur().secrets.getJson<DiscordConfig>('discord:config');
      return c ? { guildId: c.guildId, adminChannelId: c.adminChannelId ?? '', hasToken: !!c.botToken } : null;
    },
    'discord.saveConfig': (c: { botToken?: string; guildId: string; adminChannelId?: string }) => {
      const prev = cur().secrets.getJson<DiscordConfig>('discord:config');
      const token = c.botToken || prev?.botToken;
      if (!token) throw new Error('Bot token is required');
      if (!/^\d{15,22}$/.test(c.guildId)) throw new Error('Server ID must be a Discord snowflake');
      if (c.adminChannelId && !/^\d{15,22}$/.test(c.adminChannelId)) throw new Error('Admin channel ID must be a Discord snowflake');
      cur().secrets.setJson('discord:config', { botToken: token, guildId: c.guildId, adminChannelId: c.adminChannelId || undefined });
      audit(db(), ACTOR, 'discord_config_saved', 'discord', c.guildId);
    },
    'discord.test': async () => {
      const c = cur().secrets.getJson<DiscordConfig>('discord:config');
      if (!c) throw new Error('Discord is not configured');
      return testConnection(c);
    },
    'discord.syncMembers': async () => {
      const c = cur().secrets.getJson<DiscordConfig>('discord:config');
      if (!c) throw new Error('Discord is not configured');
      return syncGuildMembers(db(), c);
    },
    'discord.outbox': () => db().all<{ id: number; channelKind: string; status: string; attempts: number; lastError: string | null; createdAt: string; sentAt: string | null; payload: string }>(
      'SELECT id, channel_kind AS channelKind, status, attempts, last_error AS lastError, created_at AS createdAt, sent_at AS sentAt, payload_json AS payload FROM notifications_outbox ORDER BY id DESC LIMIT 100',
    ),
    'discord.exportMappings': async () => {
      const path = await saveDialog('glide-discord-mappings.csv', [{ name: 'CSV', extensions: ['csv'] }]);
      if (!path) return null;
      const rows = db().all<Record<string, unknown>>(
        `SELECT m.discord_id, m.username, p.name AS profile, p.first_name, p.last_name, (SELECT GROUP_CONCAT(e.address, ' ') FROM emails e WHERE e.profile_id = p.id AND e.status = 'verified') AS emails
         FROM members m LEFT JOIN profiles p ON p.member_id = m.id WHERE m.merged_into_id IS NULL ORDER BY m.username`,
      );
      writeFileSync(path, toCsv(['Discord ID', 'Discord Username', 'Profile Name', 'First Name', 'Last Name', 'Email'], rows.map((r) => [r.discord_id, r.username, r.profile, r.first_name, r.last_name, r.emails])));
      return path;
    },

    // -- Diagnostics --------------------------------------------------------
    'diagnostics.parserFailures': () => parserFailures(db()),
    'diagnostics.reprocessFailed': () => ctx.runJob({ type: 'reprocessFailed' }),
    'diagnostics.audit': (limit = 300, entity?: string) => auditLog(db(), limit, entity),
    'diagnostics.logs': () => ctx.logs.slice(-300).reverse(),
    'diagnostics.stats': () => {
      const w = cur();
      const tables = ['orders', 'order_items', 'packages', 'tracking_events', 'members', 'profiles', 'emails', 'addresses', 'products', 'source_messages', 'activity_feed', 'audit_log'];
      return {
        dbPath: w.dbPath,
        dbBytes: existsSync(w.dbPath) ? statSync(w.dbPath).size : 0,
        counts: Object.fromEntries(tables.map((t) => [t, w.db.value<number>(`SELECT COUNT(*) FROM ${t}`) ?? 0])),
        keyProtection: ctx.ws.current ? 'os' : 'none',
        isSample: w.info.isSample,
      };
    },
    'diagnostics.backupNow': () => backupNow(db(), cur().backupDir, settings().backupKeep),
    'diagnostics.backups': () => listBackups(cur().backupDir),
    'diagnostics.restore': async (backupPath: string) => {
      const w = cur();
      if (!backupPath.startsWith(w.backupDir)) throw new Error('Choose a backup from this workspace');
      backupNow(w.db, join(w.backupDir, 'pre-restore'), 3);
      const id = w.info.id;
      const dbPath = w.dbPath;
      ctx.ws.close();
      for (const suffix of ['-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
      copyFileSync(backupPath, dbPath);
      ctx.ws.open(id);
      await ctx.restartWorker();
      audit(db(), ACTOR, 'restored_backup', 'workspace', id, { file: basename(backupPath) });
      return true;
    },
    'diagnostics.exportData': async () => {
      const win = ctx.window();
      const r = win ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] }) : { canceled: true, filePaths: [] };
      if (r.canceled || !r.filePaths[0]) return null;
      const out = join(r.filePaths[0], `glide-export-${new Date().toISOString().slice(0, 10)}`);
      mkdirSync(out, { recursive: true });
      for (const [t, rows] of Object.entries(exportAllTables(db()))) {
        const headers = rows[0] ? Object.keys(rows[0]) : [];
        writeFileSync(join(out, `${t}.csv`), toCsv(headers, rows.map((row) => headers.map((h) => (row[h] instanceof Uint8Array ? '' : row[h])))));
      }
      audit(db(), ACTOR, 'data_exported', 'workspace', cur().info.id);
      return out;
    },
    'parserTemplates.list': () => db().all<{ id: number; name: string; retailerId: string; senderPattern: string; subjectPattern: string | null; rules: string; enabled: number }>('SELECT id, name, retailer_id AS retailerId, sender_pattern AS senderPattern, subject_pattern AS subjectPattern, rules_json AS rules, enabled FROM parser_templates ORDER BY name'),
    'parserTemplates.save': (t: { id?: number; name: string; retailerId: string; senderPattern: string; subjectPattern?: string; rules: Record<string, unknown> }) => {
      for (const re of [t.senderPattern, t.subjectPattern, t.rules.orderNumber as string, t.rules.total as string]) if (re) new RegExp(re);
      if (t.id) db().run('UPDATE parser_templates SET name = ?, retailer_id = ?, sender_pattern = ?, subject_pattern = ?, rules_json = ? WHERE id = ?', [t.name, t.retailerId, t.senderPattern, t.subjectPattern ?? null, JSON.stringify(t.rules), t.id]);
      else return db().run('INSERT INTO parser_templates (name, retailer_id, sender_pattern, subject_pattern, rules_json, created_at) VALUES (?, ?, ?, ?, ?, ?)', [t.name, t.retailerId, t.senderPattern, t.subjectPattern ?? null, JSON.stringify(t.rules), now()]).lastId;
      return t.id;
    },
    'parserTemplates.delete': (id: number) => db().run('DELETE FROM parser_templates WHERE id = ?', [id]),
  };
}

export type Handlers = ReturnType<typeof createHandlers>;
