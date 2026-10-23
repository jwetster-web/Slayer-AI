import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { AlertTriangle, Ban, CheckCircle2, CircleDot, Clock, Loader2, PackageCheck, PauseCircle, RotateCcw, Truck, X, XCircle } from 'lucide-react';
import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import type { CancelState, FulfillmentStatus, MatchStatus, PackageStatus, ReviewStatus } from '../../shared/types';
import { usePrefersReducedMotion } from '../lib/hooks';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Card({ className, children, glow, onClick }: { className?: string; children: ReactNode; glow?: boolean; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={cx('glass rounded-2xl', glow && 'edge-glow', onClick && 'cursor-pointer transition hover:border-accent/40', className)}>
      {children}
    </div>
  );
}

export function SectionTitle({ title, subtitle, right, icon }: { title: string; subtitle?: string; right?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div className="flex items-center gap-2.5">
        {icon && <span className="text-accent">{icon}</span>}
        <div>
          <h3 className="font-display text-[15px] font-semibold tracking-wide text-ink">{title}</h3>
          {subtitle && <p className="text-xs text-ink3">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

export function PageHeader({ title, subtitle, right, eyebrow }: { title: string; subtitle?: string; right?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.25em] text-accent">{eyebrow}</div>}
        <h1 className="font-display text-[28px] font-bold leading-tight tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-ink2">{subtitle}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'subtle' | 'danger'; size?: 'sm' | 'md'; icon?: ReactNode; busy?: boolean };

export function Button({ variant = 'subtle', size = 'md', icon, busy, className, children, disabled, ...rest }: BtnProps) {
  const base = 'focus-ring inline-flex items-center justify-center gap-2 rounded-xl font-medium transition disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap';
  const sizes = { sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 text-sm' };
  const variants = {
    primary: 'bg-gradient-to-r from-accent to-violet text-white shadow-[0_8px_24px_-8px_var(--g-accent)] hover:brightness-110',
    ghost: 'text-ink2 hover:bg-white/5 hover:text-ink',
    subtle: 'border border-line bg-panel2 text-ink hover:border-accent/40 hover:bg-panel',
    danger: 'border border-bad/40 bg-bad/10 text-bad hover:bg-bad/20',
  };
  return (
    <button className={cx(base, sizes[size], variants[variant], className)} disabled={disabled || busy} {...rest}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx('focus-ring h-10 w-full rounded-xl border border-line bg-bg2/60 px-3 text-sm text-ink placeholder:text-ink3 transition focus:border-accent/60', className)} {...rest} />;
}

export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx('focus-ring w-full rounded-xl border border-line bg-bg2/60 p-3 text-sm text-ink placeholder:text-ink3 focus:border-accent/60', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx('focus-ring h-10 rounded-xl border border-line bg-bg2 px-3 text-sm text-ink', className)} {...rest}>
      {children}
    </select>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink3">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink3">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className="focus-ring inline-flex items-center gap-3 text-sm text-ink2 disabled:opacity-50">
      <span className={cx('relative h-6 w-11 rounded-full border transition', checked ? 'border-accent bg-accent/70' : 'border-line bg-panel2')}>
        <span className={cx('absolute top-0.5 size-[18px] rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </span>
      {label}
    </button>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: string; count?: number }[] }) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-bg2/60 p-1">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)} className={cx('focus-ring relative rounded-lg px-3.5 py-1.5 text-sm font-medium transition', value === t.id ? 'text-ink' : 'text-ink3 hover:text-ink2')}>
          {value === t.id && <motion.span layoutId={`tab-${tabs.map((x) => x.id).join('')}`} className="absolute inset-0 rounded-lg bg-panel2 shadow-inner" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
          <span className="relative">
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 rounded-md bg-accent/20 px-1.5 text-[11px] text-accent">{t.count}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'good' | 'warn' | 'bad' | 'violet' | 'serious'; className?: string }) {
  const tones = {
    neutral: 'border-line bg-panel2 text-ink2',
    accent: 'border-accent/40 bg-accent/12 text-accent',
    good: 'border-good/40 bg-good/12 text-good',
    warn: 'border-warn/40 bg-warn/12 text-warn',
    serious: 'border-serious/40 bg-serious/12 text-serious',
    bad: 'border-bad/40 bg-bad/12 text-bad',
    violet: 'border-violet/40 bg-violet/15 text-violet',
  };
  return <span className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold', tones[tone], className)}>{children}</span>;
}

const FULFILLMENT: Record<FulfillmentStatus, { label: string; tone: Parameters<typeof Badge>[0]['tone']; icon: ReactNode }> = {
  ordered: { label: 'Ordered', tone: 'accent', icon: <CircleDot className="size-3" /> },
  processing: { label: 'Processing', tone: 'accent', icon: <Clock className="size-3" /> },
  backordered: { label: 'Backordered', tone: 'warn', icon: <Clock className="size-3" /> },
  partially_shipped: { label: 'Partially shipped', tone: 'violet', icon: <Truck className="size-3" /> },
  shipped: { label: 'Shipped', tone: 'violet', icon: <Truck className="size-3" /> },
  out_for_delivery: { label: 'Out for delivery', tone: 'warn', icon: <Truck className="size-3" /> },
  partially_delivered: { label: 'Partially delivered', tone: 'good', icon: <PackageCheck className="size-3" /> },
  delivered: { label: 'Delivered', tone: 'good', icon: <CheckCircle2 className="size-3" /> },
  exception: { label: 'Exception', tone: 'serious', icon: <AlertTriangle className="size-3" /> },
  delayed: { label: 'Delayed', tone: 'serious', icon: <Clock className="size-3" /> },
  canceled: { label: 'Canceled', tone: 'bad', icon: <XCircle className="size-3" /> },
  returned: { label: 'Returned', tone: 'neutral', icon: <RotateCcw className="size-3" /> },
};

export const fulfillmentLabel = (s: FulfillmentStatus) => FULFILLMENT[s]?.label ?? s;

export function StatusPill({ status, cancel, review }: { status: FulfillmentStatus; cancel?: CancelState; review?: ReviewStatus }) {
  const f = FULFILLMENT[status] ?? FULFILLMENT.ordered;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone={f.tone}>
        {f.icon}
        {f.label}
      </Badge>
      {cancel === 'partial' && (
        <Badge tone="serious">
          <Ban className="size-3" />
          Partial cancel
        </Badge>
      )}
      {review === 'hold' && (
        <Badge tone="warn">
          <PauseCircle className="size-3" />
          Review hold
        </Badge>
      )}
    </span>
  );
}

const PKG: Record<PackageStatus, { label: string; tone: Parameters<typeof Badge>[0]['tone'] }> = {
  label_created: { label: 'Label created', tone: 'neutral' },
  in_transit: { label: 'In transit', tone: 'violet' },
  out_for_delivery: { label: 'Out for delivery', tone: 'warn' },
  delivered: { label: 'Delivered', tone: 'good' },
  exception: { label: 'Exception', tone: 'serious' },
  delayed: { label: 'Delayed', tone: 'serious' },
  returned: { label: 'Returned', tone: 'neutral' },
  unknown: { label: 'Unknown', tone: 'neutral' },
};

export function PackagePill({ status }: { status: PackageStatus }) {
  const p = PKG[status] ?? PKG.unknown;
  return <Badge tone={p.tone}>{p.label}</Badge>;
}

export function MatchBadge({ status, confidence }: { status: MatchStatus; confidence: number | null }) {
  if (status === 'verified') return <Badge tone="good">Verified</Badge>;
  if (status === 'auto') return <Badge tone="accent">Auto {confidence !== null ? `${Math.round(confidence * 100)}%` : ''}</Badge>;
  if (status === 'review') return <Badge tone="warn">Review {confidence !== null ? `${Math.round(confidence * 100)}%` : ''}</Badge>;
  return <Badge tone="neutral">Unmatched</Badge>;
}

export function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.9 ? 'var(--g-good)' : value >= 0.6 ? 'var(--g-warn)' : 'var(--g-bad)';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/8">
        <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6 }} />
      </div>
      <span className="font-mono text-xs tabular text-ink2">{pct}%</span>
    </div>
  );
}

export function RetailerBadge({ name, color, short }: { name: string; color: string; short?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-ink2">
      <span className="size-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
      {short ? name.replace('Pokémon Center', 'PKC') : name}
    </span>
  );
}

const AVATAR_GRADS = ['from-[#5b8cff] to-[#8b5cf6]', 'from-[#22d3ee] to-[#5b8cff]', 'from-[#e879f9] to-[#8b5cf6]', 'from-[#34d399] to-[#22d3ee]', 'from-[#fbbf24] to-[#fb7185]', 'from-[#fb7185] to-[#e879f9]'];

export function Avatar({ name, src, size = 32 }: { name: string; src?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initials = (name.replace(/[^A-Za-z0-9 ]/g, ' ').trim().match(/[A-Z0-9]|^[a-z]/g) ?? ['?']).slice(0, 2).join('').toUpperCase();
  const grad = AVATAR_GRADS[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_GRADS.length];
  if (src && !broken && (src.startsWith('glide-img://') || src.startsWith('data:'))) return <img src={src} onError={() => setBroken(true)} className="shrink-0 rounded-full object-cover ring-1 ring-white/10" style={{ width: size, height: size }} alt="" />;
  return (
    <span className={cx('inline-grid shrink-0 place-items-center rounded-full bg-gradient-to-br font-display font-bold text-white ring-1 ring-white/10', grad)} style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials}
    </span>
  );
}

export function ProductThumb({ src, title, size = 44, className }: { src?: string | null; title?: string; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const ok = src && !broken && (src.startsWith('glide-img://') || src.startsWith('data:'));
  return (
    <div className={cx('relative shrink-0 overflow-hidden rounded-xl border border-line bg-gradient-to-br from-panel2 to-bg2', className)} style={{ width: size, height: size }} title={title}>
      {ok ? (
        <img src={src!} alt={title ?? ''} loading="lazy" onError={() => setBroken(true)} className="size-full object-contain p-0.5" />
      ) : (
        <span className="absolute inset-0 grid place-items-center font-display text-[10px] font-bold text-ink3">{(title ?? '?').replace(/^Pok[ée]mon TCG:\s*/i, '').split(' ').slice(0, 2).map((w) => w[0]).join('')}</span>
      )}
    </div>
  );
}

/** Spring-animated number that counts to its value. */
export function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const reduced = usePrefersReducedMotion();
  const mv = useMotionValue(reduced ? value : 0);
  const spring = useSpring(mv, { stiffness: 70, damping: 18, mass: 0.8 });
  const text = useTransform(spring, (v) => format(Math.round(v)));
  const [display, setDisplay] = useState(format(reduced ? value : 0));
  useEffect(() => {
    if (reduced) {
      setDisplay(format(value));
      return;
    }
    mv.set(value);
  }, [value, reduced, mv, format]);
  useEffect(() => text.on('change', (v) => setDisplay(v)), [text]);
  return <span className="tabular">{reduced ? format(value) : display}</span>;
}

export function KpiTile({ label, value, format, sub, accent = 'var(--g-accent)', icon, onClick, big }: { label: string; value: number; format: (n: number) => string; sub?: ReactNode; accent?: string; icon?: ReactNode; onClick?: () => void; big?: boolean }) {
  return (
    <Card className={cx('relative overflow-hidden p-4', onClick && 'cursor-pointer hover:-translate-y-0.5 transition')} onClick={onClick}>
      <div className="pointer-events-none absolute -right-8 -top-10 size-28 rounded-full opacity-25 blur-2xl" style={{ background: accent }} />
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink3">{label}</span>
        <span style={{ color: accent }}>{icon}</span>
      </div>
      <div className={cx('mt-2 font-display font-bold tracking-tight text-ink', big ? 'text-4xl' : 'text-[26px]')}>
        <AnimatedNumber value={value} format={format} />
      </div>
      {sub && <div className="mt-1 text-xs text-ink3">{sub}</div>}
    </Card>
  );
}

export function Empty({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && <div className="grid size-14 place-items-center rounded-2xl border border-line bg-panel2 text-accent">{icon}</div>}
      <div className="font-display text-lg font-semibold text-ink">{title}</div>
      {body && <div className="max-w-md text-sm text-ink3">{body}</div>}
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} />;
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm text-bad">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      {error}
    </div>
  );
}

export function Modal({ open, onClose, title, children, width = 560, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: number; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div
            role="dialog"
            aria-label={title}
            className="glass edge-glow flex max-h-[88vh] w-full flex-col rounded-2xl"
            style={{ maxWidth: width }}
            initial={{ y: 18, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 10, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="font-display text-lg font-semibold">{title}</h2>
              <button onClick={onClose} className="focus-ring rounded-lg p-1 text-ink3 hover:text-ink" aria-label="Close">
                <X className="size-5" />
              </button>
            </div>
            <div className="overflow-auto px-5 py-4">{children}</div>
            {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Drawer({ open, onClose, children, width = 880 }: { open: boolean; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            className="glass fixed inset-y-0 right-0 z-40 flex flex-col overflow-hidden rounded-l-3xl border-l border-line"
            style={{ width: `min(${width}px, 92vw)` }}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 36 }}
          >
            {children}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export function KV({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/60 py-2 text-sm last:border-0">
      <span className="text-ink3">{k}</span>
      <span className={cx('text-right text-ink', mono && 'font-mono text-[13px]')}>{v ?? '—'}</span>
    </div>
  );
}

export function Pager({ offset, limit, total, onChange }: { offset: number; limit: number; total: number; onChange: (o: number) => void }) {
  if (total <= limit) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-ink3">
      <span className="tabular">
        {offset + 1}–{Math.min(total, offset + limit)} of {total.toLocaleString()}
      </span>
      <Button size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
        Prev
      </Button>
      <Button size="sm" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
        Next
      </Button>
    </div>
  );
}
