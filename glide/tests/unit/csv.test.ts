import { assignOrder } from '../../src/core/identity/matcher';
import { describe, expect, it } from 'vitest';
import { applyImport, parseCsv, previewImport, rollbackImport } from '../../src/core/csv/importer';
import { exportOrdersCsv, memberInvoice, toCsv } from '../../src/core/csv/exporter';
import { backupNow, listBackups } from '../../src/core/backup';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memDb } from './helpers';
import { openWorkspaceDb } from '../../src/core/workspace';

const PROFILES = `Discord ID,Discord Username,Profile Name,Email,First Name,Last Name,Address 1,Address 2,City,State,Zip,Card Number,CVV,Exp Month
123456789012345678,ExampleUser,Target 14,buyer14@example.com,Jordan,Rivers,1427 Maple Ridge Dr,Apt 4B,Springfield,IL,62704,4111111111111111,123,04
123456789012345678,ExampleUser,Walmart 2,buyer2@example.com,Jordan,Rivers,1427 Maple Ridge Dr,Apt 4B,Springfield,IL,62704,4111111111111111,123,04
223456789012345678,OtherUser,Main,other@example.com,Casey,Stone,9 Elm St,,Columbus,OH,43201,5500000000000004,999,12
,NoIdUser,,,,,,,,,,,,
`;

describe('CSV import', () => {
  it('never retains card numbers or CVVs and auto-maps headers', () => {
    const csv = parseCsv(PROFILES);
    expect(csv.dropped.map((d) => d.header).sort()).toEqual(['CVV', 'Card Number', 'Exp Month'].sort());
    expect(csv.headers).not.toContain('Card Number');
    expect(JSON.stringify(csv.rows)).not.toContain('4111111111111111');
    expect(csv.mapping.discordId).toBe('Discord ID');
    expect(csv.mapping.zip).toBe('Zip');
    expect(csv.kind).toBe('profiles');
  });

  it('drops a mislabeled column whose values are card numbers', () => {
    const csv = parseCsv('Name,Notes\nA,4111111111111111\nB,5500000000000004\n');
    expect(csv.dropped[0].header).toBe('Notes');
  });

  it('previews, applies and rolls back a profile import', () => {
    const db = memDb();
    const csv = parseCsv(PROFILES);
    const p = previewImport(db, csv, csv.mapping);
    expect(p.creates).toBe(3);
    expect(p.missing).toBe(1);
    const res = applyImport(db, csv, csv.mapping, 'profiles.csv', 'admin');
    expect(db.value('SELECT COUNT(*) FROM members')).toBe(2);
    expect(db.value('SELECT COUNT(*) FROM profiles')).toBe(3);
    expect(db.value("SELECT COUNT(*) FROM emails WHERE status = 'verified'")).toBe(3);
    expect(db.value('SELECT COUNT(*) FROM address_owners')).toBe(2);
    // Re-preview: rows are now updates, not creates.
    expect(previewImport(db, csv, csv.mapping).creates).toBe(0);
    rollbackImport(db, res.batchId, 'admin');
    expect(db.value('SELECT COUNT(*) FROM members')).toBe(0);
    expect(db.value('SELECT COUNT(*) FROM profiles')).toBe(0);
    expect(db.value('SELECT COUNT(*) FROM emails')).toBe(0);
  });

  it('imports bot order logs, skipping failed checkouts and grouping items', () => {
    const db = memDb();
    const text = `Site,Order Number,Product,Qty,Price,Status,Email,Date
Target,912000000000111,Elite Trainer Box,2,$49.99,Success,a@example.com,2026-10-20T16:00:00Z
Target,912000000000111,Booster Bundle,1,$26.94,Success,a@example.com,2026-10-20T16:00:00Z
Walmart,2000111-22223333,Booster Box,1,$161.64,Declined,a@example.com,2026-10-20T16:00:00Z
`;
    const csv = parseCsv(text);
    expect(csv.kind).toBe('orders');
    const res = applyImport(db, csv, csv.mapping, 'bot.csv', 'admin');
    expect(res.created).toBe(1);
    const o = db.get<any>('SELECT * FROM orders');
    expect(o.units).toBe(3);
    expect(o.total_cents).toBe(9998 + 2694);
    rollbackImport(db, res.batchId, 'admin');
    expect(db.value('SELECT COUNT(*) FROM orders')).toBe(0);
  });
});

describe('exports and backups', () => {
  it('escapes formula injection in CSV', () => {
    expect(toCsv(['a'], [['=HYPERLINK("x")']])).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('exports orders and builds a member invoice', () => {
    const db = memDb();
    const csv = parseCsv(`Discord ID,Discord Username,Email\n123456789012345678,ExampleUser,a@example.com\n`);
    applyImport(db, csv, csv.mapping, 'p.csv', 'admin');
    const orders = parseCsv(`Site,Order Number,Product,Qty,Price,Email\nTarget,912000000000222,ETB,2,$49.99,a@example.com\n`);
    applyImport(db, orders, orders.mapping, 'o.csv', 'admin');
    const out = exportOrdersCsv(db, {});
    expect(out.startsWith('﻿')).toBe(true);
    expect(out).toContain('912000000000222');
    const memberId = db.value<number>('SELECT id FROM members')!;
    // Checkout emails are not identifiers, so the imported order is assigned by hand here.
    expect(db.value('SELECT member_id FROM orders')).toBeNull();
    assignOrder(db, db.value<number>('SELECT id FROM orders')!, memberId, 'admin');
    const inv = memberInvoice(db, memberId);
    expect(inv.totals.USD).toBe(9998);
    expect(inv.csv).toContain('123456789012345678');
  });

  it('creates rotating online backups', () => {
    const dir = mkdtempSync(join(tmpdir(), 'glide-bk-'));
    const db = openWorkspaceDb(join(dir, 'w.sqlite'), { name: 't', isSample: false });
    for (let i = 0; i < 3; i++) backupNow(db, join(dir, 'b'), 2);
    expect(listBackups(join(dir, 'b'))).toHaveLength(2);
  });
});
