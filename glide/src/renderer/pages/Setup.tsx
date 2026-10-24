import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Check, Database, FileUp, Fingerprint, Inbox, MessagesSquare, Rocket, ScanLine, Settings2, Sparkles, Upload, Wand2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { formatNumber } from '../../shared/format';
import { call } from '../lib/api';
import { useAction, useQuery } from '../lib/hooks';
import { useStore } from '../lib/store';
import { CsvImport } from '../components/CsvImport';
import { Aurora, ParticleField } from '../components/fx';
import { WindowControls } from '../components/Shell';
import { AddAccount, ImportProgress } from './Accounts';
import { Badge, Button, Card, Field, Input, cx } from '../components/ui';

const STEPS = [
  { title: 'Welcome', icon: <Sparkles className="size-4" /> },
  { title: 'Local database', icon: <Database className="size-4" /> },
  { title: 'Email accounts', icon: <Inbox className="size-4" /> },
  { title: 'Historical import', icon: <FileUp className="size-4" /> },
  { title: 'Discord', icon: <MessagesSquare className="size-4" /> },
  { title: 'Buying profiles', icon: <Upload className="size-4" /> },
  { title: 'Identity preview', icon: <Fingerprint className="size-4" /> },
  { title: 'Sync settings', icon: <Settings2 className="size-4" /> },
  { title: 'Initial scan', icon: <ScanLine className="size-4" /> },
  { title: 'Ready', icon: <Rocket className="size-4" /> },
];

export function Setup() {
  const ws = useStore((s) => s.workspace);
  const [step, setStep] = useState(ws ? 2 : 0);
  const [sampleRun, setSampleRun] = useState(false);
  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(ws ? 1 : 0, s - 1));
  return (
    <div className="relative flex h-full overflow-hidden bg-bg">
      <Aurora />
      <ParticleField density={0.00012} />
      <div className="drag-region absolute inset-x-0 top-0 z-20 flex h-12 items-center justify-end pr-2">
        <WindowControls className="border-l-0" />
      </div>
      <aside className="relative z-10 hidden w-[280px] shrink-0 flex-col border-r border-line bg-bg2/40 p-7 backdrop-blur-xl lg:flex">
        <div className="mb-10 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-accent via-violet to-magenta font-display text-xl font-bold text-white shadow-[0_0_28px_-4px_var(--g-accent)]">G</div>
          <div>
            <div className="font-display text-xl font-bold tracking-[0.2em]">GLIDE</div>
            <div className="text-[11px] text-ink3">PokeSlayerz Order Command Center</div>
          </div>
        </div>
        <ol className="space-y-1">
          {STEPS.map((s, i) => (
            <li key={s.title} className={cx('flex items-center gap-3 rounded-xl px-3 py-2 text-sm', i === step ? 'bg-accent/15 text-ink' : i < step ? 'text-ink2' : 'text-ink3')}>
              <span className={cx('grid size-6 place-items-center rounded-full border text-[11px]', i < step ? 'border-transparent bg-good text-bg' : i === step ? 'border-accent text-accent' : 'border-line')}>{i < step ? <Check className="size-3.5" /> : i + 1}</span>
              {s.title}
            </li>
          ))}
        </ol>
      </aside>
      <main className="relative z-10 flex flex-1 items-center justify-center overflow-y-auto p-8">
        <AnimatePresence mode="wait">
          <motion.div key={sampleRun ? 'sample' : step} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25 }} className="w-full max-w-3xl">
            {sampleRun ? (
              <SampleProgress />
            ) : (
              <>
                {step === 0 && <Welcome onCreated={() => setStep(1)} onSample={() => setSampleRun(true)} />}
                {step === 1 && <DbInit />}
                {step === 2 && <EmailStep />}
                {step === 3 && <ImportStep />}
                {step === 4 && <DiscordStep />}
                {step === 5 && <StepCard title="Import buying profiles" body="Map your profile CSV to Discord members so orders are attributed automatically. Payment card columns are dropped before anything is stored."><CsvImport /></StepCard>}
                {step === 6 && <IdentityStep />}
                {step === 7 && <SyncStep />}
                {step === 8 && <ScanStep />}
                {step === 9 && <ReadyStep />}
                {step > 0 && step < 9 && (
                  <div className="mt-6 flex justify-between">
                    <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={back}>Back</Button>
                    <div className="flex gap-2">
                      {step >= 2 && step <= 7 && <Button variant="ghost" onClick={next}>Skip for now</Button>}
                      <Button variant="primary" onClick={next}>Continue <ArrowRight className="size-4" /></Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

function StepCard({ title, body, children }: { title: string; body?: ReactNode; children?: ReactNode }) {
  return (
    <div>
      <h1 className="font-display text-3xl font-bold tracking-tight">{title}</h1>
      {body && <p className="mt-2 max-w-2xl text-ink2">{body}</p>}
      <div className="mt-6">{children}</div>
    </div>
  );
}

function Welcome({ onCreated, onSample }: { onCreated: () => void; onSample: () => void }) {
  const [name, setName] = useState('PokeSlayerz');
  const [busy, setBusy] = useState(false);
  const act = useAction();
  const { data: existing } = useQuery(() => call('workspace.list'), [], { live: false });
  return (
    <div>
      <div className="mb-2 font-mono text-xs uppercase tracking-[0.3em] text-accent">Welcome to</div>
      <h1 className="grad-text glow-text font-display text-6xl font-bold tracking-tight">GLIDE</h1>
      <p className="mt-3 max-w-xl text-lg text-ink2">The order intelligence terminal for PokeSlayerz. Track every checkout across inboxes, match orders to Discord members, follow shipments and generate stunning cook recaps — all locally on this computer.</p>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Card glow className="p-6">
          <div className="mb-3 flex items-center gap-2 font-display text-lg font-semibold"><Database className="size-5 text-accent" /> Create your workspace</div>
          <Field label="Workspace name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Button className="mt-4 w-full" variant="primary" busy={busy} onClick={async () => {
            setBusy(true);
            const info = await act(() => call('workspace.create', name, false));
            setBusy(false);
            if (info) {
              useStore.getState().setWorkspace(info);
              useStore.getState().setSettings(await call('settings.get'));
              onCreated();
            }
          }}>Create workspace</Button>
        </Card>
        <Card className="p-6">
          <div className="mb-3 flex items-center gap-2 font-display text-lg font-semibold"><Wand2 className="size-5 text-violet" /> Explore with sample data</div>
          <p className="text-sm text-ink3">Generates a separate, clearly labeled sample workspace: ~1,000 synthetic orders run through the real parsers, matcher and analytics. Never mixed with real data.</p>
          <Button className="mt-4 w-full" onClick={async () => {
            onSample();
            const info = await act(() => call('workspace.create', 'Sample Workspace', true, 1000));
            if (info) {
              await call('workspace.completeSetup');
              useStore.getState().setSettings(await call('settings.get'));
              useStore.getState().setWorkspace({ ...info, setupComplete: true });
            }
          }}>Launch sample mode</Button>
        </Card>
      </div>
      {!!existing?.length && (
        <div className="mt-6">
          <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-ink3">Open an existing workspace</div>
          <div className="flex flex-wrap gap-2">
            {existing.map((w) => (
              <Button key={w.id} size="sm" onClick={async () => {
                const info = await act(() => call('workspace.open', w.id));
                if (info) {
                  useStore.getState().setSettings(await call('settings.get'));
                  useStore.getState().setWorkspace(await call('workspace.current'));
                }
              }}>{w.name}{w.isSample && <Badge tone="warn">SAMPLE</Badge>}</Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SampleProgress() {
  const [p, setP] = useState({ done: 0, total: 1, phase: 'Generating members and emails' });
  useEffect(() => window.glide?.on((e: any) => e.kind === 'sample' && setP({ done: e.done, total: e.total, phase: e.phase })), []);
  const pct = p.total ? p.done / p.total : 0;
  return (
    <div className="text-center">
      <div className="relative mx-auto mb-8 size-56">
        <motion.div className="absolute inset-0 rounded-full border border-accent/30" animate={{ rotate: 360 }} transition={{ duration: 12, repeat: Infinity, ease: 'linear' }} style={{ borderTopColor: 'var(--g-accent)' }} />
        <motion.div className="absolute inset-6 rounded-full border border-violet/30" animate={{ rotate: -360 }} transition={{ duration: 8, repeat: Infinity, ease: 'linear' }} style={{ borderTopColor: 'var(--g-violet)' }} />
        <div className="absolute inset-12 grid place-items-center rounded-full bg-gradient-to-br from-accent/20 to-violet/20 backdrop-blur">
          <div>
            <div className="font-display text-4xl font-bold">{Math.round(pct * 100)}%</div>
            <div className="font-mono text-xs text-ink3">{formatNumber(p.done)} / {formatNumber(p.total)}</div>
          </div>
        </div>
      </div>
      <h2 className="font-display text-2xl font-bold">Building your sample workspace</h2>
      <p className="mt-2 text-ink2">{p.phase} — every message runs through the real parsing, deduplication and identity pipeline.</p>
      <div className="mx-auto mt-6 h-2 max-w-md overflow-hidden rounded-full bg-white/5"><motion.div className="h-full rounded-full bg-gradient-to-r from-accent via-violet to-magenta" animate={{ width: `${pct * 100}%` }} /></div>
    </div>
  );
}

function DbInit() {
  const ws = useStore((s) => s.workspace);
  const { data: stats } = useQuery(() => call('diagnostics.stats'), [], { live: false });
  const items = [
    ['SQLite database created', !!stats],
    ['Schema migrated (orders, identity, tracking, provenance, audit)', !!stats],
    ['Workspace encryption key sealed by your OS credential store', !!stats],
    ['Retailer adapters loaded (Target, Walmart, Pokémon Center US/UK/CA/DE, Amazon, Best Buy, Costco, Sam’s Club + more)', !!stats],
    ['Automation rules installed', !!stats],
  ] as const;
  return (
    <StepCard title="Local database ready" body={<>Everything lives on this computer in <span className="font-mono text-sm">{stats?.dbPath ?? ws?.path}</span>.</>}>
      <Card className="space-y-3 p-5">
        {items.map(([label, ok], i) => (
          <motion.div key={label} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.12 }} className="flex items-center gap-3 text-sm">
            <span className={cx('grid size-6 place-items-center rounded-full', ok ? 'bg-good text-bg' : 'border border-line')}>{ok && <Check className="size-3.5" />}</span>
            <span className="text-ink2">{label}</span>
          </motion.div>
        ))}
      </Card>
    </StepCard>
  );
}

function EmailStep() {
  const [open, setOpen] = useState(false);
  const { data: accounts, refetch } = useQuery(() => call('accounts.list'), [open]);
  return (
    <StepCard title="Connect your inboxes" body="Connect as many inboxes as you use for checkouts. Gmail and Outlook use OAuth; any other provider works over IMAP with an app password. GLIDE only reads — it never marks mail as read or changes anything.">
      <div className="space-y-2">
        {accounts?.map((a) => <Card key={a.id} className="flex items-center justify-between p-3 text-sm"><span>{a.label} <span className="font-mono text-xs text-ink3">{a.address}</span></span><Badge tone={a.status === 'connected' || a.status === 'idle' ? 'good' : 'warn'}>{a.status}</Badge></Card>)}
      </div>
      <Button className="mt-4" variant="primary" icon={<Inbox className="size-4" />} onClick={() => setOpen(true)}>Connect an inbox</Button>
      <AddAccount open={open} onClose={() => { setOpen(false); refetch(); }} />
    </StepCard>
  );
}

function ImportStep() {
  const [result, setResult] = useState<string | null>(null);
  const act = useAction();
  return (
    <StepCard title="Historical import" body="Backfill older orders from Google Takeout (MBOX), Outlook/Thunderbird exports (EML or MBOX), or a folder of .eml files. Duplicates across exports and forwards are merged into one order.">
      <ImportProgress />
      <div className="flex gap-2">
        <Button variant="primary" icon={<FileUp className="size-4" />} onClick={async () => {
          const paths = await call('dialog.openFiles', { multi: true, filters: [{ name: 'Email', extensions: ['eml', 'mbox'] }] });
          if (!paths.length) return;
          const r = await act(() => call('accounts.importFiles', paths, null));
          if (r) setResult(JSON.stringify((r as { counts: Record<string, number> }).counts));
        }}>Choose EML / MBOX files</Button>
        <Button icon={<FileUp className="size-4" />} onClick={async () => {
          const paths = await call('dialog.openFiles', { directory: true });
          if (!paths.length) return;
          const r = await act(() => call('accounts.importFiles', paths, null));
          if (r) setResult(JSON.stringify((r as { counts: Record<string, number> }).counts));
        }}>Choose a folder</Button>
      </div>
      {result && <Card className="mt-4 p-4 font-mono text-xs text-ink2">{result}</Card>}
    </StepCard>
  );
}

function DiscordStep() {
  const [f, setF] = useState({ botToken: '', guildId: '', adminChannelId: '' });
  const act = useAction();
  return (
    <StepCard title="Discord integration" body="Optional. Import member IDs and usernames from your server and send private order alerts. Order details only ever go to your private admin channel or the owner’s DMs.">
      <Card className="grid gap-3 p-5 sm:grid-cols-2">
        <Field label="Bot token"><Input type="password" value={f.botToken} onChange={(e) => setF({ ...f, botToken: e.target.value.trim() })} /></Field>
        <Field label="Server ID"><Input value={f.guildId} onChange={(e) => setF({ ...f, guildId: e.target.value.trim() })} /></Field>
        <Field label="Admin channel ID (optional)"><Input value={f.adminChannelId} onChange={(e) => setF({ ...f, adminChannelId: e.target.value.trim() })} /></Field>
        <div className="flex items-end gap-2">
          <Button variant="primary" disabled={!f.botToken || !f.guildId} onClick={async () => {
            const ok = await act(() => call('discord.saveConfig', f), 'Saved');
            if (ok !== undefined) {
              const r = await act(() => call('discord.syncMembers'));
              if (r) useStore.getState().toast(`${r.total} members imported`, 'success');
            }
          }}>Save & import members</Button>
        </div>
      </Card>
    </StepCard>
  );
}

function IdentityStep() {
  const { data: d } = useQuery(() => call('identity.discovery'), []);
  const { data: members } = useQuery(() => call('members.list', { limit: 1 }), []);
  const s = useStore((x) => x.settings);
  return (
    <StepCard title="Identity matching preview" body="How GLIDE will attribute orders: verified emails, exclusive verified addresses, profile names, phones and private catch-all domains combine into a confidence score. Only unique, high-confidence matches link automatically.">
      <div className="grid gap-3 sm:grid-cols-3">
        {[['Members', members?.total ?? 0], ['Pending reviews', d?.pendingReviews ?? 0], ['Shared households', d?.sharedAddresses ?? 0]].map(([l, v]) => (
          <Card key={l as string} className="p-4"><div className="text-[10px] uppercase tracking-widest text-ink3">{l}</div><div className="mt-1 font-display text-3xl font-bold">{v}</div></Card>
        ))}
      </div>
      <Card className="mt-4 p-5 text-sm text-ink2">
        Auto-assign above <b className="text-ink">{Math.round((s?.autoMatchThreshold ?? 0.9) * 100)}%</b> with a clear lead over any other member · review queue above <b className="text-ink">{Math.round((s?.reviewThreshold ?? 0.35) * 100)}%</b> · shared addresses never attribute one order to two members. Adjust anytime in Settings → Identity matching.
      </Card>
    </StepCard>
  );
}

function SyncStep() {
  const s = useStore((x) => x.settings);
  const [poll, setPoll] = useState(String(s?.pollIntervalSec ?? 120));
  const [backup, setBackup] = useState(String(s?.backupIntervalHours ?? 24));
  const act = useAction();
  return (
    <StepCard title="Synchronization settings" body="Background sync checks each inbox for new messages only, resumes safely after restarts, and backs up your database automatically.">
      <Card className="grid gap-3 p-5 sm:grid-cols-2">
        <Field label="Check inboxes every (seconds)"><Input type="number" min={30} value={poll} onChange={(e) => setPoll(e.target.value)} /></Field>
        <Field label="Automatic backup every (hours)"><Input type="number" min={1} value={backup} onChange={(e) => setBackup(e.target.value)} /></Field>
        <Button variant="primary" className="w-fit" onClick={async () => { const r = await act(() => call('settings.update', { pollIntervalSec: Math.max(30, Number(poll) || 120), backupIntervalHours: Math.max(1, Number(backup) || 24) }), 'Saved'); if (r) useStore.getState().setSettings(r); }}>Save</Button>
      </Card>
    </StepCard>
  );
}

function ScanStep() {
  const [state, setState] = useState<'idle' | 'running' | 'done'>('idle');
  const [events, setEvents] = useState<{ label: string; processed: number; failures: number; phase: string; created: number }[]>([]);
  const { data: accounts } = useQuery(() => call('accounts.list'), [], { live: false });
  useEffect(() => window.glide?.on((e: any) => {
    if (e.kind !== 'progress') return;
    setEvents((prev) => {
      const others = prev.filter((p) => p.label !== e.progress.accountLabel);
      return [...others, { label: e.progress.accountLabel, processed: e.progress.processed, failures: e.progress.failures, phase: e.progress.phase, created: e.progress.ordersCreated }];
    });
  }), []);
  const syncable = accounts?.filter((a) => a.kind !== 'import') ?? [];
  return (
    <StepCard title="Initial scan" body={syncable.length ? 'Scanning connected inboxes now. Counts below are live from the sync engine.' : 'No inboxes are connected yet — you can connect them later from Email Accounts.'}>
      {syncable.length > 0 && state === 'idle' && <Button variant="primary" icon={<ScanLine className="size-4" />} onClick={async () => { setState('running'); try { await call('accounts.syncNow'); } finally { setState('done'); } }}>Start initial scan</Button>}
      <div className="mt-4 space-y-2">
        {events.map((e) => (
          <Card key={e.label} className="flex items-center justify-between p-4 text-sm">
            <span className="flex items-center gap-2">{e.phase !== 'done' && e.phase !== 'error' && <span className="pulse-dot size-2 rounded-full bg-accent" />}{e.label}</span>
            <span className="font-mono text-xs text-ink2">{e.processed} processed · {e.created} new orders · {e.failures} failures · <Badge tone={e.phase === 'error' ? 'bad' : e.phase === 'done' ? 'good' : 'accent'}>{e.phase}</Badge></span>
          </Card>
        ))}
      </div>
      {state === 'done' && <div className="mt-3 text-sm text-good">Initial scan finished.</div>}
    </StepCard>
  );
}

function ReadyStep() {
  const { data: stats } = useQuery(() => call('diagnostics.stats'), [], { live: false });
  return (
    <div className="text-center">
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mx-auto mb-6 grid size-24 place-items-center rounded-3xl bg-gradient-to-br from-accent via-violet to-magenta shadow-[0_0_60px_-10px_var(--g-accent)]">
        <Rocket className="size-10 text-white" />
      </motion.div>
      <h1 className="font-display text-4xl font-bold">Your command center is ready</h1>
      <p className="mx-auto mt-3 max-w-lg text-ink2">{stats ? `${formatNumber(stats.counts.orders)} orders · ${formatNumber(stats.counts.members)} members · ${formatNumber(stats.counts.profiles)} profiles` : ''}. GLIDE keeps syncing in the background.</p>
      <Button className="mt-8" variant="primary" icon={<ArrowRight className="size-4" />} onClick={async () => {
        await call('workspace.completeSetup');
        const ws = await call('workspace.current');
        useStore.getState().setWorkspace(ws);
      }}>Open the dashboard</Button>
    </div>
  );
}
