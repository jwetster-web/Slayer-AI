import { useState } from 'react';
import { call } from '../lib/api';
import { useDebounced, useQuery } from '../lib/hooks';
import { Avatar, Input, cx } from './ui';

/** Searchable member picker (by username, display name, Discord ID, profile or email). */
export function MemberPicker({ onPick, excludeId, autoFocus }: { onPick: (m: { id: number; name: string }) => void; excludeId?: number | null; autoFocus?: boolean }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const { data } = useQuery(() => call('members.list', { search: dq, limit: 12, sort: 'spend' }), [dq], { live: false });
  return (
    <div>
      <Input autoFocus={autoFocus} placeholder="Search members by name, Discord ID, profile or email…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-2 max-h-72 space-y-1 overflow-auto">
        {data?.rows
          .filter((m) => m.id !== excludeId)
          .map((m) => (
            <button key={m.id} onClick={() => onPick({ id: m.id, name: m.displayName ?? m.username })} className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-white/5')}>
              <Avatar name={m.displayName ?? m.username} src={m.avatarUrl} size={30} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">{m.displayName ?? m.username}</div>
                <div className="truncate font-mono text-[11px] text-ink3">@{m.username}{m.discordId ? ` · ${m.discordId}` : ''}</div>
              </div>
              <span className="text-xs text-ink3">{m.profileCount} profiles</span>
            </button>
          ))}
        {data && !data.rows.length && <div className="px-3 py-6 text-center text-sm text-ink3">No members match.</div>}
      </div>
    </div>
  );
}
