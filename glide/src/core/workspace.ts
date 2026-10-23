import { DEFAULT_SETTINGS, type AppSettings } from '../shared/types';
import { now, openDb, type Db } from './db/database';
import { RETAILERS } from './retailers/registry';
import { seedAutomationRules } from './automation/rules';

export function seedWorkspace(db: Db, opts: { name: string; isSample: boolean }) {
  db.tx(() => {
    for (const r of RETAILERS) {
      db.run(
        `INSERT INTO retailers (id, name, short_name, region, currency, color) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, short_name = excluded.short_name, region = excluded.region, currency = excluded.currency`,
        [r.id, r.name, r.shortName, r.region, r.currency, r.color],
      );
    }
    const setMeta = (k: string, v: string) => db.run('INSERT OR IGNORE INTO workspace_meta (key, value) VALUES (?, ?)', [k, v]);
    setMeta('name', opts.name);
    setMeta('is_sample', opts.isSample ? '1' : '0');
    setMeta('created_at', now());
    setMeta('setup_complete', '0');
    seedAutomationRules(db);
  });
}

export function openWorkspaceDb(path: string, opts: { name: string; isSample: boolean }): Db {
  const db = openDb(path);
  seedWorkspace(db, opts);
  return db;
}

export function getMeta(db: Db, key: string): string | null {
  return db.value<string>('SELECT value FROM workspace_meta WHERE key = ?', [key]) ?? null;
}

export function setMeta(db: Db, key: string, value: string) {
  db.run('INSERT INTO workspace_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

export function isSampleWorkspace(db: Db): boolean {
  return getMeta(db, 'is_sample') === '1';
}

export function getSettings(db: Db): AppSettings {
  const rows = db.all<{ key: string; value_json: string }>('SELECT key, value_json FROM settings');
  const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    try {
      s[r.key] = JSON.parse(r.value_json);
    } catch {
      // keep default
    }
  }
  return s as unknown as AppSettings;
}

export function updateSettings(db: Db, patch: Partial<AppSettings>): AppSettings {
  db.tx(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in DEFAULT_SETTINGS)) continue;
      db.run('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json', [k, JSON.stringify(v)]);
    }
  });
  return getSettings(db);
}
