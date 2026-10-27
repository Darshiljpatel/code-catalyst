/**
 * BrandGuard API types — generated from contracts/openapi.json v0.3.0.
 *
 * Covers:
 *  - Authentication & Sessions (POST /sessions, DELETE /sessions/current, GET /me)
 *  - Brands (GET /brands, POST /brands, GET /brands/{id})
 *  - Sources (GET /brands/{id}/sources, POST /brands/{id}/sources, POST /sources/{id}/activate)
 *  - Content & Revisions (POST /content, GET /content/{id}, POST /content/{id}/revisions)
 *  - Analysis & Runs (POST /revisions/{id}/analysis, GET /runs/{id})
 *  - Processing Policy (GET /processing-policy, PUT /processing-policy)
 *  - S4 remaining stubs (decisions, comments, insights, export)
 */

// ---------------------------------------------------------------------------
// Shared error envelope (CONTRACTS.md: {code, message, request_id, details})
// ---------------------------------------------------------------------------
export interface ApiError {
  code: string;
  message: string;
  request_id: string;
  details: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Sessions POST /api/v1/sessions
// ---------------------------------------------------------------------------
export interface LoginRequest {
  email: string;
  password: string;
  org_id: string;
}

export interface LoginResponse {
  csrf_token: string;
  org_id: string;
  role: 'creator' | 'manager' | 'reviewer' | 'admin';
  label?: string | null;
  is_demo?: boolean;
  demo_expires_at?: string | null;
}

export interface DemoMember {
  membership_id: string;
  role: string;
  label: string;
  email: string;
}

export interface SandboxOut {
  org_id: string;
  role: string;
  membership_id: string;
  csrf_token: string;
  expires_at: string;
  members: DemoMember[];
}

// ---------------------------------------------------------------------------
// Me GET /api/v1/me
// ---------------------------------------------------------------------------
export interface MeResponse {
  membership_id?: string;
  csrf_token?: string;
  user_id: string;
  org_id: string;
  role: 'creator' | 'manager' | 'reviewer' | 'admin';
  label?: string;
  is_demo?: boolean;
  demo_expires_at?: string | null;
}

// ---------------------------------------------------------------------------
// Brands GET /api/v1/brands, GET /api/v1/brands/{id}, POST /api/v1/brands
// ---------------------------------------------------------------------------
export interface Brand {
  id: string;
  name: string;
  source_epoch: number;
}

export type BrandListResponse = Brand[];

export interface NewBrandRequest {
  name: string;
}

// ---------------------------------------------------------------------------
// Health GET /api/v1/health/{live,ready,worker,version}
// ---------------------------------------------------------------------------
export interface LiveResponse {
  status: 'live';
}

export type WorkerState = 'online' | 'offline' | 'unknown';

export interface ReadyResponse {
  status: 'ready';
  schema_revision: string;
  worker: WorkerState;
}

export interface WorkerHealthResponse {
  status: WorkerState;
  last_seen_at: string | null;
  age_seconds: number | null;
  worker_count: number;
  offline_after_seconds: number;
}

export interface VersionResponse {
  commit_sha: string;
  api_version: string;
  environment: string;
}

// ---------------------------------------------------------------------------
// Sources (S2)
// ---------------------------------------------------------------------------
export type RuleCategory =
  | 'terminology'
  | 'tone'
  | 'messaging'
  | 'facts_claims'
  | 'visual'
  | 'accessibility';

export type RuleKind =
  | 'terminology'
  | 'fact'
  | 'claim_policy'
  | 'guidance'
  | 'asset'
  | 'contrast'
  | 'alt_text';

export interface RuleInput {
  allowed_variants?: string[] | null;
  forbidden_variants?: string[] | null;
  id: string;
  category: RuleCategory;
  kind: RuleKind;
  key: string;
  value: string;
  evidence_quote: string;
}

export interface SourceInput {
  source_key: string;
  title: string;
  text: string;
  rules: RuleInput[];
  valid_from: string; // ISO datetime with timezone
  valid_until?: string | null;
}

export type SourceState = 'draft' | 'active' | 'retired' | string;

export interface SourceOut {
  id: string;
  brand_id: string;
  source_key: string;
  version: number;
  owner_id: string;
  title: string;
  text: string;
  text_hash: string;
  rules: RuleInput[];
  valid_from: string;
  valid_until: string | null;
  state: SourceState;
  created_at: string;
  activated_by: string | null;
  activated_at: string | null;
}

export interface ActivationInput {
  regression_acknowledgement?: string;
  expected_epoch: number;
  verified: true;
  retire_source_ids: string[];
  rationale: string;
}

// Backward-compatibility alias
export type SourceVersion = SourceOut;

// ---------------------------------------------------------------------------
// Content Items & Revisions (S2)
// ---------------------------------------------------------------------------
export interface ContentInput {
  brand_id: string;
  title: string;
  text: string;
  channel: string;
  audience: string;
  purpose: string;
  reviewer_id?: string | null;
}

export interface NewRevisionInput {
  parent_revision_id: string;
  text: string;
  channel: string;
  audience: string;
  purpose: string;
}

export interface RevisionOut {
  id: string;
  item_id: string;
  number: number;
  author_id: string;
  text: string;
  text_hash: string;
  channel: string;
  audience: string;
  purpose: string;
  created_at: string;
  asset_id?: string | null;
  asset_sha256?: string | null;
  region_map?: RegionMapEntry[] | null;
}

// ---------------------------------------------------------------------------
// Image campaigns (Improvement 2)
// ---------------------------------------------------------------------------
export interface NormBox { x: number; y: number; w: number; h: number }

export type RegionOrigin = 'ocr' | 'corrected' | 'added' | 'unreadable';

export interface RegionMapEntry {
  region_id: string;
  box: NormBox;
  ocr_text: string | null;
  final_text: string;
  confidence: number | null;
  origin: RegionOrigin;
  start: number | null;
  end: number | null;
}

export interface ImageInfo {
  asset_id: string;
  sha256: string;
  original_sha256: string;
  mime: string;
  width: number;
  height: number;
  intake: { channel: string; audience: string; purpose: string };
  ocr_status: 'queued' | 'running' | 'complete' | 'failed' | null;
  ocr_result_id: string | null;
}

export interface OcrLine { id: string; text: string; confidence: number; box: NormBox }

export interface OcrOut {
  id: string;
  asset_id: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
  engine: string;
  engine_version: string;
  params: Record<string, unknown>;
  lines: OcrLine[];
  mean_confidence: number | null;
  error_code: string | null;
  low_confidence_threshold: number;
  created_at: string;
  completed_at: string | null;
}

export interface RegionInput {
  region_id: string;
  box: NormBox;
  text: string;
  origin: RegionOrigin;
  ocr_line_id?: string | null;
  confirmed?: boolean;
}

export interface ContentOut {
  latest_run_id?: string | null;
  id: string;
  brand_id: string;
  title: string;
  creator_id: string;
  reviewer_id: string | null;
  current_revision: number;
  workflow_version: number;
  approval_stale: boolean;
  state: string;
  revisions: RevisionOut[];
  recheck?: RecheckNotice | null;
  image?: ImageInfo | null;
}

// ---------------------------------------------------------------------------
// Guideline change impact and re-review inbox (Improvement 1)
// ---------------------------------------------------------------------------
export type ImpactLevel = 'confirmed' | 'likely' | 'possible';
export type RecheckStatus = 'open' | 'recheck_queued' | 'awaiting_creator' | 'awaiting_reviewer' | 'resolved' | 'superseded';

export interface ImpactReason {
  code: string;
  detail: string;
}

export interface FindingDeltaEntry {
  rule_id: string;
  category: string;
  severity: string;
  start: number;
  end: number;
  quote?: string;
}

export interface FindingsDelta {
  added: FindingDeltaEntry[];
  removed: FindingDeltaEntry[];
  unchanged: number;
  new_blockers?: number;
  complete?: boolean;
  changed?: boolean;
}

export interface RecheckNotice {
  assignment_id: string;
  change_id: string;
  status: RecheckStatus;
  impact_level: ImpactLevel;
  reasons: ImpactReason[];
  state_before: string;
  findings_delta: FindingsDelta | null;
  guideline_title: string;
  from_version: number | null;
  to_version: number;
  changed_rules: number;
  changed_at: string;
}

export interface RuleDiffEntry {
  rule_id: string;
  before?: RuleInput;
  after?: RuleInput;
  fields?: string[];
  source_id?: string;
}

export interface RuleDiff {
  added: RuleDiffEntry[];
  removed: RuleDiffEntry[];
  modified: RuleDiffEntry[];
  unchanged: number;
  from_source: { id: string; version: number; title: string; text: string } | null;
  to_source: { id: string; version: number; title: string; text: string };
  retired_sources: { id: string; source_key: string; version: number; title: string }[];
}

export interface ImpactCounts {
  confirmed: number;
  likely: number;
  possible: number;
  total: number;
  not_affected: number;
  on_hold: number;
  brand_campaigns: number;
}

export interface ImpactEntry {
  item_id: string;
  title: string;
  state: string;
  creator_id: string;
  reviewer_id: string | null;
  revision_id: string;
  prior_run_id: string;
  impact_level: ImpactLevel;
  reasons: ImpactReason[];
  local_delta: FindingsDelta | null;
}

export interface ImpactPreview {
  source_id: string;
  brand_id: string;
  expected_epoch: number;
  retired_source_ids: string[];
  diff: RuleDiff;
  counts: ImpactCounts;
  entries: ImpactEntry[];
}

export interface GuidelineChangeSummary {
  id: string;
  brand_id: string;
  source_key: string;
  from_source_id: string | null;
  to_source_id: string;
  title: string;
  from_version: number | null;
  to_version: number;
  status: 'open' | 'closed';
  impact_counts: ImpactCounts;
  resolved: number;
  total: number;
  created_by: string;
  created_at: string;
  closed_at: string | null;
}

export interface RecheckAssignment {
  id: string;
  change_id: string;
  item_id: string;
  title: string;
  item_state: string;
  creator_id: string;
  revision_id: string;
  prior_run_id: string;
  prior_decision_id: string | null;
  state_before: string;
  impact_level: ImpactLevel;
  reasons: ImpactReason[];
  recheck_run_id: string | null;
  recheck_status: string | null;
  findings_delta: FindingsDelta | null;
  reviewer_id: string | null;
  status: RecheckStatus;
  resolved_decision_id: string | null;
  superseded_by: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface GuidelineChange extends GuidelineChangeSummary {
  diff: RuleDiff;
  assignments: RecheckAssignment[];
}

// ---------------------------------------------------------------------------
// Guideline improvement requests (Improvement 3)
// ---------------------------------------------------------------------------
export interface RuleHealth {
  source_id: string;
  source_key: string;
  source_title: string;
  rule_id: string;
  category: string;
  kind: string;
  value: string;
  flagged_items: number;
  confirmed_items: number;
  disputed_items: number;
  ambiguity_reports: number;
  dispute_rate: number | null;
  likely_unclear: boolean;
  open_request_id: string | null;
}

export interface GuidelineHealth {
  brand_id: string;
  window_days: number;
  unclear_threshold: number;
  dispute_definition: string;
  rules: RuleHealth[];
  open_requests: { id: string; title: string; rule_id: string | null; source_key: string; status: string }[];
}

export type RequestStatus = 'open' | 'in_review' | 'changes_requested' | 'approved' | 'activated' | 'withdrawn';
export type ExampleExpectation = 'flag' | 'no_flag' | 'unsure';

export interface RequestExample {
  id: string;
  item_id: string | null;
  revision_id: string | null;
  finding_id: string | null;
  kind: 'dispute' | 'ambiguity' | 'manual';
  excerpt: string;
  dispute: { actor_id?: string; action?: string; rationale?: string };
  expected: ExampleExpectation;
  labelled_by: string | null;
}

export interface ComparisonCase {
  case_id: string;
  label: string;
  text: string;
  expectations: { source_key: string; rule_id: string; expected: 'flag' | 'no_flag' }[];
  live: FindingDeltaEntry[];
  proposed: FindingDeltaEntry[];
  verdict: 'fixed' | 'regressed' | 'unchanged' | 'unstable' | 'changed' | 'not_run';
}

export interface SideMetrics {
  true_positives: number;
  false_positives: number;
  false_negatives: number;
  precision: number | null;
  recall: number | null;
}

export interface Comparison {
  id: string;
  request_id: string;
  proposed_source_id: string;
  proposed_hash: string;
  example_set_id: string;
  status: string;
  current: boolean;
  summary: {
    counts: Record<string, number>;
    verdict: string;
    cases: ComparisonCase[];
    live_metrics: SideMetrics;
    proposed_metrics: SideMetrics;
    ai: { status: string; reason: string };
  };
  created_by: string;
  created_at: string;
}

export interface RequestReview {
  id: string;
  reviewer_id: string;
  decision: 'approved' | 'changes_requested' | 'rejected';
  rationale: string;
  draft_hash: string;
  comparison_run_id: string | null;
  current: boolean;
  created_at: string;
}

export interface RequestGates {
  has_draft: boolean;
  comparison_current: boolean;
  comparison_run_id: string | null;
  approval_current: boolean;
  regressions: number;
  base_changed: boolean;
  can_activate: boolean;
}

export interface GuidelineRequestSummary {
  id: string;
  brand_id: string;
  source_key: string;
  rule_id: string | null;
  title: string;
  status: RequestStatus;
  created_by: string;
  assignee_id: string | null;
  created_at: string;
  updated_at: string;
  example_count: number;
}

export interface GuidelineRequest extends GuidelineRequestSummary {
  problem: string;
  base_source_id: string;
  draft_source_id: string | null;
  draft_hash: string | null;
  change_id: string | null;
  version: number;
  signals: Record<string, unknown>;
  examples: RequestExample[];
  base_source: SourceOut;
  draft_source: SourceOut | null;
  diff: RuleDiff | null;
  comparisons: Comparison[];
  reviews: RequestReview[];
  activity: { action: string; actor_id: string; created_at: string; details: Record<string, unknown> }[];
  gates: RequestGates;
}

export interface ExampleSet {
  id: string;
  brand_id: string;
  name: string;
  cases: { id: string; label: string; text: string; expectations: ComparisonCase['expectations']; origin_revision_id: string | null; external_ok: boolean }[];
}

export interface ActivationOut extends SourceOut {
  change_id: string;
  impact_counts: ImpactCounts;
}

// Compatibility aliases
export type ContentItem = ContentOut;
export type ContentRevision = RevisionOut;
export type ContentState =
  | 'draft'
  | 'analysing'
  | 'needs_changes'
  | 'ready_for_review'
  | 'incomplete'
  | 'in_review'
  | 'approved'
  | 'changes_requested'
  | string;

// ---------------------------------------------------------------------------
// Processing Policy (S3)
// ---------------------------------------------------------------------------
export interface PolicyOut {
  max_input_bytes: number;
  version: number;
  enabled: boolean;
  provider: string;
  model: string;
  boundary: string;
  notice: string;
}

export interface PolicyInput {
  enabled: boolean;
  expected_version: number;
  notice: string;
  rationale: string;
}

// ---------------------------------------------------------------------------
// Analysis & Runs (S2 & S3)
// ---------------------------------------------------------------------------
export interface AnalysisInput {
  external_processing_consent?: boolean;
  policy_version?: number | null;
}

export type CheckStatus =
  | 'complete'
  | 'unavailable'
  | 'failed'
  | 'needs_manual_review'
  | 'not_applicable';

export interface CheckOut {
  category: RuleCategory;
  status: CheckStatus;
  reason: string;
}

export interface FindingLocation {
  block_id?: string;
  start?: number;
  end?: number;
  quote?: string;
  image_bbox?: [number, number, number, number];
  field_name?: string;
  [key: string]: unknown;
}

export interface FindingOut {
  id: string;
  revision_id: string;
  run_id: string;
  category: string;
  severity: FindingSeverity;
  evidence_status: string;
  origin: string;
  source_version_id: string;
  rule_id: string;
  evidence_quote: string;
  location: FindingLocation;
  rationale: string;
  suggested_edit: string | null;
  resolution: string;
}

export interface RunOut {
  id: string;
  revision_id: string;
  source_epoch: number;
  source_snapshot: SourceOut[];
  checks: CheckOut[];
  status: string;
  created_at: string;
  stale: boolean;
  processing_snapshot: Record<string, unknown>;
  engine_metadata: Record<string, unknown>;
  findings: FindingOut[];
}

// Compatibility aliases
export type Finding = FindingOut;
export type ReviewRun = RunOut;
export type FindingCategory = RuleCategory;
export type FindingSeverity = 'blocker' | 'warning' | 'advisory' | string;
export type FindingEvidenceStatus =
  | 'supported_violation'
  | 'contradicted'
  | 'unsupported'
  | 'conflicting'
  | 'manual'
  | string;
export type FindingOrigin = 'deterministic' | 'model' | 'human' | string;
export type FindingResolution = 'open' | 'accepted' | 'dismissed' | 'exception' | string;

// ---------------------------------------------------------------------------
// Human Workflow & Review (S4)
// ---------------------------------------------------------------------------
export type DecisionKind = 'approved' | 'changes_requested';

export interface CommentInput {
  text: string;
  finding_id?: string | null;
}

export interface CommentOut {
  id: string;
  revision_id: string;
  finding_id: string | null;
  author_id: string;
  text: string;
  created_at: string;
}

// Compatibility alias
export type Comment = CommentOut;

export type ResolutionAction =
  | 'request_exception'
  | 'request_dismissal'
  | 'confirm'
  | 'dismiss'
  | 'grant_exception'
  | 'reject_exception';

export interface ResolutionInput {
  rationale: string;
  expected_item_version: number;
  action: ResolutionAction;
  source_version_ids?: string[];
}

export interface ResolutionOut {
  id: string;
  finding_id: string;
  actor_id: string;
  action: string;
  rationale: string;
  source_version_ids: string[];
  created_at: string;
}

export interface ReviewerOut {
  id: string;
  user_id: string;
  email: string;
}

export interface DecisionInput {
  rationale: string;
  expected_item_version: number;
  expected_run_id: string;
  expected_source_epoch: number;
  kind: DecisionKind;
}

export interface DecisionOut {
  id: string;
  revision_id: string;
  run_id: string;
  reviewer_id: string;
  kind: string;
  rationale: string;
  source_epoch: number;
  text_hash: string;
  decided_at: string;
}

// Compatibility alias
export type Decision = DecisionOut;

export interface ManualCheckInput {
  rationale: string;
  expected_item_version: number;
  category: RuleCategory;
  outcome: 'complete' | 'not_applicable';
  source_version_ids?: string[];
}

export interface ManualCheckOut {
  id: string;
  run_id: string;
  reviewer_id: string;
  category: string;
  outcome: string;
  rationale: string;
  source_version_ids: string[];
  created_at: string;
}

export interface ContentSummaryOut {
  id: string;
  brand_id: string;
  title: string;
  creator_id: string;
  reviewer_id: string | null;
  current_revision: number;
  workflow_version: number;
  approval_stale: boolean;
  state: string;
  created_at: string;
  recheck_status?: RecheckStatus | null;
}

export interface ContentPageOut {
  items: ContentSummaryOut[];
  total: number;
  limit: number;
  offset: number;
}

export interface SubmissionInput {
  expected_item_version: number;
  expected_run_id: string;
  expected_source_epoch: number;
  reviewer_id: string;
}

export interface ReviewRecordOut {
  run_id: string;
  workflow_version: number;
  stale: boolean;
  evidence: { effective_checks: CheckOut[]; [key: string]: unknown };
  decisions: DecisionOut[];
}

export interface ExportOut {
  revision_id: string;
  content_id: string;
  text: string;
  text_hash: string;
  channel: string;
  audience: string;
  purpose: string;
  decision: DecisionOut;
  evidence_record: Record<string, unknown>;
  exported_at: string;
}

export type ExportRecord = ExportOut;

export interface AmbiguityInput {
  rationale: string;
  rule_id?: string | null;
  revision_id?: string | null;
}

export interface AmbiguityOut {
  id: string;
  source_id: string;
  actor_id: string;
  rule_id: string | null;
  revision_id: string | null;
  rationale: string;
  created_at: string;
}

export interface RuleInsightOut {
  source_key: string;
  rule_id: string;
  category: string;
  confirmed_items: number;
  dismissed_items: number;
  exception_items: number;
  confirmed_per_reviewed_item: number | null;
}

export interface InsightsOut {
  brand_id: string;
  reviewed_items_denominator: number;
  denominator_definition: string;
  confirmed_total: number;
  dismissed_total: number;
  exception_total: number;
  ambiguous_total: number;
  ambiguity_definition: string;
  rules: RuleInsightOut[];
}

export type BrandInsights = InsightsOut;
