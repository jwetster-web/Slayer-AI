// Formatting helpers shared by the renderer and export engine.

export function formatCents(cents: number, currency = 'USD', opts: { compact?: boolean } = {}): string {
  const value = cents / 100;
  try {
    return new Intl.NumberFormat(currency === 'EUR' ? 'de-DE' : currency === 'GBP' ? 'en-GB' : 'en-US', {
      style: 'currency',
      currency,
      notation: opts.compact ? 'compact' : 'standard',
      maximumFractionDigits: opts.compact ? 1 : 2,
      minimumFractionDigits: opts.compact ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function formatNumber(n: number, opts: { compact?: boolean } = {}): string {
  return new Intl.NumberFormat('en-US', { notation: opts.compact ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);
}

export function formatPct(ratio: number, digits = 1): string {
  if (!Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', opts);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

export function relativeTime(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return 'never';
  const diff = (nowMs - new Date(iso).getTime()) / 1000;
  if (diff < 0) return 'just now';
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.round(diff / 86400)}d ago`;
  return formatDate(iso);
}
