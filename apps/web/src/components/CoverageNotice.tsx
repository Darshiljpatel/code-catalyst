import type { RunOut } from '../api/types';
import { incompleteCategories } from '../api/reviewReadiness';
import { categoryLabel } from './categoryLabel';

interface UnverifiedSuggestion { category: string | null; rule_id: string; content_quote: string; rationale: string; suggested_edit: string | null; error_code: string }

const rejection: Record<string, string> = {
  invalid_citation: 'cites a rule that is not in the approved sources',
  invalid_quote: 'misquotes the approved rule',
  invalid_location: 'quotes text that is not found exactly once in the draft',
  unsupported_edit_number: 'suggests an edit that adds a new number',
  duplicate_finding: 'repeats another finding',
};

const guidance: Record<string, string> = {
  input_budget_exceeded: 'The full external request exceeded its byte limit. Shorten the draft or reduce the relevant source material before retrying external review.',
  external_processing_disabled: 'External review was not authorised for this run. Enable it only with workspace approval and explicit consent, or use manual review.',
  external_processing_not_authorised: 'Nebius was not called for this run. Ask a workspace admin to enable external processing in Processing policy. Then select “For the next check: include external semantic review” and run the compliance check again. Manual review is also available.',
  provider_not_configured: 'External review is not configured on the server. Ask the workspace administrator to check the provider configuration.',
  provider_auth_failed: 'The provider rejected server authentication. Ask the workspace administrator to check its credentials.',
  rate_limited: 'The provider is temporarily rate limited. Wait before retrying, or ask the assigned reviewer to complete the missing checks.',
  provider_timeout: 'The provider did not respond in time. Retry the check when available, or use manual review.',
  provider_unreachable: 'The server could not reach the provider. Retry later or ask the administrator to check connectivity.',
  provider_http_error: 'The provider returned an error. Retry later or ask the administrator to inspect the server logs.',
  deadline_exceeded: 'Analysis reached its time limit. Retry the check, or ask the assigned reviewer to complete the missing categories.',
  attempts_exhausted: 'Analysis could not finish after its retry limit. Start a new check or ask the administrator to inspect the worker.',
  unverified_model_finding: 'The AI proposed a finding that failed evidence checks even after one correction attempt. It is listed below as an unverified suggestion; the reviewer decides whether it matters.',
  provider_request_rejected: 'The provider rejected the request. Retry later or ask the administrator to inspect the server logs.',
  snapshot_stale: 'Source guidelines changed during analysis. Recheck against the current approved sources.',
};

export function CoverageNotice({ run, canRecordManual }: { run: RunOut; canRecordManual: boolean }) {
  const missing = incompleteCategories(run);
  if (!missing.length || ['queued', 'running'].includes(run.status)) return null;
  const reasons = [...new Set(missing.map(category => run.checks.find(check => check.category === category)?.reason))];
  const semantic = run.engine_metadata?.semantic as { unverified_suggestions?: UnverifiedSuggestion[] } | undefined;
  const suggestions = semantic?.unverified_suggestions ?? [];
  const messages = [...new Set(reasons.map(reason => reason && guidance[reason]).filter((message): message is string => Boolean(message)))];
  return <section className="card" aria-label="Incomplete check coverage" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
    <h3 style={{ marginTop: 0 }}>Review coverage is incomplete</h3>
    <p>{missing.map(categoryLabel).join(', ')} still need a successful check or a recorded manual review. Zero findings do not establish compliance for these categories.</p>
    {messages.map(message => <p key={message}>{message}</p>)}
    {reasons.some(reason => !reason || !guidance[reason]) && <p>Some checks could not establish coverage. Inspect the category status and approved sources; retry analysis or complete a manual review.</p>}
    {suggestions.length > 0 && <div>
      <h4>Unverified AI suggestions</h4>
      <ul>
        {suggestions.map((s, index) => <li key={index}>
          <strong>{s.category ? categoryLabel(s.category) : 'Unknown category'}</strong> (rule {s.rule_id}): “{s.content_quote}”. {s.rationale}
          {' '}<em>Not shown as a finding because it {rejection[s.error_code] ?? 'failed evidence checks'}.</em>
        </li>)}
      </ul>
    </div>}
    <p>{run.stale ? 'Recheck the saved revision before recording manual checks.' : canRecordManual ? 'Use Manual category review below to inspect the revision and record evidence for each remaining category.' : 'Ask the assigned reviewer to record the remaining manual checks. A manager can assign a reviewer if needed.'}</p>
  </section>;
}
