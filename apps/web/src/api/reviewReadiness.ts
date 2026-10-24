import type { RunOut } from './types';
import { categoryLabel } from '../components/categoryLabel';
import { unresolvedBlockers } from './findingFilters';

export const REVIEW_CATEGORIES = ['terminology', 'tone', 'messaging', 'facts_claims', 'visual', 'accessibility'];
export function incompleteCategories(run: RunOut): string[] {
  return REVIEW_CATEGORIES.filter(category => !run.checks.some(check => check.category === category && ['complete', 'not_applicable'].includes(check.status)));
}

/** Advisory UI preflight. The server remains authoritative for submission. */
export function submissionIssues(run: RunOut | null, revisionId: string): string[] {
  if (!run || run.revision_id !== revisionId) return ['Check this revision before submitting it.'];
  if (['queued', 'running'].includes(run.status)) return ['The check is still running. Your draft is saved.'];
  const issues: string[] = [];
  if (run.stale) issues.push('Brand guidelines changed. Recheck against the latest sources.');
  const missing = incompleteCategories(run);
  if (missing.length) issues.push(`${missing.map(categoryLabel).join(', ')} still need a successful check or an assigned reviewer’s manual review. Local checks do not cover every category.`);
  const blockers = unresolvedBlockers(run.findings);
  if (blockers.length) issues.push(`${blockers.length} blocking ${blockers.length === 1 ? 'finding remains' : 'findings remain'}. Correct the draft and recheck, or ask the reviewer to record an exception.`);
  return issues;
}
