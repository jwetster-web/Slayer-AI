import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataCipher, InsecureTestProtector, SecretStore, loadWorkspaceKey } from '../../src/core/secrets';
import { redact } from '../../src/core/audit';
import { memDb } from './helpers';

describe('secrets', () => {
  it('encrypts with AES-256-GCM and detects tampering', () => {
    const c = new DataCipher(randomBytes(32));
    const sealed = c.encrypt(Buffer.from('app-password-123'));
    expect(sealed.toString()).not.toContain('app-password');
    expect(c.decrypt(sealed).toString()).toBe('app-password-123');
    sealed[sealed.length - 1] ^= 1;
    expect(() => c.decrypt(sealed)).toThrow();
  });

  it('stores secrets encrypted at rest in the workspace DB', () => {
    const db = memDb();
    const store = new SecretStore(db, new DataCipher(randomBytes(32)));
    store.setJson('discord:config', { botToken: 'secret-token-xyz' });
    const raw = db.get<{ ciphertext: Uint8Array }>('SELECT ciphertext FROM secrets')!;
    expect(Buffer.from(raw.ciphertext).toString('latin1')).not.toContain('secret-token-xyz');
    expect(store.getJson<{ botToken: string }>('discord:config')!.botToken).toBe('secret-token-xyz');
  });

  it('seals and reloads the workspace key through the protector', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'glide-key-')), 'key.bin');
    const p = new InsecureTestProtector();
    const k1 = await loadWorkspaceKey(path, p);
    const k2 = await loadWorkspaceKey(path, p);
    expect(k1.equals(k2)).toBe(true);
    expect(readFileSync(path, 'utf8').startsWith('test-plain:')).toBe(true);
  });

  it('redacts PII and tokens from log text', () => {
    const r = redact('buyer jordan@example.com at 1427 Maple Ridge Dr paid with 4111 1111 1111 1111, call 555-123-4567 token=abc123');
    expect(r).not.toMatch(/jordan@|Maple Ridge|4111|555-123|abc123/);
  });
});
