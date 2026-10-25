import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Info, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { call, onEvent } from './lib/api';
import { useStore } from './lib/store';
import { Shell, WindowControls } from './components/Shell';
import { OrderDrawer } from './pages/OrderDetail';
import { MemberDrawer } from './pages/Members';
import { ProductDrawer } from './pages/Catalog';
import { Overview } from './pages/Overview';
import { Orders } from './pages/Orders';
import { CommandCenter } from './pages/CommandCenter';
import { Members } from './pages/Members';
import { Profiles } from './pages/Profiles';
import { Accounts } from './pages/Accounts';
import { Shipping } from './pages/Shipping';
import { Catalog } from './pages/Catalog';
import { Analytics } from './pages/Analytics';
import { Studio } from './pages/Studio';
import { Identity } from './pages/Identity';
import { Logs } from './pages/Logs';
import { SettingsPage } from './pages/Settings';
import { Setup } from './pages/Setup';

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[60] flex w-[380px] flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} layout initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }} onClick={() => dismiss(t.id)} className="glass pointer-events-auto flex cursor-pointer items-start gap-3 rounded-xl p-3.5 text-sm">
            {t.kind === 'success' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" /> : t.kind === 'error' ? <XCircle className="mt-0.5 size-4 shrink-0 text-bad" /> : <Info className="mt-0.5 size-4 shrink-0 text-accent" />}
            <span className="text-ink">{t.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

let audioCtx: AudioContext | null = null;
function blip() {
  try {
    audioCtx ??= new AudioContext();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1320, audioCtx.currentTime + 0.08);
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.06, audioCtx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.22);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.25);
  } catch {
    // audio unavailable
  }
}

function Page() {
  const page = useStore((s) => s.page);
  switch (page) {
    case 'overview': return <Overview />;
    case 'orders': return <Orders />;
    case 'timeline': return <CommandCenter />;
    case 'members': return <Members />;
    case 'profiles': return <Profiles />;
    case 'accounts': return <Accounts />;
    case 'shipping': return <Shipping />;
    case 'catalog': return <Catalog />;
    case 'analytics': return <Analytics />;
    case 'studio': return <Studio />;
    case 'identity': return <Identity />;
    case 'logs': return <Logs />;
    case 'settings': return <SettingsPage />;
  }
}

export function App() {
  const workspace = useStore((s) => s.workspace);
  const settings = useStore((s) => s.settings);
  const [booted, setBooted] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const ws = await call('workspace.current');
        useStore.getState().setWorkspace(ws);
        if (ws) useStore.getState().setSettings(await call('settings.get'));
        else if ((await call('workspace.list')).length) setOpenError((await call('workspace.startupError')) ?? 'GLIDE could not open your last workspace.');
      } finally {
        setBooted(true);
      }
    })();
    return onEvent((e) => {
      if (e.kind === 'dataChanged') {
        useStore.getState().bump(e.scope ?? []);
        if (useStore.getState().settings?.soundEffects && (e.scope ?? []).includes('orders')) blip();
      }
    });
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings?.theme ?? 'dark';
    root.dataset.motion = settings?.reducedMotion === 'on' ? 'off' : 'on';
    if (settings?.accentColor && /^#[0-9a-f]{6}$/i.test(settings.accentColor)) root.style.setProperty('--g-accent', settings.accentColor);
  }, [settings]);

  if (!booted) return <div className="grid h-full place-items-center bg-bg font-display text-2xl tracking-[0.4em] text-ink3">GLIDE</div>;
  if (!workspace && openError) return (
    <>
      <OpenFailed error={openError} onOpened={() => setOpenError(null)} />
      <Toasts />
    </>
  );
  if (!workspace || !workspace.setupComplete) return (
    <>
      <Setup />
      <Toasts />
    </>
  );
  return (
    <>
      <Shell>
        <Page />
      </Shell>
      <OrderDrawer />
      <MemberDrawer />
      <ProductDrawer />
      <Toasts />
    </>
  );
}

/** Shown when existing workspaces could not be opened at startup — instead of the first-run setup. */
function OpenFailed({ error, onOpened }: { error: string; onOpened: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState(error);
  const [list, setList] = useState<{ id: string; name: string; isSample: boolean }[]>([]);
  useEffect(() => void call('workspace.list').then(setList), []);
  const finish = async (ws: Awaited<ReturnType<typeof call<'workspace.current'>>>) => {
    useStore.getState().setWorkspace(ws);
    useStore.getState().setSettings(await call('settings.get'));
    useStore.getState().bump(['all']);
    onOpened();
  };
  const retry = async () => {
    setBusy('retry');
    try {
      const ws = await call('workspace.retryOpen');
      if (ws) await finish(ws);
      else setErr((await call('workspace.startupError')) ?? 'Still could not open the workspace.');
    } finally {
      setBusy(null);
    }
  };
  const open = async (id: string) => {
    setBusy(id);
    try {
      await call('workspace.open', id);
      await finish(await call('workspace.current'));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="relative grid h-full place-items-center bg-bg p-8">
      <div className="drag-region absolute inset-x-0 top-0 z-20 flex h-12 items-center justify-end pr-2">
        <WindowControls className="border-l-0" />
      </div>
      <div className="glass w-full max-w-lg space-y-4 rounded-2xl p-6">
        <div className="font-display text-xl font-semibold text-ink">Couldn’t open your workspace</div>
        <p className="text-sm text-ink2">Your data is safe — GLIDE just couldn’t open it on startup. This usually clears up on a retry (for example right after an update, while the previous version is still closing).</p>
        <div className="rounded-xl border border-bad/30 bg-bad/10 p-3 font-mono text-xs text-bad">{err}</div>
        <div className="flex flex-wrap gap-2">
          <button onClick={retry} disabled={!!busy} className="focus-ring rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === 'retry' ? 'Retrying…' : 'Retry'}</button>
          {list.map((w) => (
            <button key={w.id} onClick={() => open(w.id)} disabled={!!busy} className="focus-ring rounded-xl border border-line px-4 py-2 text-sm text-ink hover:border-accent/50 disabled:opacity-50">{busy === w.id ? 'Opening…' : `Open ${w.name}`}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
