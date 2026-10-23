import { RANGE_LABEL, type RangeId } from '../lib/ranges';
import { Input, Tabs } from './ui';

export function RangePicker({ value, onChange, custom, onCustom, options = ['today', '7d', '30d', '90d', 'all', 'custom'] }: { value: RangeId; onChange: (r: RangeId) => void; custom?: { from?: string; to?: string }; onCustom?: (c: { from?: string; to?: string }) => void; options?: RangeId[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tabs value={value} onChange={onChange} tabs={options.map((id) => ({ id, label: RANGE_LABEL[id] }))} />
      {value === 'custom' && onCustom && (
        <div className="flex items-center gap-2">
          <Input type="date" className="h-9 w-40" value={custom?.from ?? ''} onChange={(e) => onCustom({ ...custom, from: e.target.value })} />
          <span className="text-ink3">→</span>
          <Input type="date" className="h-9 w-40" value={custom?.to ?? ''} onChange={(e) => onCustom({ ...custom, to: e.target.value })} />
        </div>
      )}
    </div>
  );
}
