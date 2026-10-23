// Headless command-line tools (no Electron needed):
//   node dist-electron/cli.cjs sample <db.sqlite> [--orders 1000] [--images ./images]
//   node dist-electron/cli.cjs import <db.sqlite> <file.eml|file.mbox|dir>
//   node dist-electron/cli.cjs stats  <db.sqlite>

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { analyticsBundle } from '../src/core/analytics/engine';
import { processRawMessage } from '../src/core/email/process';
import { splitMbox } from '../src/core/email/mime';
import { generateSampleWorkspace } from '../src/core/sample/generator';
import { getSettings, openWorkspaceDb } from '../src/core/workspace';
import { formatCents, formatPct } from '../src/shared/format';

process.removeAllListeners('warning');

const [cmd, dbPath, ...rest] = process.argv.slice(2);
const flag = (name: string, def?: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : def;
};

async function main() {
  if (!cmd || !dbPath) {
    console.log('usage: cli.cjs <sample|import|stats> <db.sqlite> [...]');
    process.exit(1);
  }
  const abs = resolve(dbPath);
  if (cmd === 'sample') {
    const db = openWorkspaceDb(abs, { name: 'Sample Workspace', isSample: true });
    const t0 = Date.now();
    const out = await generateSampleWorkspace(db, {
      orders: Number(flag('orders', '1000')),
      imageDir: resolve(flag('images', join(dirname(abs), 'images'))!),
      onProgress: (d, t, phase) => process.stdout.write(`\r${phase}: ${d}/${t}   `),
    });
    console.log(`\n${out.messages} messages → ${out.orders} orders in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    db.close();
    return;
  }
  if (cmd === 'import') {
    const db = openWorkspaceDb(abs, { name: 'Workspace', isSample: false });
    const target = resolve(rest[0]);
    const files = statSync(target).isDirectory() ? readdirSync(target).map((f) => join(target, f)) : [target];
    const counts: Record<string, number> = {};
    for (const f of files) {
      const ext = extname(f).toLowerCase();
      const data = readFileSync(f);
      const messages = ext === '.mbox' ? [...splitMbox(data)].map((m) => Buffer.from(m)) : ext === '.eml' ? [data] : [];
      for (const [i, m] of messages.entries()) {
        const ref = `file:${createHash('sha256').update(m).digest('hex')}`;
        const r = await processRawMessage({ db, settings: getSettings(db) }, m, { kind: 'import', accountId: null, importRef: ref }, undefined);
        counts[r.status] = (counts[r.status] ?? 0) + 1;
        if (r.status === 'failed') console.log(`  failed: ${f}#${i}: ${r.reason}`);
      }
    }
    console.log(counts);
    db.close();
    return;
  }
  if (cmd === 'stats') {
    const db = openWorkspaceDb(abs, { name: 'Workspace', isSample: false });
    const s = getSettings(db);
    const b = analyticsBundle(db, {}, s);
    const k = b.kpis;
    console.log(`orders ${k.orders}  live ${k.liveOrders}  canceled ${k.canceledOrders}  success ${formatPct(k.successRate)}`);
    console.log(`gross ${formatCents(k.grossCents, k.currency)}  net ${formatCents(k.netCents, k.currency)}  units ${k.netUnits}  buyers ${k.activeBuyers}${k.mixedCurrency ? '  (some orders in other currencies excluded from money totals)' : ''}`);
    for (const r of b.byRetailer) console.log(`  ${r.label.padEnd(24)} ${String(r.orders).padStart(5)} orders  ${formatCents(r.netCents, k.currency).padStart(12)}`);
    db.close();
    return;
  }
  console.log(`unknown command ${cmd}`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
