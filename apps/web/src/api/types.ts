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
}

// ---------------------------------------------------------------------------
// Me GET /api/v1/me
// ---------------------------------------------------------------------------
export interface MeResponse {
  user_id: string;
  org_id: string;
  role: 'creator' | 'manager' | 'reviewer' | 'admin';
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
// Health GET /api/v1/health/live, GET /api/v1/health/ready
// ---------------------------------------------------------------------------
export interface LiveResponse {
  status: 'live';
  phase: string;
}

export interface ReadyResponse {
  status: 'ready';
  scope: string;
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
}

export interface ContentOut {
  latest_run_id?: string | null;
  id: string;
  brand_id: string;
  title: string;
  creator_id: string;
  reviewer_id: string | null;
  current_revision: number;
  state: string;
  revisions: RevisionOut[];
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
  severity: string;
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

export interface BrandInsights {
  brand_id: string;
  confirmed_total: number;
  dismissed_total: number;
  ambiguous_total: number;
  reviewed_items_denominator: number;
}

export interface ExportRecord {
  revision_id: string;
  decision: DecisionOut;
  source_epoch: number;
  exported_at: string;
}

/** S4 reviewer discovery: scoped membership labels for assignment. */
export interface ReviewerOut {
  id: string;
  user_id: string;
  email: string;
}
