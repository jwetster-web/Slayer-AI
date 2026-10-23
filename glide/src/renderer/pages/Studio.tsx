import { AnimatePresence, motion } from 'motion/react';
import { BarChart3, Calendar, Copy, Crown, Download, FolderOpen, Image as ImageIcon, LayoutGrid, Plus, Rocket, Save, Sparkles, Store, Trash2, Truck, Type, Wand2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatCents, formatNumber, formatPct } from '../../shared/format';
import type { CustomElement, CustomProject, TemplateId } from '../../core/export/templates';
import { call } from '../lib/api';
import { useAction, useDebounced, useQuery } from '../lib/hooks';
import { RANGE_LABEL, rangeFilter, type RangeId } from '../lib/ranges';
import { useStore } from '../lib/store';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Skeleton, Tabs, Toggle, cx } from '../components/ui';

const ICONS: Record<TemplateId, ReactNode> = {
  galactic: <Sparkles className="size-5" />,
  legendary: <Crown className="size-5" />,
  wall: <LayoutGrid className="size-5" />,
  leaderboard: <BarChart3 className="size-5" />,
  retailers: <Store className="size-5" />,
  shipments: <Truck className="size-5" />,
  custom: <Wand2 className="size-5" />,
};

type Format = 'png' | 'jpg' | 'webp' | 'pdf' | 'gif' | 'mp4';

const designSize = (w: number, h: number) => {
  const z = Math.min(w, h) / 1080;
  return { w: Math.round(w / z), h: Math.round(h / z) };
};

export function Studio() {
  const [tpl, setTpl] = useState<TemplateId>('galactic');
  const [canvas, setCanvas] = useState('square');
  const [size, setSize] = useState({ w: 1080, h: 1080 });
  const [range, setRange] = useState<RangeId>('today');
  const [custom, setCustom] = useState<{ from?: string; to?: string }>({});
  const [dropWindow, setDropWindow] = useState({ from: '', to: '' });
  const [opts, setOpts] = useState({ headline: 'net' as 'net' | 'gross', transparent: false, watermark: 'bottom-right', maxProducts: 0, showTitles: true, title: '', masked: false, dateLabel: '' });
  const [format, setFormat] = useState<Format>('png');
  const [project, setProject] = useState<CustomProject | null>(null);
  const [presetName, setPresetName] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);
  const act = useAction();
  const { data: templates } = useQuery(() => call('exports.templates'), [], { live: false });
  const { data: presets, refetch: refetchPresets } = useQuery(() => call('exports.canvasPresets'), [], { live: false });
  const { data: saved, refetch: refetchSaved } = useQuery(() => call('exports.presets'), []);
  const { data: info } = useQuery(() => call('app.info'), [], { live: false });
  const { data: history, refetch: refetchHistory } = useQuery(() => call('exports.history'), []);
  const [exporting, setExporting] = useState(false);

  const filter = useMemo(() => {
    if (range === 'custom' && dropWindow.from) return { from: new Date(dropWindow.from).toISOString(), to: dropWindow.to ? new Date(dropWindow.to).toISOString() : undefined };
    return rangeFilter(range, custom);
  }, [range, custom, dropWindow]);
  const dateLabel = opts.dateLabel || (range === 'today' ? new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : undefined);
  const request = useMemo(
    () => ({
      template: tpl,
      width: size.w,
      height: size.h,
      options: { headline: opts.headline, transparent: opts.transparent, watermark: opts.watermark as never, maxProducts: opts.maxProducts || undefined, showTitles: opts.showTitles, title: opts.title || undefined },
      custom: tpl === 'custom' ? project ?? undefined : undefined,
    }),
    [tpl, size, opts, project],
  );
  const recap = useMemo(() => ({ maskNames: opts.masked, dateLabel }), [opts.masked, dateLabel]);
  const debReq = useDebounced(request, 180);
  const { data: preview, loading } = useQuery(() => call('exports.preview', debReq, filter, recap), [debReq, filter, recap]);

  useEffect(() => {
    const p = presets?.find((x) => x.id === canvas);
    if (p) setSize({ w: p.width, h: p.height });
  }, [canvas, presets]);
  useEffect(() => {
    if (tpl !== 'custom') return;
    const ds = designSize(size.w, size.h);
    if (!project || project.width !== ds.w || project.height !== ds.h) {
      if (project) setProject({ ...project, width: ds.w, height: ds.h });
      else call('exports.defaultProject', ds.w, ds.h).then(setProject);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpl, size]);

  const doExport = async () => {
    setExporting(true);
    const isMp4 = format === 'mp4';
    const r = await act(() => call('exports.render', { ...request, format: isMp4 ? 'png' : format, mp4: isMp4 }, filter, recap), undefined);
    setExporting(false);
    if (r) {
      useStore.getState().toast(`Saved ${(r as { path: string }).path.split(/[\\/]/).pop()}`, 'success');
      refetchHistory();
    }
  };
  const dailyRecap = async () => {
    setExporting(true);
    const day = new Date().toISOString().slice(0, 10);
    const r = await act(() => call('exports.dailyRecap', day));
    setExporting(false);
    if (r) {
      useStore.getState().toast('Daily Cook Recap saved to the workspace exports folder', 'success');
      call('app.showItem', (r as { path: string }).path);
      refetchHistory();
    }
  };

  const tdef = templates?.find((t) => t.id === tpl);
  const k = preview?.kpis;

  return (
    <div>
      <PageHeader eyebrow="Flagship" title="Cook Export Studio" subtitle="Share-ready graphics built only from recorded orders. Vector templates are rendered at the exact output resolution — crisp at 4K." right={
        <>
          <Button icon={<Rocket className="size-4" />} busy={exporting} onClick={dailyRecap}>One-click Daily Cook Recap</Button>
          <Button variant="primary" icon={<Download className="size-4" />} busy={exporting} onClick={doExport}>Export {format.toUpperCase()}</Button>
        </>
      } />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {templates?.map((t) => (
          <motion.button key={t.id} whileHover={{ y: -2 }} onClick={() => setTpl(t.id)} className={cx('glass rounded-2xl p-3.5 text-left transition', tpl === t.id ? 'border-accent/70 shadow-[0_0_30px_-10px_var(--g-accent)]' : 'hover:border-accent/30')}>
            <div className={cx('mb-2 grid size-9 place-items-center rounded-xl', tpl === t.id ? 'bg-gradient-to-br from-accent to-violet text-white' : 'bg-panel2 text-accent')}>{ICONS[t.id]}</div>
            <div className="text-[13px] font-semibold leading-tight text-ink">{t.name}</div>
          </motion.button>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <Card className="space-y-3 p-4">
            <div className="text-xs font-semibold uppercase tracking-widest text-ink3">Data</div>
            <Field label="Reporting range">
              <Select className="w-full" value={range} onChange={(e) => setRange(e.target.value as RangeId)}>
                {(['today', 'yesterday', '7d', '30d', '90d', 'all', 'custom'] as RangeId[]).map((r) => <option key={r} value={r}>{r === 'custom' ? 'Drop window (custom)' : RANGE_LABEL[r]}</option>)}
              </Select>
            </Field>
            {range === 'custom' && (
              <div className="grid grid-cols-1 gap-2">
                <Field label="Drop starts"><Input type="datetime-local" value={dropWindow.from} onChange={(e) => setDropWindow({ ...dropWindow, from: e.target.value })} /></Field>
                <Field label="Drop ends"><Input type="datetime-local" value={dropWindow.to} onChange={(e) => setDropWindow({ ...dropWindow, to: e.target.value })} /></Field>
              </div>
            )}
            <Field label="Date label on graphic"><Input value={opts.dateLabel} onChange={(e) => setOpts({ ...opts, dateLabel: e.target.value })} placeholder="Auto" /></Field>
            <Field label="Headline value">
              <Tabs value={opts.headline} onChange={(v) => setOpts({ ...opts, headline: v })} tabs={[{ id: 'net', label: 'Net secured' }, { id: 'gross', label: 'Gross' }]} />
            </Field>
            {k && (
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-bg2/40 p-3 text-xs">
                <span className="text-ink3">Orders</span><span className="text-right font-mono text-ink">{formatNumber(k.orders)}</span>
                <span className="text-ink3">Live</span><span className="text-right font-mono text-ink">{formatNumber(k.liveOrders)}</span>
                <span className="text-ink3">Success</span><span className="text-right font-mono text-ink">{formatPct(k.successRate)}</span>
                <span className="text-ink3">{opts.headline === 'net' ? 'Net' : 'Gross'}</span><span className="text-right font-mono text-ink">{formatCents(opts.headline === 'net' ? k.netCents : k.grossCents, k.currency)}</span>
                <span className="text-ink3">Products</span><span className="text-right font-mono text-ink">{preview?.products}</span>
              </div>
            )}
          </Card>
          <Card className="space-y-3 p-4">
            <div className="text-xs font-semibold uppercase tracking-widest text-ink3">Canvas & format</div>
            <Field label="Size">
              <Select className="w-full" value={canvas} onChange={(e) => setCanvas(e.target.value)}>
                {['Discord', 'X', 'Instagram', 'Desktop'].map((g) => (
                  <optgroup key={g} label={g}>{presets?.filter((p) => p.group === g).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>
                ))}
                <option value="custom">Custom size…</option>
              </Select>
            </Field>
            {canvas === 'custom' && (
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" value={size.w} min={320} max={7680} onChange={(e) => setSize({ ...size, w: Math.max(320, Math.min(7680, Number(e.target.value) || 1080)) })} />
                <Input type="number" value={size.h} min={320} max={7680} onChange={(e) => setSize({ ...size, h: Math.max(320, Math.min(7680, Number(e.target.value) || 1080)) })} />
              </div>
            )}
            <Field label="Format">
              <Select className="w-full" value={format} onChange={(e) => setFormat(e.target.value as Format)}>
                <option value="png">PNG (lossless)</option>
                <option value="jpg">JPG</option>
                <option value="webp">WebP</option>
                <option value="pdf">PDF</option>
                <option value="gif">Animated GIF (counting recap)</option>
                <option value="mp4" disabled={!info?.ffmpeg}>MP4 animation{info?.ffmpeg ? '' : ' — needs ffmpeg on PATH'}</option>
              </Select>
            </Field>
            {tdef?.supportsTransparent && <Toggle checked={opts.transparent} onChange={(v) => setOpts({ ...opts, transparent: v })} label="Transparent background (PNG/WebP)" />}
          </Card>
          <Card className="space-y-3 p-4">
            <div className="text-xs font-semibold uppercase tracking-widest text-ink3">Style & privacy</div>
            <Field label="Title override"><Input value={opts.title} onChange={(e) => setOpts({ ...opts, title: e.target.value })} placeholder={tdef?.name} /></Field>
            <Field label="Watermark">
              <Select className="w-full" value={opts.watermark} onChange={(e) => setOpts({ ...opts, watermark: e.target.value })}>
                <option value="bottom-right">Bottom right</option>
                <option value="bottom-left">Bottom left</option>
                <option value="top-right">Top right</option>
                <option value="top-left">Top left</option>
                <option value="none">None</option>
              </Select>
            </Field>
            <Field label="Max products (0 = auto)"><Input type="number" min={0} max={400} value={opts.maxProducts} onChange={(e) => setOpts({ ...opts, maxProducts: Number(e.target.value) || 0 })} /></Field>
            <Toggle checked={opts.showTitles} onChange={(v) => setOpts({ ...opts, showTitles: v })} label="Product titles under tiles" />
            <Toggle checked={opts.masked} onChange={(v) => setOpts({ ...opts, masked: v })} label="Masked member names (no avatars)" />
            <p className="text-[11px] text-ink3">Brand name, tagline, accent color and logo come from Settings → Branding. Addresses, emails, order and tracking numbers never appear on exports.</p>
          </Card>
          <Card className="space-y-2 p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-widest text-ink3">Presets</div>
              <Button size="sm" icon={<Save className="size-3.5" />} onClick={() => setSavingPreset(true)}>Save</Button>
            </div>
            {saved?.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
                <button className="truncate text-left text-ink2 hover:text-accent" onClick={() => {
                  const o = p.options as Record<string, unknown>;
                  setTpl(p.template as TemplateId);
                  if (o.size) setSize(o.size as { w: number; h: number });
                  if (o.canvas) setCanvas(o.canvas as string);
                  if (o.opts) setOpts({ ...opts, ...(o.opts as typeof opts) });
                  if (o.format) setFormat(o.format as Format);
                  if (o.project) setProject(o.project as CustomProject);
                }}>{p.name} <span className="text-ink3">· {p.template}</span></button>
                <button className="text-ink3 hover:text-bad" onClick={async () => { await call('exports.deletePreset', p.id); refetchSaved(); }} aria-label="Delete preset"><Trash2 className="size-3.5" /></button>
              </div>
            ))}
            {!saved?.length && <div className="text-xs text-ink3">Save a template + size + style combination for one-click reuse.</div>}
          </Card>
        </div>
        <div className="space-y-4">
          <Card className="relative overflow-hidden p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge tone="accent">{size.w} × {size.h}</Badge>
                <Badge>{format.toUpperCase()}</Badge>
                {loading && <span className="text-xs text-ink3">Rendering preview…</span>}
              </div>
              <span className="text-xs text-ink3">Preview is the same vector the exporter rasterizes</span>
            </div>
            {tpl === 'custom' && project ? (
              <CustomEditor project={project} onChange={setProject} svg={preview?.svg} />
            ) : (
              <PreviewFrame svg={preview?.svg} w={size.w} h={size.h} transparent={opts.transparent} />
            )}
          </Card>
          {!!history?.length && (
            <Card className="p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-ink3">Recent exports</div>
              <div className="grid gap-1 md:grid-cols-2">
                {history.slice(0, 8).map((h) => (
                  <button key={h.id} onClick={() => call('app.showItem', h.outputPath)} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-white/5">
                    <span className="truncate text-ink2">{h.outputPath.split(/[\\/]/).pop()}</span>
                    <span className="shrink-0 text-ink3">{h.width}×{h.height}</span>
                  </button>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
      <Modal open={savingPreset} onClose={() => setSavingPreset(false)} title="Save export preset" footer={<Button variant="primary" disabled={!presetName} onClick={async () => {
        await act(() => call('exports.savePreset', presetName, tpl, { size, canvas, opts, format, project: tpl === 'custom' ? project : undefined }), 'Preset saved');
        setSavingPreset(false);
        setPresetName('');
        refetchSaved();
        refetchPresets();
      }}>Save</Button>}>
        <Field label="Preset name"><Input autoFocus value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Discord daily recap" /></Field>
      </Modal>
    </div>
  );
}

function PreviewFrame({ svg, w, h, transparent }: { svg?: string; w: number; h: number; transparent?: boolean }) {
  const maxH = 720;
  const aspect = w / h;
  return (
    <div className="flex justify-center">
      <div
        className={cx('relative overflow-hidden rounded-xl border border-line shadow-2xl', transparent && 'bg-[conic-gradient(#222_0_25%,#333_0_50%,#222_0_75%,#333_0)] [background-size:24px_24px]')}
        style={{ width: `min(100%, ${maxH * aspect}px)`, aspectRatio: `${w} / ${h}` }}
      >
        {svg ? <div className="size-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} /> : <Skeleton className="size-full" />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom Creator

const PALETTE: { label: string; icon: ReactNode; make: (W: number, H: number) => CustomElement }[] = [
  { label: 'Hero value', icon: <Sparkles className="size-4" />, make: (W) => ({ id: '', type: 'heroValue', x: W * 0.1, y: 160, w: W * 0.8, h: 160, metric: 'net', align: 'middle' }) },
  { label: 'KPI block', icon: <BarChart3 className="size-4" />, make: () => ({ id: '', type: 'kpi', x: 80, y: 360, w: 300, h: 108, metric: 'orders' }) },
  { label: 'Text', icon: <Type className="size-4" />, make: () => ({ id: '', type: 'text', x: 80, y: 80, w: 600, h: 60, text: 'Your headline', size: 44, weight: 700, color: '#ffffff', align: 'start', font: 'display', gradient: true }) },
  { label: 'Product grid', icon: <LayoutGrid className="size-4" />, make: (W, H) => ({ id: '', type: 'productGrid', x: 60, y: H * 0.5, w: W - 120, h: H * 0.42, count: 8, titles: true }) },
  { label: 'Top product', icon: <Crown className="size-4" />, make: () => ({ id: '', type: 'product', x: 80, y: 500, w: 260, h: 320, rank: 1 }) },
  { label: 'Leaderboard', icon: <Crown className="size-4" />, make: () => ({ id: '', type: 'leaderboard', x: 80, y: 500, w: 520, h: 400, count: 5 }) },
  { label: 'Retailer badges', icon: <Store className="size-4" />, make: (W) => ({ id: '', type: 'retailers', x: 60, y: 500, w: W - 120, h: 60 }) },
  { label: 'Chart', icon: <BarChart3 className="size-4" />, make: () => ({ id: '', type: 'chart', x: 80, y: 500, w: 600, h: 260, series: 'net' }) },
  { label: 'Logo', icon: <ImageIcon className="size-4" />, make: () => ({ id: '', type: 'logo', x: 60, y: 60, w: 80, h: 80 }) },
  { label: 'Image', icon: <ImageIcon className="size-4" />, make: () => ({ id: '', type: 'image', x: 100, y: 100, w: 300, h: 300, src: '', fit: 'meet', radius: 24 }) },
  { label: 'Date', icon: <Calendar className="size-4" />, make: () => ({ id: '', type: 'date', x: 700, y: 70, w: 300, h: 52, size: 18 }) },
  { label: 'Glow orb', icon: <Sparkles className="size-4" />, make: () => ({ id: '', type: 'decoration', x: 300, y: 300, w: 400, h: 400, kind: 'orb' }) },
  { label: 'Ring', icon: <Sparkles className="size-4" />, make: () => ({ id: '', type: 'decoration', x: 300, y: 300, w: 300, h: 300, kind: 'ring' }) },
  { label: 'Glass panel', icon: <LayoutGrid className="size-4" />, make: () => ({ id: '', type: 'decoration', x: 60, y: 480, w: 600, h: 300, kind: 'panel' }) },
  { label: 'Divider', icon: <Type className="size-4" />, make: (W) => ({ id: '', type: 'decoration', x: 80, y: 340, w: W - 160, h: 12, kind: 'divider' }) },
  { label: 'Stars', icon: <Sparkles className="size-4" />, make: (W, H) => ({ id: '', type: 'decoration', x: 0, y: 0, w: W, h: H, kind: 'stars' }) },
];

const SNAP = 8;

function CustomEditor({ project, onChange, svg }: { project: CustomProject; onChange: (p: CustomProject) => void; svg?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [sel, setSel] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; mode: 'move' | 'resize'; sx: number; sy: number; orig: CustomElement } | null>(null);
  const [live, setLive] = useState<CustomElement | null>(null);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const act = useAction();
  const W = project.width;
  const H = project.height;

  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / W));
    ro.observe(el);
    return () => ro.disconnect();
  }, [W]);

  const update = useCallback((id: string, patch: Partial<CustomElement>) => onChange({ ...project, elements: project.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as CustomElement) : e)) }), [project, onChange]);

  useEffect(() => {
    if (!drag) return;
    const move = (ev: MouseEvent) => {
      const dx = (ev.clientX - drag.sx) / scale;
      const dy = (ev.clientY - drag.sy) / scale;
      const o = drag.orig;
      let next: CustomElement = drag.mode === 'move' ? { ...o, x: o.x + dx, y: o.y + dy } : ({ ...o, w: Math.max(24, o.w + dx), h: Math.max(16, o.h + dy) } as CustomElement);
      // Alignment guides: canvas center/edges and other elements' edges/centers.
      const xs = [0, W / 2, W, ...project.elements.filter((e) => e.id !== o.id).flatMap((e) => [e.x, e.x + e.w / 2, e.x + e.w])];
      const ys = [0, H / 2, H, ...project.elements.filter((e) => e.id !== o.id).flatMap((e) => [e.y, e.y + e.h / 2, e.y + e.h])];
      const gx: number[] = [];
      const gy: number[] = [];
      if (drag.mode === 'move') {
        for (const [edge, off] of [[next.x, 0], [next.x + next.w / 2, next.w / 2], [next.x + next.w, next.w]] as const) {
          const hit = xs.find((x) => Math.abs(x - edge) < SNAP / scale);
          if (hit !== undefined) { next = { ...next, x: hit - off }; gx.push(hit); break; }
        }
        for (const [edge, off] of [[next.y, 0], [next.y + next.h / 2, next.h / 2], [next.y + next.h, next.h]] as const) {
          const hit = ys.find((y) => Math.abs(y - edge) < SNAP / scale);
          if (hit !== undefined) { next = { ...next, y: hit - off }; gy.push(hit); break; }
        }
      } else {
        const hx = xs.find((x) => Math.abs(x - (next.x + next.w)) < SNAP / scale);
        if (hx !== undefined) { next = { ...next, w: hx - next.x } as CustomElement; gx.push(hx); }
        const hy = ys.find((y) => Math.abs(y - (next.y + next.h)) < SNAP / scale);
        if (hy !== undefined) { next = { ...next, h: hy - next.y } as CustomElement; gy.push(hy); }
      }
      setGuides({ x: gx, y: gy });
      setLive(next);
    };
    const up = () => {
      if (live) update(live.id, { x: Math.round(live.x), y: Math.round(live.y), w: Math.round(live.w), h: Math.round(live.h) });
      setDrag(null);
      setLive(null);
      setGuides({ x: [], y: [] });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [drag, live, scale, project, update, W, H]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!sel || (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'SELECT') return;
      const el = project.elements.find((x) => x.id === sel);
      if (!el) return;
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'Delete' || e.key === 'Backspace') onChange({ ...project, elements: project.elements.filter((x) => x.id !== sel) });
      if (e.key === 'ArrowLeft') update(sel, { x: el.x - step });
      if (e.key === 'ArrowRight') update(sel, { x: el.x + step });
      if (e.key === 'ArrowUp') update(sel, { y: el.y - step });
      if (e.key === 'ArrowDown') update(sel, { y: el.y + step });
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [sel, project, onChange, update]);

  const selected = project.elements.find((e) => e.id === sel) ?? null;
  const add = (make: (W: number, H: number) => CustomElement) => {
    const el = { ...make(W, H), id: `el${Date.now().toString(36)}` } as CustomElement;
    onChange({ ...project, elements: [...project.elements, el] });
    setSel(el.id);
  };

  return (
    <div className="grid gap-4 2xl:grid-cols-[1fr_280px]">
      <div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {PALETTE.map((p) => (
            <Button key={p.label} size="sm" variant="subtle" icon={p.icon} onClick={() => add(p.make)}>{p.label}</Button>
          ))}
        </div>
        <div className="flex justify-center">
          <div ref={box} className="relative w-full overflow-hidden rounded-xl border border-line shadow-2xl" style={{ maxWidth: 720 * (W / H), aspectRatio: `${W} / ${H}` }} onMouseDown={() => setSel(null)}>
            {svg ? <div className="pointer-events-none size-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} /> : <Skeleton className="size-full" />}
            {project.elements.map((e) => {
              const v = live?.id === e.id ? live : e;
              return (
                <div
                  key={e.id}
                  onMouseDown={(ev) => { ev.stopPropagation(); setSel(e.id); setDrag({ id: e.id, mode: 'move', sx: ev.clientX, sy: ev.clientY, orig: e }); }}
                  className={cx('absolute cursor-move rounded-md border transition-colors', sel === e.id ? 'border-accent bg-accent/10' : 'border-transparent hover:border-white/30')}
                  style={{ left: v.x * scale, top: v.y * scale, width: v.w * scale, height: v.h * scale }}
                >
                  {sel === e.id && (
                    <>
                      <span className="absolute -top-5 left-0 rounded bg-accent px-1.5 text-[10px] font-semibold text-white">{e.type}</span>
                      <span onMouseDown={(ev) => { ev.stopPropagation(); setDrag({ id: e.id, mode: 'resize', sx: ev.clientX, sy: ev.clientY, orig: e }); }} className="absolute -bottom-1.5 -right-1.5 size-3 cursor-nwse-resize rounded-sm border border-white bg-accent" />
                    </>
                  )}
                </div>
              );
            })}
            {guides.x.map((x, i) => <div key={`gx${i}`} className="pointer-events-none absolute inset-y-0 w-px bg-magenta" style={{ left: x * scale }} />)}
            {guides.y.map((y, i) => <div key={`gy${i}`} className="pointer-events-none absolute inset-x-0 h-px bg-magenta" style={{ top: y * scale }} />)}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select value={project.background} onChange={(e) => onChange({ ...project, background: e.target.value as CustomProject['background'] })}>
            <option value="galaxy">Galaxy background</option>
            <option value="aurora">Aurora background</option>
            <option value="holo">Holo rays background</option>
            <option value="solid">Solid background</option>
            <option value="none">No background (transparent)</option>
          </Select>
          <Input className="w-56" value={project.name} onChange={(e) => onChange({ ...project, name: e.target.value })} />
          <Button size="sm" icon={<Save className="size-3.5" />} onClick={() => act(() => call('exports.saveProject', project), 'Project saved')}>Save project</Button>
          <Button size="sm" icon={<FolderOpen className="size-3.5" />} onClick={async () => { const p = await act(() => call('exports.openProject')); if (p) onChange({ ...p, width: W, height: H, elements: p.elements.map((e) => ({ ...e, x: (e.x * W) / p.width, y: (e.y * H) / p.height, w: (e.w * W) / p.width, h: (e.h * H) / p.height })) as CustomElement[] }); }}>Open project</Button>
          <span className="text-xs text-ink3">Drag to move · corner to resize · arrows nudge (Shift = 10) · Delete removes</span>
        </div>
      </div>
      <Card className="h-fit p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-ink3">Inspector</div>
        {!selected ? (
          <div className="text-sm text-ink3">Select an element on the canvas.</div>
        ) : (
          <Inspector el={selected} onChange={(patch) => update(selected.id, patch)} onDuplicate={() => {
            const copy = { ...selected, id: `el${Date.now().toString(36)}`, x: selected.x + 24, y: selected.y + 24 } as CustomElement;
            onChange({ ...project, elements: [...project.elements, copy] });
            setSel(copy.id);
          }} onDelete={() => { onChange({ ...project, elements: project.elements.filter((x) => x.id !== selected.id) }); setSel(null); }} onFront={() => onChange({ ...project, elements: [...project.elements.filter((x) => x.id !== selected.id), selected] })} onBack={() => onChange({ ...project, elements: [selected, ...project.elements.filter((x) => x.id !== selected.id)] })} />
        )}
      </Card>
    </div>
  );
}

function Inspector({ el, onChange, onDuplicate, onDelete, onFront, onBack }: { el: CustomElement; onChange: (p: Partial<CustomElement>) => void; onDuplicate: () => void; onDelete: () => void; onFront: () => void; onBack: () => void }) {
  const num = (k: 'x' | 'y' | 'w' | 'h') => <Field label={k.toUpperCase()}><Input type="number" value={Math.round(el[k])} onChange={(e) => onChange({ [k]: Number(e.target.value) } as Partial<CustomElement>)} /></Field>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">{num('x')}{num('y')}{num('w')}{num('h')}</div>
      {(el.type === 'kpi' || el.type === 'heroValue') && (
        <Field label="Metric">
          <Select className="w-full" value={el.metric} onChange={(e) => onChange({ metric: e.target.value } as never)}>
            {(el.type === 'heroValue' ? ['net', 'gross'] : ['net', 'gross', 'orders', 'live', 'canceled', 'success', 'units', 'buyers', 'avgOrder', 'delivered']).map((m) => <option key={m}>{m}</option>)}
          </Select>
        </Field>
      )}
      {el.type === 'kpi' && <Field label="Label"><Input value={el.label ?? ''} onChange={(e) => onChange({ label: e.target.value || undefined } as never)} placeholder="Auto" /></Field>}
      {el.type === 'text' && (
        <>
          <Field label="Text"><Input value={el.text} onChange={(e) => onChange({ text: e.target.value } as never)} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Size"><Input type="number" value={el.size} onChange={(e) => onChange({ size: Number(e.target.value) } as never)} /></Field>
            <Field label="Weight"><Select className="w-full" value={el.weight} onChange={(e) => onChange({ weight: Number(e.target.value) } as never)}>{[400, 600, 700, 800].map((w) => <option key={w}>{w}</option>)}</Select></Field>
            <Field label="Font"><Select className="w-full" value={el.font} onChange={(e) => onChange({ font: e.target.value } as never)}><option value="display">Display</option><option value="body">Body</option><option value="mono">Mono</option></Select></Field>
            <Field label="Align"><Select className="w-full" value={el.align} onChange={(e) => onChange({ align: e.target.value } as never)}><option value="start">Left</option><option value="middle">Center</option><option value="end">Right</option></Select></Field>
          </div>
          <Field label="Color"><Input type="color" value={el.color} onChange={(e) => onChange({ color: e.target.value } as never)} className="h-10 p-1" /></Field>
          <Toggle checked={!!el.gradient} onChange={(v) => onChange({ gradient: v } as never)} label="Gradient fill" />
        </>
      )}
      {el.type === 'heroValue' && <Field label="Align"><Select className="w-full" value={el.align} onChange={(e) => onChange({ align: e.target.value } as never)}><option value="start">Left</option><option value="middle">Center</option><option value="end">Right</option></Select></Field>}
      {(el.type === 'productGrid' || el.type === 'leaderboard') && <Field label="Count"><Input type="number" min={1} max={400} value={el.count} onChange={(e) => onChange({ count: Number(e.target.value) } as never)} /></Field>}
      {el.type === 'productGrid' && <Toggle checked={el.titles} onChange={(v) => onChange({ titles: v } as never)} label="Show titles" />}
      {el.type === 'product' && <Field label="Rank"><Input type="number" min={1} value={el.rank} onChange={(e) => onChange({ rank: Number(e.target.value) } as never)} /></Field>}
      {el.type === 'chart' && <Field label="Series"><Select className="w-full" value={el.series} onChange={(e) => onChange({ series: e.target.value } as never)}><option value="net">Net secured</option><option value="orders">Orders</option></Select></Field>}
      {el.type === 'date' && <Field label="Size"><Input type="number" value={el.size} onChange={(e) => onChange({ size: Number(e.target.value) } as never)} /></Field>}
      {el.type === 'image' && (
        <>
          <Button size="sm" onClick={async () => {
            const [f] = await call('dialog.openFiles', { filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }] });
            if (f) onChange({ src: await call('exports.imageToDataUri', f) } as never);
          }}>Choose image…</Button>
          <Field label="Fit"><Select className="w-full" value={el.fit} onChange={(e) => onChange({ fit: e.target.value } as never)}><option value="meet">Contain</option><option value="slice">Cover</option></Select></Field>
          <Field label="Corner radius"><Input type="number" value={el.radius} onChange={(e) => onChange({ radius: Number(e.target.value) } as never)} /></Field>
        </>
      )}
      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        <Button size="sm" icon={<Copy className="size-3.5" />} onClick={onDuplicate}>Duplicate</Button>
        <Button size="sm" onClick={onFront}>Front</Button>
        <Button size="sm" onClick={onBack}>Back</Button>
        <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={onDelete}>Delete</Button>
      </div>
    </div>
  );
}

export { AnimatePresence, Plus };
