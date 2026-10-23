import { AnimatePresence, motion } from 'motion/react';
import { AlertOctagon, Gauge, Pause, Play, Radio, Wifi } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatCents, formatNumber, formatTime, relativeTime } from '../../shared/format';
import type { ActivityKind, ActivityRow } from '../../shared/types';
import { call } from '../lib/api';
import { useQuery } from '../lib/hooks';
import { useStore } from '../lib/store';
import { AnimatedNumber, Badge, Button, Card, PageHeader, Select, cx } from '../components/ui';

const KIND: Partial<Record<ActivityKind, { label: string; color: string }>> = {
  new_order: { label: 'New Order', color: '#34d399' },
  order_confirmed: { label: 'Order Update', color: '#5b8cff' },
  tracking_found: { label: 'Tracking Found', color: '#22d3ee' },
  shipped: { label: 'Shipped', color: '#8b5cf6' },
  out_for_delivery: { label: 'Out for Delivery', color: '#fbbf24' },
  delivered: { label: 'Delivered', color: '#10b981' },
  canceled: { label: 'Canceled', color: '#fb7185' },
  partial_cancel: { label: 'Partial Cancel', color: '#fb923c' },
  review_hold: { label: 'Review Hold', color: '#f59e0b' },
  refund: { label: 'Refund', color: '#e879f9' },
  parser_failure: { label: 'Parser Alert', color: '#ef4444' },
  import: { label: 'Import', color: '#94a3b8' },
  sync: { label: 'Sync', color: '#94a3b8' },
};

export function CommandCenter() {
  const openOrder = useStore((s) => s.openOrder);
  const version = useStore((s) => s.dataVersion);
  const [paused, setPaused] = useState(false);
  const [retailer, setRetailer] = useState('');
  const [kind, setKind] = useState('');
  const [feed, setFeed] = useState<ActivityRow[]>([]);
  const [buffer, setBuffer] = useState<ActivityRow[]>([]);
  const lastId = useRef(0);
  const { data: info } = useQuery(() => call('app.info'), [], { live: false });
  const { data: health } = useQuery(() => call('sync.health'), [], { intervalMs: 5000 });
  const today = useMemo(() => ({ from: new Date(new Date().setHours(0, 0, 0, 0)).toISOString() }), []);
  const { data: k } = useQuery(() => call('analytics.kpis', today), [today]);
  const [progress, setProgress] = useState<Record<number, { label: string; phase: string; processed: number; failures: number; message?: string }>>({});

  useEffect(() => {
    lastId.current = 0;
    call('activity.list', { limit: 60, retailers: retailer ? [retailer] : undefined, kinds: kind ? [kind] : undefined }).then((rows) => {
      setFeed(rows);
      setBuffer([]);
      lastId.current = rows[0]?.id ?? 0;
    });
  }, [retailer, kind]);

  useEffect(() => {
    const poll = () =>
      call('activity.list', { limit: 100, afterId: lastId.current, retailers: retailer ? [retailer] : undefined, kinds: kind ? [kind] : undefined }).then((rows) => {
        if (!rows.length) return;
        lastId.current = Math.max(lastId.current, ...rows.map((r) => r.id));
        if (paused) setBuffer((b) => [...rows, ...b].slice(0, 300));
        else setFeed((f) => [...rows, ...f].slice(0, 200));
      });
    poll();
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [paused, retailer, kind, version]);

  useEffect(
    () =>
      window.glide?.on((e: any) => {
        if (e.kind === 'progress') setProgress((p) => ({ ...p, [e.progress.accountId]: { label: e.progress.accountLabel, phase: e.progress.phase, processed: e.progress.processed, failures: e.progress.failures, message: e.progress.message } }));
      }),
    [],
  );

  const resume = () => {
    setFeed((f) => [...buffer, ...f].slice(0, 200));
    setBuffer([]);
    setPaused(false);
  };
  const n = (x: number) => formatNumber(x);

  return (
    <div>
      <PageHeader
        eyebrow="Mission Control"
        title="Order Timeline"
        subtitle="Every order event as it is discovered across your inboxes. Pausing freezes the view only — synchronization keeps running."
        right={
          <>
            <Select value={retailer} onChange={(e) => setRetailer(e.target.value)}>
              <option value="">All retailers</option>
              {info?.retailers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">All events</option>
              {Object.entries(KIND).map(([id, v]) => <option key={id} value={id}>{v!.label}</option>)}
            </Select>
            {paused ? (
              <Button variant="primary" icon={<Play className="size-4" />} onClick={resume}>
                Resume {buffer.length ? `(${buffer.length} new)` : ''}
              </Button>
            ) : (
              <Button icon={<Pause className="size-4" />} onClick={() => setPaused(true)}>Pause feed</Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          ['Orders today', k?.orders ?? 0, '#34d399'],
          ['Live today', k?.liveOrders ?? 0, '#5b8cff'],
          ['Canceled today', k?.canceledOrders ?? 0, '#fb7185'],
          ['Review holds', k?.reviewHolds ?? 0, '#f59e0b'],
          ['Msgs / hour', health?.messagesLastHour ?? 0, '#22d3ee'],
          ['Parser failures 24h', health?.parserFailures24h ?? 0, '#ef4444'],
        ].map(([label, value, color]) => (
          <Card key={label as string} className="relative overflow-hidden px-4 py-3">
            <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }} />
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ink3">{label}</div>
            <div className="mt-1 font-mono text-2xl font-bold text-ink"><AnimatedNumber value={value as number} format={n} /></div>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Card className="relative overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-ink2">
              <Radio className={cx('size-4', paused ? 'text-warn' : 'text-good')} />
              {paused ? 'Feed paused' : 'Live feed'}
            </div>
            <span className="font-mono text-[11px] text-ink3">{feed.length} events</span>
          </div>
          <div className="pointer-events-none absolute inset-x-0 top-12 h-24 bg-gradient-to-b from-accent/[0.05] to-transparent" />
          <div className="max-h-[calc(100vh-340px)] min-h-[420px] overflow-y-auto font-mono text-[13px]">
            <AnimatePresence initial={false}>
              {feed.map((a) => {
                const kk = KIND[a.kind] ?? { label: a.kind, color: '#94a3b8' };
                return (
                  <motion.button
                    layout="position"
                    key={a.id}
                    initial={{ opacity: 0, x: -24, backgroundColor: 'rgba(91,140,255,0.18)' }}
                    animate={{ opacity: 1, x: 0, backgroundColor: 'rgba(91,140,255,0)' }}
                    transition={{ duration: 0.5 }}
                    onClick={() => a.orderId && openOrder(a.orderId)}
                    className="grid w-full grid-cols-[96px_150px_148px_1fr_110px] items-center gap-3 border-b border-line/40 px-5 py-2.5 text-left hover:bg-white/[0.03]"
                  >
                    <span className="text-ink3">{formatTime(a.at)}</span>
                    <span className="truncate text-ink2">{a.retailerName ?? '—'}</span>
                    <span className="flex items-center gap-2 truncate" style={{ color: kk.color }}>
                      <span className="size-1.5 shrink-0 rounded-full" style={{ background: kk.color, boxShadow: `0 0 8px ${kk.color}` }} />
                      {kk.label}
                    </span>
                    <span className="truncate text-ink">
                      {a.amountCents ? formatCents(a.amountCents, a.currency ?? 'USD') : a.units ? `${a.units} units` : a.label}
                      {a.amountCents && a.units ? <span className="text-ink3"> · {a.units} units</span> : null}
                    </span>
                    <span className="truncate text-right text-ink2">{a.memberName ? `@${a.memberName}` : <span className="text-ink3">unmatched</span>}</span>
                  </motion.button>
                );
              })}
            </AnimatePresence>
            {!feed.length && <div className="p-10 text-center text-sm text-ink3">Waiting for activity…</div>}
          </div>
        </Card>
        <div className="space-y-4">
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2 font-display font-semibold"><Gauge className="size-4 text-accent" /> Ingestion</div>
            <div className="space-y-2 text-sm">
              <Row k="Throughput" v={`${health?.throughputPerMin ?? 0} msg/min`} />
              <Row k="Last sync" v={relativeTime(health?.lastSyncAt)} />
              <Row k="Inboxes healthy" v={`${health?.healthyAccounts ?? 0} / ${health?.accounts ?? 0}`} />
              <Row k="Sync engine" v={health?.paused ? <Badge tone="warn">Paused</Badge> : <Badge tone="good">Running</Badge>} />
            </div>
            <div className="mt-3 flex gap-2">
              {health?.paused ? <Button size="sm" onClick={() => call('sync.resume')}>Resume sync</Button> : <Button size="sm" onClick={() => call('sync.pause')}>Pause sync</Button>}
              <Button size="sm" variant="ghost" onClick={() => call('accounts.syncNow')}>Sync now</Button>
            </div>
          </Card>
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2 font-display font-semibold"><Wifi className="size-4 text-accent" /> Connections</div>
            {!Object.keys(progress).length && <div className="text-sm text-ink3">No sync activity this session yet.</div>}
            <div className="space-y-2.5">
              {Object.entries(progress).map(([id, p]) => (
                <div key={id} className="rounded-xl border border-line bg-bg2/40 p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-ink">{p.label}</span>
                    <Badge tone={p.phase === 'error' ? 'bad' : p.phase === 'done' ? 'good' : 'accent'}>{p.phase}</Badge>
                  </div>
                  <div className="mt-1 text-ink3">{p.processed} processed · {p.failures} failures {p.message ? `· ${p.message}` : ''}</div>
                </div>
              ))}
            </div>
          </Card>
          {!!health?.parserFailures24h && (
            <Card className="border-bad/40 p-5">
              <div className="flex items-center gap-2 font-display font-semibold text-bad"><AlertOctagon className="size-4" /> Parser failures</div>
              <p className="mt-1 text-sm text-ink2">{health.parserFailures24h} retail emails could not be parsed in the last 24h.</p>
              <Button size="sm" className="mt-3" onClick={() => useStore.getState().navigate('logs')}>Open diagnostics</Button>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink3">{k}</span>
      <span className="font-mono text-ink">{v}</span>
    </div>
  );
}
