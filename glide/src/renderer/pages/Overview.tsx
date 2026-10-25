import { AnimatePresence, motion } from 'motion/react';
import { Ban, Boxes, CheckCircle2, DollarSign, PackageCheck, ShoppingBag, Sparkles, TrendingUp, Truck, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatCents, formatNumber, formatPct, formatTime, relativeTime } from '../../shared/format';
import { call } from '../lib/api';
import { useQuery } from '../lib/hooks';
import { rangeFilter, type RangeId } from '../lib/ranges';
import { useStore } from '../lib/store';
import { baseOption, chartTheme, EChart } from '../components/Chart';
import { RangePicker } from '../components/RangePicker';
import { Avatar, Button, Card, Empty, KpiTile, PageHeader, ProductThumb, SectionTitle, Skeleton, StatusPill } from '../components/ui';

export function Overview() {
  const [range, setRange] = useState<RangeId>('7d');
  const filter = useMemo(() => rangeFilter(range), [range]);
  const navigate = useStore((s) => s.navigate);
  const openOrder = useStore((s) => s.openOrder);
  const settings = useStore((s) => s.settings);
  const { data: b } = useQuery(() => call('analytics.bundle', filter, range === 'today' ? 'hour' : 'day'), [filter, range]);
  const { data: recent } = useQuery(() => call('orders.list', { ...filter, sort: 'placed_desc', limit: 8 }), [filter]);
  const { data: ship } = useQuery(() => call('activity.list', { limit: 10, kinds: ['tracking_found', 'shipped', 'out_for_delivery', 'delivered'] }), []);
  const k = b?.kpis;
  const cur = k?.currency ?? settings?.displayCurrency ?? 'USD';
  const money = useMemo(() => (n: number) => formatCents(n, cur), [cur]);
  const num = useMemo(() => (n: number) => formatNumber(n), []);
  const pct = useMemo(() => (n: number) => formatPct(n / 1000), []);
  const drill = (f: object) => navigate('orders', { orderFilter: { ...filter, ...f } });

  const timelineOpt = useMemo(() => {
    if (!b) return {};
    const t = chartTheme();
    const base = baseOption();
    return {
      ...base,
      tooltip: { ...base.tooltip, trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: t.accent, width: 1 } }, valueFormatter: (v: number) => formatCents(v, cur) },
      xAxis: { ...base.xAxis, type: 'category', data: b.timeline.map((p) => p.bucket.slice(5)), boundaryGap: false },
      yAxis: { ...base.yAxis, type: 'value', axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => formatCents(v, cur, { compact: true }) } },
      series: [
        {
          name: 'Net secured',
          type: 'line',
          smooth: 0.35,
          showSymbol: false,
          symbolSize: 8,
          lineStyle: { width: 2, color: t.accent },
          areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: t.accent + '66' }, { offset: 1, color: t.accent + '00' }] } },
          data: b.timeline.map((p) => p.netCents),
        },
      ],
    };
  }, [b, cur]);

  if (!b || !k) return <div className="grid gap-4 md:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>;

  return (
    <div>
      <PageHeader eyebrow="Command Center" title={`${settings?.brandName ?? 'PokeSlayerz'} Overview`} subtitle="Every checkout, shipment and member across your inboxes — updated live as emails arrive." right={<RangePicker value={range} onChange={setRange} options={['today', '7d', '30d', '90d', 'all']} />} />
      <StaleNotice />

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Card glow className="relative overflow-hidden p-6">
          <div className="pointer-events-none absolute -left-10 -top-24 size-80 rounded-full bg-accent/25 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 right-0 size-72 rounded-full bg-violet/20 blur-3xl" />
          <div className="relative">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-ink3">
              <Sparkles className="size-3.5 text-accent" /> Total secured · net after cancellations
            </div>
            <div className="glow-text grad-text mt-2 font-display text-[64px] font-bold leading-none tracking-tight">
              <KpiNumber value={k.netCents} format={money} />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink2">
              <span>Gross <b className="text-ink">{money(k.grossCents)}</b></span>
              <span>Canceled <b className="text-bad">{money(k.canceledCents)}</b></span>
              <span>Avg order <b className="text-ink">{money(k.avgOrderCents)}</b></span>
              {k.mixedCurrency && <span className="text-warn">Some orders use currencies without an FX rate — set rates in Settings</span>}
            </div>
            <div className="mt-6">
              <EChart option={timelineOpt} height={190} />
            </div>
          </div>
        </Card>
        <div className="grid grid-cols-2 gap-4">
          <KpiTile label="Orders" value={k.orders} format={num} icon={<ShoppingBag className="size-4" />} sub={`${k.partiallyCanceledOrders} partially canceled`} onClick={() => drill({})} />
          <KpiTile label="Live" value={k.liveOrders} format={num} accent="var(--g-good)" icon={<CheckCircle2 className="size-4" />} sub="Not canceled" onClick={() => drill({ cancel: ['none', 'partial'] })} />
          <KpiTile label="Success rate" value={Math.round(k.successRate * 1000)} format={pct} accent="var(--g-violet)" icon={<TrendingUp className="size-4" />} sub={`${formatPct(k.cancellationRate)} canceled`} />
          <KpiTile label="Canceled" value={k.canceledOrders} format={num} accent="var(--g-bad)" icon={<Ban className="size-4" />} sub={`${k.reviewHolds} on review hold`} onClick={() => drill({ cancel: ['full'] })} />
          <KpiTile label="Units secured" value={k.netUnits} format={num} accent="var(--g-cyan)" icon={<Boxes className="size-4" />} sub={`${k.units} ordered`} />
          <KpiTile label="Active buyers" value={k.activeBuyers} format={num} accent="var(--g-warn)" icon={<Users className="size-4" />} sub={`${money(k.avgSpendPerMemberCents)} avg / member`} onClick={() => navigate('members')} />
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <KpiTile label="Awaiting shipment" value={k.awaitingShipment} format={num} icon={<DollarSign className="size-4" />} onClick={() => drill({ fulfillment: ['ordered', 'processing', 'backordered'], cancel: ['none', 'partial'] })} />
        <KpiTile label="In transit" value={k.inTransitOrders} format={num} accent="var(--g-violet)" icon={<Truck className="size-4" />} onClick={() => drill({ fulfillment: ['shipped', 'partially_shipped', 'out_for_delivery', 'partially_delivered', 'delayed', 'exception'] })} />
        <KpiTile label="Delivered" value={k.deliveredOrders} format={num} accent="var(--g-good)" icon={<PackageCheck className="size-4" />} sub={`${formatPct(k.fulfillmentRate)} of live orders`} onClick={() => drill({ fulfillment: ['delivered'] })} />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        <Card className="p-5">
          <SectionTitle title="Recently detected purchases" subtitle="Newest checkouts first" right={<Button size="sm" variant="ghost" onClick={() => navigate('orders', { orderFilter: filter })}>View all</Button>} />
          {!recent?.rows.length ? (
            <Empty title="No orders in this range" body="Connect an inbox or import emails to start tracking." />
          ) : (
            <div className="space-y-1.5">
              <AnimatePresence initial={false}>
                {recent.rows.map((o) => (
                  <motion.button layout key={o.id} initial={{ opacity: 0, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} onClick={() => openOrder(o.id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-white/[0.04]">
                    <ProductThumb src={o.firstImage} title={o.firstTitle ?? ''} size={46} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">{o.firstTitle ?? `Order #${o.orderNumber}`}</div>
                      <div className="flex items-center gap-2 text-xs text-ink3">
                        <span>{o.retailerName}</span>·<span>{o.units} units</span>·<span>{relativeTime(o.placedAt)}</span>
                      </div>
                    </div>
                    <div className="hidden sm:block"><StatusPill status={o.fulfillmentStatus} cancel={o.cancelState} review={o.reviewStatus} /></div>
                    <div className="flex w-36 items-center justify-end gap-2">
                      {o.memberName && <Avatar name={o.memberName} src={o.memberAvatar} size={22} />}
                      <span className="font-display text-sm font-semibold tabular text-ink">{formatCents(o.totalCents, o.currency)}</span>
                    </div>
                  </motion.button>
                ))}
              </AnimatePresence>
            </div>
          )}
        </Card>
        <div className="grid gap-4">
          <Card className="p-5">
            <SectionTitle title="Live shipment events" subtitle="From shipping emails and carrier APIs" right={<Button size="sm" variant="ghost" onClick={() => navigate('shipping')}>Tracker</Button>} />
            {!ship?.length ? (
              <div className="py-6 text-center text-sm text-ink3">No shipment events yet.</div>
            ) : (
              <div className="space-y-2">
                {ship.map((a) => (
                  <button key={a.id} onClick={() => a.orderId && openOrder(a.orderId)} className="flex w-full items-center gap-3 rounded-lg px-1 py-1 text-left text-sm hover:bg-white/[0.03]">
                    <span className="w-20 font-mono text-[11px] text-ink3">{formatTime(a.at)}</span>
                    <span className={a.kind === 'delivered' ? 'text-good' : a.kind === 'out_for_delivery' ? 'text-warn' : 'text-violet'}>●</span>
                    <span className="flex-1 truncate text-ink2">{a.label} · {a.retailerName}</span>
                    <span className="truncate text-xs text-ink3">{a.memberName ? `@${a.memberName}` : ''}</span>
                  </button>
                ))}
              </div>
            )}
          </Card>
          <Card className="p-5">
            <SectionTitle title="Product activity" subtitle="Most secured in this range" right={<Button size="sm" variant="ghost" onClick={() => navigate('catalog')}>Catalog</Button>} />
            <div className="grid grid-cols-4 gap-3">
              {b.byProduct.slice(0, 8).map((p) => (
                <button key={p.key} onClick={() => drill({ productIds: [Number(p.key)] })} className="group text-left">
                  <div className="relative">
                    <ProductThumb src={p.imageUrl} title={p.label} size={84} className="!w-full transition group-hover:border-accent/50" />
                    <span className="absolute bottom-1 right-1 rounded-md bg-black/70 px-1.5 font-display text-xs font-bold text-white">×{p.units}</span>
                  </div>
                  <div className="mt-1 line-clamp-1 text-[11px] text-ink3">{p.label.replace(/^Pok[ée]mon TCG:\s*/i, '')}</div>
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Card className="mt-4 p-5">
        <SectionTitle title="Retailers" subtitle="Net secured · click to drill down" />
        <div className="space-y-2.5">
          {b.byRetailer.map((r) => {
            const max = Math.max(...b.byRetailer.map((x) => x.netCents), 1);
            return (
              <button key={r.key} onClick={() => drill({ retailers: [r.key] })} className="group flex w-full items-center gap-4 text-left">
                <span className="w-44 truncate text-sm text-ink2 group-hover:text-ink">{r.label}</span>
                <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                  <motion.div className="h-full rounded-full bg-gradient-to-r from-accent to-violet" initial={{ width: 0 }} animate={{ width: `${(r.netCents / max) * 100}%` }} transition={{ duration: 0.8 }} />
                </div>
                <span className="w-24 text-right font-mono text-xs tabular text-ink3">{r.successfulOrders}/{r.orders}</span>
                <span className="w-28 text-right font-display text-sm font-semibold tabular text-ink">{formatCents(r.netCents, cur)}</span>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function KpiNumber({ value, format }: { value: number; format: (n: number) => string }) {
  return <AnimatedValue value={value} format={format} />;
}

import { AnimatedNumber as AnimatedValue } from '../components/ui';

function StaleNotice() {
  const { data: stale } = useQuery(() => call('orders.staleCount', 10), []);
  if (!stale) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">
      <span><b>{stale}</b> open order{stale === 1 ? ' has' : 's have'} had no email or tracking update in 10+ days — they may have been canceled silently, be stuck in transit, or already delivered without a scan.</span>
      <Button size="sm" onClick={() => useStore.getState().navigate('orders', { orderFilter: { staleDays: 10 } })}>Review them</Button>
    </div>
  );
}
