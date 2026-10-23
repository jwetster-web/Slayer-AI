import { motion } from 'motion/react';
import { FileDown, GitMerge, Plus, Scissors, Search, Trash2, Users, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatCents, formatDate, formatNumber, relativeTime } from '../../shared/format';
import { call } from '../lib/api';
import { useAction, useDebounced, useQuery } from '../lib/hooks';
import { useStore } from '../lib/store';
import { MemberPicker } from '../components/pickers';
import { Avatar, Badge, Button, Card, Drawer, Empty, Field, Input, KV, Modal, PageHeader, Pager, Select, Skeleton, Textarea, cx } from '../components/ui';

export function Members() {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'spend' | 'orders' | 'recent' | 'name'>('spend');
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const dq = useDebounced(q);
  const cur = useStore((s) => s.settings?.displayCurrency ?? 'USD');
  const openMember = useStore((s) => s.openMember);
  const { data } = useQuery(() => call('members.list', { search: dq, sort, limit: 60, offset }), [dq, sort, offset]);
  useEffect(() => setOffset(0), [dq, sort]);
  return (
    <div>
      <PageHeader
        eyebrow="People"
        title="Members"
        subtitle="Discord members with every linked buying profile, email and address. Stable Discord IDs survive username changes."
        right={
          <>
            <Button icon={<FileDown className="size-4" />} onClick={() => call('members.exportCsv', {})}>Spending report</Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Add member</Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[280px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink3" />
          <Input className="pl-9" placeholder="Username, display name, Discord ID, past usernames, profile or email…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="spend">Top spenders</option>
          <option value="orders">Most orders</option>
          <option value="recent">Recently active</option>
          <option value="name">Name</option>
        </Select>
        {data && <Pager offset={offset} limit={60} total={data.total} onChange={setOffset} />}
      </div>
      {!data ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 9 }, (_, i) => <Skeleton key={i} className="h-36" />)}</div>
      ) : !data.rows.length ? (
        <Card><Empty icon={<Users className="size-6" />} title="No members yet" body="Import a profile CSV, sync your Discord server, or add members manually." /></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.rows.map((m, i) => (
            <motion.div key={m.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 20) * 0.02 }}>
              <Card className="group p-4" onClick={() => openMember(m.id)}>
                <div className="flex items-center gap-3">
                  <Avatar name={m.displayName ?? m.username} src={m.avatarUrl} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-display text-[15px] font-semibold text-ink group-hover:text-accent">{m.displayName ?? m.username}</div>
                    <div className="truncate font-mono text-[11px] text-ink3">@{m.username}{m.discordId ? ` · ${m.discordId}` : ' · no Discord ID'}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-lg font-bold tabular text-ink">{formatCents(m.netCents, cur, { compact: m.netCents > 1e7 })}</div>
                    <div className="text-[11px] text-ink3">net spend</div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                  {[
                    ['Orders', m.successfulOrders],
                    ['Units', m.units],
                    ['Profiles', m.profileCount],
                    ['Addresses', m.addressCount],
                  ].map(([l, v]) => (
                    <div key={l as string} className="rounded-lg bg-bg2/50 py-1.5">
                      <div className="font-mono text-sm font-bold text-ink">{formatNumber(v as number)}</div>
                      <div className="text-[10px] uppercase tracking-wider text-ink3">{l}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-ink3">
                  <span>Last order {relativeTime(m.lastActivityAt)}</span>
                  <span className="flex gap-1">{m.tags.slice(0, 3).map((t) => <Badge key={t}>{t}</Badge>)}</span>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
      <CreateMember open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function CreateMember({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ discordId: '', username: '', displayName: '' });
  const act = useAction();
  return (
    <Modal open={open} onClose={onClose} title="Add member" footer={
      <Button variant="primary" disabled={!f.username} onClick={async () => {
        const r = await act(() => call('members.create', f), 'Member added');
        if (r) {
          onClose();
          setF({ discordId: '', username: '', displayName: '' });
          useStore.getState().openMember(r.id);
        }
      }}>Add member</Button>
    }>
      <div className="space-y-3">
        <Field label="Discord user ID" hint="Developer Mode → right-click user → Copy ID. Stored as the stable identifier."><Input value={f.discordId} onChange={(e) => setF({ ...f, discordId: e.target.value.trim() })} placeholder="123456789012345678" /></Field>
        <Field label="Username"><Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
        <Field label="Display name"><Input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export function MemberDrawer() {
  const id = useStore((s) => s.memberId);
  const close = () => useStore.getState().openMember(null);
  const cur = useStore((s) => s.settings?.displayCurrency ?? 'USD');
  const { data: m, refetch } = useQuery(() => (id ? call('members.get', id) : Promise.resolve(null)), [id]);
  const { data: orders } = useQuery(() => (id ? call('orders.list', { memberIds: [id], limit: 12 }) : Promise.resolve(null)), [id]);
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [merging, setMerging] = useState(false);
  const [splitSel, setSplitSel] = useState<number[]>([]);
  const [splitting, setSplitting] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const act = useAction();
  useEffect(() => {
    setNotes(m?.notes ?? '');
    setTags(m?.tags.join(', ') ?? '');
    setSplitSel([]);
  }, [m?.id, m?.notes, m?.tags]);

  return (
    <Drawer open={!!id} onClose={close} width={900}>
      {!m ? (
        <div className="space-y-4 p-8"><Skeleton className="h-16" /><Skeleton className="h-64" /></div>
      ) : (
        <>
          <div className="relative overflow-hidden border-b border-line px-7 py-6">
            <div className="pointer-events-none absolute -left-16 -top-20 size-64 rounded-full bg-violet/25 blur-3xl" />
            <div className="relative flex items-center gap-4">
              <Avatar name={m.displayName ?? m.username} src={m.avatarUrl} size={64} />
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-display text-2xl font-bold">{m.displayName ?? m.username}</h2>
                <div className="font-mono text-xs text-ink3">@{m.username} · {m.discordId ?? 'no Discord ID'}</div>
                {!!m.nameHistory.length && <div className="mt-1 text-xs text-ink3">Previously: {m.nameHistory.map((h) => h.username).join(', ')}</div>}
              </div>
              <div className="text-right">
                <div className="font-display text-3xl font-bold">{formatCents(m.netCents, cur)}</div>
                <div className="text-xs text-ink3">{m.successfulOrders} successful orders · {m.units} units</div>
              </div>
              <button onClick={close} className="focus-ring rounded-lg p-1 text-ink3 hover:text-ink" aria-label="Close"><X className="size-5" /></button>
            </div>
            <div className="relative mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => (close(), useStore.getState().navigate('orders', { orderFilter: { memberIds: [m.id] } }))}>All orders</Button>
              <Button size="sm" icon={<FileDown className="size-3.5" />} onClick={() => act(() => call('members.invoice', m.id, undefined, undefined, 'pdf'), 'Statement saved')}>Statement PDF</Button>
              <Button size="sm" icon={<FileDown className="size-3.5" />} onClick={() => act(() => call('members.invoice', m.id, undefined, undefined, 'csv'), 'Statement saved')}>Statement CSV</Button>
              <Button size="sm" icon={<GitMerge className="size-3.5" />} onClick={() => setMerging(true)}>Merge duplicate into this</Button>
              <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => setForgetting(true)}>Forget member</Button>
            </div>
          </div>
          <div className="flex-1 space-y-5 overflow-y-auto px-7 py-6">
            <div className="grid gap-5 lg:grid-cols-2">
              <Card className="p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-display font-semibold">Buying profiles · {m.profiles.length}</h3>
                  {splitSel.length > 0 && <Button size="sm" icon={<Scissors className="size-3.5" />} onClick={() => setSplitting(true)}>Split {splitSel.length}</Button>}
                </div>
                <div className="space-y-2">
                  {m.profiles.map((p) => (
                    <label key={p.id} className={cx('flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-bg2/40 p-3', splitSel.includes(p.id) && 'border-accent/60')}>
                      <input type="checkbox" className="mt-1 accent-[var(--g-accent)]" checked={splitSel.includes(p.id)} onChange={(e) => setSplitSel((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-ink">{p.name}</div>
                        <div className="text-xs text-ink3">{[p.firstName, p.lastName].filter(Boolean).join(' ')} · {p.orderCount} orders · {p.addressCount} addresses</div>
                        {!!p.emails.length && <div className="mt-1 truncate font-mono text-[11px] text-ink3">{p.emails.join(', ')}</div>}
                      </div>
                    </label>
                  ))}
                  {!m.profiles.length && <div className="text-sm text-ink3">No profiles linked.</div>}
                </div>
              </Card>
              <div className="space-y-5">
                <Card className="p-5">
                  <h3 className="mb-2 font-display font-semibold">Emails · {m.emails.length}</h3>
                  <div className="space-y-1.5">
                    {m.emails.map((e) => (
                      <div key={e.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate font-mono text-xs text-ink2">{e.address}</span>
                        <Badge tone={e.status === 'verified' ? 'good' : 'warn'}>{e.status}</Badge>
                      </div>
                    ))}
                  </div>
                </Card>
                <Card className="p-5">
                  <h3 className="mb-2 font-display font-semibold">Addresses · {m.addresses.length}</h3>
                  <div className="space-y-2">
                    {m.addresses.map((a) => (
                      <div key={a.id} className="text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-ink2">{a.line1}, {a.city} {a.state} {a.postal}</span>
                          <Badge tone={a.ownerStatus === 'verified' ? 'good' : 'warn'}>{a.ownerStatus}</Badge>
                        </div>
                        {!!a.sharedWith.length && <div className="text-xs text-warn">Shared household with {a.sharedWith.join(', ')}</div>}
                        {a.variantCount > 1 && <div className="text-xs text-ink3">{a.variantCount} formatting variations seen</div>}
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <Card className="p-5">
                <h3 className="mb-2 font-display font-semibold">By retailer</h3>
                {m.retailers.map((r) => <KV key={r.retailerId} k={`${r.name} · ${r.orders} orders`} v={formatCents(r.netCents ?? 0, cur)} />)}
                {!m.retailers.length && <div className="text-sm text-ink3">No orders yet.</div>}
              </Card>
              <Card className="p-5">
                <h3 className="mb-2 font-display font-semibold">Notes & tags</h3>
                <Field label="Tags (comma separated)"><Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vip, staff" /></Field>
                <div className="mt-3"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Private admin notes…" /></div>
                <Button size="sm" variant="primary" className="mt-2" onClick={() => act(() => call('members.update', m.id, { notes, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) }), 'Saved')}>Save</Button>
              </Card>
            </div>
            <Card className="p-5">
              <h3 className="mb-2 font-display font-semibold">Recent orders</h3>
              {orders?.rows.map((o) => (
                <button key={o.id} onClick={() => useStore.getState().openOrder(o.id)} className="flex w-full items-center justify-between gap-3 border-b border-line/50 py-2 text-left text-sm last:border-0 hover:text-accent">
                  <span className="truncate">{o.retailerName} #{o.orderNumber} · {o.firstTitle}</span>
                  <span className="shrink-0 text-ink3">{formatDate(o.placedAt)} · {formatCents(o.totalCents, o.currency)}</span>
                </button>
              ))}
            </Card>
          </div>
          <Modal open={merging} onClose={() => setMerging(false)} title={`Merge a duplicate into ${m.displayName ?? m.username}`}>
            <p className="mb-3 text-sm text-ink3">The selected member’s profiles, emails, addresses and orders move to this member. The duplicate is kept as a tombstone and the change is audited.</p>
            <MemberPicker excludeId={m.id} onPick={async (other) => {
              setMerging(false);
              await act(() => call('members.merge', m.id, other.id), `Merged ${other.name}`);
              refetch();
            }} />
          </Modal>
          <Modal open={splitting} onClose={() => setSplitting(false)} title="Move selected profiles">
            <p className="mb-3 text-sm text-ink3">Move {splitSel.length} profile(s) and their orders to another member.</p>
            <MemberPicker excludeId={m.id} onPick={async (other) => {
              setSplitting(false);
              await act(() => call('members.split', splitSel, { memberId: other.id }), `Moved to ${other.name}`);
              refetch();
            }} />
          </Modal>
          <Modal open={forgetting} onClose={() => setForgetting(false)} title="Forget member" footer={
            <Button variant="danger" onClick={async () => {
              setForgetting(false);
              await act(() => call('members.forget', m.id), 'Member forgotten');
              close();
            }}>Delete identity records</Button>
          }>
            <p className="text-sm text-ink2">Deletes this member, their profiles, linked emails and address ownership. Orders stay in totals but become unassigned and won’t be re-matched automatically. This cannot be undone.</p>
          </Modal>
        </>
      )}
    </Drawer>
  );
}
