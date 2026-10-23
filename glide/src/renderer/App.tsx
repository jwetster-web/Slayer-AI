import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Info, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { call, onEvent } from './lib/api';
import { useStore } from './lib/store';
import { Shell } from './components/Shell';
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

  useEffect(() => {
    (async () => {
      try {
        const ws = await call('workspace.current');
        useStore.getState().setWorkspace(ws);
        if (ws) useStore.getState().setSettings(await call('settings.get'));
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
