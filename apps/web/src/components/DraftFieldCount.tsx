import { DRAFT_LIMITS, draftFieldLength, type DraftField } from '../api/draftValidation';

export function DraftFieldCount({ field, value, id, inline = false }: { field: DraftField; value: string; id: string; inline?: boolean }) {
  const count = draftFieldLength(field, value), limit = DRAFT_LIMITS[field];
  const empty = !value.trim();
  return <small id={id} style={{ display: inline ? 'inline' : 'block', marginTop: inline ? 0 : 4, fontSize: '0.75rem', color: count > limit || empty ? 'var(--color-blocker)' : 'var(--text-muted)' }}
    title={`Counts Unicode code points to match the save limit.${field !== 'text' ? ' Outer spaces are excluded because they are not saved.' : ''}`}>
    {count.toLocaleString('en-US')} / {limit.toLocaleString('en-US')} characters{empty ? ' - required' : count > limit && ` - ${(count - limit).toLocaleString('en-US')} over`}
  </small>;
}
