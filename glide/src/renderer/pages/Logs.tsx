import { AlertTriangle, Bot, History, RotateCcw, ScrollText, Send, Workflow } from 'lucide-react';
import { useState } from 'react';
import { formatCents, formatDateTime } from '../../shared/format';
import { call } from '../lib/api';
import { useAction, useQuery } from '../lib/hooks';
import { useStore } from '../lib/store';
import { Badge, Button, Card, Empty, Modal, PageHeader, Tabs, Toggle } from '../components/ui';

type Tab = 'activity' | 'parsers' | 'automation' | 'audit' | 'system' | 'outbox';

export function Logs() {
  const [tab, setTab] = useState<Tab>('activity');
  return (
    <div>
      <PageHeader eyebrow="Diagnostics" title="Activity Logs" subtitle="Everything GLIDE did and why: order events, parser diagnostics, automation runs, identity changes and notifications. Logs never contain passwords, tokens or full addresses." />
      <div className="mb-4">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'activity', label: 'Activity' }, { id: 'parsers', label: 'Parser diagnostics' }, { id: 'automation', label: 'Automations' }, { id: 'audit', label: 'Audit log' }, { id: 'system', label: 'System' }, { id: 'outbox', label: 'Discord outbox' }]} />
      </div>
      {tab === 'activity' && <ActivityLog />}
      {tab === 'parsers' && <Parsers />}
      {tab === 'automation' && <Automations />}
      {tab === 'audit' && <Audit />}
      {tab === 'system' && <SystemLog />}
      {tab === 'outbox' && <Outbox />}
    </div>
  );
}

function ActivityLog() {
  const { data } = useQuery(() => call('activity.list', { limit: 300 }), []);
  if (!data?.length) return <Card><Empty icon={<ScrollText className="size-6" />} title="No activity yet" /></Card>;
  return (
    <Card className="overflow-hidden font-mono text-[12.5px]">
      {data.map((a) => (
        <button key={a.id} onClick={() => a.orderId && useStore.getState().openOrder(a.orderId)} className="grid w-full grid-cols-[170px_150px_170px_1fr_140px] gap-3 border-b border-line/40 px-4 py-2 text-left hover:bg-white/[0.03]">
          <span className="text-ink3">{formatDateTime(a.at)}</span>
          <span className="truncate text-ink2">{a.retailerName ?? '—'}</span>
          <span className="truncate text-accent">{a.kind}</span>
          <span className="truncate text-ink">{a.label}{a.amountCents ? ` · ${formatCents(a.amountCents, a.currency ?? 'USD')}` : ''}</span>
          <span className="truncate text-right text-ink3">{a.memberName ?? ''}</span>
        </button>
      ))}
    </Card>
  );
}

function Parsers() {
  const { data, refetch } = useQuery(() => call('diagnostics.parserFailures'), []);
  const act = useAction();
  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="text-sm text-ink2">Retail emails that were recognized but could not be fully parsed. Samples are redacted (emails, street lines, phone and long numbers removed). Add a custom parsing template in Settings, then reprocess.</div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => useStore.getState().navigate('settings', { settingsTab: 'parsers' })}>Parser templates</Button>
          <Button size="sm" variant="primary" icon={<RotateCcw className="size-3.5" />} onClick={async () => { const r = await act(() => call('diagnostics.reprocessFailed')); if (r) useStore.getState().toast(`Reprocessed ${(r as { attempted: number; fixed: number }).attempted}: ${(r as { fixed: number }).fixed} now parse`, 'success'); refetch(); }}>Reprocess failed</Button>
        </div>
      </Card>
      {!data?.length ? (
        <Card><Empty icon={<AlertTriangle className="size-6" />} title="No parser failures" body="Every recognized retail email parsed successfully." /></Card>
      ) : (
        data.map((f) => (
          <Card key={f.id} className="p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="bad">{f.reason ?? 'failed'}</Badge>
              <Badge>{f.retailerId ?? 'unknown retailer'}</Badge>
              <Badge>{f.messageType}</Badge>
              <span className="text-xs text-ink3">{formatDateTime(f.createdAt)} · {f.accountLabel ?? 'import'}</span>
            </div>
            {f.sample && <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-lg bg-bg2/60 p-2 text-[11px] text-ink3">{f.sample}</pre>}
          </Card>
        ))
      )}
    </div>
  );
}

function Automations() {
  const { data, refetch } = useQuery(() => call('automation.rules'), []);
  const [hist, setHist] = useState<number | null>(null);
  const { data: execs } = useQuery(() => (hist ? call('automation.executions', hist) : Promise.resolve(null)), [hist]);
  const act = useAction();
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {data?.map((r) => (
        <Card key={r.id} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-line bg-panel2 text-accent"><Workflow className="size-4" /></div>
              <div>
                <div className="font-medium text-ink">{r.name}</div>
                <div className="mt-0.5 text-xs text-ink3">{r.description}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {r.triggers.map((t) => <Badge key={t} tone="violet">on {t.replace('_', ' ')}</Badge>)}
                  {r.actions.map((a, i) => <Badge key={i}>{a.type.replace(/_/g, ' ')}{'channel' in a ? ` → ${a.channel.replace('_', ' ')}` : ''}</Badge>)}
                </div>
              </div>
            </div>
            <Toggle checked={r.enabled} onChange={async (v) => { await act(() => call('automation.setEnabled', r.id, v)); refetch(); }} />
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-ink3">
            <span>{r.executions} runs · last {r.lastRunAt ? formatDateTime(r.lastRunAt) : 'never'}</span>
            <Button size="sm" variant="ghost" icon={<History className="size-3.5" />} onClick={() => setHist(r.id)}>History</Button>
          </div>
        </Card>
      ))}
      <Modal open={!!hist} onClose={() => setHist(null)} title="Execution history" width={720}>
        <p className="mb-2 text-xs text-ink3">Each rule runs at most once per event (duplicate-notification safeguard).</p>
        {execs?.map((e) => (
          <div key={e.id} className="flex items-center justify-between gap-3 border-b border-line/50 py-1.5 text-xs">
            <span className="font-mono text-ink3">{e.event_key}</span>
            <span className="flex-1 truncate text-ink2">{e.detail}</span>
            <Badge tone={e.status === 'ok' ? 'good' : 'bad'}>{e.status}</Badge>
            <span className="text-ink3">{formatDateTime(e.executed_at)}</span>
          </div>
        ))}
        {!execs?.length && <div className="text-sm text-ink3">No runs yet.</div>}
      </Modal>
    </div>
  );
}

function Audit() {
  const { data } = useQuery(() => call('diagnostics.audit', 400, undefined), []);
  return (
    <Card className="overflow-hidden font-mono text-[12px]">
      {data?.map((a) => (
        <div key={a.id} className="grid grid-cols-[170px_90px_220px_1fr] gap-3 border-b border-line/40 px-4 py-1.5">
          <span className="text-ink3">{formatDateTime(a.at)}</span>
          <span className="text-ink2">{a.actor}</span>
          <span className="text-accent">{a.action}</span>
          <span className="truncate text-ink3">{a.entity} {a.entityId} {a.detail}</span>
        </div>
      ))}
      {!data?.length && <Empty title="Audit log is empty" />}
    </Card>
  );
}

function SystemLog() {
  const { data } = useQuery(() => call('diagnostics.logs'), [], { intervalMs: 5000 });
  return (
    <Card className="overflow-hidden font-mono text-[12px]">
      {data?.map((l, i) => (
        <div key={i} className="grid grid-cols-[170px_60px_1fr] gap-3 border-b border-line/40 px-4 py-1.5">
          <span className="text-ink3">{formatDateTime(l.at)}</span>
          <span className={l.level === 'error' ? 'text-bad' : l.level === 'warn' ? 'text-warn' : 'text-ink2'}>{l.level}</span>
          <span className="text-ink2">{l.message}</span>
        </div>
      ))}
      {!data?.length && <Empty icon={<Bot className="size-6" />} title="No system messages this session" />}
    </Card>
  );
}

function Outbox() {
  const { data } = useQuery(() => call('discord.outbox'), []);
  return (
    <Card className="overflow-hidden">
      {data?.map((o) => (
        <div key={o.id} className="flex items-center justify-between gap-3 border-b border-line/50 px-4 py-2 text-sm">
          <span className="flex items-center gap-2 text-ink2"><Send className="size-3.5 text-accent" />{o.channelKind.replace('_', ' ')} · {JSON.parse(o.payload).event}</span>
          <span className="flex items-center gap-2">
            {o.lastError && <span className="max-w-xs truncate text-xs text-bad">{o.lastError}</span>}
            <Badge tone={o.status === 'sent' ? 'good' : o.status === 'failed' ? 'bad' : o.status === 'skipped' ? 'neutral' : 'warn'}>{o.status}</Badge>
            <span className="text-xs text-ink3">{formatDateTime(o.sentAt ?? o.createdAt)}</span>
          </span>
        </div>
      ))}
      {!data?.length && <Empty icon={<Send className="size-6" />} title="No notifications queued" body="Enable Discord and a notification rule to send alerts to your admin channel or member DMs." />}
    </Card>
  );
}
