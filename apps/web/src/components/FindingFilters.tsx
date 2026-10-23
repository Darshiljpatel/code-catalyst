import type { FindingOut } from '../api/types';
import { ALL_FINDINGS, unresolvedBlockers, type FindingFilters as FilterValues } from '../api/findingFilters';
import { categoryLabel } from './categoryLabel';

export function FindingFilters({ findings, visibleCount, values, onChange }: { findings: FindingOut[]; visibleCount: number; values: FilterValues; onChange: (values: FilterValues) => void }) {
  const blockers = unresolvedBlockers(findings).length;
  return <div className="finding-filters">
    <div className="finding-filters__fields">
      <div><label htmlFor="finding-category-filter">Finding category</label>
        <select className="input" id="finding-category-filter" value={values.category} onChange={e => onChange({ ...values, category: e.target.value })}>
          <option value="all">All categories</option>
          {[...new Set(findings.map(f => f.category))].map(category => <option key={category} value={category}>{categoryLabel(category)}</option>)}
        </select></div>
      <div><label htmlFor="finding-severity-filter">Finding severity</label>
        <select className="input" id="finding-severity-filter" value={values.severity} onChange={e => onChange({ ...values, severity: e.target.value })}>
          <option value="all">All severities</option><option value="blocker">Blocker</option><option value="warning">Warning</option><option value="advisory">Advisory</option>
        </select></div>
      <div><label htmlFor="finding-disposition-filter">Finding disposition</label>
        <select className="input" id="finding-disposition-filter" value={values.disposition} onChange={e => onChange({ ...values, disposition: e.target.value })}>
          <option value="all">All dispositions</option><option value="unresolved">Unresolved</option><option value="open">Open</option><option value="requested">Requests pending</option><option value="confirmed">Confirmed</option><option value="dismissed">Dismissed</option><option value="exception">Exception granted</option><option value="exception_rejected">Exception rejected</option>
        </select></div>
    </div>
    <p role="status">Showing {visibleCount} of {findings.length} findings. {blockers} unresolved {blockers === 1 ? 'blocker' : 'blockers'} across this run.</p>
    <div className="finding-filters__actions">
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange(ALL_FINDINGS)}>Clear finding filters</button>
      {blockers > 0 && <button type="button" className="btn btn--secondary btn--sm" onClick={() => onChange({ category: 'all', severity: 'blocker', disposition: 'unresolved' })}>Show unresolved blockers</button>}
    </div>
    <small>Dismissals and granted exceptions are excluded from unresolved counts. Staged fixes are confirmed after rechecking.</small>
  </div>;
}
