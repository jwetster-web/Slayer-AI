export type RangeId = 'today' | 'yesterday' | '7d' | '30d' | '90d' | 'all' | 'custom';

export const RANGE_LABEL: Record<RangeId, string> = { today: 'Today', yesterday: 'Yesterday', '7d': '7 days', '30d': '30 days', '90d': '90 days', all: 'All time', custom: 'Custom' };

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function rangeFilter(id: RangeId, custom?: { from?: string; to?: string }): { from?: string; to?: string } {
  const now = new Date();
  const today = startOfDay(now);
  const day = 86400000;
  switch (id) {
    case 'today': return { from: today.toISOString() };
    case 'yesterday': return { from: new Date(today.getTime() - day).toISOString(), to: today.toISOString() };
    case '7d': return { from: new Date(today.getTime() - 6 * day).toISOString() };
    case '30d': return { from: new Date(today.getTime() - 29 * day).toISOString() };
    case '90d': return { from: new Date(today.getTime() - 89 * day).toISOString() };
    case 'custom': return { from: custom?.from ? new Date(`${custom.from}T00:00:00`).toISOString() : undefined, to: custom?.to ? new Date(new Date(`${custom.to}T00:00:00`).getTime() + day).toISOString() : undefined };
    default: return {};
  }
}

/** The equally long period right before the given range (for comparisons). */
export function previousPeriod(r: { from?: string; to?: string }): { from?: string; to?: string } | null {
  if (!r.from) return null;
  const from = new Date(r.from).getTime();
  const to = r.to ? new Date(r.to).getTime() : Date.now();
  const len = to - from;
  return { from: new Date(from - len).toISOString(), to: new Date(from).toISOString() };
}
