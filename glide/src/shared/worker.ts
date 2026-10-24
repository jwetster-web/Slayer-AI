// Messages between the main process and the background worker thread.

import type { SyncProgress } from './types';

export type WorkerJob =
  | { type: 'syncAll' }
  | { type: 'syncAccount'; accountId: number }
  | { type: 'coverage'; accountId: number; days: number }
  | { type: 'importFiles'; paths: string[]; accountId: number | null }
  | { type: 'generateSample'; orders: number }
  | { type: 'render'; request: unknown; filter: unknown; recap: unknown; outPath: string; mp4?: boolean }
  | { type: 'cacheImages' }
  | { type: 'refreshTracking' }
  | { type: 'flushOutbox' }
  | { type: 'reprocessFailed' };

export interface WorkerInit {
  dbPath: string;
  key: string;
  imageDir: string;
  fontDir: string;
}

export type WorkerEvent =
  | { kind: 'progress'; progress: SyncProgress }
  | { kind: 'import'; done: number; total: number; label: string }
  | { kind: 'sample'; done: number; total: number; phase: string }
  | { kind: 'dataChanged'; scope: string[] }
  | { kind: 'log'; level: 'info' | 'warn' | 'error'; message: string };

export type WorkerOut =
  | { type: 'ready' }
  | { type: 'event'; event: WorkerEvent }
  | { type: 'result'; id: number; ok: true; value: unknown }
  | { type: 'result'; id: number; ok: false; error: string };
