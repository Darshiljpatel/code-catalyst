/**
 * BrandGuard API types — generated from contracts/openapi.json v0.1.0 (S1 scope).
 * DO NOT edit by hand. Re-generate from the committed OpenAPI spec when Sanath
 * publishes a new contract version.
 *
 * Phase coverage: sessions, /me, brands, health.
 * S2+ endpoints (sources, content, revisions, runs, findings, decisions, export,
 * insights, demo-sessions) are PENDING — stubs marked with @pending.
 */

// ---------------------------------------------------------------------------
// Shared error envelope  (CONTRACTS.md: {code, message, request_id, details})
// ---------------------------------------------------------------------------
export interface ApiError {
  code: string;
  message: string;
  request_id: string;
  details: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Sessions  POST /api/v1/sessions
// ---------------------------------------------------------------------------
export interface LoginRequest {
  email: string;
  password: string;
  org_id: string;
}

/** Response body from POST /api/v1/sessions (200) */
export interface LoginResponse {
  csrf_token: string;
  org_id: string;
  role: 'creator' | 'manager' | 'reviewer' | 'admin';
}

// ---------------------------------------------------------------------------
// Me  GET /api/v1/me
// ---------------------------------------------------------------------------
export interface MeResponse {
  user_id: string;
  org_id: string;
  role: 'creator' | 'manager' | 'reviewer' | 'admin';
}

// ---------------------------------------------------------------------------
// Brands  GET /api/v1/brands, GET /api/v1/brands/:id, POST /api/v1/brands
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
// Health  GET /api/v1/health/live, GET /api/v1/health/ready
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
// @pending — S2 types (stubs only; do not implement UI against these yet)
// ---------------------------------------------------------------------------

/** @pending S2 — source lifecycle */
export interface SourceVersion {
  id: string;
  brand_id: string;
  org_id: string;
  version: number;
  text_hash: string;
  activated_at: string | null;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
}

/** @pending S2 — content + revision */
export interface ContentItem {
  id: string;
  org_id: string;
  brand_id: string;
  state: ContentState;
  current_revision_id: string | null;
}

export type ContentState =
  | 'draft'
  | 'analysing'
  | 'needs_changes'
  | 'ready_for_review'
  | 'incomplete'
  | 'in_review'
  | 'approved'
  | 'changes_requested';

export interface ContentRevision {
  id: string;
  content_id: string;
  parent_revision_id: string | null;
  author_id: string;
  created_at: string;
  channel: string | null;
  audience: string | null;
  purpose: string | null;
  text_hash: string;
}

/** @pending S3 — finding (CONTRACTS.md full shape) */
export type FindingCategory =
  | 'terminology'
  | 'tone'
  | 'messaging'
  | 'facts_claims'
  | 'visual'
  | 'accessibility';

export type FindingSeverity = 'blocker' | 'warning' | 'advisory';

export type FindingEvidenceStatus =
  | 'supported_violation'
  | 'contradicted'
  | 'unsupported'
  | 'conflicting'
  | 'manual';

export type FindingOrigin = 'deterministic' | 'model' | 'human';

export type FindingResolution = 'open' | 'accepted' | 'dismissed' | 'exception';

export interface Finding {
  id: string;
  org_id: string;
  revision_id: string;
  run_id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  evidence_status: FindingEvidenceStatus;
  origin: FindingOrigin;
  location: FindingLocation;
  rule_id: string | null;
  source_version_id: string | null;
  evidence_quote: string | null;
  rationale: string;
  suggested_edit: string | null;
  resolution: FindingResolution;
}

export interface FindingLocation {
  block_id: string;
  start: number;
  end: number;
  image_bbox?: [number, number, number, number];
  field_name?: string;
}

/** @pending S3 — review run */
export type CheckStatus =
  | 'complete'
  | 'unavailable'
  | 'failed'
  | 'needs_manual_review'
  | 'not_applicable';

export interface ReviewRun {
  id: string;
  revision_id: string;
  source_snapshot_epoch: number;
  started_at: string;
  completed_at: string | null;
  check_statuses: Record<string, CheckStatus>;
  incomplete_reason: string | null;
  model_id: string | null;
  prompt_version: string | null;
  engine_version: string | null;
}

/** @pending S4 — decision */
export type DecisionKind = 'approved' | 'changes_requested';

export interface Decision {
  id: string;
  revision_id: string;
  run_id: string;
  reviewer_id: string;
  kind: DecisionKind;
  rationale: string;
  decided_at: string;
  source_epoch_at_decision: number;
  is_stale: boolean;
}

/** @pending S4 — comment */
export interface Comment {
  id: string;
  revision_id: string;
  finding_id: string | null;
  author_id: string;
  text: string;
  created_at: string;
}

/** @pending S4 — insights */
export interface BrandInsights {
  brand_id: string;
  confirmed_total: number;
  dismissed_total: number;
  ambiguous_total: number;
  reviewed_items_denominator: number;
}

/** @pending S4 — export */
export interface ExportRecord {
  revision_id: string;
  decision: Decision;
  source_epoch: number;
  exported_at: string;
}
