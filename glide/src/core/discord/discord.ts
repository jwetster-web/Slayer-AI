// Discord integration through the official REST API with a bot token.
// Member import needs the bot in the server with the Server Members intent.
// Notifications go only to a configured private admin channel or to the
// order owner's DMs; nothing per-order is ever posted to public channels.

import { formatCents } from '../../shared/format';
import { audit } from '../audit';
import { now, type Db } from '../db/database';
import { upsertMember } from '../identity/store';

const API = 'https://discord.com/api/v10';

export interface DiscordConfig {
  botToken: string;
  guildId: string;
  adminChannelId?: string;
}

type Fetch = typeof fetch;

async function call(cfg: DiscordConfig, path: string, init: RequestInit = {}, fetcher: Fetch = fetch, attempt = 0): Promise<any> {
  const res = await fetcher(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bot ${cfg.botToken}`, 'Content-Type': 'application/json', 'User-Agent': 'DiscordBot (https://pokeslayerz.gg, 0.1) GLIDE', ...(init.headers ?? {}) },
  });
  if (res.status === 429 && attempt < 5) {
    const j = (await res.json().catch(() => ({}))) as { retry_after?: number };
    await new Promise((r) => setTimeout(r, Math.ceil((j.retry_after ?? 1) * 1000)));
    return call(cfg, path, init, fetcher, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord ${res.status}: ${body.slice(0, 160)}`);
  }
  return res.status === 204 ? null : res.json();
}

export function avatarUrl(userId: string, hash: string | null | undefined, size = 128): string | null {
  if (!hash) return null;
  return `https://cdn.discordapp.com/avatars/${userId}/${hash}.${hash.startsWith('a_') ? 'gif' : 'png'}?size=${size}`;
}

export async function testConnection(cfg: DiscordConfig, fetcher?: Fetch) {
  const me = await call(cfg, '/users/@me', {}, fetcher);
  const guild = await call(cfg, `/guilds/${cfg.guildId}?with_counts=true`, {}, fetcher);
  return { bot: me.username as string, guild: guild.name as string, approxMembers: guild.approximate_member_count as number | undefined };
}

/** Imports or refreshes all guild members (stable IDs; username changes are recorded in history). */
export async function syncGuildMembers(db: Db, cfg: DiscordConfig, fetcher?: Fetch, onProgress?: (n: number) => void) {
  let after = '0';
  let total = 0;
  let created = 0;
  for (;;) {
    const page = (await call(cfg, `/guilds/${cfg.guildId}/members?limit=1000&after=${after}`, {}, fetcher)) as any[];
    if (!page.length) break;
    db.tx(() => {
      for (const m of page) {
        if (m.user?.bot) continue;
        const r = upsertMember(db, { discordId: m.user.id, username: m.user.username, displayName: m.nick ?? m.user.global_name ?? null, avatarUrl: avatarUrl(m.user.id, m.avatar ?? m.user.avatar) }, 'discord-sync');
        if (r.created) created++;
        total++;
      }
    });
    onProgress?.(total);
    after = page[page.length - 1].user.id;
    if (page.length < 1000) break;
  }
  audit(db, 'discord-sync', 'members_synced', 'discord', cfg.guildId, { total, created });
  return { total, created };
}

const EVENT_TITLE: Record<string, string> = {
  order_created: '✅ New successful order',
  tracking_added: '📦 Tracking number detected',
  out_for_delivery: '🚚 Out for delivery',
  delivered: '🏠 Delivered',
  order_canceled: '❌ Order canceled',
  partial_cancel: '⚠️ Items canceled',
  refund: '💸 Refund issued',
  shipped: '📦 Shipped',
};

export function formatNotification(kind: 'admin_channel' | 'member_dm', p: Record<string, any>) {
  const title = EVENT_TITLE[p.event] ?? 'Order update';
  const fields = [
    ...(p.item ? [{ name: 'Item', value: String(p.item).slice(0, 200), inline: false }] : []),
    { name: 'Retailer', value: String(p.retailer), inline: true },
    { name: 'Total', value: formatCents(Number(p.totalCents ?? 0), p.currency ?? 'USD'), inline: true },
    { name: 'Units', value: String(p.units ?? '—'), inline: true },
  ];
  if (kind === 'admin_channel') fields.push({ name: 'Member', value: String(p.member ?? 'Unassigned'), inline: true });
  // Order numbers only in DMs to the owner and the private admin channel; never tracking numbers or addresses.
  fields.push({ name: 'Order', value: `#${p.orderNumber}`, inline: true });
  return { embeds: [{ title, color: 0x5b8cff, fields, footer: { text: 'GLIDE · PokeSlayerz' }, timestamp: now() }], allowed_mentions: { parse: [] } };
}

/** Sends pending outbox notifications with retry/backoff. */
export async function flushOutbox(db: Db, cfg: DiscordConfig | null, fetcher?: Fetch, limit = 20) {
  const rows = db.all<{ id: number; channel_kind: 'admin_channel' | 'member_dm'; target: string; payload_json: string; attempts: number }>(
    "SELECT id, channel_kind, target, payload_json, attempts FROM notifications_outbox WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY id LIMIT ?",
    [now(), limit],
  );
  let sent = 0;
  for (const r of rows) {
    if (!cfg) {
      db.run("UPDATE notifications_outbox SET status = 'skipped', last_error = 'Discord not configured' WHERE id = ?", [r.id]);
      continue;
    }
    try {
      const body = JSON.stringify(formatNotification(r.channel_kind, JSON.parse(r.payload_json)));
      if (r.channel_kind === 'admin_channel') {
        if (!cfg.adminChannelId) throw new Error('no admin channel configured');
        await call(cfg, `/channels/${cfg.adminChannelId}/messages`, { method: 'POST', body }, fetcher);
      } else {
        const dm = await call(cfg, '/users/@me/channels', { method: 'POST', body: JSON.stringify({ recipient_id: r.target }) }, fetcher);
        await call(cfg, `/channels/${dm.id}/messages`, { method: 'POST', body }, fetcher);
      }
      db.run("UPDATE notifications_outbox SET status = 'sent', sent_at = ?, attempts = attempts + 1 WHERE id = ?", [now(), r.id]);
      sent++;
    } catch (e) {
      const attempts = r.attempts + 1;
      db.run('UPDATE notifications_outbox SET attempts = ?, last_error = ?, status = ?, next_attempt_at = ? WHERE id = ?', [
        attempts,
        (e as Error).message.slice(0, 200),
        attempts >= 5 ? 'failed' : 'pending',
        new Date(Date.now() + 2 ** attempts * 60000).toISOString(),
        r.id,
      ]);
    }
  }
  return sent;
}
