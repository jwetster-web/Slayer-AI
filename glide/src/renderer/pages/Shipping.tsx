import { CheckCheck, CircleCheck, ExternalLink, RefreshCw, Settings2, Truck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatDate, formatNumber, relativeTime } from '../../shared/format';
import type { PackageStatus } from '../../shared/types';
import { call } from '../lib/api';
import { useAction, useQuery } from '../lib/hooks';
import { useStore } from '../lib/store';
import { AnimatedNumber, Badge, Button, Card, Empty, Field, Input, Modal, PackagePill, PageHeader, Tabs, Toggle } from '../components/ui';

const COLS: { id: PackageStatus | 'all'; label: string; color: string }[] = [
  { id: 'all', label: 'All', color: 'var(--g-accent)' },
  { id: 'label_created', label: 'Label created', color: 'var(--g-ink3)' },
  { id: 'in_transit', label: 'In transit', color: 'var(--g-violet)' },
  { id: 'out_for_delivery', label: 'Out for delivery', color: 'var(--g-warn)' },
  { id: 'delivered', label: 'Delivered', color: 'var(--g-good)' },
  { id: 'exception', label: 'Exceptions', color: 'var(--g-serious)' },
];

export function Shipping() {
  const { data } = useQuery(() => call('shipping.overview'), []);
  const { data: providers } = useQuery(() => call('shipping.providers'), []);
  const [tab, setTab] = useState<PackageStatus | 'all'>('all');
  const [bulk, setBulk] = useState(false);
  const act = useAction();
  const counts = useMemo(() => Object.fromEntries((data?.counts ?? []).map((c) => [c.status, c.count])), [data]);
  const total = (data?.counts ?? []).reduce((s, c) => s + c.count, 0);
  const rows = (data?.rows ?? []).filter((r) => tab === 'all' || r.status === tab || (tab === 'exception' && r.status === 'delayed'));
  const configured = providers?.filter((p) => p.configured).length ?? 0;
  const n = (x: number) => formatNumber(x);
  return (
    <div>
      <PageHeader eyebrow="Logistics" title="Shipping Tracker" subtitle="Packages from shipping emails, refreshed through Shippo, 17TRACK or carrier APIs where you have configured credentials. Every status shows when it was last verified." right={
        <>
          <Button icon={<Settings2 className="size-4" />} onClick={() => useStore.getState().navigate('settings', { settingsTab: 'shipping' })}>Carrier APIs ({configured}/{providers?.length ?? 4})</Button>
          <Button icon={<CheckCheck className="size-4" />} onClick={() => setBulk(true)}>Mark delivered…</Button>
          <Button variant="primary" icon={<RefreshCw className="size-4" />} onClick={() => act(async () => {
            const r = (await call('shipping.refresh')) as { checked: number; updated: number; skipped: number; errors: string[] };
            if (r.errors.length) throw new Error(r.errors[0]);
            useStore.getState().toast(r.checked ? `Checked ${r.checked} packages · ${r.updated} updated` : r.skipped ? 'No tracking API connected for these packages' : 'Nothing due — every package was checked recently', 'success');
          })}>Refresh now</Button>
        </>
      } />
      {configured === 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/30 bg-warn/10 p-3 text-sm text-warn">
          <span>
            No tracking API is connected, so deliveries are only detected from emails (retailer "delivered" emails, UPS / FedEx / USPS notices, Fetch Package). Most retailers never email when a package is delivered{counts.in_transit ? ` — ${n(counts.in_transit)} packages are waiting on a delivery scan` : ''}. Add a free Shippo API token to check every tracking number automatically.
          </span>
          <Button size="sm" variant="primary" onClick={() => useStore.getState().navigate('settings', { settingsTab: 'shipping' })}>Add tracking key</Button>
        </div>
      )}
      <BulkDelivered open={bulk} onClose={() => setBulk(false)} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {COLS.map((c) => (
          <Card key={c.id} onClick={() => setTab(c.id)} className={`relative overflow-hidden p-4 ${tab === c.id ? 'border-accent/50' : ''}`}>
            <div className="absolute inset-x-0 bottom-0 h-[2px]" style={{ background: c.color }} />
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ink3">{c.label}</div>
            <div className="mt-1 font-display text-2xl font-bold"><AnimatedNumber value={c.id === 'all' ? total : (counts[c.id] ?? 0) + (c.id === 'exception' ? counts.delayed ?? 0 : 0)} format={n} /></div>
          </Card>
        ))}
      </div>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <Tabs value={tab} onChange={setTab} tabs={COLS.map((c) => ({ id: c.id, label: c.label }))} />
          <span className="text-xs text-ink3">{rows.length} shown</span>
        </div>
        {!rows.length ? (
          <Empty icon={<Truck className="size-6" />} title="No packages here" body="Packages appear when shipping confirmations arrive." />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line text-[10px] uppercase tracking-[0.18em] text-ink3">
              <tr><th className="px-4 py-2.5 text-left">Tracking</th><th className="text-left">Status</th><th className="text-left">Latest event</th><th className="text-left">Order</th><th className="text-left">Member</th><th className="text-left">ETA</th><th className="px-4 text-right">Verified</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-b border-line/50 hover:bg-white/[0.03]" onClick={() => useStore.getState().openOrder(r.orderId)}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <Badge>{r.carrier.toUpperCase()}</Badge>
                      <span className="font-mono text-xs text-ink2">{r.trackingNumber}</span>
                      {r.trackingUrl && <button onClick={(e) => { e.stopPropagation(); call('app.openExternal', r.trackingUrl!); }} className="text-ink3 hover:text-accent" aria-label="Open carrier page"><ExternalLink className="size-3.5" /></button>}
                    </div>
                  </td>
                  <td><PackagePill status={r.status as PackageStatus} /></td>
                  <td className="max-w-[260px] truncate text-ink2">{r.lastEvent ?? '—'}</td>
                  <td className="text-ink2">{r.retailerName} <span className="font-mono text-xs text-ink3">#{r.orderNumber}</span></td>
                  <td className="text-ink2">{r.memberName ?? <span className="text-ink3">—</span>}</td>
                  <td className="text-ink3">{r.deliveredAt ? `Delivered ${formatDate(r.deliveredAt)}` : r.estimatedDelivery ? formatDate(r.estimatedDelivery) : '—'}</td>
                  <td className="px-4 text-right text-xs text-ink3">
                    <div className="flex items-center justify-end gap-2">
                      {relativeTime(r.lastVerifiedAt)}
                      {r.status !== 'delivered' && r.status !== 'returned' && (
                        <button title="Mark delivered" aria-label="Mark delivered" onClick={(e) => { e.stopPropagation(); void act(() => call('shipping.markDelivered', { packageIds: [r.id] }), 'Marked delivered'); }} className="text-ink3 hover:text-good">
                          <CircleCheck className="size-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function BulkDelivered({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [days, setDays] = useState('7');
  const [unshipped, setUnshipped] = useState(false);
  const [preview, setPreview] = useState<{ packages: number; orders: number } | null>(null);
  const act = useAction();
  const scope = { olderThanDays: Math.max(0, Number(days) || 0), includeUnshipped: unshipped };
  useEffect(() => {
    if (!open) return;
    void call('shipping.markDeliveredPreview', scope).then(setPreview);
  }, [open, days, unshipped]);
  const count = (preview?.packages ?? 0) + (preview?.orders ?? 0);
  return (
    <Modal open={open} onClose={onClose} title="Mark old shipments delivered" footer={<Button variant="primary" icon={<CheckCheck className="size-4" />} disabled={!count} onClick={async () => { const r = await act(() => call('shipping.markDelivered', scope), 'Marked delivered'); if (r) onClose(); }}>Mark {formatNumber(count)} delivered</Button>}>
      <div className="space-y-4 text-sm">
        <p className="text-ink3">Most retailers never email when a package arrives. Use this to close out shipments you know have landed. Each one is recorded as <span className="text-ink2">"Marked delivered by you"</span> — not as a carrier scan — and a later carrier update still shows up on the order.</p>
        <Field label="Last shipping update at least this many days ago"><Input type="number" min={0} value={days} onChange={(e) => setDays(e.target.value)} className="w-32" /></Field>
        <label className="flex items-center gap-3"><Toggle checked={unshipped} onChange={setUnshipped} /><span className="text-ink2">Also include orders that never got a shipping email (placed that long ago)</span></label>
        <div className="rounded-xl border border-line bg-bg2/40 p-3 text-ink2">
          {preview ? <>Will mark <b className="text-ink">{formatNumber(preview.packages)}</b> packages and <b className="text-ink">{formatNumber(preview.orders)}</b> orders without tracking as delivered.</> : 'Counting…'}
        </div>
      </div>
    </Modal>
  );
}
