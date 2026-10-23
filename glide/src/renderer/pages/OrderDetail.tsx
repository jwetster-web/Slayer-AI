import { motion } from 'motion/react';
import { Check, ExternalLink, FileText, Mail, MapPin, PackagePlus, Pencil, ShieldCheck, Truck, UserRound, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatCents, formatDateTime, relativeTime } from '../../shared/format';
import type { OrderDetail as Detail } from '../../shared/types';
import { call } from '../lib/api';
import { useAction, useQuery } from '../lib/hooks';
import { useStore } from '../lib/store';
import { MemberPicker } from '../components/pickers';
import { Avatar, Badge, Button, Card, ConfidenceMeter, Drawer, Input, KV, MatchBadge, Modal, PackagePill, ProductThumb, Select, Skeleton, StatusPill, Textarea, cx } from '../components/ui';

const STEPS = [
  { key: 'ordered', label: 'Ordered' },
  { key: 'processing', label: 'Processing' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'out_for_delivery', label: 'Out for delivery' },
  { key: 'delivered', label: 'Delivered' },
];

function stepIndex(o: Detail): number {
  switch (o.fulfillmentStatus) {
    case 'delivered': return 4;
    case 'out_for_delivery': case 'partially_delivered': return 3;
    case 'shipped': case 'partially_shipped': case 'delayed': case 'exception': return 2;
    case 'backordered': case 'processing': return 1;
    default: return o.events.length > 1 ? 1 : 0;
  }
}

function Lifecycle({ o }: { o: Detail }) {
  const idx = stepIndex(o);
  const canceled = o.cancelState === 'full';
  return (
    <div className="relative flex items-center justify-between px-2 py-3">
      <div className="absolute left-6 right-6 top-[26px] h-[3px] rounded-full bg-white/8" />
      <motion.div className={cx('absolute left-6 top-[26px] h-[3px] rounded-full', canceled ? 'bg-bad' : 'bg-gradient-to-r from-accent via-violet to-good')} initial={{ width: 0 }} animate={{ width: `calc(${(canceled ? 0 : idx / 4) * 100}% - ${idx === 4 ? 48 : 24}px)` }} transition={{ duration: 0.8, ease: 'easeOut' }} />
      {STEPS.map((s, i) => {
        const done = !canceled && i <= idx;
        return (
          <div key={s.key} className="relative z-10 flex w-24 flex-col items-center gap-2">
            <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: i * 0.08 }} className={cx('grid size-7 place-items-center rounded-full border-2', done ? 'border-transparent bg-gradient-to-br from-accent to-violet text-white shadow-[0_0_16px_-2px_var(--g-accent)]' : 'border-line bg-bg2 text-ink3')}>
              {done ? <Check className="size-3.5" /> : <span className="size-1.5 rounded-full bg-current" />}
            </motion.div>
            <span className={cx('text-center text-[11px] font-semibold uppercase tracking-wider', done ? 'text-ink' : 'text-ink3')}>{s.label}</span>
          </div>
        );
      })}
      {canceled && <div className="absolute inset-x-0 top-1 text-center"><Badge tone="bad">Canceled</Badge></div>}
    </div>
  );
}

function SourceViewer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data: meta } = useQuery(() => (id ? call('orders.source', id) : Promise.resolve(null)), [id], { live: false });
  const { data: body } = useQuery(() => (id ? call('orders.sourceBody', id) : Promise.resolve(null)), [id], { live: false });
  return (
    <Modal open={!!id} onClose={onClose} title="Source message" width={860}>
      {meta && (
        <div className="mb-3 space-y-1 text-sm">
          <div className="font-medium text-ink">{meta.subject}</div>
          <div className="text-ink3">
            {meta.from_addr} · {formatDateTime(meta.sent_at)} {meta.forwarded ? `· forwarded by ${meta.forwarded_by ?? 'another inbox'}` : ''}
          </div>
          {meta.parse_error && <div className="text-xs text-warn">Parser notes: {meta.parse_error}</div>}
        </div>
      )}
      {body?.html ? (
        // No scripts, no navigation; remote images are blocked by the app's CSP (no tracking pixels).
        <iframe title="Original email" sandbox="" srcDoc={body.html} className="h-[60vh] w-full rounded-xl border border-line bg-white" />
      ) : body?.text ? (
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-bg2 p-4 text-xs text-ink2">{body.text}</pre>
      ) : (
        <div className="text-sm text-ink3">{meta && !meta.rawAvailable ? 'The original was not stored (raw email storage is off for this message).' : 'Loading…'}</div>
      )}
    </Modal>
  );
}

export function OrderDrawer() {
  const id = useStore((s) => s.orderId);
  const close = () => useStore.getState().openOrder(null);
  const { data: o, refetch } = useQuery(() => (id ? call('orders.get', id) : Promise.resolve(null)), [id]);
  const [assigning, setAssigning] = useState(false);
  const [source, setSource] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [trk, setTrk] = useState('');
  const act = useAction();
  useEffect(() => setNotes(o?.notes ?? ''), [o?.id, o?.notes]);
  const cur = o?.currency ?? 'USD';

  return (
    <Drawer open={!!id} onClose={close} width={960}>
      {!o ? (
        <div className="space-y-4 p-8">
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-40" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <>
          <div className="relative overflow-hidden border-b border-line px-7 pb-5 pt-6">
            <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-accent/20 blur-3xl" />
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-accent">{o.retailerName}</div>
                <h2 className="mt-1 font-display text-2xl font-bold text-ink">Order #{o.orderNumber}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusPill status={o.fulfillmentStatus} cancel={o.cancelState} review={o.reviewStatus} />
                  {o.financialStatus !== 'charged' && <Badge tone="violet">{o.financialStatus.replace('_', ' ')}</Badge>}
                  <span className="text-xs text-ink3">Placed {formatDateTime(o.placedAt)} · last activity {relativeTime(o.lastActivityAt)}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="font-display text-3xl font-bold text-ink">{formatCents(o.totalCents, cur)}</div>
                {o.netCents !== o.totalCents && <div className="text-sm text-ink3">Net {formatCents(o.netCents, cur)}</div>}
                <button onClick={close} className="focus-ring mt-2 rounded-lg p-1 text-ink3 hover:text-ink" aria-label="Close">
                  <X className="size-5" />
                </button>
              </div>
            </div>
            <Lifecycle o={o} />
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-7 py-6">
            <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
              <Card className="p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-display font-semibold">Products · {o.units} units</h3>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {o.items.map((it, i) => (
                    <motion.div key={it.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className={cx('rounded-xl border border-line bg-bg2/50 p-3', it.status === 'canceled' && 'opacity-50')}>
                      <ProductThumb src={it.imageUrl} title={it.title} size={120} className="mx-auto mb-2 !w-full" />
                      <div className="line-clamp-2 text-xs font-medium text-ink">{it.title}</div>
                      <div className="mt-1 flex items-center justify-between text-xs text-ink3">
                        <span>
                          ×{it.quantity}
                          {it.canceledQty > 0 && <span className="text-bad"> ({it.canceledQty} canceled)</span>}
                        </span>
                        <span className="tabular">{formatCents(it.lineTotalCents, cur)}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-ink3">
                        <span className="font-mono">{it.sku ?? it.upc ?? ''}</span>
                        <Badge tone={it.status === 'canceled' ? 'bad' : it.status === 'delivered' ? 'good' : it.status.includes('ship') ? 'violet' : 'neutral'}>{it.status.replace('_', ' ')}</Badge>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </Card>
              <div className="space-y-5">
                <Card className="p-5">
                  <h3 className="mb-2 font-display font-semibold">Totals</h3>
                  <KV k="Subtotal" v={formatCents(o.subtotalCents, cur)} />
                  {o.discountCents > 0 && <KV k="Discount" v={`−${formatCents(o.discountCents, cur)}`} />}
                  <KV k="Shipping" v={o.shippingCents ? formatCents(o.shippingCents, cur) : 'Free'} />
                  <KV k="Tax" v={formatCents(o.taxCents, cur)} />
                  <KV k="Order total" v={<b>{formatCents(o.totalCents, cur)}</b>} />
                  {o.canceledCents > 0 && <KV k="Canceled value" v={<span className="text-bad">−{formatCents(o.canceledCents, cur)}</span>} />}
                  {o.refundedCents > 0 && <KV k="Refunded" v={<span className="text-violet">{formatCents(o.refundedCents, cur)}</span>} />}
                  <KV k="Net" v={<b>{formatCents(o.netCents, cur)}</b>} />
                </Card>
                <Card className="p-5">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="font-display font-semibold">Identity</h3>
                    <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setAssigning(true)}>
                      Reassign
                    </Button>
                  </div>
                  <div className="mb-3 flex items-center gap-3">
                    {o.memberName ? <Avatar name={o.memberName} src={o.memberAvatar} size={40} /> : <div className="grid size-10 place-items-center rounded-full border border-dashed border-line text-ink3"><UserRound className="size-5" /></div>}
                    <div className="min-w-0 flex-1">
                      <button className="truncate font-medium text-ink hover:text-accent" disabled={!o.memberId} onClick={() => o.memberId && useStore.getState().openMember(o.memberId)}>
                        {o.memberName ?? 'Unassigned'}
                      </button>
                      <div className="text-xs text-ink3">{o.profileName ?? 'No profile'}</div>
                    </div>
                    <MatchBadge status={o.matchStatus} confidence={o.matchConfidence} />
                  </div>
                  {o.matchConfidence !== null && <ConfidenceMeter value={o.matchConfidence} />}
                  <div className="mt-3 space-y-1.5 text-xs text-ink2">
                    {o.purchaseEmail && <div className="flex items-center gap-2"><Mail className="size-3.5 text-ink3" />{o.purchaseEmail}</div>}
                    {o.shippingAddress && (
                      <div className="flex items-start gap-2">
                        <MapPin className="mt-0.5 size-3.5 text-ink3" />
                        <span>
                          {o.recipientName && <>{o.recipientName}<br /></>}
                          {o.shippingAddress.line1}, {o.shippingAddress.city} {o.shippingAddress.state} {o.shippingAddress.postal}
                          {o.shippingAddress.ownerCount > 1 && <Badge tone="warn" className="ml-1">shared ×{o.shippingAddress.ownerCount}</Badge>}
                        </span>
                      </div>
                    )}
                    {o.emailAccountLabel && <div className="flex items-center gap-2"><ShieldCheck className="size-3.5 text-ink3" />Inbox: {o.emailAccountLabel}</div>}
                  </div>
                  {!!o.matchEvidence.length && (
                    <div className="mt-3 space-y-1 border-t border-line pt-3">
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-ink3">Why this match</div>
                      {o.matchEvidence.map((e, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-ink2">{e.detail}</span>
                          <span className="font-mono text-ink3">+{Math.round(e.weight * 100)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            </div>

            <Card className="p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display font-semibold">Packages · {o.packages.length}</h3>
                <form
                  className="flex items-center gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!trk.trim()) return;
                    await act(() => call('orders.addTracking', o.id, trk.trim()), 'Tracking added');
                    setTrk('');
                    refetch();
                  }}
                >
                  <Input value={trk} onChange={(e) => setTrk(e.target.value)} placeholder="Add tracking number" className="h-8 w-56 text-xs" />
                  <Button size="sm" icon={<PackagePlus className="size-3.5" />}>Add</Button>
                </form>
              </div>
              {!o.packages.length && <div className="text-sm text-ink3">No tracking yet. Packages appear when a shipping email arrives or when you add a tracking number.</div>}
              <div className="grid gap-3 md:grid-cols-2">
                {o.packages.map((p) => (
                  <div key={p.id} className="rounded-xl border border-line bg-bg2/50 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Truck className="size-4 text-accent" />
                        <span className="text-sm font-semibold">{p.carrierName}</span>
                        <PackagePill status={p.status} />
                      </div>
                      {p.trackingUrl && (
                        <button className="flex items-center gap-1 text-xs text-accent hover:underline" onClick={() => call('app.openExternal', p.trackingUrl!)}>
                          Carrier page <ExternalLink className="size-3" />
                        </button>
                      )}
                    </div>
                    <div className="mt-1 font-mono text-xs text-ink2">{p.trackingNumber}</div>
                    <div className="mt-1 text-[11px] text-ink3">
                      {p.estimatedDelivery && <>Est. {new Date(p.estimatedDelivery).toLocaleDateString()} · </>}Last verified {relativeTime(p.lastVerifiedAt)}
                    </div>
                    <div className="mt-3 space-y-2 border-l border-line pl-3">
                      {p.events.map((e) => (
                        <div key={e.id} className="text-xs">
                          <div className="text-ink">{e.description}</div>
                          <div className="text-ink3">
                            {formatDateTime(e.occurredAt)} {e.location ? `· ${e.location}` : ''} · {e.source === 'carrier_api' ? 'carrier API' : e.source}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
              <Card className="p-5">
                <h3 className="mb-4 font-display font-semibold">Activity timeline</h3>
                <ol className="relative space-y-4 border-l-2 border-line/70 pl-6">
                  {o.events.map((e, i) => (
                    <motion.li key={e.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="relative">
                      <span className={cx('absolute -left-[33px] top-0.5 grid size-4 place-items-center rounded-full ring-4 ring-bg', /cancel/.test(e.kind) ? 'bg-bad' : /deliver/.test(e.kind) ? 'bg-good' : /hold/.test(e.kind) ? 'bg-warn' : 'bg-accent')} />
                      <div className="text-sm font-medium text-ink">{e.label}</div>
                      <div className="text-xs text-ink3">
                        {formatDateTime(e.occurredAt)} · {e.source}
                      </div>
                    </motion.li>
                  ))}
                </ol>
              </Card>
              <div className="space-y-5">
                <Card className="p-5">
                  <h3 className="mb-3 font-display font-semibold">Source messages · {o.sources.length}</h3>
                  <div className="space-y-2">
                    {o.sources.map((s) => (
                      <button key={s.id} onClick={() => setSource(s.id)} className="flex w-full items-start gap-3 rounded-xl border border-line bg-bg2/40 p-3 text-left hover:border-accent/40">
                        <FileText className="mt-0.5 size-4 shrink-0 text-ink3" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium text-ink">{s.subject}</div>
                          <div className="text-[11px] text-ink3">
                            {s.messageType.replace('_', ' ')} · {formatDateTime(s.sentAt)} · {s.accountLabel ?? 'import'}
                            {s.forwarded && ' · forwarded'}
                            {s.parseStatus === 'duplicate' && ' · duplicate copy'}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </Card>
                <Card className="p-5">
                  <h3 className="mb-2 font-display font-semibold">Notes & corrections</h3>
                  <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes (never shared)…" />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="primary" onClick={() => act(() => call('orders.setNotes', o.id, notes), 'Notes saved')}>Save notes</Button>
                    <Select className="h-8 text-xs" value="" onChange={async (e) => {
                      const v = e.target.value as 'mark_delivered' | 'mark_canceled' | 'clear_hold' | 'set_hold' | 'uncancel' | '';
                      if (!v) return;
                      await act(() => call('orders.correct', o.id, v), 'Correction recorded');
                      refetch();
                    }}>
                      <option value="">Manual correction…</option>
                      <option value="mark_delivered">Mark delivered</option>
                      <option value="mark_canceled">Mark canceled</option>
                      <option value="uncancel">Undo cancellation</option>
                      <option value="set_hold">Set review hold</option>
                      <option value="clear_hold">Clear review hold</option>
                    </Select>
                  </div>
                </Card>
              </div>
            </div>
          </div>
          <Modal open={assigning} onClose={() => setAssigning(false)} title="Assign order to member">
            <p className="mb-3 text-sm text-ink3">This verifies the assignment, locks it against automatic re-matching, and remembers the email and address for future orders.</p>
            <MemberPicker autoFocus excludeId={o.memberId} onPick={async (m) => {
              setAssigning(false);
              await act(() => call('orders.assign', o.id, m.id), `Assigned to ${m.name}`);
              refetch();
            }} />
            {o.memberId && (
              <Button className="mt-3" variant="danger" size="sm" onClick={async () => {
                setAssigning(false);
                await act(() => call('orders.assign', o.id, null), 'Order unassigned');
                refetch();
              }}>
                Unassign
              </Button>
            )}
          </Modal>
          <SourceViewer id={source} onClose={() => setSource(null)} />
        </>
      )}
    </Drawer>
  );
}
