import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { now, type Db } from './db/database';

/**
 * Protects small key material with the operating system's credential store.
 * In the desktop app this is Electron safeStorage (Keychain on macOS, DPAPI on
 * Windows, libsecret on Linux). Tests use an in-memory implementation.
 */
export interface KeyProtector {
  readonly name: string;
  readonly secure: boolean;
  protect(plain: Buffer): Promise<Buffer>;
  /** Returns the key and whether the OS asks for it to be re-sealed (e.g. key rotation). */
  unprotect(sealed: Buffer): Promise<{ plain: Buffer; reseal: boolean }>;
}

export class InsecureTestProtector implements KeyProtector {
  readonly name = 'test-plain';
  readonly secure = false;
  async protect(p: Buffer) {
    return Buffer.from(p);
  }
  async unprotect(s: Buffer) {
    return { plain: Buffer.from(s), reseal: false };
  }
}

/** AES-256-GCM with a random 12-byte nonce. Layout: version(1) | iv(12) | tag(16) | ciphertext. */
export class DataCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('DataCipher key must be 32 bytes');
  }
  encrypt(plain: Buffer): Buffer {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([c.update(plain), c.final()]);
    return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), body]);
  }
  decrypt(sealed: Buffer): Buffer {
    if (sealed[0] !== 1) throw new Error('unknown cipher version');
    const iv = sealed.subarray(1, 13);
    const tag = sealed.subarray(13, 29);
    const d = createDecipheriv('aes-256-gcm', this.key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(sealed.subarray(29)), d.final()]);
  }
}

/** Loads (or creates) the workspace data key, sealed by the OS key protector. */
export async function loadWorkspaceKey(path: string, protector: KeyProtector): Promise<Buffer> {
  if (existsSync(path)) {
    const raw = readFileSync(path);
    const [scheme, b64] = raw.toString('utf8').split(':');
    const sealed = Buffer.from(b64 ?? '', 'base64');
    if (scheme !== protector.name) throw new Error(`workspace key was sealed with ${scheme}, current protector is ${protector.name}`);
    const { plain, reseal } = await protector.unprotect(sealed);
    if (reseal) writeFileSync(path, `${protector.name}:${(await protector.protect(plain)).toString('base64')}`, { mode: 0o600 });
    return plain;
  }
  const key = randomBytes(32);
  writeFileSync(path, `${protector.name}:${(await protector.protect(key)).toString('base64')}`, { mode: 0o600 });
  return key;
}

/** Encrypted secret storage (passwords, OAuth refresh tokens, bot tokens) in the workspace DB. */
export class SecretStore {
  constructor(private readonly db: Db, private readonly cipher: DataCipher) {}

  set(ref: string, value: string) {
    const ct = this.cipher.encrypt(Buffer.from(value, 'utf8'));
    this.db.run(
      'INSERT INTO secrets (ref, ciphertext, scheme, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(ref) DO UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at',
      [ref, ct, 'aes-256-gcm/v1', now()],
    );
  }

  get(ref: string): string | null {
    const row = this.db.get<{ ciphertext: Uint8Array }>('SELECT ciphertext FROM secrets WHERE ref = ?', [ref]);
    if (!row) return null;
    return this.cipher.decrypt(Buffer.from(row.ciphertext)).toString('utf8');
  }

  getJson<T>(ref: string): T | null {
    const v = this.get(ref);
    return v ? (JSON.parse(v) as T) : null;
  }

  setJson(ref: string, v: unknown) {
    this.set(ref, JSON.stringify(v));
  }

  delete(ref: string) {
    this.db.run('DELETE FROM secrets WHERE ref = ?', [ref]);
  }

  has(ref: string): boolean {
    return !!this.db.get('SELECT 1 FROM secrets WHERE ref = ?', [ref]);
  }
}
