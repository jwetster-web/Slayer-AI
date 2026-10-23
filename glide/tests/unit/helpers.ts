import { openWorkspaceDb } from '../../src/core/workspace';
import { processRawMessage, type MessageRef } from '../../src/core/email/process';
import { EventSink } from '../../src/core/events';
import { DataCipher } from '../../src/core/secrets';
import { randomBytes } from 'node:crypto';
import type { Db } from '../../src/core/db/database';

export function memDb(): Db {
  return openWorkspaceDb(':memory:', { name: 'test', isSample: false });
}

let seq = 0;
export async function ingest(db: Db, raw: string, accountId: number | null = null, sink = new EventSink()) {
  const ref: MessageRef = { kind: 'import', accountId, importRef: `test:${++seq}:${Math.random()}` };
  const r = await processRawMessage({ db, sink, cipher: new DataCipher(randomBytes(32)) }, Buffer.from(raw), ref);
  return { ...r, sink };
}
