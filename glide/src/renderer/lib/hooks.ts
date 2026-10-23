import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from './store';

/**
 * Runs an async query, re-running when `deps` change or when the backend
 * reports data changes. Keeps the previous value while refreshing.
 */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[], opts: { live?: boolean; intervalMs?: number } = {}) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const version = useStore((s) => (opts.live === false ? 0 : s.dataVersion));
  const seq = useRef(0);
  const run = useCallback(() => {
    const my = ++seq.current;
    setLoading(true);
    fn()
      .then((d) => {
        if (my === seq.current) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => my === seq.current && setError(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
      .finally(() => my === seq.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    const t = setTimeout(run, version ? 250 : 0);
    return () => clearTimeout(t);
  }, [run, version]);
  useEffect(() => {
    if (!opts.intervalMs) return;
    const t = setInterval(run, opts.intervalMs);
    return () => clearInterval(t);
  }, [run, opts.intervalMs]);
  return { data, error, loading, refetch: run };
}

export function errMsg(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

/** Runs an action with toast feedback. */
export function useAction() {
  const toast = useStore((s) => s.toast);
  return useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const r = await fn();
        if (success) toast(success, 'success');
        return r;
      } catch (e) {
        toast(errMsg(e), 'error');
        return undefined;
      }
    },
    [toast],
  );
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function usePrefersReducedMotion(): boolean {
  const setting = useStore((s) => s.settings?.reducedMotion ?? 'system');
  const [sys, setSys] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const h = () => setSys(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return setting === 'on' ? true : setting === 'off' ? false : sys;
}
