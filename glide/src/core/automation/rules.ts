// Automation engine. Rules react to domain events (or a daily schedule) and
// run actions. Every (rule, event) pair executes at most once, enforced by a
// unique index, so replays and duplicate emails never double-notify.

import type { AppSettings } from '../../shared/types';
import { now, json, type Db } from '../db/database';
import type { DomainEvent, DomainEventKind } from '../events';

export type RuleTrigger = DomainEventKind | 'schedule_daily';

export type RuleAction =
  | { type: 'record_member_stats' }
  | { type: 'discord_notify'; channel: 'admin_channel' | 'member_dm' }
  | { type: 'ensure_delivered_milestone' }
  | { type: 'queue_identity_review' }
  | { type: 'generate_daily_recap'; template: string; format: 'png' | 'jpg' | 'webp' | 'pdf' }
  | { type: 'parser_failure_alert'; threshold: number };

export interface RuleDef {
  key: string;
  name: string;
  description: string;
  trigger: RuleTrigger;
  triggers?: RuleTrigger[];
  actions: RuleAction[];
  enabled: boolean;
}

export const BUILTIN_RULES: RuleDef[] = [
  { key: 'A_spending', name: 'Update member spending', description: 'When a new order is matched to a member, refresh their spending totals and leaderboard position.', trigger: 'order_created', triggers: ['order_created', 'match_auto'], actions: [{ type: 'record_member_stats' }], enabled: true },
  { key: 'B_tracking', name: 'Tracking found', description: 'When tracking appears, attach it to the package and (optionally) DM the order owner.', trigger: 'tracking_added', actions: [{ type: 'discord_notify', channel: 'member_dm' }], enabled: false },
  { key: 'C_new_email', name: 'Unknown email at verified address', description: 'When an unknown email uses a verified address, evaluate the identity relationship and link safely or request approval.', trigger: 'match_review', triggers: ['match_review', 'match_auto'], actions: [{ type: 'queue_identity_review' }], enabled: true },
  { key: 'D_cancel', name: 'Cancellation analytics', description: 'When an order is canceled, update financial and fulfillment analytics and notify admins.', trigger: 'order_canceled', triggers: ['order_canceled', 'partial_cancel'], actions: [{ type: 'record_member_stats' }, { type: 'discord_notify', channel: 'admin_channel' }], enabled: true },
  { key: 'E_delivered', name: 'Delivered milestone', description: 'When an order is delivered, add the final milestone to its timeline.', trigger: 'delivered', actions: [{ type: 'ensure_delivered_milestone' }], enabled: true },
  { key: 'F_daily_recap', name: 'Daily Cook Recap', description: 'At the configured time, render a Galactic Checkout Recap of the day’s recorded orders.', trigger: 'schedule_daily', actions: [{ type: 'generate_daily_recap', template: 'galactic', format: 'png' }], enabled: false },
  { key: 'G_parser_alert', name: 'Parser failure alert', description: 'When a retailer parser fails repeatedly, raise a diagnostics alert with a redacted example.', trigger: 'parser_failure', actions: [{ type: 'parser_failure_alert', threshold: 3 }], enabled: true },
  { key: 'H_new_order_admin', name: 'New order → admin channel', description: 'Post each successful checkout to the private admin channel.', trigger: 'order_created', actions: [{ type: 'discord_notify', channel: 'admin_channel' }], enabled: false },
  { key: 'I_delivered_dm', name: 'Delivered → member DM', description: 'DM the member when their package is delivered.', trigger: 'delivered', actions: [{ type: 'discord_notify', channel: 'member_dm' }], enabled: false },
  { key: 'J_out_for_delivery_dm', name: 'Out for delivery → member DM', description: 'DM the member the morning their package is out for delivery.', trigger: 'out_for_delivery', actions: [{ type: 'discord_notify', channel: 'member_dm' }], enabled: false },
  { key: 'K_shipping_admin', name: 'Shipping updates → admin channel', description: 'Post out-for-delivery and delivered updates for every order to the private admin channel.', trigger: 'delivered', triggers: ['out_for_delivery', 'delivered'], actions: [{ type: 'discord_notify', channel: 'admin_channel' }], enabled: false },
];

export function seedAutomationRules(db: Db) {
  for (const r of BUILTIN_RULES) {
    db.run(
      `INSERT INTO automation_rules (key, name, description, trigger, conditions_json, actions_json, enabled, builtin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT(key) DO UPDATE SET name = excluded.name, description = excluded.description, trigger = excluded.trigger, actions_json = excluded.actions_json, conditions_json = excluded.conditions_json`,
      [r.key, r.name, r.description, r.trigger, JSON.stringify({ triggers: r.triggers ?? [r.trigger] }), JSON.stringify(r.actions), r.enabled ? 1 : 0, now()],
    );
  }
}

export interface RuleRow {
  id: number;
  key: string;
  name: string;
  description: string;
  trigger: RuleTrigger;
  triggers: RuleTrigger[];
  actions: RuleAction[];
  enabled: boolean;
  executions: number;
  lastRunAt: string | null;
}

export function listRules(db: Db): RuleRow[] {
  return db
    .all<{ id: number; key: string; name: string; description: string; trigger: RuleTrigger; conditions_json: string; actions_json: string; enabled: number; executions: number; last_run: string | null }>(
      `SELECT r.*, (SELECT COUNT(*) FROM automation_executions e WHERE e.rule_id = r.id) AS executions,
              (SELECT MAX(executed_at) FROM automation_executions e WHERE e.rule_id = r.id) AS last_run
       FROM automation_rules r ORDER BY r.key`,
    )
    .map((r) => ({
      id: r.id, key: r.key, name: r.name, description: r.description, trigger: r.trigger,
      triggers: json<{ triggers?: RuleTrigger[] }>(r.conditions_json, {}).triggers ?? [r.trigger],
      actions: json<RuleAction[]>(r.actions_json, []), enabled: !!r.enabled, executions: r.executions, lastRunAt: r.last_run,
    }));
}

export interface AutomationHooks {
  /** Called for daily recap generation; implemented by the export engine host. */
  generateRecap?: (template: string, format: string, day: string) => Promise<string | null> | string | null;
}

function notificationPayload(db: Db, e: DomainEvent, channel: 'admin_channel' | 'member_dm'): { target: string; payload: Record<string, unknown> } | null {
  if (!e.orderId) return null;
  const o = db.get<{ order_number: string; retailer: string; total_cents: number; currency: string; units: number; member_id: number | null; discord_id: string | null; username: string | null; item: string | null }>(
    `SELECT o.order_number, r.name AS retailer, o.total_cents, o.currency, o.units, o.member_id, m.discord_id, m.username,
            (SELECT oi.title FROM order_items oi WHERE oi.order_id = o.id ORDER BY oi.line_total_cents DESC LIMIT 1) AS item
     FROM orders o JOIN retailers r ON r.id = o.retailer_id LEFT JOIN members m ON m.id = o.member_id WHERE o.id = ?`,
    [e.orderId],
  );
  if (!o) return null;
  if (channel === 'member_dm') {
    // DMs go only to the order's own member, identified by stable Discord ID.
    if (!o.discord_id) return null;
    return { target: o.discord_id, payload: { event: e.kind, retailer: o.retailer, orderNumber: o.order_number, totalCents: o.total_cents, currency: o.currency, units: o.units, item: o.item, packageId: e.packageId ?? null } };
  }
  return { target: 'admin', payload: { event: e.kind, retailer: o.retailer, orderNumber: o.order_number, totalCents: o.total_cents, currency: o.currency, units: o.units, item: o.item, member: o.username ?? 'Unassigned' } };
}

export async function runAutomations(db: Db, events: DomainEvent[], settings: AppSettings, hooks: AutomationHooks = {}): Promise<number> {
  const rules = listRules(db).filter((r) => r.enabled);
  let executed = 0;
  for (const e of events) {
    for (const rule of rules) {
      if (!rule.triggers.includes(e.kind)) continue;
      const ins = db.run('INSERT OR IGNORE INTO automation_executions (rule_id, event_key, status, detail, executed_at) VALUES (?, ?, ?, ?, ?)', [rule.id, e.key, 'ok', null, now()]);
      if (!ins.changes) continue; // already ran for this event
      executed++;
      const notes: string[] = [];
      try {
        for (const a of rule.actions) {
          switch (a.type) {
            case 'record_member_stats':
              notes.push(e.memberId ? `member ${e.memberId} totals refreshed` : 'no member yet');
              break;
            case 'queue_identity_review':
              notes.push(e.kind === 'match_review' ? 'sent to Identity Review' : 'linked automatically (high confidence)');
              break;
            case 'ensure_delivered_milestone':
              if (e.orderId) {
                db.run(
                  "INSERT OR IGNORE INTO order_events (order_id, kind, label, occurred_at, source, detail_json, dedupe_key) VALUES (?, 'delivered_final', 'Final milestone: delivered', ?, 'system', NULL, ?)",
                  [e.orderId, e.at, `final:${e.orderId}:${e.packageId ?? 'o'}`],
                );
                notes.push('milestone recorded');
              }
              break;
            case 'discord_notify': {
              if (!settings.discordEnabled) {
                notes.push('discord disabled');
                break;
              }
              const n = notificationPayload(db, e, a.channel);
              if (!n) {
                notes.push('no eligible recipient');
                break;
              }
              db.run(
                'INSERT OR IGNORE INTO notifications_outbox (channel_kind, target, payload_json, dedupe_key, status, created_at, next_attempt_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [a.channel, n.target, JSON.stringify(n.payload), `${rule.key}:${e.key}:${a.channel}`, 'pending', now(), now()],
              );
              notes.push(`queued ${a.channel}`);
              break;
            }
            case 'parser_failure_alert': {
              const count = db.value<number>("SELECT COUNT(*) FROM source_messages WHERE parse_status = 'failed' AND retailer_id = ? AND created_at >= ?", [e.retailerId ?? null, new Date(Date.now() - 86400000).toISOString()]) ?? 0;
              if (count >= a.threshold) {
                db.run(
                  "INSERT OR IGNORE INTO activity_feed (at, kind, retailer_id, label, dedupe_key) VALUES (?, 'parser_failure', ?, ?, ?)",
                  [now(), e.retailerId ?? null, `Parser failing repeatedly (${count} in 24h) — see Diagnostics`, `pfa:${e.retailerId}:${new Date().toISOString().slice(0, 10)}`],
                );
                notes.push(`alert raised (${count})`);
              }
              break;
            }
            case 'generate_daily_recap':
              if (hooks.generateRecap) {
                const out = await hooks.generateRecap(a.template, a.format, e.at.slice(0, 10));
                notes.push(out ? `recap saved: ${out}` : 'no orders for the day');
              }
              break;
          }
        }
        db.run('UPDATE automation_executions SET detail = ? WHERE rule_id = ? AND event_key = ?', [notes.join('; '), rule.id, e.key]);
      } catch (err) {
        db.run('UPDATE automation_executions SET status = ?, detail = ? WHERE rule_id = ? AND event_key = ?', ['error', (err as Error).message.slice(0, 300), rule.id, e.key]);
      }
    }
  }
  return executed;
}

export function setRuleEnabled(db: Db, ruleId: number, enabled: boolean) {
  db.run('UPDATE automation_rules SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, ruleId]);
}

export function ruleExecutions(db: Db, ruleId: number, limit = 50) {
  return db.all<{ id: number; event_key: string; status: string; detail: string | null; executed_at: string }>('SELECT id, event_key, status, detail, executed_at FROM automation_executions WHERE rule_id = ? ORDER BY id DESC LIMIT ?', [ruleId, limit]);
}
