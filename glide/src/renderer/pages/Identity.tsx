import { AnimatePresence, motion } from 'motion/react';
import { Check, Fingerprint, Home, Mail, MapPin, ScanSearch, ShoppingBag, UserPlus, Users, X } from 'lucide-react';
import { useState } from 'react';
import { formatCents, formatDateTime, relativeTime } from '../../shared/format';
import type { MatchCandidateRow } from '../../shared/types';
import { call } from '../lib/api';
import { useAction, useQuery } from '../lib/hooks';
import { useStore } from '../lib/store';
import { MemberPicker } from '../components/pickers';
import { Avatar, Badge, Button, Card, ConfidenceMeter, Empty, MatchBadge, Modal, PageHeader, ProductThumb, Tabs } from '../components/ui';

type Tab = 'queue' | 'unmatched' | 'emails' | 'households' | 'corrections';

const KIND_ICON: Record<string, React.ReactNode> = {
  order_assignment: <ShoppingBag className="size-4" />,
  email_link: <Mail className="size-4" />,
  address_link: <MapPin className="size-4" />,
  member_merge: <Users className="size-4" />,
};

export function Identity() {
  const [tab, setTab] = useState<Tab>('queue');
  const [kind, setKind] = useState('');
  const { data: disc } = useQuery(() => call('identity.discovery'), []);
  const act = useAction();
  return (
    <div>
      <PageHeader eyebrow="Identity Intelligence" title="Identity Review" subtitle="Only unique, high-confidence matches are linked automatically. Everything ambiguous waits here with the evidence that produced it." right={
        <Button icon={<ScanSearch className="size-4" />} onClick={async () => { const n = await act(() => call('identity.scanDuplicates')); if (n !== undefined) useStore.getState().toast(`${n} possible duplicate member(s) found`, 'info'); }}>Scan for duplicates</Button>
      } />
      <div className="mb-5 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {[
          ['Pending reviews', disc?.pendingReviews, 'var(--g-warn)'],
          ['Orders without owner', disc?.unmatchedOrders, 'var(--g-bad)'],
          ['Unverified emails', disc?.newEmails, 'var(--g-accent)'],
          ['Unverified addresses', disc?.unverifiedAddresses, 'var(--g-violet)'],
          ['Shared households', disc?.sharedAddresses, 'var(--g-cyan)'],
          ['Discovered profiles', disc?.discoveredProfiles, 'var(--g-good)'],
        ].map(([l, v, c]) => (
          <Card key={l as string} className="relative overflow-hidden p-4">
            <div className="absolute inset-y-0 left-0 w-[3px]" style={{ background: c as string }} />
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink3">{l}</div>
            <div className="mt-1 font-display text-2xl font-bold">{(v as number | undefined) ?? '—'}</div>
          </Card>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'queue', label: 'Review queue', count: disc?.pendingReviews }, { id: 'unmatched', label: 'Unmatched orders' }, { id: 'emails', label: 'New emails' }, { id: 'households', label: 'Shared households' }, { id: 'corrections', label: 'Audit trail' }]} />
        {tab === 'queue' && (
          <Tabs value={kind} onChange={setKind} tabs={[{ id: '', label: 'All' }, { id: 'order_assignment', label: 'Orders' }, { id: 'email_link', label: 'Emails' }, { id: 'address_link', label: 'Addresses' }, { id: 'member_merge', label: 'Duplicates' }]} />
        )}
      </div>
      {tab === 'queue' && <Queue kind={kind} />}
      {tab === 'unmatched' && <Unmatched />}
      {tab === 'emails' && <NewEmails />}
      {tab === 'households' && <Households />}
      {tab === 'corrections' && <Corrections />}
    </div>
  );
}

function Queue({ kind }: { kind: string }) {
  const { data, refetch } = useQuery(() => call('identity.candidates', { status: 'pending', kind: kind || undefined, limit: 200 }), [kind]);
  const [choosing, setChoosing] = useState<MatchCandidateRow | null>(null);
  const act = useAction();
  const resolve = async (c: MatchCandidateRow, approve: boolean, memberId?: number) => {
    await act(() => call('identity.resolve', c.id, approve, memberId), approve ? 'Approved and remembered' : 'Rejected');
    refetch();
  };
  if (!data) return null;
  if (!data.length) return <Card><Empty icon={<Fingerprint className="size-6" />} title="Nothing to review" body="New ambiguous matches, unseen emails and new addresses will appear here." /></Card>;
  return (
    <div className="space-y-3">
      <AnimatePresence initial={false}>
        {data.map((c) => (
          <motion.div key={c.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40 }}>
            <Card className="p-4">
              <div className="flex flex-wrap items-start gap-4">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-panel2 text-accent">{KIND_ICON[c.kind] ?? <Fingerprint className="size-4" />}</div>
                <div className="min-w-[260px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{c.title}</span>
                    <Badge tone="warn">{c.kind.replace('_', ' ')}</Badge>
                    <span className="text-xs text-ink3">{relativeTime(c.createdAt)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-ink2">
                    {c.proposedMemberName && <span className="flex items-center gap-1.5"><Avatar name={c.proposedMemberName} size={20} />{c.summary}</span>}
                    <ConfidenceMeter value={c.confidence} />
                  </div>
                  {!!c.evidence.length && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {c.evidence.slice(0, 8).map((e, i) => <span key={i} className="rounded-lg border border-line bg-bg2/60 px-2 py-0.5 text-[11px] text-ink2">{e.detail} <span className="font-mono text-ink3">+{Math.round(e.weight * 100)}</span></span>)}
                    </div>
                  )}
                  {!!c.alternatives.length && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink3">
                      Alternatives:
                      {c.alternatives.map((a) => (
                        <button key={a.memberId} onClick={() => resolve(c, true, a.memberId)} className="rounded-full border border-line px-2 py-0.5 text-ink2 hover:border-accent/50 hover:text-ink">
                          {a.name} {Math.round(a.confidence * 100)}%
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {c.orderId && <Button size="sm" variant="ghost" onClick={() => useStore.getState().openOrder(c.orderId!)}>Open order</Button>}
                  {c.kind === 'order_assignment' && <Button size="sm" icon={<UserPlus className="size-3.5" />} onClick={() => setChoosing(c)}>Other member…</Button>}
                  <Button size="sm" variant="danger" icon={<X className="size-3.5" />} onClick={() => resolve(c, false)}>Reject</Button>
                  <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} disabled={!c.proposedMemberId} onClick={() => resolve(c, true)}>Approve</Button>
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
      </AnimatePresence>
      <Modal open={!!choosing} onClose={() => setChoosing(null)} title="Assign to a different member">
        <MemberPicker onPick={async (m) => { const c = choosing!; setChoosing(null); await resolve(c, true, m.id); }} />
      </Modal>
    </div>
  );
}

function Unmatched() {
  const { data, refetch } = useQuery(() => call('orders.list', { match: ['unmatched', 'review'], limit: 200, sort: 'placed_desc' }), []);
  const [assigning, setAssigning] = useState<number | null>(null);
  const act = useAction();
  if (!data) return null;
  if (!data.rows.length) return <Card><Empty title="Every order has an owner" /></Card>;
  return (
    <Card className="overflow-hidden">
      {data.rows.map((o) => (
        <div key={o.id} className="flex items-center gap-3 border-b border-line/50 px-4 py-2.5 last:border-0">
          <ProductThumb src={o.firstImage} title={o.firstTitle ?? ''} size={40} />
          <button className="min-w-0 flex-1 text-left" onClick={() => useStore.getState().openOrder(o.id)}>
            <div className="truncate text-sm text-ink">{o.retailerName} #{o.orderNumber} · {o.firstTitle}</div>
            <div className="text-xs text-ink3">{o.purchaseEmail ?? 'no email'} · {formatDateTime(o.placedAt)}</div>
          </button>
          <MatchBadge status={o.matchStatus} confidence={o.matchConfidence} />
          <span className="w-24 text-right font-display text-sm font-semibold">{formatCents(o.totalCents, o.currency)}</span>
          <Button size="sm" onClick={() => setAssigning(o.id)}>Assign</Button>
        </div>
      ))}
      <Modal open={assigning !== null} onClose={() => setAssigning(null)} title="Assign order">
        <MemberPicker onPick={async (m) => { const id = assigning!; setAssigning(null); await act(() => call('orders.assign', id, m.id), `Assigned to ${m.name}`); refetch(); }} />
      </Modal>
    </Card>
  );
}

function NewEmails() {
  const { data } = useQuery(() => call('identity.recentEmails'), []);
  if (!data?.length) return <Card><Empty icon={<Mail className="size-6" />} title="No unverified emails" /></Card>;
  return (
    <Card className="overflow-hidden">
      {data.map((e) => (
        <div key={e.id} className="flex items-center justify-between gap-3 border-b border-line/50 px-4 py-2.5 text-sm last:border-0">
          <span className="font-mono text-xs text-ink2">{e.address}</span>
          <span className="flex items-center gap-3">
            <span className="text-ink3">{e.member ? `proposed for ${e.member}` : 'no owner'}</span>
            <Badge tone={e.status === 'proposed' ? 'warn' : 'neutral'}>{e.status}</Badge>
            <span className="text-xs text-ink3">{relativeTime(e.firstSeen)}</span>
          </span>
        </div>
      ))}
    </Card>
  );
}

function Households() {
  const { data } = useQuery(() => call('identity.shared'), []);
  if (!data?.length) return <Card><Empty icon={<Home className="size-6" />} title="No shared addresses" body="Distinct members who ship to the same address stay separate; their orders are never attributed to both." /></Card>;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {data.map((h) => (
        <Card key={h.addressId} className="p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-ink"><Home className="size-4 text-cyan" />{h.line1}, {h.city} {h.postal}</div>
          <div className="mt-1 text-xs text-ink3">Members: {h.members}</div>
        </Card>
      ))}
    </div>
  );
}

function Corrections() {
  const { data } = useQuery(() => call('diagnostics.audit', 200, undefined), []);
  return (
    <Card className="overflow-hidden">
      {data?.filter((a) => /member|order_assigned|candidate|email|address|profile|merged|split/.test(a.action)).map((a) => (
        <div key={a.id} className="flex items-center justify-between gap-3 border-b border-line/50 px-4 py-2 text-sm last:border-0">
          <span className="text-ink2"><span className="font-mono text-xs text-accent">{a.action}</span> · {a.entity} {a.entityId}</span>
          <span className="text-xs text-ink3">{a.actor} · {formatDateTime(a.at)}</span>
        </div>
      ))}
      {!data?.length && <Empty title="No identity changes yet" />}
    </Card>
  );
}
