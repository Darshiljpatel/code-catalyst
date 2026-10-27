import type { ImpactLevel } from '../api/types';

// eslint-disable-next-line react-refresh/only-export-components
export const LEVEL_LABEL: Record<ImpactLevel, string> = {
  confirmed: 'Confirmed',
  likely: 'Likely',
  possible: 'Possible',
};

const LEVEL_HINT: Record<ImpactLevel, string> = {
  confirmed: 'A finding cited the changed rule, or local checks now give different results.',
  likely: 'The copy mentions what the changed rule is about.',
  possible: 'The last review checked this guideline, with nothing more specific linking them.',
};

export function ImpactBadge({ level }: { level: ImpactLevel }) {
  return (
    <span className={`impact-badge impact-badge--${level}`} title={LEVEL_HINT[level]}>
      <span aria-hidden="true">{level === 'confirmed' ? '●' : level === 'likely' ? '◐' : '○'}</span> {LEVEL_LABEL[level]}
    </span>
  );
}

