// Typed client for the main-process handlers. The types come straight from
// electron/handlers.ts (type-only import; nothing from the main process is bundled).
import type { Handlers } from '../../../electron/handlers';

type Fn = (...args: never[]) => unknown;
export type Channel = keyof Handlers;
type Args<K extends Channel> = Handlers[K] extends Fn ? Parameters<Handlers[K]> : never;
type Ret<K extends Channel> = Handlers[K] extends Fn ? Awaited<ReturnType<Handlers[K]>> : never;

interface Bridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(cb: (e: unknown) => void): () => void;
  platform: string;
}

declare global {
  interface Window {
    glide: Bridge;
  }
}

export function call<K extends Channel>(channel: K, ...args: Args<K>): Promise<Ret<K>> {
  return window.glide.invoke(channel, ...args) as Promise<Ret<K>>;
}

export type ApiResult<K extends Channel> = Ret<K>;

export function onEvent(cb: (e: { kind: string; [k: string]: any }) => void) {
  return window.glide.on(cb as (e: unknown) => void);
}

export const platform = () => window.glide?.platform ?? 'unknown';
