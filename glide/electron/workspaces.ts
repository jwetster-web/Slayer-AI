// Workspace registry. Each workspace is a folder with its own SQLite file,
// image cache, exports, backups and sealed data key. Sample workspaces are
// separate folders flagged is_sample, so they can never mix with real data.

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../src/core/db/database';
import { DataCipher, SecretStore, loadWorkspaceKey, type KeyProtector } from '../src/core/secrets';
import { getMeta, openWorkspaceDb } from '../src/core/workspace';
import type { WorkspaceInfo } from '../src/shared/types';

interface RegistryFile {
  current: string | null;
  workspaces: { id: string; name: string; isSample: boolean; createdAt: string }[];
}

export interface OpenWorkspace {
  info: WorkspaceInfo;
  db: Db;
  dir: string;
  dbPath: string;
  imageDir: string;
  exportDir: string;
  backupDir: string;
  key: Buffer;
  cipher: DataCipher;
  secrets: SecretStore;
}

export class WorkspaceManager {
  private file: string;
  private root: string;
  current: OpenWorkspace | null = null;

  constructor(private userData: string, private protector: KeyProtector) {
    this.root = join(userData, 'workspaces');
    this.file = join(userData, 'glide-workspaces.json');
    mkdirSync(this.root, { recursive: true });
  }

  private read(): RegistryFile {
    if (!existsSync(this.file)) return { current: null, workspaces: [] };
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as RegistryFile;
    } catch {
      return { current: null, workspaces: [] };
    }
  }

  private write(r: RegistryFile) {
    writeFileSync(this.file, JSON.stringify(r, null, 2), { mode: 0o600 });
  }

  list(): WorkspaceInfo[] {
    return this.read().workspaces.map((w) => this.info(w.id, w.name, w.isSample, w.createdAt));
  }

  private info(id: string, name: string, isSample: boolean, createdAt: string): WorkspaceInfo {
    const dir = join(this.root, id);
    let setupComplete = false;
    if (this.current?.info.id === id) setupComplete = getMeta(this.current.db, 'setup_complete') === '1';
    return { id, name, path: dir, isSample, createdAt, setupComplete };
  }

  create(name: string, isSample: boolean): WorkspaceInfo {
    const r = this.read();
    const id = `${isSample ? 'sample' : 'ws'}-${randomUUID().slice(0, 8)}`;
    const createdAt = new Date().toISOString();
    r.workspaces.push({ id, name, isSample, createdAt });
    this.write(r);
    return this.info(id, name, isSample, createdAt);
  }

  async open(id: string): Promise<OpenWorkspace> {
    const r = this.read();
    const w = r.workspaces.find((x) => x.id === id);
    if (!w) throw new Error('workspace not found');
    this.close();
    const dir = join(this.root, id);
    for (const sub of ['', 'images', 'exports', 'backups']) mkdirSync(join(dir, sub), { recursive: true });
    const dbPath = join(dir, 'glide.sqlite');
    const db = openWorkspaceDb(dbPath, { name: w.name, isSample: w.isSample });
    const key = await loadWorkspaceKey(join(dir, 'key.bin'), this.protector);
    const cipher = new DataCipher(key);
    this.current = {
      info: { id, name: w.name, path: dir, isSample: w.isSample, createdAt: w.createdAt, setupComplete: getMeta(db, 'setup_complete') === '1' },
      db,
      dir,
      dbPath,
      imageDir: join(dir, 'images'),
      exportDir: join(dir, 'exports'),
      backupDir: join(dir, 'backups'),
      key,
      cipher,
      secrets: new SecretStore(db, cipher),
    };
    r.current = id;
    this.write(r);
    return this.current;
  }

  async openLast(): Promise<OpenWorkspace | null> {
    const r = this.read();
    if (r.current && r.workspaces.some((w) => w.id === r.current)) return this.open(r.current);
    return null;
  }

  rename(id: string, name: string) {
    const r = this.read();
    const w = r.workspaces.find((x) => x.id === id);
    if (w) w.name = name;
    this.write(r);
    if (this.current?.info.id === id) this.current.info.name = name;
  }

  delete(id: string) {
    if (this.current?.info.id === id) this.close();
    const r = this.read();
    r.workspaces = r.workspaces.filter((w) => w.id !== id);
    if (r.current === id) r.current = null;
    this.write(r);
    const dir = join(this.root, id);
    if (dir.startsWith(this.root) && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }

  close() {
    if (this.current) {
      try {
        this.current.db.close();
      } catch {
        // already closed
      }
      this.current = null;
    }
  }
}
