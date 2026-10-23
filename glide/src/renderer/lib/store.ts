import { create } from 'zustand';
import type { AppSettings, OrderFilter, WorkspaceInfo } from '../../shared/types';

export type PageId =
  | 'overview' | 'orders' | 'timeline' | 'members' | 'profiles' | 'accounts' | 'shipping'
  | 'catalog' | 'analytics' | 'studio' | 'identity' | 'logs' | 'settings';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
}

interface State {
  page: PageId;
  orderFilter: OrderFilter;
  orderId: number | null;
  memberId: number | null;
  productId: number | null;
  settingsTab: string;
  workspace: WorkspaceInfo | null;
  settings: AppSettings | null;
  dataVersion: number;
  scopes: Record<string, number>;
  toasts: Toast[];
  navigate: (page: PageId, opts?: { orderFilter?: OrderFilter; settingsTab?: string }) => void;
  openOrder: (id: number | null) => void;
  openMember: (id: number | null) => void;
  openProduct: (id: number | null) => void;
  setWorkspace: (w: WorkspaceInfo | null) => void;
  setSettings: (s: AppSettings) => void;
  bump: (scopes: string[]) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismiss: (id: number) => void;
}

let toastSeq = 0;

export const useStore = create<State>((set) => ({
  page: 'overview',
  orderFilter: {},
  orderId: null,
  memberId: null,
  productId: null,
  settingsTab: 'general',
  workspace: null,
  settings: null,
  dataVersion: 0,
  scopes: {},
  toasts: [],
  navigate: (page, opts) =>
    set((s) => ({ page, orderFilter: opts?.orderFilter ?? (page === 'orders' ? s.orderFilter : s.orderFilter), settingsTab: opts?.settingsTab ?? s.settingsTab })),
  openOrder: (orderId) => set({ orderId }),
  openMember: (memberId) => set({ memberId }),
  openProduct: (productId) => set({ productId }),
  setWorkspace: (workspace) => set({ workspace }),
  setSettings: (settings) => set({ settings }),
  bump: (scopes) =>
    set((s) => {
      const next = { ...s.scopes };
      for (const k of scopes) next[k] = (next[k] ?? 0) + 1;
      return { dataVersion: s.dataVersion + 1, scopes: next };
    }),
  toast: (text, kind = 'info') => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 7000 : 3800);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
