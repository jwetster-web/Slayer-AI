// Sample product catalog. Prices and names are illustrative; product art is
// generated locally (see art.ts) and labeled SAMPLE so it is never mistaken
// for real retailer imagery.

export interface SampleProduct {
  slug: string;
  title: string;
  setName: string;
  format: string;
  priceCents: number;
  hue: number;
  weight: number;
}

const SETS: { name: string; hue: number }[] = [
  { name: 'Prismatic Evolutions', hue: 285 },
  { name: 'Surging Sparks', hue: 48 },
  { name: 'Journey Together', hue: 200 },
  { name: 'Destined Rivals', hue: 350 },
  { name: 'Black Bolt', hue: 230 },
  { name: 'White Flare', hue: 25 },
  { name: 'Mega Evolution', hue: 160 },
  { name: 'Phantasmal Flames', hue: 10 },
];

const FORMATS: { format: string; price: number; weight: number }[] = [
  { format: 'Elite Trainer Box', price: 4999, weight: 10 },
  { format: 'Booster Bundle', price: 2694, weight: 9 },
  { format: 'Booster Box', price: 16164, weight: 3 },
  { format: 'Ultra-Premium Collection', price: 11999, weight: 2 },
  { format: 'Mini Tin', price: 999, weight: 5 },
  { format: 'Collection Box', price: 2499, weight: 4 },
  { format: '3-Pack Blister', price: 1399, weight: 5 },
  { format: 'Build & Battle Box', price: 2199, weight: 2 },
];

export const SAMPLE_PRODUCTS: SampleProduct[] = SETS.flatMap((s, si) =>
  FORMATS.filter((_, fi) => (si + fi) % 2 === 0 || fi < 2).map((f) => ({
    slug: `${s.name}-${f.format}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    title: `Pokémon TCG: ${s.name} ${f.format}`,
    setName: s.name,
    format: f.format,
    priceCents: f.price,
    hue: s.hue,
    weight: f.weight * (si < 4 ? 2 : 1),
  })),
);

export const SAMPLE_IMAGE_HOST = 'https://sample-images.glide.invalid/';

export function sampleImageUrl(p: SampleProduct): string {
  return `${SAMPLE_IMAGE_HOST}${p.slug}.svg`;
}
