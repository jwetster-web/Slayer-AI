import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db/database';

/** Consistent online backup with VACUUM INTO; keeps the newest `keep` files. */
export function backupNow(db: Db, dir: string, keep = 7): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const name = `glide-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;
  const path = join(dir, name);
  db.raw.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
  const all = listBackups(dir);
  for (const b of all.slice(keep)) unlinkSync(b.path);
  return path;
}

export function listBackups(dir: string): { name: string; path: string; size: number; createdAt: string }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^glide-.*\.sqlite$/.test(f))
    .map((f) => {
      const p = join(dir, f);
      const s = statSync(p);
      return { name: f, path: p, size: s.size, createdAt: s.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
}

/** Exports every non-secret table as CSV-ready rows (data portability). */
export function exportAllTables(db: Db): Record<string, Record<string, unknown>[]> {
  const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('secrets', 'source_message_blobs', 'schema_migrations') AND name NOT LIKE 'sqlite_%'");
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const t of tables) out[t.name] = db.all(`SELECT * FROM "${t.name}"`);
  return out;
}

/** Forgets a member: removes identity records and unassigns their orders (orders stay for totals). */
export function forgetMember(db: Db, memberId: number) {
  db.tx(() => {
    db.run("UPDATE orders SET member_id = NULL, profile_id = NULL, match_status = 'unmatched', match_locked = 1 WHERE member_id = ?", [memberId]);
    db.run('DELETE FROM emails WHERE member_id = ?', [memberId]);
    db.run('DELETE FROM profiles WHERE member_id = ?', [memberId]);
    db.run('DELETE FROM address_owners WHERE member_id = ?', [memberId]);
    db.run('DELETE FROM discord_name_history WHERE member_id = ?', [memberId]);
    db.run('DELETE FROM members WHERE id = ? OR merged_into_id = ?', [memberId, memberId]);
  });
}
