import { Link } from 'react-router-dom';
import type { RecheckNotice } from '../api/types';

const NEXT_STEP: Record<string, { creator: string; reviewer: string; manager: string }> = {
  open: {
    creator: 'Nothing to do yet. BrandGuard will recheck this campaign against the new rules.',
    reviewer: 'Nothing to do yet. The recheck has not started.',
    manager: 'The recheck has not been queued. Re-queue it from the re-review inbox.',
  },
  recheck_queued: {
    creator: 'Nothing to do yet. BrandGuard is rechecking this campaign against the new rules.',
    reviewer: 'Rechecking now. You will be asked to re-approve once it finishes.',
    manager: 'Rechecking now.',
  },
  awaiting_creator: {
    creator: 'Action needed: the new rules flag something in this copy. Revise it and submit for review again.',
    reviewer: 'Waiting for the creator to revise the copy.',
    manager: 'Waiting for the creator to revise the copy.',
  },
  awaiting_reviewer: {
    creator: 'Nothing to change: your copy still passes. The reviewer will re-approve it against the new rules.',
    reviewer: 'Action needed: review the recheck below and re-approve, or request changes.',
    manager: 'Waiting for the reviewer to re-approve.',
  },
};

/** Explains a guideline-change recheck without opening the guideline. */
export function RecheckBanner({ notice, viewer }: { notice: RecheckNotice; viewer: 'creator' | 'reviewer' | 'manager' }) {
  const delta = notice.findings_delta;
  const finished = notice.status === 'awaiting_creator' || notice.status === 'awaiting_reviewer';
  const version = notice.from_version ? `version ${notice.from_version} to ${notice.to_version}` : `a new version ${notice.to_version}`;
  if (notice.routing === 'keep') {
    const what = notice.state_before === 'approved' ? 'approval' : 'place in review';
    return (
      <section className="recheck-banner" aria-labelledby="recheck-banner-title">
        <h2 id="recheck-banner-title">Rechecking: “{notice.guideline_title}” changed</h2>
        <p>
          A manager updated this guideline from {version} on {new Date(notice.changed_at).toLocaleString()}. Nothing in this
          campaign points at the changed rules, so it keeps its {what} while BrandGuard rechecks it against the new version.
          It goes back to the reviewer only if the recheck finds a change.
          {notice.state_before === 'approved' ? ' Export is paused until the recheck finishes.' : ''}
        </p>
        <p><strong>Why it is listed:</strong> {notice.reasons.map(r => r.detail).join(' ')}</p>
        <p><strong>Next step:</strong> Nothing to do.</p>
        {viewer === 'manager' && <Link className="text-link" to={`/rechecks/${notice.change_id}`}>Open in the re-review inbox →</Link>}
      </section>
    );
  }
  return (
    <section className="recheck-banner" aria-labelledby="recheck-banner-title">
      <h2 id="recheck-banner-title">Recheck required: “{notice.guideline_title}” changed</h2>
      <p>
        A manager updated this guideline from {version} on {new Date(notice.changed_at).toLocaleString()} ({notice.changed_rules} rule
        {notice.changed_rules === 1 ? '' : 's'} changed). This campaign’s last review relied on the old version, so it is on hold
        {notice.state_before === 'approved' ? ' and cannot be exported until it is re-approved' : ''}.
      </p>
      <p><strong>Why:</strong> {notice.reasons.map(r => r.detail).join(' ')}</p>
      {finished && delta && (
        <p>
          <strong>Recheck result:</strong> {delta.added.length} new finding{delta.added.length === 1 ? '' : 's'}
          {delta.new_blockers ? ` (${delta.new_blockers} blocking)` : ''}, {delta.removed.length} cleared, {delta.unchanged} unchanged.
        </p>
      )}
      <p><strong>Next step:</strong> {NEXT_STEP[notice.status]?.[viewer] ?? 'Done.'}</p>
      {viewer === 'manager' && <Link className="text-link" to={`/rechecks/${notice.change_id}`}>Open in the re-review inbox →</Link>}
    </section>
  );
}
