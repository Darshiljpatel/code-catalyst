import type { ContentOut, FindingOut, MeResponse, ResolutionAction, RunOut } from './types';

/** UI choices mirror workflow rules; server permissions and versions remain authoritative. */
export function resolutionActions(user: MeResponse | null, content: ContentOut, finding: FindingOut, run: RunOut | null): ResolutionAction[] {
  if (!user?.membership_id || !run || run.stale || ['queued', 'running'].includes(run.status) ||
      ['approved', 'changes_requested'].includes(content.state) || finding.run_id !== run.id ||
      finding.revision_id !== run.revision_id ||
      !content.revisions.some(revision => revision.id === run.revision_id && revision.number === content.current_revision)) return [];
  if (user.membership_id === content.creator_id) return ['request_exception', 'request_dismissal'];
  if (user.role !== 'reviewer' || user.membership_id !== content.reviewer_id) return [];
  const actions: ResolutionAction[] = ['confirm', 'grant_exception', 'reject_exception'];
  if (!(finding.category === 'facts_claims' && ['unsupported', 'contradicted'].includes(finding.evidence_status))) actions.splice(1, 0, 'dismiss');
  return actions;
}

export const resolutionLabels: Record<ResolutionAction, string> = {
  request_exception: 'Request a reviewer exception',
  request_dismissal: 'Request dismissal by the reviewer',
  confirm: 'Confirm violation',
  dismiss: 'Dismiss finding with rationale',
  grant_exception: 'Grant an exception for this revision',
  reject_exception: 'Reject exception request',
};
