import { now, type Db } from './db/database';

/** Records an audit entry. Callers must pass redacted detail (no secrets, no full PII). */
export function audit(db: Db, actor: string, action: string, entity: string, entityId: string | number | null, detail?: Record<string, unknown>) {
  db.run('INSERT INTO audit_log (at, actor, action, entity, entity_id, detail_json) VALUES (?, ?, ?, ?, ?, ?)', [
    now(),
    actor,
    action,
    entity,
    entityId === null ? null : String(entityId),
    detail ? JSON.stringify(detail) : null,
  ]);
}

/** Removes emails, long digit runs, street lines and tokens from free text before it is logged. */
export function redact(text: string, max = 400): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[number]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9 .]{2,40}\s(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|ct|court|way|pl|place)\b\.?/gi, '[street]')
    .replace(/\b(?:\+?1[ -.]?)?\(?\d{3}\)?[ -.]?\d{3}[ -.]?\d{4}\b/g, '[phone]')
    .replace(/(access_token|refresh_token|password|token|secret)=([^&\s]+)/gi, '$1=[redacted]')
    .slice(0, max);
}
