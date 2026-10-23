import { existsSync, mkdirSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { app, BrowserWindow, ipcMain, net, protocol, safeStorage, shell } from 'electron';
import { backupNow, listBackups } from '../src/core/backup';
import { getSettings } from '../src/core/workspace';
import { listRules } from '../src/core/automation/rules';
import type { KeyProtector } from '../src/core/secrets';
import type { WorkerEvent, WorkerJob, WorkerOut } from '../src/shared/worker';
import { createHandlers, type HandlerContext, type Handlers } from './handlers';
import { WorkspaceManager } from './workspaces';

process.removeAllListeners('warning');

if (process.env.GLIDE_USER_DATA) app.setPath('userData', resolve(process.env.GLIDE_USER_DATA));
app.setName('GLIDE');

protocol.registerSchemesAsPrivileged([{ scheme: 'glide-img', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();

/** OS credential store (Keychain / DPAPI / libsecret) through Electron safeStorage. */
class SafeStorageProtector implements KeyProtector {
  readonly name = 'safeStorage';
  readonly secure = true;
  protect(p: Buffer) {
    return safeStorage.encryptStringAsync(p.toString('base64'));
  }
  async unprotect(s: Buffer) {
    const r = await safeStorage.decryptStringAsync(s);
    return { plain: Buffer.from(r.result, 'base64'), reseal: r.shouldReEncrypt };
  }
}

/** Used only when the OS offers no credential store (e.g. Linux without a keyring); flagged in Diagnostics. */
class FallbackProtector implements KeyProtector {
  readonly name = 'fallback';
  readonly secure = false;
  async protect(p: Buffer) {
    return Buffer.from(p);
  }
  async unprotect(s: Buffer) {
    return { plain: Buffer.from(s), reseal: false };
  }
}

let win: BrowserWindow | null = null;
let worker: Worker | null = null;
let ws: WorkspaceManager;
let handlers: Handlers;
let jobSeq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const logs: HandlerContext['logs'] = [];
const busy = new Set<string>();
const syncState = { paused: false, lastSyncAt: null as string | null, setPaused: (p: boolean) => (syncState.paused = p), trigger: () => void tick(true) };

const resourcesDir = () => (app.isPackaged ? join(process.resourcesPath, 'resources') : join(app.getAppPath(), 'resources'));

function log(level: 'info' | 'warn' | 'error', message: string) {
  logs.push({ at: new Date().toISOString(), level, message: message.slice(0, 500) });
  if (logs.length > 1000) logs.splice(0, logs.length - 1000);
}

function send(event: WorkerEvent | { kind: string; [k: string]: unknown }) {
  win?.webContents.send('glide:event', event);
}

async function startWorker() {
  if (worker) {
    const w = worker;
    worker = null;
    for (const [, p] of pending) p.reject(new Error('worker restarted'));
    pending.clear();
    await w.terminate();
  }
  const cur = ws.current;
  if (!cur) return;
  await new Promise<void>((resolveReady, rejectReady) => {
    const w = new Worker(join(__dirname, 'worker.cjs'), {
      workerData: { dbPath: cur.dbPath, key: cur.key.toString('hex'), imageDir: cur.imageDir, fontDir: join(resourcesDir(), 'fonts') },
    });
    worker = w;
    w.on('message', (m: WorkerOut) => {
      if (m.type === 'ready') resolveReady();
      else if (m.type === 'event') {
        if (m.event.kind === 'log') log(m.event.level, m.event.message);
        if (m.event.kind === 'progress' && m.event.progress.phase === 'error') log('warn', `${m.event.progress.accountLabel}: ${m.event.progress.message ?? 'sync error'}`);
        send(m.event);
      } else if (m.type === 'result') {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (p) (m.ok ? p.resolve(m.value) : p.reject(new Error(m.error)));
      }
    });
    w.on('error', (e: Error) => {
      log('error', `worker crashed: ${e.message}`);
      rejectReady(e);
    });
    w.on('exit', (code) => {
      if (worker === w && code !== 0) {
        log('error', `worker exited (${code}); restarting`);
        worker = null;
        setTimeout(() => void startWorker(), 2000);
      }
    });
  });
}

function runJob(job: WorkerJob): Promise<unknown> {
  if (!worker) return Promise.reject(new Error('No workspace is open'));
  const id = ++jobSeq;
  return new Promise((res, rej) => {
    pending.set(id, { resolve: res, reject: rej });
    worker!.postMessage({ id, job });
  });
}

async function once(key: string, job: WorkerJob) {
  if (busy.has(key)) return;
  busy.add(key);
  try {
    await runJob(job);
  } catch (e) {
    log('warn', `${key}: ${(e as Error).message}`);
  } finally {
    busy.delete(key);
  }
}

const lastRun: Record<string, number> = {};
async function tick(force = false) {
  const cur = ws?.current;
  if (!cur || !worker) return;
  const s = getSettings(cur.db);
  const t = Date.now();
  const due = (k: string, ms: number) => {
    if (force && k === 'sync') return true;
    if (t - (lastRun[k] ?? 0) < ms) return false;
    lastRun[k] = t;
    return true;
  };
  if (!syncState.paused && due('sync', Math.max(30, s.pollIntervalSec) * 1000)) {
    lastRun.sync = t;
    void once('sync', { type: 'syncAll' }).then(() => (syncState.lastSyncAt = new Date().toISOString()));
  }
  if (due('images', 5 * 60000)) void once('images', { type: 'cacheImages' });
  if (due('tracking', 30 * 60000)) void once('tracking', { type: 'refreshTracking' });
  if (s.discordEnabled && due('outbox', 60000)) void once('outbox', { type: 'flushOutbox' });
  if (due('backup', 15 * 60000)) {
    const last = listBackups(cur.backupDir)[0];
    if (!last || t - new Date(last.createdAt).getTime() > s.backupIntervalHours * 3600000) {
      try {
        backupNow(cur.db, cur.backupDir, s.backupKeep);
        log('info', 'automatic backup created');
      } catch (e) {
        log('error', `backup failed: ${(e as Error).message}`);
      }
    }
  }
  // Daily Cook Recap (rule F) at the configured local time.
  if (s.dailyRecapTime && due('recap-check', 60000)) {
    const rule = listRules(cur.db).find((r) => r.key === 'F_daily_recap');
    const d = new Date();
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const day = d.toISOString().slice(0, 10);
    if (rule?.enabled && hhmm >= s.dailyRecapTime && lastRun[`recap-${day}`] === undefined) {
      lastRun[`recap-${day}`] = t;
      try {
        const out = await handlers['exports.dailyRecap'](day);
        log('info', `daily recap rendered: ${JSON.stringify(out)}`);
        send({ kind: 'dataChanged', scope: ['exports'] });
      } catch (e) {
        log('warn', `daily recap: ${(e as Error).message}`);
      }
    }
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1520,
    height: 960,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#05060d',
    title: 'GLIDE',
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://') && !url.startsWith(process.env.VITE_DEV_SERVER_URL ?? '\u0000')) e.preventDefault();
  });
  if (process.env.VITE_DEV_SERVER_URL) void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void win.loadFile(join(__dirname, '..', 'dist', 'index.html'));
  win.on('closed', () => (win = null));
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  mkdirSync(userData, { recursive: true });
  const protector: KeyProtector = (await safeStorage.isAsyncEncryptionAvailable()) ? new SafeStorageProtector() : new FallbackProtector();
  if (!protector.secure) log('warn', 'OS credential storage unavailable — workspace keys are stored unprotected on this machine');
  ws = new WorkspaceManager(userData, protector);

  protocol.handle('glide-img', (req) => {
    const u = new URL(req.url);
    const cur = ws.current;
    if (!cur || u.hostname !== 'local') return new Response('not found', { status: 404 });
    const file = normalize(join(cur.imageDir, decodeURIComponent(u.pathname)));
    if (!file.startsWith(cur.imageDir + sep) || !existsSync(file)) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  const ctx: HandlerContext = {
    ws,
    runJob,
    restartWorker: startWorker,
    window: () => win,
    fontDir: join(resourcesDir(), 'fonts'),
    sync: syncState,
    logs,
  };
  handlers = createHandlers(ctx);

  ipcMain.handle('glide:invoke', async (event, channel: string, ...args: unknown[]) => {
    if (!win || event.sender.id !== win.webContents.id) throw new Error('unauthorized sender');
    const fn = (handlers as unknown as Record<string, (...a: unknown[]) => unknown>)[channel];
    if (!fn) throw new Error(`unknown channel ${channel}`);
    try {
      const out = await fn(...args);
      if (/\.(assign|correct|addTracking|setNotes|merge|split|forget|resolve|apply|rollback|update|create|setImage|remove|add|delete|scanDuplicates|syncMembers|setPrimaryImage|importSignups)$/.test(channel)) send({ kind: 'dataChanged', scope: [channel.split('.')[0]] });
      return out;
    } catch (e) {
      log('warn', `${channel}: ${(e as Error).message}`);
      throw e;
    }
  });

  try {
    await ws.openLast();
    await startWorker();
  } catch (e) {
    log('error', `could not open last workspace: ${(e as Error).message}`);
  }
  createWindow();
  setInterval(() => void tick(), 15000);
  setTimeout(() => void tick(), 4000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void worker?.terminate();
  ws?.close();
});
