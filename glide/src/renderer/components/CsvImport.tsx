import { AlertTriangle, FileSpreadsheet, ShieldAlert, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { formatDateTime } from '../../shared/format';
import { call, type ApiResult } from '../lib/api';
import { useAction, useQuery } from '../lib/hooks';
import { Badge, Button, Card, Field, Select, Tabs, cx } from './ui';

type Parsed = ApiResult<'csv.parse'>;
type Preview = ApiResult<'csv.preview'>;

const LABELS: Record<string, string> = {
  discordId: 'Discord ID', discordUsername: 'Discord username', profileName: 'Profile name', email: 'Email', firstName: 'First name', lastName: 'Last name', phone: 'Phone',
  address1: 'Address line 1', address2: 'Address line 2', city: 'City', state: 'State / province', zip: 'ZIP / postal', country: 'Country', retailer: 'Retailer', orderNumber: 'Order number',
  orderDate: 'Order date', product: 'Product', sku: 'SKU', quantity: 'Quantity', price: 'Unit price', total: 'Order total', trackingNumber: 'Tracking number', carrier: 'Carrier', status: 'Checkout status',
};
const PROFILE_FIELDS = ['discordId', 'discordUsername', 'profileName', 'email', 'firstName', 'lastName', 'phone', 'address1', 'address2', 'city', 'state', 'zip', 'country'];
const ORDER_FIELDS = ['retailer', 'orderNumber', 'orderDate', 'product', 'sku', 'quantity', 'price', 'total', 'status', 'email', 'firstName', 'lastName', 'address1', 'address2', 'city', 'state', 'zip', 'trackingNumber', 'carrier'];

export function CsvImport({ onDone }: { onDone?: () => void }) {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<'profiles' | 'orders'>('profiles');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const act = useAction();
  const { data: batches, refetch } = useQuery(() => call('csv.batches'), []);

  const choose = async (preset?: string) => {
    const [path] = await call('dialog.openFiles', { filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }] });
    if (!path) return;
    const p = await act(() => call('csv.parse', path, preset));
    if (!p) return;
    setParsed(p);
    setMapping(p.mapping as Record<string, string>);
    setKind(p.kind);
    setPreview(null);
  };

  const runPreview = async () => {
    if (!parsed) return;
    setBusy(true);
    setPreview((await act(() => call('csv.preview', parsed.token, mapping, kind))) ?? null);
    setBusy(false);
  };

  const apply = async () => {
    if (!parsed) return;
    setBusy(true);
    const r = await act(() => call('csv.apply', parsed.token, mapping, kind), 'Import applied — you can roll it back below');
    setBusy(false);
    if (r) {
      setParsed(null);
      setPreview(null);
      refetch();
      onDone?.();
    }
  };

  const fields = kind === 'profiles' ? PROFILE_FIELDS : ORDER_FIELDS;

  return (
    <div className="space-y-4">
      {!parsed ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <FileSpreadsheet className="size-10 text-accent" />
          <div className="font-display text-lg font-semibold">Import buying profiles, Discord mappings or bot order logs</div>
          <p className="max-w-lg text-sm text-ink3">Headers are matched automatically (PokeSlayerz, Valor, Sniped and common bot formats). Card numbers, CVVs and expiry columns are dropped before anything is stored.</p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => choose()}>Choose CSV…</Button>
            <Button onClick={() => choose('valor')}>Valor export</Button>
            <Button onClick={() => choose('sniped')}>Sniped export</Button>
          </div>
        </Card>
      ) : (
        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-display font-semibold">{parsed.rowCount.toLocaleString()} rows · {parsed.headers.length} columns</div>
              <div className="text-xs text-ink3">{parsed.detectedPreset ? `Detected format: ${parsed.detectedPreset}` : 'Generic CSV — check the mapping below'}</div>
            </div>
            <Tabs value={kind} onChange={(k) => { setKind(k); setPreview(null); }} tabs={[{ id: 'profiles', label: 'Profiles & members' }, { id: 'orders', label: 'Orders' }]} />
          </div>
          {!!parsed.dropped.length && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <span>Dropped for your protection: {parsed.dropped.map((d) => `${d.header} (${d.reason})`).join('; ')}</span>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map((f) => (
              <Field key={f} label={LABELS[f] ?? f}>
                <Select className="w-full" value={mapping[f] ?? ''} onChange={(e) => { setMapping({ ...mapping, [f]: e.target.value || undefined } as Record<string, string>); setPreview(null); }}>
                  <option value="">— not mapped —</option>
                  {parsed.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </Select>
              </Field>
            ))}
          </div>
          <div className="mt-4 overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-xs">
              <thead className="bg-bg2/60 text-ink3"><tr>{parsed.headers.map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-semibold">{h}</th>)}</tr></thead>
              <tbody>
                {parsed.sample.slice(0, 5).map((r, i) => (
                  <tr key={i} className="border-t border-line/60">{parsed.headers.map((h) => <td key={h} className="max-w-[180px] truncate whitespace-nowrap px-3 py-1.5 text-ink2">{r[h]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => setParsed(null)}>Cancel</Button>
            <Button variant="primary" busy={busy} onClick={runPreview}>Preview changes</Button>
          </div>
          {preview && (
            <div className="mt-5">
              <div className="mb-3 flex flex-wrap gap-2">
                <Badge tone="good">{preview.creates} new</Badge>
                <Badge tone="accent">{preview.updates} update existing</Badge>
                <Badge tone="neutral">{preview.skips} skipped</Badge>
                {preview.missing > 0 && <Badge tone="bad">{preview.missing} missing required fields</Badge>}
                {preview.duplicates > 0 && <Badge tone="warn">{preview.duplicates} duplicates</Badge>}
              </div>
              <div className="max-h-72 space-y-1 overflow-auto rounded-xl border border-line p-2">
                {preview.rows.map((r) => (
                  <div key={r.index} className={cx('flex items-start justify-between gap-3 rounded-lg px-2 py-1.5 text-xs', r.action === 'skip' && 'opacity-60')}>
                    <span className="text-ink2">#{r.index + 1} {r.summary}</span>
                    <span className="flex shrink-0 flex-wrap justify-end gap-1">
                      <Badge tone={r.action === 'create' ? 'good' : r.action === 'update' ? 'accent' : 'neutral'}>{r.action}</Badge>
                      {r.issues.map((x) => <Badge key={x} tone="bad"><AlertTriangle className="size-3" />{x}</Badge>)}
                      {r.suggestions.map((x) => <Badge key={x} tone="warn">{x}</Badge>)}
                    </span>
                  </div>
                ))}
              </div>
              <Button className="mt-3" variant="primary" busy={busy} disabled={!preview.creates && !preview.updates} onClick={apply}>Apply import</Button>
            </div>
          )}
        </Card>
      )}
      {!!batches?.length && (
        <Card className="p-5">
          <div className="mb-2 font-display font-semibold">Import history</div>
          {batches.slice(0, 8).map((b) => {
            const stats = JSON.parse(b.statsJson || '{}');
            return (
              <div key={b.id} className="flex items-center justify-between gap-3 border-b border-line/50 py-2 text-sm last:border-0">
                <span className="text-ink2">{b.filename} · {b.kind} · {stats.created ?? 0} created · {formatDateTime(b.createdAt)}</span>
                {b.status === 'applied' ? (
                  <Button size="sm" icon={<Undo2 className="size-3.5" />} onClick={async () => { await act(() => call('csv.rollback', b.id), 'Import rolled back'); refetch(); }}>Roll back</Button>
                ) : (
                  <Badge>rolled back</Badge>
                )}
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
