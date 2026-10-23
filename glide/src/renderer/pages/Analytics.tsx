import { ArrowDownRight, ArrowUpRight, BarChart3, Megaphone, Plus, Upload } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { formatCents, formatNumber, formatPct } from '../../shared/format';
import type { KpiSummary, OrderFilter } from '../../shared/types';
import { call } from '../lib/api';
import { useAction, useQuery } from '../lib/hooks';
import { previousPeriod, rangeFilter, type RangeId } from '../lib/ranges';
import { useStore } from '../lib/store';
import { baseOption, chartTheme, EChart } from '../components/Chart';
import { RangePicker } from '../components/RangePicker';
import { Avatar, Button, Card, Field, Input, Modal, PageHeader, ProductThumb, SectionTitle, Select, Skeleton, Tabs, Toggle } from '../components/ui';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function Delta({ cur, prev, money, invert }: { cur: number; prev: number | undefined; money?: string; invert?: boolean }) {
  if (prev === undefined) return null;
  if (!prev) return <span className="text-xs text-ink3">no prior data</span>;
  const d = (cur - prev) / prev;
  const good = invert ? d < 0 : d > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${good ? 'text-good' : d === 0 ? 'text-ink3' : 'text-bad'}`}>
      {d >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {formatPct(Math.abs(d))} <span className="font-normal text-ink3">vs {money ? formatCents(prev, money, { compact: true }) : formatNumber(prev)}</span>
    </span>
  );
}

export function Analytics() {
  const [range, setRange] = useState<RangeId>('30d');
  const [custom, setCustom] = useState<{ from?: string; to?: string }>({});
  const [retailer, setRetailer] = useState('');
  const [gran, setGran] = useState<'day' | 'week' | 'month' | 'hour'>('day');
  const [compare, setCompare] = useState(true);
  const navigate = useStore((s) => s.navigate);
  const filter: OrderFilter = useMemo(() => ({ ...rangeFilter(range, custom), retailers: retailer ? [retailer as never] : undefined }), [range, custom, retailer]);
  const prevFilter = useMemo(() => {
    const p = previousPeriod(filter);
    return p ? { ...filter, ...p } : null;
  }, [filter]);
  const { data: info } = useQuery(() => call('app.info'), [], { live: false });
  const { data: b } = useQuery(() => call('analytics.bundle', filter, gran), [filter, gran]);
  const { data: prev } = useQuery(() => (compare && prevFilter ? call('analytics.kpis', prevFilter) : Promise.resolve(undefined)), [compare, prevFilter]);
  const k = b?.kpis;
  const cur = k?.currency ?? 'USD';
  const drill = useCallback((f: OrderFilter) => navigate('orders', { orderFilter: { ...filter, ...f } }), [navigate, filter]);

  const lineOpt = (key: 'netCents' | 'orders', name: string, money: boolean) => {
    if (!b) return {};
    const t = chartTheme();
    const base = baseOption();
    return {
      ...base,
      tooltip: { ...base.tooltip, trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: t.ink3 } }, valueFormatter: (v: number) => (money ? formatCents(v, cur) : formatNumber(v)) },
      xAxis: { ...base.xAxis, type: 'category', data: b.timeline.map((p) => p.bucket), boundaryGap: !money },
      yAxis: { ...base.yAxis, type: 'value', axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => (money ? formatCents(v, cur, { compact: true }) : formatNumber(v, { compact: true })) } },
      series: money
        ? [{ name, type: 'line', smooth: 0.3, showSymbol: false, symbolSize: 8, lineStyle: { width: 2, color: t.series[0] }, itemStyle: { color: t.series[0] }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: t.series[0] + '55' }, { offset: 1, color: t.series[0] + '00' }] } }, data: b.timeline.map((p) => p[key]) }]
        : [
            { name: 'Live', type: 'bar', stack: 'o', barMaxWidth: 22, itemStyle: { color: t.series[0], borderRadius: [0, 0, 0, 0] }, data: b.timeline.map((p) => p.orders - p.canceled) },
            { name: 'Canceled', type: 'bar', stack: 'o', barMaxWidth: 22, itemStyle: { color: t.series[1], borderRadius: [4, 4, 0, 0], borderColor: 'transparent' }, data: b.timeline.map((p) => p.canceled) },
          ],
      legend: money ? undefined : { top: 0, right: 0, textStyle: { color: t.ink2 }, itemWidth: 10, itemHeight: 10, icon: 'roundRect' },
      grid: { ...base.grid, top: money ? 16 : 30 },
    };
  };
  const netOpt = useMemo(() => lineOpt('netCents', 'Net secured', true), [b, cur]);
  const volOpt = useMemo(() => lineOpt('orders', 'Orders', false), [b, cur]);

  const heatOpt = useMemo(() => {
    if (!b) return {};
    const t = chartTheme();
    const base = baseOption();
    const max = Math.max(1, ...b.heatmap.map((h) => h.orders));
    return {
      ...base,
      tooltip: { ...base.tooltip, formatter: (p: any) => `${DOW[p.value[1]]} ${String(p.value[0]).padStart(2, '0')}:00 — <b>${p.value[2]}</b> orders` },
      grid: { left: 8, right: 8, top: 8, bottom: 40, containLabel: true },
      xAxis: { ...base.xAxis, type: 'category', data: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')), splitArea: { show: false } },
      yAxis: { ...base.yAxis, type: 'category', data: DOW, splitLine: { show: false } },
      visualMap: { min: 0, max, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemWidth: 10, itemHeight: 120, textStyle: { color: t.ink3 }, inRange: { color: t.light ? ['#eef3fd', '#9cbcf0', '#2a78d6', '#163f73'] : ['#121a33', '#1f3f78', '#3987e5', '#9cc3ff'] } },
      series: [{ type: 'heatmap', data: b.heatmap.map((h) => [h.hour, h.dow, h.orders]), itemStyle: { borderColor: 'var(--g-chart-surface)', borderWidth: 2, borderRadius: 3 }, emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1 } } }],
    };
  }, [b]);

  const retailOpt = useMemo(() => {
    if (!b) return {};
    const t = chartTheme();
    const base = baseOption();
    const rows = [...b.byRetailer].reverse();
    return {
      ...base,
      tooltip: { ...base.tooltip, trigger: 'item', formatter: (p: any) => `${p.name}<br/><b>${formatCents(p.value, cur)}</b> net · ${rows[p.dataIndex].orders} orders` },
      grid: { left: 8, right: 70, top: 4, bottom: 4, containLabel: true },
      xAxis: { ...base.xAxis, type: 'value', show: false },
      yAxis: { ...base.yAxis, type: 'category', data: rows.map((r) => r.label), splitLine: { show: false }, axisLabel: { color: t.ink2, fontSize: 12 } },
      series: [{ type: 'bar', barWidth: 14, data: rows.map((r) => r.netCents), itemStyle: { color: t.series[0], borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', color: t.ink2, fontSize: 11, formatter: (p: any) => formatCents(p.value, cur, { compact: true }) } }],
    };
  }, [b, cur]);

  const statusOpt = useMemo(() => {
    if (!b) return {};
    const t = chartTheme();
    const base = baseOption();
    const rows = [...b.byStatus].reverse();
    return {
      ...base,
      tooltip: { ...base.tooltip, trigger: 'item' },
      grid: { left: 8, right: 40, top: 4, bottom: 4, containLabel: true },
      xAxis: { ...base.xAxis, type: 'value', show: false },
      yAxis: { ...base.yAxis, type: 'category', data: rows.map((r) => r.status.replace(/_/g, ' ')), splitLine: { show: false }, axisLabel: { color: t.ink2, fontSize: 12 } },
      series: [{ type: 'bar', barWidth: 12, data: rows.map((r) => r.count), itemStyle: { color: t.series[6], borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', color: t.ink2, fontSize: 11 } }],
    };
  }, [b]);

  const onRetailClick = useCallback((p: any) => { const r = [...(b?.byRetailer ?? [])].reverse()[p.dataIndex]; if (r) drill({ retailers: [r.key as never] }); }, [b, drill]);
  const onStatusClick = useCallback((p: any) => { const r = [...(b?.byStatus ?? [])].reverse()[p.dataIndex]; if (r) drill({ fulfillment: [r.status as never] }); }, [b, drill]);
  const onTimeClick = useCallback((p: any) => {
    const bucket = b?.timeline[p.dataIndex]?.bucket;
    if (!bucket || gran !== 'day') return;
    const from = new Date(`${bucket}T00:00:00`);
    drill({ from: from.toISOString(), to: new Date(from.getTime() + 86400000).toISOString() });
  }, [b, gran, drill]);

  return (
    <div>
      <PageHeader eyebrow="Insight" title="Spending & Performance" subtitle="Live, filterable analytics. Click any bar, point, row or product to see the exact orders behind it." right={
        <>
          <Select value={retailer} onChange={(e) => setRetailer(e.target.value)}>
            <option value="">All retailers</option>
            {info?.retailers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
          <Toggle checked={compare} onChange={setCompare} label="Compare to previous period" />
        </>
      } />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <RangePicker value={range} onChange={setRange} custom={custom} onCustom={setCustom} />
        <Tabs value={gran} onChange={setGran} tabs={[{ id: 'hour', label: 'Hourly' }, { id: 'day', label: 'Daily' }, { id: 'week', label: 'Weekly' }, { id: 'month', label: 'Monthly' }]} />
      </div>
      {!b || !k ? (
        <div className="grid gap-4 md:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : (
        <>
          <KpiGrid k={k} prev={compare ? prev ?? undefined : undefined} />
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Card className="p-5"><SectionTitle title="Net secured over time" subtitle="After cancellations and refunds" /><EChart option={netOpt} height={260} onClick={onTimeClick} /></Card>
            <Card className="p-5"><SectionTitle title="Checkout volume" subtitle="Orders per period — live vs canceled" /><EChart option={volOpt} height={260} onClick={onTimeClick} /></Card>
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <Card className="p-5 xl:col-span-2"><SectionTitle title="Checkout heatmap" subtitle="When orders are placed (your local time)" /><EChart option={heatOpt} height={280} /></Card>
            <Card className="p-5">
              <SectionTitle title="Cancellations" subtitle={`${formatPct(k.cancellationRate)} of orders`} />
              <div className="space-y-3">
                {b.cancellationReasons.map((c) => (
                  <div key={c.label}>
                    <div className="mb-1 flex justify-between text-sm"><span className="text-ink2">{c.label}</span><span className="font-mono text-ink">{c.count}</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-[var(--g-bad)]" style={{ width: `${(c.count / Math.max(1, k.orders)) * 100}%` }} /></div>
                  </div>
                ))}
                <div className="border-t border-line pt-3 text-sm">
                  <div className="flex justify-between"><span className="text-ink3">Canceled value</span><span className="text-bad">{formatCents(k.canceledCents, cur)}</span></div>
                  <div className="flex justify-between"><span className="text-ink3">Refunded</span><span className="text-ink">{formatCents(k.refundedCents, cur)}</span></div>
                  <div className="flex justify-between"><span className="text-ink3">Review holds</span><span className="text-ink">{k.reviewHolds}</span></div>
                </div>
                <Button size="sm" onClick={() => drill({ cancel: ['full', 'partial'] })}>View canceled orders</Button>
              </div>
            </Card>
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Card className="p-5"><SectionTitle title="Retailer performance" subtitle="Net secured · click a bar" /><EChart option={retailOpt} height={Math.max(160, b.byRetailer.length * 34)} onClick={onRetailClick} />
              <table className="mt-3 w-full text-sm">
                <thead className="text-[10px] uppercase tracking-widest text-ink3"><tr><th className="py-1 text-left">Retailer</th><th className="text-right">Orders</th><th className="text-right">Success</th><th className="text-right">Units</th><th className="text-right">Net</th></tr></thead>
                <tbody>{b.byRetailer.map((r) => (
                  <tr key={r.key} className="cursor-pointer border-t border-line/50 hover:bg-white/[0.03]" onClick={() => drill({ retailers: [r.key as never] })}>
                    <td className="py-1.5 text-ink2">{r.label}</td><td className="text-right tabular">{r.orders}</td><td className="text-right tabular">{formatPct(r.successfulOrders / Math.max(1, r.orders), 0)}</td><td className="text-right tabular">{r.units}</td><td className="text-right tabular text-ink">{formatCents(r.netCents, cur)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </Card>
            <Card className="p-5"><SectionTitle title="Fulfillment status" subtitle="Orders by current state · click a bar" /><EChart option={statusOpt} height={Math.max(160, b.byStatus.length * 32)} onClick={onStatusClick} /></Card>
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Card className="p-5">
              <SectionTitle title="Member leaderboard" subtitle="Highest net spend" />
              <div className="space-y-1">
                {b.byMember.slice(0, 12).map((m, i) => (
                  <button key={m.key} onClick={() => drill({ memberIds: [Number(m.key)] })} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.04]">
                    <span className="w-6 text-right font-mono text-xs text-ink3">{i + 1}</span>
                    <Avatar name={m.label} src={m.imageUrl} size={26} />
                    <span className="flex-1 truncate text-sm text-ink">{m.label}</span>
                    <span className="w-24 text-right text-xs text-ink3">{m.successfulOrders} orders · {m.units} u</span>
                    <span className="w-28 text-right font-display text-sm font-semibold tabular">{formatCents(m.netCents, cur)}</span>
                  </button>
                ))}
              </div>
            </Card>
            <Card className="p-5">
              <SectionTitle title="Product popularity" subtitle="Units secured" />
              <div className="space-y-1">
                {b.byProduct.slice(0, 12).map((p, i) => (
                  <button key={p.key} onClick={() => drill({ productIds: [Number(p.key)] })} className="flex w-full items-center gap-3 rounded-lg px-2 py-1 text-left hover:bg-white/[0.04]">
                    <span className="w-6 text-right font-mono text-xs text-ink3">{i + 1}</span>
                    <ProductThumb src={p.imageUrl} title={p.label} size={34} />
                    <span className="flex-1 truncate text-sm text-ink">{p.label.replace(/^Pok[ée]mon TCG:\s*/i, '')}</span>
                    <span className="w-16 text-right font-mono text-sm text-ink">×{p.units}</span>
                    <span className="w-24 text-right text-xs tabular text-ink3">{formatCents(p.netCents, cur, { compact: true })}</span>
                  </button>
                ))}
              </div>
            </Card>
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Campaigns />
            <Card className="p-5">
              <SectionTitle title="Members without recent orders" subtitle="No successful order in 30 days" />
              <div className="flex flex-wrap gap-2">
                {b.inactiveMembers.slice(0, 40).map((m) => (
                  <button key={m.memberId} onClick={() => useStore.getState().openMember(m.memberId)} className="flex items-center gap-2 rounded-full border border-line bg-bg2/50 py-1 pl-1 pr-3 text-xs text-ink2 hover:border-accent/40">
                    <Avatar name={m.name} size={20} />{m.name}
                  </button>
                ))}
                {!b.inactiveMembers.length && <div className="text-sm text-ink3">Everyone has ordered recently.</div>}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function KpiGrid({ k, prev }: { k: KpiSummary; prev?: KpiSummary }) {
  const cur = k.currency;
  const tiles: [string, string, React.ReactNode][] = [
    ['Net secured', formatCents(k.netCents, cur), <Delta cur={k.netCents} prev={prev?.netCents} money={cur} />],
    ['Gross order value', formatCents(k.grossCents, cur), <Delta cur={k.grossCents} prev={prev?.grossCents} money={cur} />],
    ['Orders', formatNumber(k.orders), <Delta cur={k.orders} prev={prev?.orders} />],
    ['Success rate', formatPct(k.successRate), <Delta cur={k.successRate} prev={prev?.successRate} />],
    ['Units secured', formatNumber(k.netUnits), <Delta cur={k.netUnits} prev={prev?.netUnits} />],
    ['Avg order value', formatCents(k.avgOrderCents, cur), <Delta cur={k.avgOrderCents} prev={prev?.avgOrderCents} money={cur} />],
    ['Active buyers', formatNumber(k.activeBuyers), <Delta cur={k.activeBuyers} prev={prev?.activeBuyers} />],
    ['Avg spend / member', formatCents(k.avgSpendPerMemberCents, cur), <Delta cur={k.avgSpendPerMemberCents} prev={prev?.avgSpendPerMemberCents} money={cur} />],
    ['Delivered', formatNumber(k.deliveredOrders), <span className="text-xs text-ink3">{formatPct(k.fulfillmentRate)} fulfillment</span>],
    ['Canceled', formatNumber(k.canceledOrders), <Delta cur={k.canceledOrders} prev={prev?.canceledOrders} invert />],
    ['Taxes paid', formatCents(k.taxCents, cur), <span className="text-xs text-ink3">shipping {formatCents(k.shippingCents, cur)}</span>],
    ['Returns / refunds', `${k.returns} / ${k.refunds}`, <span className="text-xs text-ink3">{formatCents(k.refundedCents, cur)} refunded</span>],
  ];
  return (
    <>
      {k.mixedCurrency && <div className="mb-3 rounded-xl border border-warn/30 bg-warn/10 p-3 text-sm text-warn">Some orders are in currencies without an exchange rate and are excluded from money totals (counts still include them). Add rates in Settings → General.</div>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        {tiles.map(([label, value, sub]) => (
          <Card key={label} className="p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink3">{label}</div>
            <div className="mt-1.5 font-display text-xl font-bold tabular text-ink">{value}</div>
            <div className="mt-1">{sub}</div>
          </Card>
        ))}
      </div>
    </>
  );
}

function Campaigns() {
  const { data, refetch } = useQuery(() => call('analytics.campaigns'), []);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', startsAt: '', endsAt: '' });
  const act = useAction();
  return (
    <Card className="p-5">
      <SectionTitle title="Campaign conversion" subtitle="Share of signed-up members with a successful checkout" icon={<Megaphone className="size-4" />} right={<Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setOpen(true)}>Campaign</Button>} />
      <div className="space-y-3">
        {data?.map((c) => (
          <div key={c.id} className="rounded-xl border border-line bg-bg2/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-ink">{c.name}</span>
              <Button size="sm" variant="ghost" icon={<Upload className="size-3.5" />} onClick={async () => {
                const [p] = await call('dialog.openFiles', { filters: [{ name: 'CSV', extensions: ['csv'] }] });
                if (p) { const r = await act(() => call('analytics.importSignups', c.id, p)); if (r) useStore.getState().toast(`${r.added} signups added, ${r.unknown} unknown members`, 'success'); refetch(); }
              }}>Import signups</Button>
            </div>
            {c.stats && (
              <>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-display text-2xl font-bold">{formatPct(c.stats.conversionRate)}</span>
                  <span className="text-xs text-ink3">{c.stats.membersWithSuccess} of {c.stats.signups} signups checked out</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-gradient-to-r from-accent to-violet" style={{ width: `${c.stats.conversionRate * 100}%` }} /></div>
              </>
            )}
          </div>
        ))}
        {!data?.length && <div className="text-sm text-ink3">Create a campaign and import its signup CSV (Discord ID or username column) to measure conversion.</div>}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="New campaign" footer={<Button variant="primary" disabled={!f.name} onClick={async () => {
        await act(() => call('analytics.createCampaign', { name: f.name, startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : undefined, endsAt: f.endsAt ? new Date(new Date(f.endsAt).getTime() + 86400000).toISOString() : undefined }), 'Campaign created');
        setOpen(false);
        refetch();
      }}>Create</Button>}>
        <div className="space-y-3">
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Prismatic drop week" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts"><Input type="date" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></Field>
            <Field label="Ends"><Input type="date" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

export { BarChart3 };
