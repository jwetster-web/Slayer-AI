import { AnimatePresence, motion } from 'motion/react';
import {
  Activity, BarChart3, Boxes, ChevronDown, Fingerprint, Gauge, Inbox, LayoutDashboard, ListOrdered, Moon, Radar, ScrollText, Search, Settings, Sparkles, Sun, Truck, Users, UserSquare2,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { relativeTime } from '../../shared/format';
import { call } from '../lib/api';
import { useAction, useQuery } from '../lib/hooks';
import { useStore, type PageId } from '../lib/store';
import { Aurora, ParticleField } from './fx';
import { Badge, cx } from './ui';

const NAV: { id: PageId; label: string; icon: ReactNode; group?: string }[] = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="size-[18px]" /> },
  { id: 'orders', label: 'Live Orders', icon: <ListOrdered className="size-[18px]" /> },
  { id: 'timeline', label: 'Order Timeline', icon: <Radar className="size-[18px]" /> },
  { id: 'members', label: 'Members', icon: <Users className="size-[18px]" />, group: 'People' },
  { id: 'profiles', label: 'Buying Profiles', icon: <UserSquare2 className="size-[18px]" /> },
  { id: 'identity', label: 'Identity Review', icon: <Fingerprint className="size-[18px]" /> },
  { id: 'accounts', label: 'Email Accounts', icon: <Inbox className="size-[18px]" />, group: 'Operations' },
  { id: 'shipping', label: 'Shipping Tracker', icon: <Truck className="size-[18px]" /> },
  { id: 'catalog', label: 'Product Catalog', icon: <Boxes className="size-[18px]" /> },
  { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="size-[18px]" />, group: 'Insight' },
  { id: 'studio', label: 'Cook Export Studio', icon: <Sparkles className="size-[18px]" /> },
  { id: 'logs', label: 'Activity Logs', icon: <ScrollText className="size-[18px]" /> },
  { id: 'settings', label: 'Settings', icon: <Settings className="size-[18px]" /> },
];

function Sidebar() {
  const page = useStore((s) => s.page);
  const navigate = useStore((s) => s.navigate);
  const settings = useStore((s) => s.settings);
  const { data: disc } = useQuery(() => call('identity.discovery'), []);
  const { data: logo } = useQuery(() => call('settings.getLogo'), []);
  return (
    <aside className="relative z-10 flex w-[248px] shrink-0 flex-col border-r border-line bg-bg2/40 backdrop-blur-xl">
      <div className="drag-region flex items-center gap-3 px-5 pb-5 pt-7">
        {logo ? (
          <img src={logo} className="size-10 rounded-xl object-cover" alt="" />
        ) : (
          <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-accent via-violet to-magenta font-display text-lg font-bold text-white shadow-[0_0_24px_-4px_var(--g-accent)]">G</div>
        )}
        <div className="min-w-0">
          <div className="font-display text-[19px] font-bold leading-none tracking-[0.18em] text-ink">GLIDE</div>
          <div className="mt-1 truncate text-[11px] text-ink3">{settings?.brandName ?? 'PokeSlayerz'} · {settings?.brandTagline ?? 'Order Command Center'}</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {NAV.map((n) => (
          <div key={n.id}>
            {n.group && <div className="mb-1.5 mt-4 px-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-ink3/80">{n.group}</div>}
            <button
              onClick={() => navigate(n.id)}
              className={cx('focus-ring group relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-medium transition', page === n.id ? 'text-ink' : 'text-ink3 hover:bg-white/[0.035] hover:text-ink2')}
            >
              {page === n.id && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl border border-accent/30 bg-gradient-to-r from-accent/20 to-violet/5 shadow-[0_0_20px_-8px_var(--g-accent)]" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
              <span className={cx('relative transition', page === n.id ? 'text-accent' : 'group-hover:text-ink2')}>{n.icon}</span>
              <span className="relative flex-1 text-left">{n.label}</span>
              {n.id === 'identity' && !!disc?.pendingReviews && <span className="relative rounded-md bg-warn/20 px-1.5 text-[11px] font-bold text-warn">{disc.pendingReviews}</span>}
            </button>
          </div>
        ))}
      </nav>
      <SyncFooter />
    </aside>
  );
}

function SyncFooter() {
  const { data: h } = useQuery(() => call('sync.health'), [], { intervalMs: 15000 });
  const progress = useSyncProgress();
  const navigate = useStore((s) => s.navigate);
  const healthy = h && h.accounts > 0 && h.healthyAccounts === h.accounts;
  const color = !h || h.accounts === 0 ? 'var(--g-ink3)' : h.paused ? 'var(--g-warn)' : healthy ? 'var(--g-good)' : 'var(--g-serious)';
  return (
    <button onClick={() => navigate('accounts')} className="focus-ring m-3 rounded-xl border border-line bg-panel/60 p-3 text-left transition hover:border-accent/30">
      <div className="flex items-center gap-2 text-xs font-semibold text-ink2">
        <span className="pulse-dot size-2 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
        {!h || h.accounts === 0 ? 'No inboxes connected' : h.paused ? 'Sync paused' : progress ? `Syncing ${progress}` : `${h.healthyAccounts}/${h.accounts} inboxes healthy`}
      </div>
      <div className="mt-1 text-[11px] text-ink3">
        Last sync {relativeTime(h?.lastSyncAt)} · {h?.throughputPerMin ?? 0}/min
      </div>
    </button>
  );
}

function useSyncProgress() {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const off = window.glide?.on((e: any) => {
      if (e.kind === 'progress' && e.progress.phase !== 'done' && e.progress.phase !== 'error') {
        setLabel(e.progress.accountLabel);
        clearTimeout(t);
        t = setTimeout(() => setLabel(null), 8000);
      } else if (e.kind === 'progress') setLabel(null);
    });
    return () => {
      off?.();
      clearTimeout(t);
    };
  }, []);
  return label;
}

function GlobalSearch() {
  const navigate = useStore((s) => s.navigate);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  return (
    <form
      className="no-drag relative w-full max-w-xl"
      onSubmit={(e) => {
        e.preventDefault();
        navigate('orders', { orderFilter: { search: q } });
      }}
    >
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink3" />
      <input
        ref={ref}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search orders, members, products, tracking numbers…"
        className="focus-ring h-10 w-full rounded-xl border border-line bg-bg2/70 pl-10 pr-16 text-sm text-ink placeholder:text-ink3 focus:border-accent/50"
      />
      <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-ink3">⌘K</kbd>
    </form>
  );
}

function WorkspaceMenu() {
  const ws = useStore((s) => s.workspace);
  const [open, setOpen] = useState(false);
  const { data: list } = useQuery(() => call('workspace.list'), [open]);
  const act = useAction();
  return (
    <div className="no-drag relative">
      <button onClick={() => setOpen(!open)} className="focus-ring flex h-10 items-center gap-2 rounded-xl border border-line bg-panel2 px-3 text-sm text-ink hover:border-accent/40">
        <span className="max-w-[160px] truncate">{ws?.name ?? 'Workspace'}</span>
        {ws?.isSample && <Badge tone="warn">SAMPLE</Badge>}
        <ChevronDown className="size-4 text-ink3" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="glass absolute right-0 top-12 z-30 w-72 rounded-xl p-2" onMouseLeave={() => setOpen(false)}>
            <div className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-widest text-ink3">Workspaces</div>
            {list?.map((w) => (
              <button
                key={w.id}
                onClick={async () => {
                  setOpen(false);
                  await act(async () => {
                    const info = await call('workspace.open', w.id);
                    useStore.getState().setWorkspace(info);
                    useStore.getState().setSettings(await call('settings.get'));
                    useStore.getState().bump(['all']);
                  });
                }}
                className={cx('flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm hover:bg-white/5', w.id === ws?.id && 'bg-accent/10 text-ink')}
              >
                <span className="truncate">{w.name}</span>
                {w.isSample && <Badge tone="warn">SAMPLE</Badge>}
              </button>
            ))}
            <div className="my-1 border-t border-line" />
            <button onClick={() => (setOpen(false), useStore.getState().setWorkspace(null))} className="w-full rounded-lg px-2.5 py-2 text-left text-sm text-accent hover:bg-white/5">
              + New workspace…
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ThemeToggle() {
  const settings = useStore((s) => s.settings);
  const act = useAction();
  const dark = (settings?.theme ?? 'dark') === 'dark';
  return (
    <button
      aria-label="Toggle theme"
      onClick={() => act(async () => useStore.getState().setSettings(await call('settings.update', { theme: dark ? 'light' : 'dark' })))}
      className="no-drag focus-ring grid size-10 place-items-center rounded-xl border border-line bg-panel2 text-ink2 hover:text-ink"
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const ws = useStore((s) => s.workspace);
  const page = useStore((s) => s.page);
  return (
    <div className="relative flex h-full overflow-hidden bg-bg">
      <Aurora />
      <ParticleField />
      <Sidebar />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="drag-region flex h-[68px] shrink-0 items-center gap-4 border-b border-line/70 bg-bg/30 px-7 backdrop-blur-xl">
          <GlobalSearch />
          <div className="flex-1" />
          {ws?.isSample && (
            <div className="no-drag hidden items-center gap-2 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-xs font-semibold text-warn lg:flex">
              <Gauge className="size-4" /> Sample data — not real orders
            </div>
          )}
          <LiveDot />
          <ThemeToggle />
          <WorkspaceMenu />
        </header>
        <main className="relative flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div key={page} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }} className="mx-auto max-w-[1600px] px-7 py-7">
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

function LiveDot() {
  const [flash, setFlash] = useState(0);
  useEffect(() => window.glide?.on((e: any) => e.kind === 'dataChanged' && setFlash((f) => f + 1)), []);
  return (
    <div className="no-drag flex items-center gap-2 text-xs text-ink3" title="Live updates">
      <motion.span key={flash} initial={{ scale: 1.8, opacity: 0.4 }} animate={{ scale: 1, opacity: 1 }} className="size-2 rounded-full bg-good shadow-[0_0_10px_var(--g-good)]" />
      <Activity className="size-4" />
    </div>
  );
}
