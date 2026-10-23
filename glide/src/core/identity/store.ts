import type { ParsedAddress } from '../../shared/types';
import { audit } from '../audit';
import { now, type Db } from '../db/database';
import { addressRawHash, baseEmail, maskPhone, nameKey, normalizeAddress, normalizeEmail, phoneKey } from './normalize';

// ---------------------------------------------------------------------------
// Addresses

export function upsertAddress(db: Db, a: ParsedAddress): number {
  const n = normalizeAddress(a);
  const ts = now();
  let id = db.value<number>('SELECT id FROM addresses WHERE canonical_key = ?', [n.canonicalKey]);
  if (!id) {
    id = db.run(
      'INSERT INTO addresses (canonical_key, street_key, line1, line2, city, state, postal, country, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [n.canonicalKey, n.streetKey, n.line1, n.line2, n.city, n.state, n.postal, n.country, ts],
    ).lastId;
  }
  const raw = [a.line1, a.line2, a.city, a.state, a.postal, a.country].filter(Boolean).join(', ');
  db.run('INSERT OR IGNORE INTO address_variants (address_id, raw, raw_hash, first_seen) VALUES (?, ?, ?, ?)', [id, raw, addressRawHash(a), ts]);
  return id;
}

export function setAddressOwner(db: Db, addressId: number, memberId: number, status: 'verified' | 'proposed', actor = 'system') {
  const prev = db.get<{ status: string }>('SELECT status FROM address_owners WHERE address_id = ? AND member_id = ?', [addressId, memberId]);
  if (prev?.status === 'verified' && status === 'proposed') return;
  db.run(
    `INSERT INTO address_owners (address_id, member_id, status, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(address_id, member_id) DO UPDATE SET status = excluded.status`,
    [addressId, memberId, status, now()],
  );
  if (status === 'verified') db.run('UPDATE addresses SET verified = 1 WHERE id = ?', [addressId]);
  if (prev?.status !== status) audit(db, actor, `address_owner_${status}`, 'address', addressId, { memberId });
}

export function linkProfileAddress(db: Db, profileId: number, addressId: number) {
  db.run('INSERT OR IGNORE INTO profile_addresses (profile_id, address_id) VALUES (?, ?)', [profileId, addressId]);
}

// ---------------------------------------------------------------------------
// Emails

export function upsertEmail(db: Db, address: string): number | null {
  const e = normalizeEmail(address);
  if (!e) return null;
  const ts = now();
  const id = db.value<number>('SELECT id FROM emails WHERE address = ?', [e]);
  if (id) {
    db.run('UPDATE emails SET last_seen = ? WHERE id = ?', [ts, id]);
    return id;
  }
  return db.run('INSERT INTO emails (address, base_address, status, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)', [e, baseEmail(e), 'unverified', ts, ts]).lastId;
}

export function linkEmail(db: Db, emailId: number, memberId: number, profileId: number | null, status: 'verified' | 'proposed', actor = 'system') {
  const prev = db.get<{ member_id: number | null; status: string }>('SELECT member_id, status FROM emails WHERE id = ?', [emailId]);
  if (!prev) return;
  // Never silently move a verified email to a different member.
  if (prev.status === 'verified' && prev.member_id && prev.member_id !== memberId && actor === 'system') return;
  if (prev.status === 'verified' && prev.member_id === memberId && status === 'proposed') return;
  db.run('UPDATE emails SET member_id = ?, profile_id = COALESCE(?, profile_id), status = ? WHERE id = ?', [memberId, profileId, status, emailId]);
  audit(db, actor, `email_${status}`, 'email', emailId, { memberId, previousMemberId: prev.member_id });
}

// ---------------------------------------------------------------------------
// Members and profiles

export interface MemberInput {
  discordId?: string | null;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  tags?: string[];
}

export function upsertMember(db: Db, m: MemberInput, actor = 'system'): { id: number; created: boolean } {
  const ts = now();
  if (m.discordId) {
    const existing = db.get<{ id: number; username: string; display_name: string | null }>('SELECT id, username, display_name FROM members WHERE discord_id = ?', [m.discordId]);
    if (existing) {
      if (existing.username !== m.username || (m.displayName ?? null) !== existing.display_name) {
        db.run('INSERT INTO discord_name_history (member_id, username, display_name, observed_at) VALUES (?, ?, ?, ?)', [existing.id, existing.username, existing.display_name, ts]);
        db.run('UPDATE members SET username = ?, display_name = COALESCE(?, display_name), avatar_url = COALESCE(?, avatar_url), updated_at = ? WHERE id = ?', [m.username, m.displayName ?? null, m.avatarUrl ?? null, ts, existing.id]);
      } else if (m.avatarUrl) {
        db.run('UPDATE members SET avatar_url = ?, updated_at = ? WHERE id = ?', [m.avatarUrl, ts, existing.id]);
      }
      return { id: existing.id, created: false };
    }
  } else {
    const byName = db.get<{ id: number }>('SELECT id FROM members WHERE discord_id IS NULL AND username = ? COLLATE NOCASE', [m.username]);
    if (byName) return { id: byName.id, created: false };
  }
  const id = db.run(
    'INSERT INTO members (discord_id, username, display_name, avatar_url, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [m.discordId ?? null, m.username, m.displayName ?? null, m.avatarUrl ?? null, JSON.stringify(m.tags ?? []), ts, ts],
  ).lastId;
  audit(db, actor, 'member_created', 'member', id, { discordId: m.discordId ?? null });
  return { id, created: true };
}

export interface ProfileInput {
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  memberId?: number | null;
  source?: string;
}

export function createProfile(db: Db, p: ProfileInput, actor = 'system'): number {
  const full = [p.firstName, p.lastName].filter(Boolean).join(' ') || p.name;
  const nk = nameKey(full);
  const id = db.run(
    'INSERT INTO profiles (member_id, name, first_name, last_name, name_key, last_key, phone_key, phone_masked, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [p.memberId ?? null, p.name, p.firstName ?? null, p.lastName ?? null, nk.key, nk.last, phoneKey(p.phone), maskPhone(p.phone), p.source ?? 'manual', now()],
  ).lastId;
  audit(db, actor, 'profile_created', 'profile', id, { memberId: p.memberId ?? null, source: p.source ?? 'manual' });
  return id;
}

export function assignProfile(db: Db, profileId: number, memberId: number | null, actor: string) {
  const prev = db.value<number | null>('SELECT member_id FROM profiles WHERE id = ?', [profileId]);
  db.run('UPDATE profiles SET member_id = ? WHERE id = ?', [memberId, profileId]);
  db.run('UPDATE emails SET member_id = ? WHERE profile_id = ?', [memberId, profileId]);
  audit(db, actor, 'profile_reassigned', 'profile', profileId, { from: prev ?? null, to: memberId });
}

/** Merges `fromId` into `intoId`. Everything owned by `fromId` moves; the record is kept as a tombstone. */
export function mergeMembers(db: Db, intoId: number, fromId: number, actor: string) {
  if (intoId === fromId) return;
  db.tx(() => {
    db.run('UPDATE profiles SET member_id = ? WHERE member_id = ?', [intoId, fromId]);
    db.run('UPDATE emails SET member_id = ? WHERE member_id = ?', [intoId, fromId]);
    db.run('UPDATE orders SET member_id = ? WHERE member_id = ?', [intoId, fromId]);
    db.run('UPDATE email_accounts SET owner_member_id = ? WHERE owner_member_id = ?', [intoId, fromId]);
    db.run(
      `INSERT INTO address_owners (address_id, member_id, status, created_at)
       SELECT address_id, ?, status, created_at FROM address_owners WHERE member_id = ?
       ON CONFLICT(address_id, member_id) DO UPDATE SET status = CASE WHEN excluded.status = 'verified' THEN 'verified' ELSE address_owners.status END`,
      [intoId, fromId],
    );
    db.run('DELETE FROM address_owners WHERE member_id = ?', [fromId]);
    db.run('INSERT OR IGNORE INTO campaign_signups (campaign_id, member_id, signed_up_at) SELECT campaign_id, ?, signed_up_at FROM campaign_signups WHERE member_id = ?', [intoId, fromId]);
    db.run('DELETE FROM campaign_signups WHERE member_id = ?', [fromId]);
    db.run('UPDATE match_candidates SET status = ? WHERE status = ? AND (member_id = ? OR other_member_id = ?)', ['superseded', 'pending', fromId, fromId]);
    const from = db.get<{ discord_id: string | null; username: string }>('SELECT discord_id, username FROM members WHERE id = ?', [fromId]);
    db.run('UPDATE members SET merged_into_id = ?, discord_id = NULL, updated_at = ? WHERE id = ?', [intoId, now(), fromId]);
    if (from?.discord_id) {
      const intoDiscord = db.value<string | null>('SELECT discord_id FROM members WHERE id = ?', [intoId]);
      if (!intoDiscord) db.run('UPDATE members SET discord_id = ? WHERE id = ?', [from.discord_id, intoId]);
    }
    db.run('INSERT INTO identity_corrections (kind, payload_json, actor, created_at) VALUES (?, ?, ?, ?)', ['merge', JSON.stringify({ intoId, fromId }), actor, now()]);
    audit(db, actor, 'members_merged', 'member', intoId, { fromId, fromUsername: from?.username });
  });
}

/** Splits the given profiles off into another (possibly new) member. */
export function splitProfiles(db: Db, profileIds: number[], target: { memberId?: number; newMember?: MemberInput }, actor: string): number {
  return db.tx(() => {
    const memberId = target.memberId ?? upsertMember(db, target.newMember!, actor).id;
    for (const pid of profileIds) {
      assignProfile(db, pid, memberId, actor);
      db.run('UPDATE orders SET member_id = ?, match_status = ?, match_locked = 1 WHERE profile_id = ?', [memberId, 'verified', pid]);
    }
    db.run('INSERT INTO identity_corrections (kind, payload_json, actor, created_at) VALUES (?, ?, ?, ?)', ['split', JSON.stringify({ profileIds, memberId }), actor, now()]);
    audit(db, actor, 'profiles_split', 'member', memberId, { profileIds });
    return memberId;
  });
}

export function memberName(db: Db, memberId: number | null): string | null {
  if (!memberId) return null;
  const r = db.get<{ username: string; display_name: string | null }>('SELECT username, display_name FROM members WHERE id = ?', [memberId]);
  return r ? r.display_name || r.username : null;
}
