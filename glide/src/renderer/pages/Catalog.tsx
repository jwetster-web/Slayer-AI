import { Boxes, GitMerge, ImagePlus, RefreshCw, Search, Star, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { formatCents, formatDate, formatNumber } from '../../shared/format';
import { call } from '../lib/api';
import { useAction, useDebounced, useQuery } from '../lib/hooks';
import { useStore } from '../lib/store';
import { Badge, Button, Card, Drawer, Empty, Field, Input, Modal, PageHeader, Pager, ProductThumb, Select, Skeleton, cx } from '../components/ui';

export function Catalog() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [offset, setOffset] = useState(0);
  const dq = useDebounced(q);
  const { data: info } = useQuery(() => call('app.info'), [], { live: false });
  const { data } = useQuery(() => call('products.list', { search: dq, category: cat || undefined, limit: 120, offset }), [dq, cat, offset]);
  useEffect(() => setOffset(0), [dq, cat]);
  const act = useAction();
  return (
    <div>
      <PageHeader eyebrow="Catalog" title="Product Catalog" subtitle="Products are identified by retailer SKU and UPC — never by fuzzy title matching — so an image always belongs to the exact product." right={<Button icon={<RefreshCw className="size-4" />} onClick={() => act(() => call('products.refreshImages'), 'Images refreshed')}>Refresh images</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[280px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink3" />
          <Input className="pl-9" placeholder="Title, SKU or UPC…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>
          {info && Object.entries(info.categories).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
        </Select>
        {data && <Pager offset={offset} limit={120} total={data.total} onChange={setOffset} />}
      </div>
      {!data ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6">{Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="h-56" />)}</div>
      ) : !data.rows.length ? (
        <Card><Empty icon={<Boxes className="size-6" />} title="No products yet" body="Products appear automatically from order confirmations." /></Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6">
          {data.rows.map((p, i) => (
            <motion.div key={p.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 24) * 0.015 }}>
              <Card className="group overflow-hidden p-3" onClick={() => useStore.getState().openProduct(p.id)}>
                <div className="relative">
                  <ProductThumb src={p.imageUrl} title={p.title} size={180} className="!w-full transition group-hover:scale-[1.02]" />
                  <span className="absolute right-2 top-2 rounded-lg bg-black/70 px-2 py-0.5 font-display text-sm font-bold text-white">×{formatNumber(p.units)}</span>
                </div>
                <div className="mt-2 line-clamp-2 min-h-[2.5em] text-xs font-medium text-ink">{p.title}</div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-ink3">
                  <span>{info?.categories[p.category] ?? p.category}</span>
                  <span>{p.lastPriceCents ? formatCents(p.lastPriceCents, p.currency ?? 'USD') : ''}</span>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProductDrawer() {
  const id = useStore((s) => s.productId);
  const close = () => useStore.getState().openProduct(null);
  const { data: p, refetch } = useQuery(() => (id ? call('products.get', id) : Promise.resolve(null)), [id]);
  const { data: info } = useQuery(() => call('app.info'), [], { live: false });
  const [form, setForm] = useState({ title: '', sku: '', upc: '', brand: '', category: '' });
  const [merging, setMerging] = useState(false);
  const [mergeQ, setMergeQ] = useState('');
  const dmq = useDebounced(mergeQ);
  const { data: mergeList } = useQuery(() => (merging ? call('products.list', { search: dmq, limit: 20 }) : Promise.resolve(null)), [merging, dmq], { live: false });
  const act = useAction();
  useEffect(() => {
    if (p) setForm({ title: p.title, sku: p.sku ?? '', upc: p.upc ?? '', brand: p.brand ?? '', category: p.category });
  }, [p?.id]);
  return (
    <Drawer open={!!id} onClose={close} width={760}>
      {!p ? (
        <div className="p-8"><Skeleton className="h-64" /></div>
      ) : (
        <>
          <div className="flex items-start justify-between border-b border-line px-7 py-5">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-accent">{p.retailerId ?? 'catalog'}</div>
              <h2 className="mt-1 max-w-xl font-display text-xl font-bold">{p.title}</h2>
              <div className="mt-1 text-sm text-ink3">{formatNumber(p.units)} units across {p.orderCount} orders</div>
            </div>
            <button onClick={close} className="focus-ring rounded-lg p-1 text-ink3 hover:text-ink" aria-label="Close"><X className="size-5" /></button>
          </div>
          <div className="flex-1 space-y-5 overflow-y-auto px-7 py-6">
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-display font-semibold">Images</h3>
                <Button size="sm" icon={<ImagePlus className="size-3.5" />} onClick={async () => {
                  const [f] = await call('dialog.openFiles', { filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif'] }] });
                  if (f) { await act(() => call('products.setImage', p.id, f), 'Image set as primary'); refetch(); }
                }}>Upload correct image</Button>
              </div>
              <div className="flex flex-wrap gap-3">
                {p.images.map((img) => {
                  const src = img.localPath ? `glide-img://local/${img.localPath}` : img.url;
                  const primary = p.imageUrl === src;
                  return (
                    <div key={img.id} className={cx('relative rounded-xl border p-1', primary ? 'border-accent' : 'border-line')}>
                      <ProductThumb src={src} title={p.title} size={110} />
                      <div className="mt-1 flex items-center justify-between px-1 text-[10px] text-ink3">
                        <span>{img.source}</span>
                        {!primary && <button className="text-accent hover:underline" onClick={async () => { await call('products.setPrimaryImage', p.id, img.id); refetch(); }}><Star className="inline size-3" /> use</button>}
                      </div>
                    </div>
                  );
                })}
                {!p.images.length && <div className="text-sm text-ink3">No image yet. Emails without product photos stay imageless rather than borrowing a look-alike.</div>}
              </div>
            </Card>
            <Card className="p-5">
              <h3 className="mb-3 font-display font-semibold">Catalog details</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2"><Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field></div>
                <Field label="Retailer SKU"><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></Field>
                <Field label="UPC / EAN"><Input value={form.upc} onChange={(e) => setForm({ ...form, upc: e.target.value })} /></Field>
                <Field label="Brand"><Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></Field>
                <Field label="Category">
                  <Select className="w-full" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    {info && Object.entries(info.categories).map(([cid, l]) => <option key={cid} value={cid}>{l}</option>)}
                  </Select>
                </Field>
              </div>
              <div className="mt-3 flex gap-2">
                <Button variant="primary" size="sm" onClick={() => act(() => call('products.update', p.id, { title: form.title, sku: form.sku || null, upc: form.upc || null, brand: form.brand || null, category: form.category }), 'Saved')}>Save</Button>
                <Button size="sm" icon={<GitMerge className="size-3.5" />} onClick={() => setMerging(true)}>Merge another product into this</Button>
                <Button size="sm" variant="ghost" onClick={() => (close(), useStore.getState().navigate('orders', { orderFilter: { productIds: [p.id] } }))}>View orders</Button>
              </div>
            </Card>
            <Card className="p-5">
              <h3 className="mb-2 font-display font-semibold">Observed prices</h3>
              {p.prices.slice(-12).reverse().map((pr, i) => (
                <div key={i} className="flex justify-between border-b border-line/50 py-1.5 text-sm last:border-0">
                  <span className="text-ink3">{formatDate(pr.observedAt)} · {pr.retailerId}</span>
                  <span className="tabular text-ink">{formatCents(pr.priceCents, pr.currency)}</span>
                </div>
              ))}
              {!p.prices.length && <div className="text-sm text-ink3">No prices recorded.</div>}
            </Card>
          </div>
          <Modal open={merging} onClose={() => setMerging(false)} title="Merge a product into this one">
            <p className="mb-3 text-sm text-ink3">Use this when the same item was recorded under two catalog entries (e.g. different retailers without a shared UPC). Orders, images and prices move here.</p>
            <Input autoFocus placeholder="Search products…" value={mergeQ} onChange={(e) => setMergeQ(e.target.value)} />
            <div className="mt-2 max-h-72 space-y-1 overflow-auto">
              {mergeList?.rows.filter((x) => x.id !== p.id).map((x) => (
                <button key={x.id} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/5" onClick={async () => { setMerging(false); await act(() => call('products.merge', p.id, x.id), 'Products merged'); refetch(); }}>
                  <ProductThumb src={x.imageUrl} title={x.title} size={36} />
                  <span className="flex-1 truncate text-sm">{x.title}</span>
                  <Badge>{x.retailerId}</Badge>
                </button>
              ))}
            </div>
          </Modal>
        </>
      )}
    </Drawer>
  );
}
