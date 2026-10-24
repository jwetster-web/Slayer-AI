import { motion } from 'motion/react';
import { FileUp, Inbox, KeyRound, Link2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatNumber, relativeTime } from '../../shared/format';
import type { EmailAccountRow } from '../../shared/types';
import { call } from '../lib/api';
import { useAction, useQuery } from '../lib/hooks';
import { useStore } from '../lib/store';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Tabs, Toggle } from '../components/ui';

const STATUS_TONE: Record<string, 'good' | 'accent' | 'bad' | 'warn' | 'neutral'> = { connected: 'good', syncing: 'accent', error: 'bad', needs_auth: 'warn', throttled: 'warn', idle: 'neutral', disabled: 'neutral' };

export function ImportProgress() {
  const [p, setP] = useState<{ done: number; total: number; label: string } | null>(null);
  useEffect(() => window.glide?.on((e: any) => {
    if (e.kind === 'import' || e.kind === 'sample') setP({ done: e.done, total: e.total, label: e.label ?? e.phase });
  }), []);
  if (!p || p.done >= p.total) return null;
  return (
    <Card className="mb-4 p-4">
      <div className="mb-2 flex justify-between text-sm"><span className="text-ink2">{p.label}</span><span className="font-mono text-ink3">{p.done}/{p.total}</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-white/5"><motion.div className="h-full rounded-full bg-gradient-to-r from-accent to-violet" animate={{ width: `${(p.done / Math.max(1, p.total)) * 100}%` }} /></div>
    </Card>
  );
}

export function Accounts() {
  const { data: accounts, refetch } = useQuery(() => call('accounts.list'), []);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<EmailAccountRow | null>(null);
  const act = useAction();
  const importFiles = async (directory: boolean) => {
    const paths = await call('dialog.openFiles', directory ? { directory: true } : { multi: true, filters: [{ name: 'Email', extensions: ['eml', 'mbox'] }] });
    if (!paths.length) return;
    const r = await act(() => call('accounts.importFiles', paths, null));
    if (r) useStore.getState().toast(`Imported ${(r as { messages: number }).messages} messages`, 'success');
  };
  return (
    <div>
      <PageHeader eyebrow="Ingestion" title="Email Accounts" subtitle="Inboxes are read incrementally and read-only: GLIDE never marks mail as read, moves or deletes anything." right={
        <>
          <Button icon={<FileUp className="size-4" />} onClick={() => importFiles(false)}>Import EML / MBOX</Button>
          <Button icon={<FileUp className="size-4" />} onClick={() => importFiles(true)}>Import folder</Button>
          <Button icon={<RefreshCw className="size-4" />} onClick={() => act(() => call('accounts.syncNow'), 'Sync started')}>Sync all</Button>
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Connect inbox</Button>
        </>
      } />
      <ImportProgress />
      {!accounts?.length ? (
        <Card><Empty icon={<Inbox className="size-6" />} title="No inboxes connected" body="Connect Gmail or Outlook with OAuth, any IMAP server with an app password, or import EML/MBOX exports for a historical backfill." action={<Button variant="primary" onClick={() => setAdding(true)}>Connect inbox</Button>} /></Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {accounts.map((a) => (
            <Card key={a.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-display text-[15px] font-semibold text-ink">{a.label}</span>
                    <Badge tone={STATUS_TONE[a.status] ?? 'neutral'}>{a.status.replace('_', ' ')}</Badge>
                    <Badge>{a.kind}</Badge>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-xs text-ink3">{a.address}{a.host ? ` · ${a.host}` : ''}</div>
                </div>
                <Toggle checked={a.enabled} onChange={(v) => act(async () => { await call('accounts.update', a.id, { enabled: v }); refetch(); })} />
              </div>
              <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                {[['Scanned', a.processedCount], ['Orders', a.orderCount], ['Errors', a.errorCount], ['Backfill', `${a.backfillDays}d`]].map(([l, v]) => (
                  <div key={l as string} className="rounded-lg bg-bg2/50 py-2">
                    <div className="font-mono text-sm font-bold text-ink">{typeof v === 'number' ? formatNumber(v) : v}</div>
                    <div className="text-[10px] uppercase tracking-wider text-ink3">{l}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-xs text-ink3">Last sync {relativeTime(a.lastSyncAt)}</div>
              {a.lastError && <div className="mt-2 rounded-lg border border-bad/30 bg-bad/10 p-2 text-xs text-bad">{a.lastError}</div>}
              <div className="mt-3 flex flex-wrap gap-2">
                {a.kind !== 'import' && <Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={() => act(() => call('accounts.syncNow', a.id), 'Synced')}>Sync now</Button>}
                {(a.kind === 'gmail' || a.kind === 'outlook') && <Button size="sm" icon={<Link2 className="size-3.5" />} onClick={() => act(async () => { await call('accounts.oauthConnect', a.id); refetch(); }, 'Connected')}>{a.status === 'needs_auth' ? 'Connect' : 'Reconnect'}</Button>}
                {a.kind === 'imap' && <Button size="sm" icon={<KeyRound className="size-3.5" />} onClick={() => setEditing(a)}>Edit</Button>}
                <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => act(async () => { await call('accounts.remove', a.id); refetch(); }, 'Removed')}>Remove</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <AddAccount open={adding} onClose={() => { setAdding(false); refetch(); }} />
      <EditAccount account={editing} onClose={() => { setEditing(null); refetch(); }} />
    </div>
  );
}

export function AddAccount({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [kind, setKind] = useState<'imap' | 'gmail' | 'outlook'>('imap');
  const [f, setF] = useState({ label: '', address: '', host: '', port: '993', username: '', password: '', backfillDays: '30', mailboxes: 'INBOX' });
  const [client, setClient] = useState({ clientId: '', clientSecret: '', tenant: '' });
  const { data: existing } = useQuery(() => (kind === 'imap' ? Promise.resolve(null) : call('accounts.getOAuthClient', kind)), [kind, open], { live: false });
  const act = useAction();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (kind !== 'imap' || !f.address.includes('@') || f.host) return;
    call('accounts.guessHost', f.address).then((g) => g && setF((x) => ({ ...x, host: g.host, port: String(g.port) })));
  }, [f.address, kind, f.host]);

  const submit = async () => {
    setBusy(true);
    try {
      if (kind !== 'imap' && client.clientId) await call('accounts.setOAuthClient', kind, { clientId: client.clientId, clientSecret: client.clientSecret || undefined, tenant: client.tenant || undefined });
      const id = await act(() => call('accounts.add', { label: f.label || f.address, kind, address: f.address, host: kind === 'imap' ? f.host : undefined, port: kind === 'imap' ? Number(f.port) : undefined, username: f.username || undefined, password: kind === 'imap' ? f.password : undefined, backfillDays: Number(f.backfillDays) || 0, mailboxes: f.mailboxes.split(',').map((s) => s.trim()).filter(Boolean) }));
      if (!id) return;
      if (kind !== 'imap') await act(() => call('accounts.oauthConnect', id), 'Account connected');
      else await act(() => call('accounts.syncNow', id), 'Inbox connected — first sync complete');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Connect an inbox" width={640} footer={<Button variant="primary" busy={busy} disabled={!f.address || (kind === 'imap' && (!f.host || !f.password))} onClick={submit}>{kind === 'imap' ? 'Connect & sync' : 'Sign in with browser'}</Button>}>
      <Tabs value={kind} onChange={setKind} tabs={[{ id: 'imap', label: 'IMAP / app password' }, { id: 'gmail', label: 'Gmail (OAuth)' }, { id: 'outlook', label: 'Outlook (OAuth)' }]} />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Email address"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value.trim(), host: '' })} placeholder="cook@example.com" /></Field>
        <Field label="Label"><Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Main cook inbox" /></Field>
        {kind === 'imap' && (
          <>
            <Field label="IMAP server"><Input value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} placeholder="imap.example.com" /></Field>
            <Field label="Port"><Input value={f.port} onChange={(e) => setF({ ...f, port: e.target.value })} /></Field>
            <Field label="Username" hint="Usually the email address."><Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder={f.address} /></Field>
            <Field label="App password" hint="Stored encrypted with your OS keychain. Use an app-specific password, not your login."><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          </>
        )}
        <Field label="Historical backfill (days)" hint="0 = only mail from now on. Older mail is scanned once."><Input value={f.backfillDays} onChange={(e) => setF({ ...f, backfillDays: e.target.value })} /></Field>
        <Field label="Folders" hint="Comma separated (e.g. INBOX, [Gmail]/All Mail)."><Input value={f.mailboxes} onChange={(e) => setF({ ...f, mailboxes: e.target.value })} /></Field>
      </div>
      {kind !== 'imap' && (
        <div className="mt-4 rounded-xl border border-line bg-bg2/50 p-4">
          <div className="mb-1 text-sm font-semibold text-ink">{kind === 'gmail' ? 'Google' : 'Microsoft'} OAuth client</div>
          <p className="mb-3 text-xs text-ink3">
            {kind === 'gmail'
              ? 'Create a “Desktop app” OAuth client in Google Cloud Console with the Gmail scope https://mail.google.com/ (IMAP access). Add yourself as a test user. See docs/EMAIL_SETUP.md.'
              : 'Register a public client app in Microsoft Entra with redirect http://127.0.0.1 and the IMAP.AccessAsUser.All permission. See docs/EMAIL_SETUP.md.'}
            {existing && ' A client is already saved; leave blank to reuse it.'}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Client ID"><Input value={client.clientId} onChange={(e) => setClient({ ...client, clientId: e.target.value.trim() })} placeholder={existing?.clientId ?? ''} /></Field>
            {kind === 'gmail' ? (
              <Field label="Client secret"><Input type="password" value={client.clientSecret} onChange={(e) => setClient({ ...client, clientSecret: e.target.value.trim() })} placeholder={existing?.hasSecret ? '•••••• saved' : ''} /></Field>
            ) : (
              <Field label="Tenant" hint="common, consumers, or your tenant ID"><Input value={client.tenant} onChange={(e) => setClient({ ...client, tenant: e.target.value.trim() })} placeholder={existing?.tenant || 'common'} /></Field>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function EditAccount({ account, onClose }: { account: EmailAccountRow | null; onClose: () => void }) {
  const [f, setF] = useState({ label: '', host: '', port: '', password: '', backfillDays: '' });
  const act = useAction();
  useEffect(() => {
    if (account) setF({ label: account.label, host: account.host ?? '', port: String(account.port ?? 993), password: '', backfillDays: String(account.backfillDays) });
  }, [account]);
  return (
    <Modal open={!!account} onClose={onClose} title="Edit inbox" footer={<Button variant="primary" onClick={async () => { await act(() => call('accounts.update', account!.id, { label: f.label, host: f.host, port: Number(f.port), backfillDays: Number(f.backfillDays), password: f.password || undefined }), 'Saved'); onClose(); }}>Save</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Label"><Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
        <Field label="Backfill days"><Input value={f.backfillDays} onChange={(e) => setF({ ...f, backfillDays: e.target.value })} /></Field>
        <Field label="IMAP server"><Input value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} /></Field>
        <Field label="Port"><Input value={f.port} onChange={(e) => setF({ ...f, port: e.target.value })} /></Field>
        <Field label="New app password" hint="Leave blank to keep the saved one."><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export { Select };
