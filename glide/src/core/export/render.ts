// Rasterizes template SVG at the exact output size (vector → pixels, no
// upscaling) and encodes PNG / JPG / WebP / PDF / GIF.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { RecapData } from './data';
import { template, type CustomProject, type TemplateId, type TemplateOptions } from './templates';

export type ExportFormat = 'png' | 'jpg' | 'webp' | 'pdf' | 'gif';

export interface CanvasPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  group: 'Discord' | 'X' | 'Instagram' | 'Desktop' | 'Custom';
}

export const CANVAS_PRESETS: CanvasPreset[] = [
  { id: 'square', label: 'Square 1080 × 1080', width: 1080, height: 1080, group: 'Instagram' },
  { id: 'portrait', label: 'Vertical 1080 × 1920', width: 1080, height: 1920, group: 'Instagram' },
  { id: 'insta45', label: 'Portrait 1080 × 1350', width: 1080, height: 1350, group: 'Instagram' },
  { id: 'landscape', label: 'Landscape 1920 × 1080', width: 1920, height: 1080, group: 'Desktop' },
  { id: 'qhd', label: 'QHD 2560 × 1440', width: 2560, height: 1440, group: 'Desktop' },
  { id: '4k', label: '4K 3840 × 2160', width: 3840, height: 2160, group: 'Desktop' },
  { id: 'x', label: 'X post 1600 × 900', width: 1600, height: 900, group: 'X' },
  { id: 'discord', label: 'Discord 1920 × 1080', width: 1920, height: 1080, group: 'Discord' },
  { id: 'discord-sq', label: 'Discord square 1280 × 1280', width: 1280, height: 1280, group: 'Discord' },
];

/** Design units: the shorter side is normalized to 1080 so layouts scale identically at any resolution. */
export function designSize(width: number, height: number): { w: number; h: number; zoom: number } {
  const zoom = Math.min(width, height) / 1080;
  return { w: Math.round(width / zoom), h: Math.round(height / zoom), zoom };
}

export interface RenderRequest {
  template: TemplateId;
  width: number;
  height: number;
  format: ExportFormat;
  options?: Omit<TemplateOptions, 'width' | 'height'>;
  custom?: CustomProject;
  quality?: number;
}

export function buildSvg(data: RecapData, req: Pick<RenderRequest, 'template' | 'width' | 'height' | 'options' | 'custom'>): string {
  const ds = designSize(req.width, req.height);
  const def = template(req.template);
  const custom = req.custom ? { ...req.custom, width: ds.w, height: ds.h, elements: scaleElements(req.custom, ds.w, ds.h) } : undefined;
  return def.render(data, { ...req.options, width: ds.w, height: ds.h, transparent: req.options?.transparent && def.supportsTransparent }, custom);
}

function scaleElements(p: CustomProject, w: number, h: number) {
  const sx = w / p.width;
  const sy = h / p.height;
  if (Math.abs(sx - 1) < 1e-6 && Math.abs(sy - 1) < 1e-6) return p.elements;
  return p.elements.map((e) => ({ ...e, x: e.x * sx, y: e.y * sy, w: e.w * sx, h: e.h * sy }));
}

let fontFiles: string[] | null = null;
export function setFontDir(dir: string) {
  fontFiles = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(ttf|otf)$/i.test(f)).map((f) => join(dir, f)) : [];
}

async function rasterize(svg: string, width: number, transparent: boolean): Promise<Buffer> {
  const { renderAsync } = await import('@resvg/resvg-js');
  const img = await renderAsync(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: !fontFiles?.length, fontFiles: fontFiles ?? [], defaultFontFamily: 'Inter', sansSerifFamily: 'Inter', monospaceFamily: 'JetBrains Mono' },
    background: transparent ? undefined : '#05060d',
    shapeRendering: 2,
    textRendering: 1,
    imageRendering: 0,
  });
  return img.asPng();
}

export async function renderExport(data: RecapData, req: RenderRequest): Promise<{ buffer: Buffer; mime: string; ext: string; svg: string }> {
  const svg = buildSvg(data, req);
  const transparent = !!req.options?.transparent && template(req.template).supportsTransparent && (req.format === 'png' || req.format === 'webp');
  if (req.format === 'gif') return { buffer: await renderGif(data, req), mime: 'image/gif', ext: 'gif', svg };
  const png = await rasterize(svg, req.width, transparent);
  const q = req.quality ?? 92;
  if (req.format === 'png') return { buffer: png, mime: 'image/png', ext: 'png', svg };
  const sharp = (await import('sharp')).default;
  if (req.format === 'jpg') return { buffer: await sharp(png).flatten({ background: '#05060d' }).jpeg({ quality: q, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer(), mime: 'image/jpeg', ext: 'jpg', svg };
  if (req.format === 'webp') return { buffer: await sharp(png).webp({ quality: q, alphaQuality: 100, smartSubsample: true }).toBuffer(), mime: 'image/webp', ext: 'webp', svg };
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle(`${data.brandName} — ${req.template} — ${data.rangeLabel}`);
  doc.setProducer('GLIDE Cook Export Studio');
  const img = await doc.embedPng(png);
  // 1 px = 0.75 pt keeps the physical size sensible while embedding full-resolution pixels.
  const page = doc.addPage([req.width * 0.75, req.height * 0.75]);
  page.drawImage(img, { x: 0, y: 0, width: req.width * 0.75, height: req.height * 0.75 });
  return { buffer: Buffer.from(await doc.save()), mime: 'application/pdf', ext: 'pdf', svg };
}

/** Short counting/entrance animation encoded as GIF (rendered locally, frame by frame). */
export async function renderGif(data: RecapData, req: RenderRequest, frames = 36, maxWidth = 720): Promise<Buffer> {
  const { GIFEncoder, quantize, applyPalette } = (await import('gifenc')) as unknown as {
    GIFEncoder: () => { writeFrame(i: Uint8Array, w: number, h: number, o: Record<string, unknown>): void; finish(): void; bytes(): Uint8Array };
    quantize: (rgba: Uint8Array, n: number) => number[][];
    applyPalette: (rgba: Uint8Array, p: number[][]) => Uint8Array;
  };
  const { renderAsync } = await import('@resvg/resvg-js');
  const width = Math.min(maxWidth, req.width);
  const height = Math.round((req.height * width) / req.width);
  const enc = GIFEncoder();
  for (let i = 0; i <= frames; i++) {
    const progress = i / frames;
    const svg = buildSvg(data, { ...req, options: { ...req.options, progress, transparent: false } });
    const img = await renderAsync(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: !fontFiles?.length, fontFiles: fontFiles ?? [], defaultFontFamily: 'Inter' }, background: '#05060d' });
    const rgba = new Uint8Array(img.pixels);
    const pal = quantize(rgba, 256);
    const index = applyPalette(rgba, pal);
    enc.writeFrame(index, img.width, img.height, { palette: pal, delay: i === frames ? 2600 : 45 });
  }
  enc.finish();
  return Buffer.from(enc.bytes());
}

/** MP4 needs a local ffmpeg binary on PATH; reported as unavailable otherwise. */
export async function ffmpegAvailable(): Promise<string | null> {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-version'], { timeout: 4000 }, (err) => resolve(err ? null : 'ffmpeg'));
  });
}

export async function renderMp4(data: RecapData, req: RenderRequest, outPath: string, fps = 30, seconds = 3): Promise<void> {
  const bin = await ffmpegAvailable();
  if (!bin) throw new Error('MP4 export needs ffmpeg installed and on your PATH');
  const { spawn } = await import('node:child_process');
  const { renderAsync } = await import('@resvg/resvg-js');
  const width = Math.min(req.width, 1920) & ~1;
  const height = Math.round((req.height * width) / req.width) & ~1;
  const ff = spawn(bin, ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-vf', `scale=${width}:${height}`, '-movflags', '+faststart', outPath], { stdio: ['pipe', 'ignore', 'pipe'] });
  const done = new Promise<void>((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited with ${c}`)))));
  const total = fps * seconds;
  for (let i = 0; i <= total; i++) {
    const svg = buildSvg(data, { ...req, options: { ...req.options, progress: Math.min(1, i / (total * 0.75)), transparent: false } });
    const img = await renderAsync(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: !fontFiles?.length, fontFiles: fontFiles ?? [], defaultFontFamily: 'Inter' }, background: '#05060d' });
    if (!ff.stdin.write(img.asPng())) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await done;
}
