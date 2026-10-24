import type { FindingOut } from './types';

export interface FindingFilters { category: string; severity: string; disposition: string }
export const ALL_FINDINGS: FindingFilters = { category: 'all', severity: 'all', disposition: 'all' };
export const unresolvedBlockers = (findings: FindingOut[]) => findings.filter(finding => finding.severity === 'blocker' && !['dismissed', 'exception'].includes(finding.resolution));

export function filterFindings(findings: FindingOut[], filters: FindingFilters): FindingOut[] {
  return findings.filter(finding => {
    const dispositionMatches = filters.disposition === 'all' ||
      (filters.disposition === 'unresolved' ? !['dismissed', 'exception'].includes(finding.resolution) :
        filters.disposition === 'requested' ? ['exception_requested', 'dismissal_requested'].includes(finding.resolution) :
          finding.resolution === filters.disposition);
    return (filters.category === 'all' || finding.category === filters.category) &&
      (filters.severity === 'all' || finding.severity === filters.severity) && dispositionMatches;
  });
}
