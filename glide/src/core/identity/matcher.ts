// Identity resolution: decides which Discord member an order belongs to.
//
// Each piece of evidence contributes an independent probability that the
// order belongs to a given member; scores combine with noisy-OR
// (1 - Π(1 - w)). An order is auto-assigned only when the top candidate is
// above the auto threshold AND clearly ahead of every other candidate.
// Everything else goes to the review queue with the evidence attached.

import { DEFAULT_SETTINGS, type AppSettings, type MatchEvidence } from '../../shared/types';
import { audit } from '../audit';
import { now, type Db } from '../db/database';
import { baseEmail, compareNames, emailDomain, isPublicEmailDomain, nameKey } from './normalize';
import { createProfile, linkEmail, linkProfileAddress, memberName, mergeMembers, setAddressOwner, upsertEmail } from './store';

export const WEIGHTS = {
  emailVerified: 0.97,
  emailBaseVerified: 0.9,
  emailProposed: 0.55,
  catchAllDomain: 0.75,
  addressVerifiedExclusive: 0.85,
  addressVerifiedShared: 0.25,
  addressProposed: 0.45,
  streetExclusive: 0.2,
  nameExact: 0.6,
  nameNickname: 0.45,
  nameInitial: 0.25,
  nameShared: 0.3,
  phoneExclusive: 0.85,
  phoneShared: 0.3,
  inboxOwner: 0.5,
} as const;

export interface Candidate {
  memberId: number;
  name: string;
  score: number;
  evidence: MatchEvidence[];
}

export interface MatchDecision {
  status: 'auto' | 'review' | 'unmatched';
  memberId: number | null;
  confidence: number;
  candidates: Candidate[];
  reason: string;
}

interface OrderFacts {
  id: number;
  purchase_email: string | null;
  recipient_name: string | null;
  phone_key: string | null;
  shipping_address_id: number | null;
  email_account_id: number | null;
}

export function gatherCandidates(db: Db, o: OrderFacts): Candidate[] {
  const map = new Map<number, Candidate>();
  const add = (memberId: number, signal: string, detail: string, weight: number) => {
    let c = map.get(memberId);
    if (!c) {
      c = { memberId, name: memberName(db, memberId) ?? `#${memberId}`, score: 0, evidence: [] };
      map.set(memberId, c);
    }
    // One signal type counts once per member (the strongest instance).
    const prev = c.evidence.find((e) => e.signal === signal);
    if (prev) {
      if (prev.weight >= weight) return;
      c.evidence = c.evidence.filter((e) => e !== prev);
    }
    c.evidence.push({ signal, detail, weight, memberId });
  };
  const live = (id: number | null) => (id ? db.value<number | null>('SELECT merged_into_id FROM members WHERE id = ?', [id]) ?? id : null);

  // Email evidence
  if (o.purchase_email) {
    const email = o.purchase_email.toLowerCase();
    const row = db.get<{ member_id: number | null; status: string }>('SELECT member_id, status FROM emails WHERE address = ?', [email]);
    if (row?.member_id) {
      const mid = live(row.member_id)!;
      if (row.status === 'verified') add(mid, 'email', 'Purchase email is verified for this member', WEIGHTS.emailVerified);
      else add(mid, 'email_proposed', 'Purchase email was previously seen on this member’s orders (unverified)', WEIGHTS.emailProposed);
    }
    const base = baseEmail(email);
    for (const r of db.all<{ member_id: number }>("SELECT DISTINCT member_id FROM emails WHERE base_address = ? AND address <> ? AND status = 'verified' AND member_id IS NOT NULL", [base, email])) {
      add(live(r.member_id)!, 'email_alias', 'Same mailbox as a verified email (dot/+tag variant)', WEIGHTS.emailBaseVerified);
    }
    const domain = emailDomain(email);
    if (domain && !isPublicEmailDomain(domain)) {
      const owners = db.all<{ member_id: number; n: number }>(
        "SELECT member_id, COUNT(*) AS n FROM emails WHERE address LIKE ? AND status = 'verified' AND member_id IS NOT NULL GROUP BY member_id",
        ['%@' + domain],
      );
      if (owners.length === 1 && owners[0].n >= 2) add(live(owners[0].member_id)!, 'catchall_domain', `Private domain @${domain} is used only by this member`, WEIGHTS.catchAllDomain);
    }
  }

  // Address evidence
  if (o.shipping_address_id) {
    const owners = db.all<{ member_id: number; status: string }>('SELECT member_id, status FROM address_owners WHERE address_id = ?', [o.shipping_address_id]);
    const verified = owners.filter((x) => x.status === 'verified');
    for (const ow of owners) {
      const mid = live(ow.member_id)!;
      if (ow.status === 'verified') {
        if (verified.length === 1) add(mid, 'address', 'Shipping address is verified and belongs only to this member', WEIGHTS.addressVerifiedExclusive);
        else add(mid, 'address_shared', `Shipping address is shared by ${verified.length} members`, WEIGHTS.addressVerifiedShared);
      } else {
        add(mid, 'address_proposed', 'Shipping address seen on this member’s orders (unverified)', WEIGHTS.addressProposed);
      }
    }
    if (!owners.length) {
      const street = db.value<string>('SELECT street_key FROM addresses WHERE id = ?', [o.shipping_address_id]);
      const neighbours = db.all<{ member_id: number }>(
        "SELECT DISTINCT ao.member_id FROM addresses a JOIN address_owners ao ON ao.address_id = a.id WHERE a.street_key = ? AND a.id <> ? AND ao.status = 'verified'",
        [street ?? '', o.shipping_address_id],
      );
      if (neighbours.length === 1) add(live(neighbours[0].member_id)!, 'street', 'Same building as a verified address (different unit)', WEIGHTS.streetExclusive);
    }
  }

  // Name evidence (against profiles)
  const nk = nameKey(o.recipient_name);
  if (nk.key && nk.last) {
    const profiles = db.all<{ member_id: number; name_key: string }>('SELECT member_id, name_key FROM profiles WHERE last_key = ? AND member_id IS NOT NULL', [nk.last]);
    const byMember = new Map<number, 'exact' | 'nickname' | 'initial'>();
    for (const p of profiles) {
      const sim = compareNames(nk, nameKey(p.name_key));
      if (sim === 'exact' || sim === 'nickname' || sim === 'initial') {
        const mid = live(p.member_id)!;
        const prev = byMember.get(mid);
        const rank = { exact: 3, nickname: 2, initial: 1 };
        if (!prev || rank[sim] > rank[prev]) byMember.set(mid, sim);
      }
    }
    const exactMembers = [...byMember.values()].filter((s) => s === 'exact').length;
    for (const [mid, sim] of byMember) {
      if (sim === 'exact') {
        if (exactMembers > 1) add(mid, 'name_shared', `Recipient name matches profiles of ${exactMembers} members`, WEIGHTS.nameShared);
        else add(mid, 'name', 'Recipient name matches a buying profile', WEIGHTS.nameExact);
      } else if (sim === 'nickname') add(mid, 'name_nickname', 'Recipient name matches a profile (nickname variant)', WEIGHTS.nameNickname);
      else add(mid, 'name_initial', 'Recipient initial and last name match a profile', WEIGHTS.nameInitial);
    }
  }

  // Phone evidence
  if (o.phone_key) {
    const ms = db.all<{ member_id: number }>('SELECT DISTINCT member_id FROM profiles WHERE phone_key = ? AND member_id IS NOT NULL', [o.phone_key]);
    for (const r of ms) add(live(r.member_id)!, ms.length === 1 ? 'phone' : 'phone_shared', ms.length === 1 ? 'Phone number matches a profile' : `Phone shared by ${ms.length} members`, ms.length === 1 ? WEIGHTS.phoneExclusive : WEIGHTS.phoneShared);
  }

  // Inbox owner
  if (o.email_account_id) {
    const owner = db.value<number | null>('SELECT owner_member_id FROM email_accounts WHERE id = ?', [o.email_account_id]);
    if (owner) add(live(owner)!, 'inbox', 'Order arrived in an inbox owned by this member', WEIGHTS.inboxOwner);
  }

  const out = [...map.values()].filter((c) => c.memberId);
  for (const c of out) c.score = 1 - c.evidence.reduce((p, e) => p * (1 - e.weight), 1);
  return out.sort((a, b) => b.score - a.score);
}

export function decide(cands: Candidate[], settings: Pick<AppSettings, 'autoMatchThreshold' | 'reviewThreshold'>): MatchDecision {
  const [top, second] = cands;
  if (!top) return { status: 'unmatched', memberId: null, confidence: 0, candidates: cands, reason: 'no linked evidence' };
  const margin = top.score - (second?.score ?? 0);
  if (top.score >= settings.autoMatchThreshold && margin >= 0.25 && (second?.score ?? 0) < 0.5) {
    return { status: 'auto', memberId: top.memberId, confidence: top.score, candidates: cands, reason: 'high confidence, unique' };
  }
  if (top.score >= settings.reviewThreshold) {
    const reason = top.score >= settings.autoMatchThreshold ? 'competing candidates' : 'confidence below auto threshold';
    return { status: 'review', memberId: top.memberId, confidence: top.score, candidates: cands, reason };
  }
  return { status: 'unmatched', memberId: null, confidence: top.score, candidates: cands, reason: 'evidence too weak' };
}

function chooseProfile(db: Db, memberId: number, o: OrderFacts, autoCreate: boolean, actor: string): number | null {
  const nk = nameKey(o.recipient_name);
  const profiles = db.all<{ id: number; name_key: string | null }>('SELECT id, name_key FROM profiles WHERE member_id = ?', [memberId]);
  if (o.shipping_address_id) {
    const withAddr = db.all<{ profile_id: number }>('SELECT pa.profile_id FROM profile_addresses pa JOIN profiles p ON p.id = pa.profile_id WHERE pa.address_id = ? AND p.member_id = ?', [o.shipping_address_id, memberId]);
    const both = withAddr.find((w) => profiles.find((p) => p.id === w.profile_id && p.name_key === nk.key));
    if (both) return both.profile_id;
  }
  const byName = profiles.find((p) => p.name_key && nk.key && p.name_key === nk.key);
  if (byName) return byName.id;
  if (o.purchase_email) {
    const viaEmail = db.value<number | null>('SELECT profile_id FROM emails WHERE address = ? AND member_id = ?', [o.purchase_email, memberId]);
    if (viaEmail) return viaEmail;
  }
  if (o.shipping_address_id) {
    const viaAddr = db.value<number>('SELECT pa.profile_id FROM profile_addresses pa JOIN profiles p ON p.id = pa.profile_id WHERE pa.address_id = ? AND p.member_id = ? LIMIT 1', [o.shipping_address_id, memberId]);
    if (viaAddr) return viaAddr;
  }
  if (autoCreate && o.recipient_name) {
    const pid = createProfile(db, { name: o.recipient_name, memberId, source: 'discovered' }, actor);
    return pid;
  }
  return profiles.length === 1 ? profiles[0].id : null;
}

function upsertCandidate(db: Db, c: {
  kind: string; orderId?: number | null; memberId?: number | null; otherMemberId?: number | null; emailId?: number | null; addressId?: number | null; profileId?: number | null;
  confidence: number; alternatives?: unknown[]; evidence?: MatchEvidence[]; dedupeKey: string;
}) {
  const existing = db.value<number>("SELECT id FROM match_candidates WHERE dedupe_key = ? AND status = 'pending'", [c.dedupeKey]);
  const vals = [c.memberId ?? null, c.otherMemberId ?? null, c.confidence, JSON.stringify(c.alternatives ?? []), JSON.stringify(c.evidence ?? [])];
  if (existing) {
    db.run('UPDATE match_candidates SET member_id = ?, other_member_id = ?, confidence = ?, alternatives_json = ?, evidence_json = ? WHERE id = ?', [...vals, existing]);
    return existing;
  }
  // A suggestion the admin already rejected is not raised again.
  const rejected = db.value<number>("SELECT id FROM match_candidates WHERE dedupe_key = ? AND status = 'rejected'", [c.dedupeKey]);
  if (rejected) return rejected;
  return db.run(
    `INSERT INTO match_candidates (kind, status, order_id, member_id, other_member_id, email_id, address_id, profile_id, confidence, alternatives_json, evidence_json, dedupe_key, created_at)
     VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [c.kind, c.orderId ?? null, c.memberId ?? null, c.otherMemberId ?? null, c.emailId ?? null, c.addressId ?? null, c.profileId ?? null, c.confidence, vals[3], vals[4], c.dedupeKey, now()],
  ).lastId;
}

/** Applies what an assignment teaches us: emails and addresses become proposed (auto) or verified (manual). */
function learn(db: Db, memberId: number, profileId: number | null, o: OrderFacts, verified: boolean, confidence: number, settings: AppSettings, actor: string) {
  if (o.purchase_email) {
    const emailId = upsertEmail(db, o.purchase_email);
    if (emailId) {
      const row = db.get<{ member_id: number | null; status: string }>('SELECT member_id, status FROM emails WHERE id = ?', [emailId])!;
      if (verified) linkEmail(db, emailId, memberId, profileId, 'verified', actor);
      else if (!row.member_id || (row.member_id === memberId && row.status !== 'verified')) {
        const autoLink = settings.autoLinkNewEmails && confidence >= settings.autoLinkEmailThreshold;
        linkEmail(db, emailId, memberId, profileId, autoLink ? 'verified' : 'proposed', actor);
        if (!autoLink) {
          upsertCandidate(db, {
            kind: 'email_link', emailId, memberId, orderId: o.id, confidence,
            evidence: [{ signal: 'order', detail: `Seen on order matched with ${(confidence * 100).toFixed(0)}% confidence`, weight: confidence }],
            dedupeKey: `email:${emailId}:${memberId}`,
          });
        }
      }
    }
  }
  if (o.shipping_address_id) {
    const owner = db.get<{ status: string }>('SELECT status FROM address_owners WHERE address_id = ? AND member_id = ?', [o.shipping_address_id, memberId]);
    if (verified) setAddressOwner(db, o.shipping_address_id, memberId, 'verified', actor);
    else if (!owner) {
      setAddressOwner(db, o.shipping_address_id, memberId, 'proposed', actor);
      const others = db.value<number>('SELECT COUNT(*) FROM address_owners WHERE address_id = ? AND member_id <> ?', [o.shipping_address_id, memberId]) ?? 0;
      upsertCandidate(db, {
        kind: 'address_link', addressId: o.shipping_address_id, memberId, orderId: o.id, confidence,
        evidence: [{ signal: 'order', detail: others ? `Address also used by ${others} other member(s) — possible shared household` : 'New shipping address for this member', weight: confidence }],
        dedupeKey: `address:${o.shipping_address_id}:${memberId}`,
      });
    }
    if (profileId) linkProfileAddress(db, profileId, o.shipping_address_id);
  }
}

function orderFacts(db: Db, orderId: number): OrderFacts | undefined {
  return db.get<OrderFacts>('SELECT id, purchase_email, recipient_name, phone_key, shipping_address_id, email_account_id FROM orders WHERE id = ?', [orderId]);
}

/** Runs matching for one order and persists the decision. Locked (manually verified) orders are left alone. */
export function matchOrder(db: Db, orderId: number, settings: AppSettings = DEFAULT_SETTINGS, actor = 'system'): MatchDecision | null {
  const locked = db.value<number>('SELECT match_locked FROM orders WHERE id = ?', [orderId]);
  if (locked) return null;
  const o = orderFacts(db, orderId);
  if (!o) return null;
  const cands = gatherCandidates(db, o);
  const d = decide(cands, settings);
  const evidenceJson = JSON.stringify(d.candidates[0]?.evidence ?? []);
  if (d.status === 'auto') {
    const profileId = chooseProfile(db, d.memberId!, o, true, actor);
    db.run('UPDATE orders SET member_id = ?, profile_id = ?, match_status = ?, match_confidence = ?, match_evidence_json = ?, updated_at = ? WHERE id = ?', [d.memberId, profileId, 'auto', d.confidence, evidenceJson, now(), orderId]);
    db.run("UPDATE match_candidates SET status = 'superseded', resolved_at = ? WHERE kind = 'order_assignment' AND order_id = ? AND status = 'pending'", [now(), orderId]);
    learn(db, d.memberId!, profileId, o, false, d.confidence, settings, actor);
  } else {
    db.run('UPDATE orders SET member_id = NULL, profile_id = NULL, match_status = ?, match_confidence = ?, match_evidence_json = ?, updated_at = ? WHERE id = ?', [d.status, d.confidence || null, evidenceJson, now(), orderId]);
    if (d.status === 'review') {
      upsertCandidate(db, {
        kind: 'order_assignment', orderId, memberId: d.memberId, confidence: d.confidence,
        alternatives: d.candidates.slice(1, 5).map((c) => ({ memberId: c.memberId, name: c.name, confidence: c.score })),
        evidence: d.candidates.flatMap((c) => c.evidence),
        dedupeKey: `order:${orderId}`,
      });
    }
  }
  return d;
}

/** Manual assignment from the UI or a review approval. Locks the order and verifies the learned identity links. */
export function assignOrder(db: Db, orderId: number, memberId: number | null, actor: string, settings: AppSettings = DEFAULT_SETTINGS, profileId?: number | null) {
  db.tx(() => {
    const o = orderFacts(db, orderId);
    if (!o) throw new Error('order not found');
    const prev = db.value<number | null>('SELECT member_id FROM orders WHERE id = ?', [orderId]);
    if (memberId === null) {
      db.run("UPDATE orders SET member_id = NULL, profile_id = NULL, match_status = 'unmatched', match_locked = 1, match_confidence = NULL, updated_at = ? WHERE id = ?", [now(), orderId]);
    } else {
      const pid = profileId ?? chooseProfile(db, memberId, o, true, actor);
      db.run("UPDATE orders SET member_id = ?, profile_id = ?, match_status = 'verified', match_locked = 1, match_confidence = 1, updated_at = ? WHERE id = ?", [memberId, pid, now(), orderId]);
      learn(db, memberId, pid, o, true, 1, settings, actor);
    }
    db.run("UPDATE match_candidates SET status = 'superseded', resolved_at = ?, resolved_by = ? WHERE kind = 'order_assignment' AND order_id = ? AND status = 'pending'", [now(), actor, orderId]);
    db.run('INSERT INTO identity_corrections (kind, payload_json, actor, created_at) VALUES (?, ?, ?, ?)', ['assign_order', JSON.stringify({ orderId, from: prev, to: memberId }), actor, now()]);
    audit(db, actor, 'order_assigned', 'order', orderId, { from: prev, to: memberId });
  });
}

/** Approve or reject a review candidate. */
export function resolveCandidate(db: Db, candidateId: number, approve: boolean, actor: string, settings: AppSettings = DEFAULT_SETTINGS, overrideMemberId?: number) {
  const c = db.get<{ id: number; kind: string; status: string; order_id: number | null; member_id: number | null; other_member_id: number | null; email_id: number | null; address_id: number | null }>(
    'SELECT * FROM match_candidates WHERE id = ?',
    [candidateId],
  );
  if (!c || c.status !== 'pending') throw new Error('candidate is not pending');
  const memberId = overrideMemberId ?? c.member_id;
  db.tx(() => {
    if (approve) {
      if (c.kind === 'order_assignment' && c.order_id && memberId) assignOrder(db, c.order_id, memberId, actor, settings);
      if (c.kind === 'email_link' && c.email_id && memberId) linkEmail(db, c.email_id, memberId, null, 'verified', actor);
      if (c.kind === 'address_link' && c.address_id && memberId) setAddressOwner(db, c.address_id, memberId, 'verified', actor);
      if (c.kind === 'member_merge' && memberId && c.other_member_id) {
        mergeMembers(db, memberId, c.other_member_id, actor);
      }
    } else {
      if (c.kind === 'email_link' && c.email_id) db.run("UPDATE emails SET member_id = NULL, status = 'unverified' WHERE id = ? AND status = 'proposed'", [c.email_id]);
      if (c.kind === 'address_link' && c.address_id && c.member_id) db.run("DELETE FROM address_owners WHERE address_id = ? AND member_id = ? AND status = 'proposed'", [c.address_id, c.member_id]);
    }
    db.run('UPDATE match_candidates SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?', [approve ? 'approved' : 'rejected', now(), actor, candidateId]);
    audit(db, actor, approve ? 'candidate_approved' : 'candidate_rejected', 'match_candidate', candidateId, { kind: c.kind, memberId });
  });
}

/** Finds likely duplicate member records (same verified mailbox or same profile name + address). */
export function scanDuplicateMembers(db: Db): number {
  let created = 0;
  const pairs = db.all<{ a: number; b: number; why: string }>(`
    SELECT DISTINCT e1.member_id AS a, e2.member_id AS b, 'Same mailbox ' || e1.base_address AS why
    FROM emails e1 JOIN emails e2 ON e1.base_address = e2.base_address AND e1.member_id < e2.member_id
    WHERE e1.status = 'verified' AND e2.status = 'verified'
    UNION
    SELECT DISTINCT p1.member_id, p2.member_id, 'Same profile name at the same address'
    FROM profiles p1 JOIN profile_addresses pa1 ON pa1.profile_id = p1.id
    JOIN profile_addresses pa2 ON pa2.address_id = pa1.address_id
    JOIN profiles p2 ON p2.id = pa2.profile_id AND p2.name_key = p1.name_key AND p1.member_id < p2.member_id
    UNION
    SELECT m1.id, m2.id, 'Same username without Discord ID'
    FROM members m1 JOIN members m2 ON m1.username = m2.username COLLATE NOCASE AND m1.id < m2.id
    WHERE (m1.discord_id IS NULL OR m2.discord_id IS NULL) AND m1.merged_into_id IS NULL AND m2.merged_into_id IS NULL
  `);
  for (const p of pairs) {
    if (!p.a || !p.b) continue;
    const before = db.value<number>('SELECT COUNT(*) FROM match_candidates');
    upsertCandidate(db, {
      kind: 'member_merge', memberId: p.a, otherMemberId: p.b, confidence: 0.6,
      evidence: [{ signal: 'duplicate', detail: p.why, weight: 0.6 }],
      dedupeKey: `merge:${p.a}:${p.b}`,
    });
    if ((db.value<number>('SELECT COUNT(*) FROM match_candidates') ?? 0) > (before ?? 0)) created++;
  }
  return created;
}
