import { Database, Download, HardDrive, ImagePlus, Plus, RefreshCw, Save, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { formatDateTime, formatNumber } from '../../shared/format';
import type { AppSettings } from '../../shared/types';
import { call } from '../lib/api';
import { useAction, useQuery } from '../lib/hooks';
import { useStore } from '../lib/store';
import { Badge, Button, Card, Field, Input, KV, Modal, PageHeader, Select, Textarea, Toggle, cx } from '../components/ui';

const TABS = [
  ['general', 'General & branding'],
  ['email', 'Email & sync'],
  ['discord', 'Discord'],
  ['shipping', 'Shipping carriers'],
  ['matching', 'Identity matching'],
  ['data', 'Data & backups'],
  ['parsers', 'Parser templates'],
  ['about', 'Diagnostics'],
] as const;

export function SettingsPage() {
  const tab = useStore((s) => s.settingsTab);
  const settings = useStore((s) => s.settings);
  const [draft, setDraft] = useState<AppSettings | null>(settings);
  const act = useAction();
  useEffect(() => setDraft(settings), [settings]);
  const save = async (patch: Partial<AppSettings>) => {
    const s = await act(() => call('settings.update', patch), 'Settings saved');
    if (s) useStore.getState().setSettings(s);
  };
  if (!draft) return null;
  const set = (p: Partial<AppSettings>) => setDraft({ ...draft, ...p });
  return (
    <div>
      <PageHeader eyebrow="Configuration" title="Settings" />
      <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
        <Card className="h-fit p-2">
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => useStore.getState().navigate('settings', { settingsTab: id })} className={cx('w-full rounded-xl px-3 py-2 text-left text-sm transition', tab === id ? 'bg-accent/15 text-ink' : 'text-ink3 hover:bg-white/5 hover:text-ink2')}>
              {label}
            </button>
          ))}
        </Card>
        <div className="space-y-4">
          {tab === 'general' && <General draft={draft} set={set} save={save} />}
          {tab === 'email' && <EmailSettings draft={draft} set={set} save={save} />}
          {tab === 'discord' && <DiscordSettings draft={draft} set={set} save={save} />}
          {tab === 'shipping' && <ShippingSettings />}
          {tab === 'matching' && <MatchingSettings draft={draft} set={set} save={save} />}
          {tab === 'data' && <DataSettings draft={draft} set={set} save={save} />}
          {tab === 'parsers' && <ParserTemplates />}
          {tab === 'about' && <Updates />}
          {tab === 'about' && <About />}
        </div>
      </div>
    </div>
  );
}

type P = { draft: AppSettings; set: (p: Partial<AppSettings>) => void; save: (p: Partial<AppSettings>) => Promise<void> };

function Section({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Card className="p-5">
      <h3 className="mb-4 font-display text-[15px] font-semibold">{title}</h3>
      <div className="space-y-4">{children}</div>
      {footer && <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">{footer}</div>}
    </Card>
  );
}

function General({ draft, set, save }: P) {
  const { data: logo, refetch } = useQuery(() => call('settings.getLogo'), []);
  const act = useAction();
  const [fx, setFx] = useState(Object.entries(draft.fxRates).map(([k, v]) => `${k}=${v}`).join(', '));
  return (
    <>
      <Section title="Branding" footer={<Button variant="primary" icon={<Save className="size-4" />} onClick={() => save({ brandName: draft.brandName, brandTagline: draft.brandTagline, accentColor: draft.accentColor })}>Save branding</Button>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Brand name" hint="Shown in the app and on every Cook Export."><Input value={draft.brandName} onChange={(e) => set({ brandName: e.target.value })} /></Field>
          <Field label="Tagline"><Input value={draft.brandTagline} onChange={(e) => set({ brandTagline: e.target.value })} /></Field>
          <Field label="Accent color" hint="Drives the UI glow and export palettes.">
            <div className="flex gap-2"><Input type="color" className="h-10 w-16 p-1" value={draft.accentColor} onChange={(e) => set({ accentColor: e.target.value })} /><Input value={draft.accentColor} onChange={(e) => set({ accentColor: e.target.value })} /></div>
          </Field>
          <Field label="Logo" hint="PNG/SVG, used on exports and in the sidebar.">
            <div className="flex items-center gap-3">
              {logo ? <img src={logo} className="size-12 rounded-xl border border-line object-cover" alt="" /> : <div className="grid size-12 place-items-center rounded-xl border border-dashed border-line text-ink3"><ImagePlus className="size-5" /></div>}
              <Button size="sm" onClick={async () => { const [f] = await call('dialog.openFiles', { filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }] }); if (f) { await act(() => call('settings.setLogo', f), 'Logo updated'); refetch(); } }}>Upload</Button>
              {logo && <Button size="sm" variant="ghost" onClick={async () => { await call('settings.setLogo', null); refetch(); }}>Remove</Button>}
            </div>
          </Field>
        </div>
      </Section>
      <Section title="Appearance">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Theme"><Select className="w-full" value={draft.theme} onChange={(e) => save({ theme: e.target.value as AppSettings['theme'] })}><option value="dark">Cinematic dark</option><option value="light">Light</option></Select></Field>
          <Field label="Reduced motion"><Select className="w-full" value={draft.reducedMotion} onChange={(e) => save({ reducedMotion: e.target.value as AppSettings['reducedMotion'] })}><option value="system">Follow system</option><option value="on">Always reduce</option><option value="off">Full motion</option></Select></Field>
        </div>
        <Toggle checked={draft.soundEffects} onChange={(v) => save({ soundEffects: v })} label="Subtle sound when new orders arrive" />
      </Section>
      <Section title="Currency" footer={<Button variant="primary" onClick={() => {
        const rates: Record<string, number> = {};
        for (const part of fx.split(/[,\n]/)) { const [k, v] = part.split('=').map((s) => s.trim()); if (/^[A-Z]{3}$/.test(k ?? '') && Number(v) > 0) rates[k] = Number(v); }
        save({ displayCurrency: draft.displayCurrency, fxRates: rates, timezone: draft.timezone });
      }}>Save</Button>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Display currency"><Select className="w-full" value={draft.displayCurrency} onChange={(e) => set({ displayCurrency: e.target.value })}>{['USD', 'CAD', 'GBP', 'EUR'].map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="Timezone" hint="Used for daily buckets and heatmaps."><Input value={draft.timezone} onChange={(e) => set({ timezone: e.target.value })} /></Field>
        </div>
        <Field label="Exchange rates (1 unit = X display currency)" hint="Orders keep their original currency. Money totals only include currencies with a rate; e.g. GBP=1.27, EUR=1.08, CAD=0.72"><Input value={fx} onChange={(e) => setFx(e.target.value)} /></Field>
      </Section>
    </>
  );
}

function EmailSettings({ draft, set, save }: P) {
  const { data: g } = useQuery(() => call('accounts.getOAuthClient', 'gmail'), []);
  const { data: o } = useQuery(() => call('accounts.getOAuthClient', 'outlook'), []);
  const [gc, setGc] = useState({ clientId: '', clientSecret: '' });
  const [oc, setOc] = useState({ clientId: '', tenant: '' });
  const act = useAction();
  return (
    <>
      <Section title="Background sync" footer={<Button variant="primary" onClick={() => save({ pollIntervalSec: draft.pollIntervalSec, storeRawEmails: draft.storeRawEmails, encryptRawEmails: draft.encryptRawEmails, fetchRemoteProductImages: draft.fetchRemoteProductImages })}>Save</Button>}>
        <Field label="Polling interval (seconds)" hint="Each run fetches only new messages since the last checkpoint."><Input type="number" min={30} value={draft.pollIntervalSec} onChange={(e) => set({ pollIntervalSec: Math.max(30, Number(e.target.value) || 120) })} /></Field>
        <Toggle checked={draft.storeRawEmails} onChange={(v) => set({ storeRawEmails: v })} label="Keep original retail emails for troubleshooting (non-retail mail is never stored)" />
        <Toggle checked={draft.encryptRawEmails} onChange={(v) => set({ encryptRawEmails: v })} label="Encrypt stored emails with the workspace key (AES-256-GCM)" />
        <Toggle checked={draft.fetchRemoteProductImages} onChange={(v) => set({ fetchRemoteProductImages: v })} label="Download product images referenced in retailer emails to the local cache" />
      </Section>
      <Section title="Gmail OAuth client" footer={<Button variant="primary" disabled={!gc.clientId} onClick={() => act(() => call('accounts.setOAuthClient', 'gmail', { clientId: gc.clientId, clientSecret: gc.clientSecret || undefined }), 'Saved')}>Save</Button>}>
        <p className="text-sm text-ink3">{g ? <>Saved client <span className="font-mono">{g.clientId.slice(0, 18)}…</span></> : 'Not configured.'} Create a Desktop OAuth client in Google Cloud with scope https://mail.google.com/.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Client ID"><Input value={gc.clientId} onChange={(e) => setGc({ ...gc, clientId: e.target.value.trim() })} /></Field>
          <Field label="Client secret"><Input type="password" value={gc.clientSecret} onChange={(e) => setGc({ ...gc, clientSecret: e.target.value.trim() })} /></Field>
        </div>
      </Section>
      <Section title="Microsoft / Outlook OAuth client" footer={<Button variant="primary" disabled={!oc.clientId} onClick={() => act(() => call('accounts.setOAuthClient', 'outlook', { clientId: oc.clientId, tenant: oc.tenant || undefined }), 'Saved')}>Save</Button>}>
        <p className="text-sm text-ink3">{o ? <>Saved client <span className="font-mono">{o.clientId.slice(0, 18)}…</span></> : 'Not configured.'} Public client with redirect http://127.0.0.1 and IMAP.AccessAsUser.All.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Application (client) ID"><Input value={oc.clientId} onChange={(e) => setOc({ ...oc, clientId: e.target.value.trim() })} /></Field>
          <Field label="Tenant"><Input value={oc.tenant} onChange={(e) => setOc({ ...oc, tenant: e.target.value.trim() })} placeholder="common" /></Field>
        </div>
      </Section>
    </>
  );
}

function DiscordSettings({ draft, save }: P) {
  const { data: cfg, refetch } = useQuery(() => call('discord.getConfig'), []);
  const [f, setF] = useState({ botToken: '', guildId: '', adminChannelId: '' });
  const act = useAction();
  useEffect(() => { if (cfg) setF((x) => ({ ...x, guildId: cfg.guildId, adminChannelId: cfg.adminChannelId })); }, [cfg]);
  return (
    <>
      <Section title="Discord bot" footer={
        <>
          <Button onClick={async () => { const r = await act(() => call('discord.test')); if (r) useStore.getState().toast(`Connected as ${r.bot} in ${r.guild}`, 'success'); }}>Test connection</Button>
          <Button variant="primary" onClick={async () => { await act(() => call('discord.saveConfig', { botToken: f.botToken || undefined, guildId: f.guildId, adminChannelId: f.adminChannelId || undefined }), 'Discord saved'); setF({ ...f, botToken: '' }); refetch(); }}>Save</Button>
        </>
      }>
        <p className="text-sm text-ink3">Uses the official Discord REST API with your bot token (stored encrypted). Importing members requires the Server Members intent. You can reuse the SlayerBot application or create a separate one.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Bot token" hint={cfg?.hasToken ? 'A token is saved — leave blank to keep it.' : undefined}><Input type="password" value={f.botToken} onChange={(e) => setF({ ...f, botToken: e.target.value.trim() })} /></Field>
          <Field label="Server (guild) ID"><Input value={f.guildId} onChange={(e) => setF({ ...f, guildId: e.target.value.trim() })} /></Field>
          <Field label="Private admin channel ID" hint="Order alerts only go here or to the order owner’s DMs — never public channels."><Input value={f.adminChannelId} onChange={(e) => setF({ ...f, adminChannelId: e.target.value.trim() })} /></Field>
        </div>
        <Toggle checked={draft.discordEnabled} onChange={(v) => save({ discordEnabled: v })} label="Send notifications (enable individual alerts under Activity Logs → Automations)" />
      </Section>
      <Section title="Members & mappings">
        <div className="flex flex-wrap gap-2">
          <Button icon={<RefreshCw className="size-4" />} onClick={async () => { const r = await act(() => call('discord.syncMembers')); if (r) useStore.getState().toast(`${r.total} members synced (${r.created} new)`, 'success'); }}>Sync server members</Button>
          <Button icon={<Download className="size-4" />} onClick={() => act(() => call('discord.exportMappings'), 'Mappings exported')}>Export profile ↔ Discord mappings</Button>
          <Button icon={<Upload className="size-4" />} onClick={() => useStore.getState().navigate('profiles')}>Import mappings CSV</Button>
        </div>
      </Section>
    </>
  );
}

function ShippingSettings() {
  const { data, refetch } = useQuery(() => call('shipping.providers'), []);
  const [edit, setEdit] = useState<string | null>(null);
  const [f, setF] = useState({ clientId: '', clientSecret: '', apiKey: '' });
  const act = useAction();
  return (
    <Section title="Carrier tracking APIs">
      <p className="text-sm text-ink3">Without an API, tracking comes from retailer shipping emails plus UPS / FedEx / USPS notification emails in your inboxes. Add a free Shippo API token (one token covers UPS, FedEx, USPS, DHL and more), a 17TRACK key, or a carrier's own API and GLIDE checks every undelivered package for shipped → out for delivery → delivered (hourly once it's out for delivery). GLIDE never invents milestones or ETAs.</p>
      {data?.map((p) => (
        <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-bg2/40 p-3">
          <div>
            <div className="font-medium text-ink">{p.name}</div>
            <div className="text-xs text-ink3">{p.carriers.join(', ').toUpperCase()}</div>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={p.configured ? 'good' : 'neutral'}>{p.configured ? 'Configured' : 'Not configured'}</Badge>
            <Button size="sm" onClick={() => { setEdit(p.id); setF({ clientId: '', clientSecret: '', apiKey: '' }); }}>{p.configured ? 'Update' : 'Add credentials'}</Button>
            {p.configured && <Button size="sm" variant="ghost" onClick={async () => { await act(() => call('shipping.saveProvider', p.id, null), 'Removed'); refetch(); }}>Remove</Button>}
          </div>
        </div>
      ))}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`${edit?.toUpperCase()} credentials`} footer={<Button variant="primary" onClick={async () => { await act(() => call('shipping.saveProvider', edit!, edit === 'dhl' || edit === '17track' || edit === 'shippo' ? { apiKey: f.apiKey } : { clientId: f.clientId, clientSecret: f.clientSecret }), 'Saved'); setEdit(null); refetch(); }}>Save</Button>}>
        {edit === 'dhl' || edit === '17track' || edit === 'shippo' ? (
          <Field label={edit === 'shippo' ? 'Shippo live API token (shippo_live_…, from apps.goshippo.com → Settings → API)' : edit === '17track' ? '17TRACK API key (Security key from api.17track.net)' : 'DHL API key'}><Input type="password" value={f.apiKey} onChange={(e) => setF({ ...f, apiKey: e.target.value })} /></Field>
        ) : (
          <div className="space-y-3">
            <Field label="Client ID"><Input value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })} /></Field>
            <Field label="Client secret"><Input type="password" value={f.clientSecret} onChange={(e) => setF({ ...f, clientSecret: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </Section>
  );
}

function MatchingSettings({ draft, set, save }: P) {
  return (
    <Section title="Identity matching" footer={<Button variant="primary" onClick={() => save({ autoMatchThreshold: draft.autoMatchThreshold, reviewThreshold: draft.reviewThreshold, autoLinkNewEmails: draft.autoLinkNewEmails, autoLinkEmailThreshold: draft.autoLinkEmailThreshold })}>Save</Button>}>
      <p className="text-sm text-ink3">Evidence (verified email, exclusive verified address, profile name, phone, private catch-all domain, inbox owner) combines into a confidence score. Orders are linked automatically only above the auto threshold and when no other member is close.</p>
      <Field label={`Auto-assign threshold · ${Math.round(draft.autoMatchThreshold * 100)}%`}><input type="range" min={0.7} max={0.99} step={0.01} value={draft.autoMatchThreshold} onChange={(e) => set({ autoMatchThreshold: Number(e.target.value) })} className="w-full accent-[var(--g-accent)]" /></Field>
      <Field label={`Send to review above · ${Math.round(draft.reviewThreshold * 100)}%`}><input type="range" min={0.1} max={0.8} step={0.01} value={draft.reviewThreshold} onChange={(e) => set({ reviewThreshold: Number(e.target.value) })} className="w-full accent-[var(--g-accent)]" /></Field>
      <Toggle checked={draft.autoLinkNewEmails} onChange={(v) => set({ autoLinkNewEmails: v })} label="Automatically verify new emails when the order match is near-certain" />
      {draft.autoLinkNewEmails && <Field label={`Auto-verify email threshold · ${Math.round(draft.autoLinkEmailThreshold * 100)}%`}><input type="range" min={0.9} max={0.999} step={0.001} value={draft.autoLinkEmailThreshold} onChange={(e) => set({ autoLinkEmailThreshold: Number(e.target.value) })} className="w-full accent-[var(--g-accent)]" /></Field>}
    </Section>
  );
}

function DataSettings({ draft, set, save }: P) {
  const { data: backups, refetch } = useQuery(() => call('diagnostics.backups'), []);
  const ws = useStore((s) => s.workspace);
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const act = useAction();
  return (
    <>
      <Section title="Backups" footer={<Button variant="primary" onClick={() => save({ backupIntervalHours: draft.backupIntervalHours, backupKeep: draft.backupKeep, dailyRecapTime: draft.dailyRecapTime })}>Save</Button>}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Automatic backup every (hours)"><Input type="number" min={1} value={draft.backupIntervalHours} onChange={(e) => set({ backupIntervalHours: Math.max(1, Number(e.target.value) || 24) })} /></Field>
          <Field label="Keep last"><Input type="number" min={1} value={draft.backupKeep} onChange={(e) => set({ backupKeep: Math.max(1, Number(e.target.value) || 7) })} /></Field>
          <Field label="Daily Cook Recap time" hint="Requires the Daily Cook Recap automation."><Input type="time" value={draft.dailyRecapTime ?? ''} onChange={(e) => set({ dailyRecapTime: e.target.value || null })} /></Field>
        </div>
        <div className="flex gap-2">
          <Button icon={<HardDrive className="size-4" />} onClick={async () => { await act(() => call('diagnostics.backupNow'), 'Backup created'); refetch(); }}>Back up now</Button>
          <Button icon={<Database className="size-4" />} onClick={() => act(() => call('diagnostics.exportData'), 'Data exported')}>Export all data (CSV)</Button>
        </div>
        <div className="space-y-1">
          {backups?.map((b) => (
            <div key={b.path} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-white/[0.03]">
              <span className="font-mono text-xs text-ink2">{b.name}</span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-ink3">{(b.size / 1024 / 1024).toFixed(1)} MB · {formatDateTime(b.createdAt)}</span>
                <Button size="sm" onClick={() => act(async () => { await call('diagnostics.restore', b.path); useStore.getState().bump(['all']); }, 'Restored (a pre-restore backup was kept)')}>Restore</Button>
              </span>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Danger zone">
        <p className="text-sm text-ink3">Deleting the workspace removes its database, cached images, exports, backups and encryption key from this computer.</p>
        <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)}>Delete workspace “{ws?.name}”</Button>
        <Modal open={deleting} onClose={() => setDeleting(false)} title="Delete workspace" footer={<Button variant="danger" disabled={confirm !== ws?.name} onClick={async () => { await act(() => call('workspace.delete', ws!.id), 'Workspace deleted'); setDeleting(false); useStore.getState().setWorkspace(null); }}>Delete permanently</Button>}>
          <p className="mb-3 text-sm text-ink2">Type the workspace name to confirm.</p>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={ws?.name} />
        </Modal>
      </Section>
    </>
  );
}

function ParserTemplates() {
  const { data, refetch } = useQuery(() => call('parserTemplates.list'), []);
  const { data: info } = useQuery(() => call('app.info'), [], { live: false });
  const [f, setF] = useState({ id: 0, name: '', retailerId: 'custom', senderPattern: '', subjectPattern: '', orderNumber: '', total: '', currency: '' });
  const [open, setOpen] = useState(false);
  const act = useAction();
  return (
    <Section title="Custom parsing templates">
      <p className="text-sm text-ink3">For retailers without a built-in adapter (or changed email formats). Patterns are regular expressions; the first capture group is the value. The generic extractor still finds items, addresses and tracking.</p>
      <Button icon={<Plus className="size-4" />} onClick={() => { setF({ id: 0, name: '', retailerId: 'custom', senderPattern: '', subjectPattern: '', orderNumber: '', total: '', currency: '' }); setOpen(true); }}>New template</Button>
      {data?.map((t) => {
        const rules = JSON.parse(t.rules);
        return (
          <div key={t.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-bg2/40 p-3 text-sm">
            <div><div className="font-medium text-ink">{t.name}</div><div className="font-mono text-xs text-ink3">from /{t.senderPattern}/ → {t.retailerId}</div></div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => { setF({ id: t.id, name: t.name, retailerId: t.retailerId, senderPattern: t.senderPattern, subjectPattern: t.subjectPattern ?? '', orderNumber: rules.orderNumber ?? '', total: rules.total ?? '', currency: rules.currency ?? '' }); setOpen(true); }}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={async () => { await call('parserTemplates.delete', t.id); refetch(); }}>Delete</Button>
            </div>
          </div>
        );
      })}
      <Modal open={open} onClose={() => setOpen(false)} title="Parsing template" width={620} footer={<Button variant="primary" disabled={!f.name || !f.senderPattern} onClick={async () => {
        await act(() => call('parserTemplates.save', { id: f.id || undefined, name: f.name, retailerId: f.retailerId, senderPattern: f.senderPattern, subjectPattern: f.subjectPattern || undefined, rules: { orderNumber: f.orderNumber || undefined, total: f.total || undefined, currency: f.currency || undefined } }), 'Template saved');
        setOpen(false);
        refetch();
      }}>Save</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Retailer"><Select className="w-full" value={f.retailerId} onChange={(e) => setF({ ...f, retailerId: e.target.value })}>{info?.retailers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
          <Field label="Sender pattern" hint="e.g. @shop\.example\.com$"><Input value={f.senderPattern} onChange={(e) => setF({ ...f, senderPattern: e.target.value })} /></Field>
          <Field label="Subject pattern (optional)"><Input value={f.subjectPattern} onChange={(e) => setF({ ...f, subjectPattern: e.target.value })} /></Field>
          <Field label="Order number pattern" hint="e.g. Order\s*#\s*(\d+)"><Input value={f.orderNumber} onChange={(e) => setF({ ...f, orderNumber: e.target.value })} /></Field>
          <Field label="Total pattern (optional)"><Input value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} /></Field>
          <Field label="Currency (optional)"><Input value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} placeholder="USD" /></Field>
        </div>
      </Modal>
    </Section>
  );
}

function About() {
  const { data: stats } = useQuery(() => call('diagnostics.stats'), []);
  const { data: info } = useQuery(() => call('app.info'), [], { live: false });
  return (
    <>
      <Section title="GLIDE">
        <KV k="Version" v={info?.version} />
        <KV k="Electron" v={info?.electron} />
        <KV k="Platform" v={info?.platform} />
        <KV k="MP4 export" v={info?.ffmpeg ? 'ffmpeg found' : 'ffmpeg not found (GIF still available)'} />
        <KV k="Workspace" v={stats?.isSample ? <Badge tone="warn">Sample workspace</Badge> : 'Production'} />
        <KV k="Database" v={<span className="font-mono text-xs">{stats?.dbPath}</span>} />
        <KV k="Database size" v={stats ? `${(stats.dbBytes / 1024 / 1024).toFixed(1)} MB` : '—'} />
      </Section>
      <Section title="Record counts">
        <div className="grid gap-x-8 sm:grid-cols-2">{stats && Object.entries(stats.counts).map(([k, v]) => <KV key={k} k={k.replace(/_/g, ' ')} v={formatNumber(v)} mono />)}</div>
      </Section>
      <Section title="Security">
        <div className="flex items-start gap-3 text-sm text-ink2"><ShieldCheck className="mt-0.5 size-5 text-good" /><span>Passwords, OAuth tokens, bot tokens and carrier keys are encrypted with a workspace key sealed by your operating system’s credential store. The renderer is sandboxed with a strict Content Security Policy; remote images inside stored emails are never loaded.</span></div>
      </Section>
    </>
  );
}

export { Textarea };

function Updates() {
  const { data, refetch } = useQuery(() => call('updates.state'), []);
  const [checking, setChecking] = useState(false);
  const act = useAction();
  const label: Record<string, string> = {
    idle: 'Not checked yet', checking: 'Checking…', available: `Version ${data?.version} found — downloading`, downloading: `Downloading ${data?.version ?? ''} (${data?.percent ?? 0}%)`,
    ready: `Version ${data?.version} downloaded — restart to install`, none: 'You have the latest version', error: `Update check failed: ${data?.error ?? ''}`,
  };
  return (
    <Section title="Updates">
      <p className="text-sm text-ink3">GLIDE checks GitHub Releases for new versions when it starts and every 6 hours, downloads them in the background and installs them the next time it restarts.</p>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-bg2/40 p-3 text-sm">
        <div>
          <div className="text-ink">Installed version <span className="font-mono">{data?.current ?? '—'}</span></div>
          <div className="text-xs text-ink3">{data?.packaged === false ? 'Development build — updates are only checked in the installed app.' : label[data?.status ?? 'idle']}</div>
        </div>
        <div className="flex gap-2">
          {data?.status === 'ready' && <Button variant="primary" onClick={() => void call('updates.install')}>Restart to update</Button>}
          <Button busy={checking} onClick={async () => { setChecking(true); await act(() => call('updates.check')); setChecking(false); refetch(); }}>Check for updates</Button>
        </div>
      </div>
    </Section>
  );
}
