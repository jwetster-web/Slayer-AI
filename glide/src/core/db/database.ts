import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { MIGRATIONS } from './migrations';

export type Params = SQLInputValue[] | Record<string, SQLInputValue>;
type Row = Record<string, unknown>;

/**
 * Thin synchronous wrapper around node:sqlite with statement caching,
 * nested-safe transactions (savepoints) and schema migrations.
 * One instance per connection; the main process and each worker open their own.
 */
export class Db {
  readonly raw: DatabaseSync;
  readonly path: string;
  private cache = new Map<string, ReturnType<DatabaseSync['prepare']>>();
  private depth = 0;

  constructor(path: string, opts: { readOnly?: boolean } = {}) {
    this.path = path;
    this.raw = new DatabaseSync(path, { readOnly: opts.readOnly ?? false });
    this.raw.exec('PRAGMA journal_mode = WAL');
    this.raw.exec('PRAGMA synchronous = NORMAL');
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.raw.exec('PRAGMA busy_timeout = 5000');
    this.raw.exec('PRAGMA temp_store = MEMORY');
  }

  private stmt(sql: string) {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  run(sql: string, params: Params = []): { changes: number; lastId: number } {
    const s = this.stmt(sql);
    const r = Array.isArray(params) ? s.run(...params) : s.run(params);
    return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
  }

  get<T = Row>(sql: string, params: Params = []): T | undefined {
    const s = this.stmt(sql);
    return (Array.isArray(params) ? s.get(...params) : s.get(params)) as T | undefined;
  }

  all<T = Row>(sql: string, params: Params = []): T[] {
    const s = this.stmt(sql);
    return (Array.isArray(params) ? s.all(...params) : s.all(params)) as T[];
  }

  value<T = unknown>(sql: string, params: Params = []): T | undefined {
    const row = this.get<Row>(sql, params);
    if (!row) return undefined;
    const k = Object.keys(row)[0];
    return row[k] as T;
  }

  exec(sql: string) {
    this.raw.exec(sql);
  }

  /** Runs fn atomically. Nested calls become savepoints. */
  tx<T>(fn: () => T): T {
    const name = `sp${this.depth}`;
    if (this.depth === 0) this.raw.exec('BEGIN IMMEDIATE');
    else this.raw.exec(`SAVEPOINT ${name}`);
    this.depth++;
    try {
      const out = fn();
      this.depth--;
      if (this.depth === 0) this.raw.exec('COMMIT');
      else this.raw.exec(`RELEASE ${name}`);
      return out;
    } catch (e) {
      this.depth--;
      if (this.depth === 0) this.raw.exec('ROLLBACK');
      else this.raw.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
      throw e;
    }
  }

  migrate() {
    this.raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const current = (this.value<number>('SELECT COALESCE(MAX(version), 0) FROM schema_migrations') ?? 0) as number;
    for (const m of MIGRATIONS) {
      if (m.version <= current) continue;
      this.tx(() => {
        this.raw.exec(m.sql);
        this.run('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)', [m.version, new Date().toISOString()]);
      });
    }
  }

  close() {
    this.cache.clear();
    this.raw.close();
  }
}

export function openDb(path: string): Db {
  const db = new Db(path);
  db.migrate();
  return db;
}

export const now = () => new Date().toISOString();

export function json<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string' || !v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}
