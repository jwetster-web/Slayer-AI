import { Plus, Search, Upload, UserSquare2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ProfileRow } from '../../shared/types';
import { call } from '../lib/api';
import { useAction, useDebounced, useQuery } from '../lib/hooks';
import { useStore } from '../lib/store';
import { CsvImport } from '../components/CsvImport';
import { MemberPicker } from '../components/pickers';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Pager, Tabs } from '../components/ui';

export function Profiles() {
  const [q, setQ] = useState('');
  const [view, setView] = useState<'all' | 'unassigned' | 'import'>('all');
  const [offset, setOffset] = useState(0);
  const [assign, setAssign] = useState<ProfileRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', firstName: '', lastName: '' });
  const dq = useDebounced(q);
  const act = useAction();
  const { data } = useQuery(() => (view === 'import' ? Promise.resolve(null) : call('profiles.list', { search: dq, unassigned: view === 'unassigned', limit: 100, offset })), [dq, view, offset]);
  useEffect(() => setOffset(0), [dq, view]);
  return (
    <div>
      <PageHeader eyebrow="People" title="Buying Profiles" subtitle="Checkout profiles linked to members. Discovered profiles come from orders matched with high confidence." right={
        <>
          <Button icon={<Upload className="size-4" />} onClick={() => setView('import')}>Import CSV</Button>
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New profile</Button>
        </>
      } />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={view} onChange={setView} tabs={[{ id: 'all', label: 'All profiles' }, { id: 'unassigned', label: 'Unassigned' }, { id: 'import', label: 'CSV import' }]} />
        {view !== 'import' && (
          <div className="relative min-w-[280px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink3" />
            <Input className="pl-9" placeholder="Profile name, person or email…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        )}
        {data && <Pager offset={offset} limit={100} total={data.total} onChange={setOffset} />}
      </div>
      {view === 'import' ? (
        <CsvImport onDone={() => setView('all')} />
      ) : !data?.rows.length ? (
        <Card><Empty icon={<UserSquare2 className="size-6" />} title="No profiles" body="Import your profile CSV to link buying profiles to Discord members." /></Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-[10px] uppercase tracking-[0.18em] text-ink3">
              <tr><th className="px-4 py-3 text-left">Profile</th><th className="text-left">Person</th><th className="text-left">Member</th><th className="text-left">Emails</th><th className="text-right">Addresses</th><th className="text-right">Orders</th><th className="px-4 text-left">Retailers</th></tr>
            </thead>
            <tbody>
              {data.rows.map((p) => (
                <tr key={p.id} className="border-b border-line/50 hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5 font-medium text-ink">{p.name}</td>
                  <td className="text-ink2">{[p.firstName, p.lastName].filter(Boolean).join(' ') || '—'}</td>
                  <td>
                    {p.memberId ? (
                      <button className="text-accent hover:underline" onClick={() => useStore.getState().openMember(p.memberId!)}>{p.memberName}</button>
                    ) : (
                      <Button size="sm" onClick={() => setAssign(p)}>Assign…</Button>
                    )}
                  </td>
                  <td className="max-w-[260px] truncate font-mono text-xs text-ink3">{p.emails.join(', ') || '—'}</td>
                  <td className="text-right tabular text-ink2">{p.addressCount}</td>
                  <td className="text-right tabular text-ink2">
                    <button className="hover:text-accent" onClick={() => useStore.getState().navigate('orders', { orderFilter: { profileIds: [p.id] } })}>{p.orderCount}</button>
                  </td>
                  <td className="px-4"><span className="flex flex-wrap gap-1">{p.retailers.slice(0, 4).map((r) => <Badge key={r}>{r}</Badge>)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Modal open={!!assign} onClose={() => setAssign(null)} title={`Assign “${assign?.name}” to a member`}>
        <MemberPicker onPick={async (m) => {
          const p = assign!;
          setAssign(null);
          await act(() => call('profiles.assign', p.id, m.id), `Assigned to ${m.name}`);
        }} />
      </Modal>
      <Modal open={creating} onClose={() => setCreating(false)} title="New buying profile" footer={
        <Button variant="primary" disabled={!form.name} onClick={async () => {
          await act(() => call('profiles.create', { ...form, memberId: null }), 'Profile created');
          setCreating(false);
          setForm({ name: '', firstName: '', lastName: '' });
        }}>Create</Button>
      }>
        <div className="space-y-3">
          <Field label="Profile name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="TARGET ACCOUNT 14" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name"><Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
            <Field label="Last name"><Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
          </div>
        </div>
      </Modal>
    </div>
  );
}
