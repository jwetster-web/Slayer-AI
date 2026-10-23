import { useVirtualizer } from '@tanstack/react-virtual';
import { motion } from 'motion/react';
import { Download, FilterX, ListOrdered, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatCents, formatDateTime } from '../../shared/format';
import type { CancelState, FulfillmentStatus, MatchStatus, OrderFilter, OrderRow, ReviewStatus } from '../../shared/types';
import { call } from '../lib/api';
import { useAction, useDebounced, useQuery } from '../lib/hooks';
import { useStore } from '../lib/store';
import { Avatar, Badge, Button, Card, Empty, ErrorNote, Input, MatchBadge, PageHeader, ProductThumb, Select, StatusPill, cx } from '../components/ui';

const PAGE = 200;

const FULFILLMENT_OPTS: [string, FulfillmentStatus[]][] = [
  ['Awaiting shipment', ['ordered', 'processing', 'backordered']],
  ['In transit', ['shipped', 'partially_shipped', 'out_for_delivery', 'partially_delivered', 'delayed', 'exception']],
  ['Out for delivery', ['out_for_delivery']],
  ['Delivered', ['delivered']],
  ['Exceptions & delays', ['exception', 'delayed']],
  ['Canceled', ['canceled']],
  ['Returned', ['returned']],
];

export function Orders() {
  const initial = useStore((s) => s.orderFilter);
  const navigate = useStore((s) => s.navigate);
  const openOrder = useStore((s) => s.openOrder);
  const version = useStore((s) => s.dataVersion);
  const [search, setSearch] = useState(initial.search ?? '');
  const [filter, setFilter] = useState<OrderFilter>(initial);
  const dsearch = useDebounced(search, 250);
  const { data: info } = useQuery(() => call('app.info'), [], { live: false });
  const act = useAction();
  useEffect(() => {
    setFilter(initial);
    setSearch(initial.search ?? '');
  }, [initial]);

  const eff = useMemo(() => ({ ...filter, search: dsearch || undefined }), [filter, dsearch]);
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadingMore = useRef(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    call('orders.list', { ...eff, limit: Math.max(PAGE, rows.length && version ? rows.length : PAGE), offset: 0 })
      .then((r) => {
        if (!alive) return;
        setRows(r.rows);
        setTotal(r.total);
        setError(null);
      })
      .catch((e) => alive && setError(String(e.message ?? e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eff, version]);

  const parent = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parent.current, estimateSize: () => 64, overscan: 12 });
  const items = v.getVirtualItems();
  useEffect(() => {
    const last = items[items.length - 1];
    if (!last || last.index < rows.length - 30 || rows.length >= total || loadingMore.current) return;
    loadingMore.current = true;
    call('orders.list', { ...eff, limit: PAGE, offset: rows.length })
      .then((r) => setRows((prev) => [...prev, ...r.rows]))
      .finally(() => (loadingMore.current = false));
  }, [items, rows.length, total, eff]);

  const set = (patch: Partial<OrderFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const active = Object.entries(eff).filter(([k, val]) => k !== 'sort' && val !== undefined && (!Array.isArray(val) || val.length)).length;
  const fKey = FULFILLMENT_OPTS.find(([, s]) => JSON.stringify(s) === JSON.stringify(filter.fulfillment))?.[0] ?? '';

  return (
    <div className="flex h-[calc(100vh-68px-56px)] flex-col">
      <PageHeader
        eyebrow="Order Intelligence"
        title="Live Orders"
        subtitle={`${total.toLocaleString()} orders match · click any row for the full timeline`}
        right={
          <>
            <Button icon={<Download className="size-4" />} onClick={() => act(async () => { const p = await call('orders.exportCsv', eff); return p; }, 'CSV exported')}>
              Export CSV
            </Button>
          </>
        }
      />
      <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink3" />
          <Input className="pl-9" placeholder="Order #, product, SKU, member, Discord ID, email, tracking…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={filter.retailers?.[0] ?? ''} onChange={(e) => set({ retailers: e.target.value ? [e.target.value as never] : undefined })}>
          <option value="">All retailers</option>
          {info?.retailers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
        <Select value={fKey} onChange={(e) => set({ fulfillment: FULFILLMENT_OPTS.find(([k]) => k === e.target.value)?.[1] })}>
          <option value="">Any fulfillment</option>
          {FULFILLMENT_OPTS.map(([k]) => <option key={k}>{k}</option>)}
        </Select>
        <Select value={filter.cancel?.join(',') ?? ''} onChange={(e) => set({ cancel: e.target.value ? (e.target.value.split(',') as CancelState[]) : undefined })}>
          <option value="">Any cancellation</option>
          <option value="none,partial">Live (not canceled)</option>
          <option value="partial">Partially canceled</option>
          <option value="full">Fully canceled</option>
        </Select>
        <Select value={filter.review?.[0] ?? ''} onChange={(e) => set({ review: e.target.value ? [e.target.value as ReviewStatus] : undefined })}>
          <option value="">Any review</option>
          <option value="hold">On review hold</option>
          <option value="cleared">Hold cleared</option>
        </Select>
        <Select value={filter.match?.join(',') ?? ''} onChange={(e) => set({ match: e.target.value ? (e.target.value.split(',') as MatchStatus[]) : undefined })}>
          <option value="">Any match</option>
          <option value="auto,verified">Matched</option>
          <option value="review">Needs review</option>
          <option value="unmatched">Unmatched</option>
        </Select>
        <Select value={filter.sort ?? 'placed_desc'} onChange={(e) => set({ sort: e.target.value as OrderFilter['sort'] })}>
          <option value="placed_desc">Newest</option>
          <option value="placed_asc">Oldest</option>
          <option value="activity_desc">Latest activity</option>
          <option value="total_desc">Highest total</option>
          <option value="total_asc">Lowest total</option>
        </Select>
        {active > 0 && (
          <Button variant="ghost" icon={<FilterX className="size-4" />} onClick={() => { setFilter({}); setSearch(''); navigate('orders', { orderFilter: {} }); }}>
            Clear {active}
          </Button>
        )}
        {(filter.memberIds || filter.productIds || filter.profileIds || filter.from) && (
          <div className="flex w-full flex-wrap gap-1.5 pt-1">
            {filter.memberIds && <Badge tone="accent">Member filter</Badge>}
            {filter.productIds && <Badge tone="accent">Product filter</Badge>}
            {filter.profileIds && <Badge tone="accent">Profile filter</Badge>}
            {filter.from && <Badge tone="accent">From {new Date(filter.from).toLocaleDateString()}</Badge>}
            {filter.to && <Badge tone="accent">To {new Date(filter.to).toLocaleDateString()}</Badge>}
          </div>
        )}
      </Card>
      <ErrorNote error={error} />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="grid grid-cols-[minmax(240px,2.4fr)_1fr_1.1fr_1.2fr_1.3fr_0.8fr_0.9fr] gap-3 border-b border-line px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink3">
          <span>Product</span><span>Retailer</span><span>Order</span><span>Member</span><span>Status</span><span className="text-right">Total</span><span className="text-right">Placed</span>
        </div>
        {!loading && !rows.length ? (
          <Empty icon={<ListOrdered className="size-6" />} title="No orders match" body="Try clearing filters, or connect an inbox in Email Accounts." />
        ) : (
          <div ref={parent} className="min-h-0 flex-1 overflow-auto">
            <div style={{ height: v.getTotalSize(), position: 'relative' }}>
              {items.map((it) => {
                const o = rows[it.index];
                return (
                  <motion.button
                    key={o.id}
                    initial={false}
                    onClick={() => openOrder(o.id)}
                    className={cx('absolute left-0 grid w-full grid-cols-[minmax(240px,2.4fr)_1fr_1.1fr_1.2fr_1.3fr_0.8fr_0.9fr] items-center gap-3 border-b border-line/50 px-4 text-left text-sm transition hover:bg-accent/[0.06]', o.cancelState === 'full' && 'opacity-60')}
                    style={{ top: it.start, height: it.size }}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <ProductThumb src={o.firstImage} title={o.firstTitle ?? ''} size={44} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">{o.firstTitle ?? '—'}</span>
                        <span className="text-xs text-ink3">{o.units} units{o.packageCount ? ` · ${o.packageCount} pkg` : ''}</span>
                      </span>
                    </span>
                    <span className="truncate text-ink2">{o.retailerName}</span>
                    <span className="truncate font-mono text-xs text-ink2">{o.orderNumber}</span>
                    <span className="flex min-w-0 items-center gap-2">
                      {o.memberName ? <Avatar name={o.memberName} src={o.memberAvatar} size={24} /> : null}
                      <span className="min-w-0">
                        <span className="block truncate text-ink2">{o.memberName ?? <span className="text-ink3">Unassigned</span>}</span>
                        <MatchBadge status={o.matchStatus} confidence={o.matchConfidence} />
                      </span>
                    </span>
                    <span><StatusPill status={o.fulfillmentStatus} cancel={o.cancelState} review={o.reviewStatus} /></span>
                    <span className="text-right font-display font-semibold tabular text-ink">{formatCents(o.totalCents, o.currency)}</span>
                    <span className="text-right text-xs text-ink3">{formatDateTime(o.placedAt)}</span>
                  </motion.button>
                );
              })}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
