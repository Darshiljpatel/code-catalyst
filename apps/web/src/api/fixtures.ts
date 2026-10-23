/**
 * Canonical fixture data — aligned to seed.py identities and CONTRACTS.md shapes.
 *
 * These fixtures are used in:
 *  1. Frontend mock transport (dev-only, import.meta.env.DEV guard)
 *  2. Contract validation tests (T26)
 *
 * Seed identities (seed.py):
 *   creator@lumadesk.test  → role: creator
 *   manager@lumadesk.test  → role: manager
 *   reviewer@lumadesk.test → role: reviewer
 *   admin@lumadesk.test    → role: admin
 *   org_id: use FIXTURE_ORG_ID below (matches seed output pattern)
 *
 * NOTE: Passwords are NOT in fixtures. The real API requires SEED_PASSWORD
 *       from the environment. These fixtures only cover responses.
 */

import type {
  LoginResponse,
  MeResponse,
  Brand,
  BrandListResponse,
  LiveResponse,
  ReadyResponse,
  ApiError,
  FindingOut,
  RunOut,
  SourceOut,
  PolicyOut,
  RevisionOut,
  ContentOut,
  Decision,
  Comment,
  ContentPageOut,
  InsightsOut,
  ExportOut,
  ReviewRecordOut,
  AmbiguityOut,
} from './types';

// ---------------------------------------------------------------------------
// Stable IDs for the synthetic LumaDesk workspace
// (deterministic UUIDs so fixtures are consistent across contributors)
// ---------------------------------------------------------------------------

export const FIXTURE_ORG_ID = 'aaaaaaaa-0000-4000-a000-000000000001';
export const FIXTURE_BRAND_ID = 'bbbbbbbb-0000-4000-a000-000000000001';
export const FIXTURE_CREATOR_USER_ID = 'cccccccc-0000-4000-a000-000000000001';
export const FIXTURE_MANAGER_USER_ID = 'cccccccc-0000-4000-a000-000000000002';
export const FIXTURE_REVIEWER_USER_ID = 'cccccccc-0000-4000-a000-000000000003';
export const FIXTURE_ADMIN_USER_ID = 'cccccccc-0000-4000-a000-000000000004';

// Synthetic content + revision IDs (S2 scope)
export const FIXTURE_CONTENT_ID = 'dddddddd-0000-4000-a000-000000000001';
export const FIXTURE_REVISION_ID_1 = 'eeeeeeee-0000-4000-a000-000000000001';
export const FIXTURE_REVISION_ID_2 = 'eeeeeeee-0000-4000-a000-000000000002';
export const FIXTURE_RUN_ID = 'ffffffff-0000-4000-a000-000000000001';

// ---------------------------------------------------------------------------
// Session responses (POST /api/v1/sessions)
// ---------------------------------------------------------------------------

export const FIXTURE_LOGIN_CREATOR: LoginResponse = {
  csrf_token: 'fixture-csrf-creator-token',
  org_id: FIXTURE_ORG_ID,
  role: 'creator',
};

export const FIXTURE_LOGIN_MANAGER: LoginResponse = {
  csrf_token: 'fixture-csrf-manager-token',
  org_id: FIXTURE_ORG_ID,
  role: 'manager',
};

export const FIXTURE_LOGIN_REVIEWER: LoginResponse = {
  csrf_token: 'fixture-csrf-reviewer-token',
  org_id: FIXTURE_ORG_ID,
  role: 'reviewer',
};

// ---------------------------------------------------------------------------
// Me responses (GET /api/v1/me)
// ---------------------------------------------------------------------------

export const FIXTURE_ME_CREATOR: MeResponse = {
  user_id: FIXTURE_CREATOR_USER_ID,
  org_id: FIXTURE_ORG_ID,
  role: 'creator',
};

export const FIXTURE_ME_MANAGER: MeResponse = {
  user_id: FIXTURE_MANAGER_USER_ID,
  org_id: FIXTURE_ORG_ID,
  role: 'manager',
};

export const FIXTURE_ME_REVIEWER: MeResponse = {
  user_id: FIXTURE_REVIEWER_USER_ID,
  org_id: FIXTURE_ORG_ID,
  role: 'reviewer',
};

// ---------------------------------------------------------------------------
// Brand fixtures
// ---------------------------------------------------------------------------

export const FIXTURE_BRAND: Brand = {
  id: FIXTURE_BRAND_ID,
  name: 'LumaDesk',
  source_epoch: 0,
};

export const FIXTURE_BRAND_LIST: BrandListResponse = [FIXTURE_BRAND];

// ---------------------------------------------------------------------------
// Health fixtures
// ---------------------------------------------------------------------------

export const FIXTURE_LIVE: LiveResponse = {
  status: 'live',
  phase: 'S1',
};

export const FIXTURE_READY: ReadyResponse = {
  status: 'ready',
  scope: 'S1 identity only; worker not implemented',
};

// ---------------------------------------------------------------------------
// Error fixtures — each documented error code from CONTRACTS.md
// ---------------------------------------------------------------------------

export const FIXTURE_ERROR_UNAUTHENTICATED: ApiError = {
  code: 'unauthenticated',
  message: 'Sign in to continue.',
  request_id: 'fixture-request-id',
  details: {},
};

export const FIXTURE_ERROR_FORBIDDEN: ApiError = {
  code: 'forbidden',
  message: 'A brand manager is required.',
  request_id: 'fixture-request-id',
  details: {},
};

export const FIXTURE_ERROR_NOT_FOUND: ApiError = {
  code: 'not_found',
  message: 'Brand not found.',
  request_id: 'fixture-request-id',
  details: {},
};

export const FIXTURE_ERROR_STALE: ApiError = {
  code: 'stale_revision',
  message: 'This revision is no longer current.',
  request_id: 'fixture-request-id',
  details: {},
};

export const FIXTURE_ERROR_RATE_LIMITED: ApiError = {
  code: 'rate_limited',
  message: 'Too many sign-in attempts. Try again later.',
  request_id: 'fixture-request-id',
  details: {},
};

export const FIXTURE_ERROR_INVALID_FIELDS: ApiError = {
  code: 'invalid_fields',
  message: 'Check the supplied fields.',
  request_id: 'fixture-request-id',
  details: {},
};

export const FIXTURE_ERROR_CSRF: ApiError = {
  code: 'csrf_denied',
  message: 'Refresh your session and retry.',
  request_id: 'fixture-request-id',
  details: {},
};

export const FIXTURE_SOURCE_TRIAL_TERMS: SourceOut = {
  id: 'source-0001',
  brand_id: FIXTURE_BRAND_ID,
  source_key: 'trial_terms',
  version: 1,
  owner_id: FIXTURE_MANAGER_USER_ID,
  title: 'Approved trial terms',
  text: 'The trial lasts 14 days. No credit card is required.',
  text_hash: 'sha256-of-trial-terms',
  rules: [
    {
      id: 'F-01',
      category: 'facts_claims',
      kind: 'fact',
      key: 'trial_duration',
      value: '14 days',
      evidence_quote: 'The trial lasts 14 days.',
    },
  ],
  valid_from: '2026-10-22T00:00:00Z',
  valid_until: null,
  state: 'active',
  created_at: '2026-10-22T10:00:00Z',
  activated_by: FIXTURE_MANAGER_USER_ID,
  activated_at: '2026-10-22T10:05:00Z',
};

export const FIXTURE_SOURCE_BRAND_NAME: SourceOut = {
  id: 'source-0002',
  brand_id: FIXTURE_BRAND_ID,
  source_key: 'brand_identity',
  version: 1,
  owner_id: FIXTURE_MANAGER_USER_ID,
  title: 'Brand name & style guidelines',
  text: 'The brand name must always be spelled LumaDesk with a capital D. Voice is calm and evidence-based.',
  text_hash: 'sha256-of-brand-name',
  rules: [
    {
      id: 'T-01',
      category: 'terminology',
      kind: 'terminology',
      key: 'brand_name',
      value: 'LumaDesk',
      evidence_quote: 'spelled LumaDesk with a capital D',
    },
    {
      id: 'TN-01',
      category: 'tone',
      kind: 'guidance',
      key: 'voice_calm',
      value: 'calm and evidence-based',
      evidence_quote: 'Voice is calm and evidence-based.',
    },
  ],
  valid_from: '2026-10-22T00:00:00Z',
  valid_until: null,
  state: 'active',
  created_at: '2026-10-22T10:10:00Z',
  activated_by: FIXTURE_MANAGER_USER_ID,
  activated_at: '2026-10-22T10:15:00Z',
};

export const FIXTURE_SOURCES: SourceOut[] = [
  FIXTURE_SOURCE_TRIAL_TERMS,
  FIXTURE_SOURCE_BRAND_NAME,
];

export const FIXTURE_POLICY: PolicyOut = {
  version: 1,
  enabled: false,
  provider: 'nebius',
  model: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
  boundary: 'external',
  notice: 'Local deterministic processing only. Semantic checks are unavailable until external provider policy is enabled by an admin.',
};

export const FIXTURE_REVISION_1: RevisionOut = {
  id: FIXTURE_REVISION_ID_1,
  item_id: FIXTURE_CONTENT_ID,
  number: 1,
  author_id: FIXTURE_CREATOR_USER_ID,
  created_at: '2026-10-23T06:00:00Z',
  channel: 'email',
  audience: 'SMB customers',
  purpose: 'acquisition',
  text: 'Lumadesk guarantees 10x productivity. Get your 30-day free trial. Sign up NOW!!!',
  text_hash: 'sha256-of-lumadesk-draft',
};

export const FIXTURE_CONTENT_ITEM: ContentOut = {
  id: FIXTURE_CONTENT_ID,
  brand_id: FIXTURE_BRAND_ID,
  title: 'LumaDesk Q4 Launch Email',
  creator_id: FIXTURE_CREATOR_USER_ID,
  reviewer_id: FIXTURE_REVIEWER_USER_ID,
  current_revision: 1,
  workflow_version: 1,
  approval_stale: false,
  state: 'draft',
  revisions: [FIXTURE_REVISION_1],
};

// The initial LumaDesk demo draft (IMPLEMENTATION_PLAN.md §1)
export const FIXTURE_LUMADESK_DRAFT_TEXT =
  'Lumadesk guarantees 10x productivity. Get your 30-day free trial. Sign up NOW!!!';

// ---------------------------------------------------------------------------
// @pending S3 — Finding fixtures (LumaDesk expected findings)
// ---------------------------------------------------------------------------

export const FIXTURE_FINDINGS: FindingOut[] = [
  {
    id: 'find-0001',
    revision_id: FIXTURE_REVISION_ID_1,
    run_id: FIXTURE_RUN_ID,
    category: 'terminology',
    severity: 'blocker',
    evidence_status: 'supported_violation',
    origin: 'deterministic',
    location: { block_id: 'b1', start: 0, end: 8 },
    rule_id: 'rule-terminology-001',
    source_version_id: 'sv-0001',
    evidence_quote: 'LumaDesk must be written as "LumaDesk" (capital D).',
    rationale: '"Lumadesk" uses incorrect capitalisation. Approved name is "LumaDesk".',
    suggested_edit: 'LumaDesk',
    resolution: 'open',
  },
  {
    id: 'find-0002',
    revision_id: FIXTURE_REVISION_ID_1,
    run_id: FIXTURE_RUN_ID,
    category: 'facts_claims',
    severity: 'blocker',
    evidence_status: 'contradicted',
    origin: 'deterministic',
    location: { block_id: 'b1', start: 40, end: 64 },
    rule_id: 'rule-facts-trial-duration',
    source_version_id: 'sv-0001',
    evidence_quote: 'LumaDesk offers a 14-day free trial.',
    rationale: 'Draft claims a 30-day trial; approved sources specify 14 days.',
    suggested_edit: '14-day free trial',
    resolution: 'open',
  },
  {
    id: 'find-0003',
    revision_id: FIXTURE_REVISION_ID_1,
    run_id: FIXTURE_RUN_ID,
    category: 'facts_claims',
    severity: 'blocker',
    evidence_status: 'unsupported',
    origin: 'model',
    location: { block_id: 'b1', start: 9, end: 40 },
    rule_id: 'rule-claims-evidence',
    source_version_id: '',
    evidence_quote: '',
    rationale: '"guarantees 10x productivity" is an unsupported quantitative claim. No approved source substantiates this figure.',
    suggested_edit: null,
    resolution: 'open',
  },
  {
    id: 'find-0004',
    revision_id: FIXTURE_REVISION_ID_1,
    run_id: FIXTURE_RUN_ID,
    category: 'tone',
    severity: 'advisory',
    evidence_status: 'supported_violation',
    origin: 'model',
    location: { block_id: 'b1', start: 65, end: 80 },
    rule_id: 'rule-tone-calm',
    source_version_id: 'sv-0002',
    evidence_quote: 'Brand voice is calm and evidence-based; avoid pressure language.',
    rationale: '"Sign up NOW!!!" uses urgency language and excessive punctuation contrary to brand tone guidelines.',
    suggested_edit: 'Start your free trial.',
    resolution: 'open',
  },
  {
    id: 'find-0005',
    revision_id: FIXTURE_REVISION_ID_1,
    run_id: FIXTURE_RUN_ID,
    category: 'accessibility',
    severity: 'warning',
    evidence_status: 'manual',
    origin: 'deterministic',
    location: { block_id: 'img-1', start: 0, end: 0, field_name: 'alt_text' },
    rule_id: 'rule-accessibility-alt',
    source_version_id: '',
    evidence_quote: '',
    rationale: 'PNG asset has no alt text provided. Screen readers cannot describe this image.',
    suggested_edit: null,
    resolution: 'open',
  },
];

// ---------------------------------------------------------------------------
// ReviewRun fixture
// ---------------------------------------------------------------------------

export const FIXTURE_REVIEW_RUN: RunOut = {
  id: FIXTURE_RUN_ID,
  revision_id: FIXTURE_REVISION_ID_1,
  source_epoch: 0,
  source_snapshot: FIXTURE_SOURCES,
  checks: [
    { category: 'terminology', status: 'complete', reason: 'Verified against active brand dictionary' },
    { category: 'facts_claims', status: 'complete', reason: 'Checked against approved source facts' },
    { category: 'tone', status: 'complete', reason: 'Verified against tone guidelines' },
    { category: 'visual', status: 'complete', reason: 'Dimensions and assets validated' },
    { category: 'accessibility', status: 'complete', reason: 'Alt-text and contrast verified' },
    { category: 'messaging', status: 'unavailable', reason: 'External semantic processing disabled by policy' },
  ],
  status: 'completed',
  created_at: '2026-10-23T06:01:00Z',
  stale: false,
  processing_snapshot: {},
  engine_metadata: { engine_version: '0.1.0-deterministic' },
  findings: FIXTURE_FINDINGS,
};

// ---------------------------------------------------------------------------
// @pending S4 — Decision fixture
// ---------------------------------------------------------------------------

export const FIXTURE_DECISION: Decision = {
  id: 'dec-0001',
  revision_id: FIXTURE_REVISION_ID_2,
  run_id: 'ffffffff-0000-4000-a000-000000000002',
  reviewer_id: FIXTURE_REVIEWER_USER_ID,
  kind: 'approved',
  rationale: 'All blockers resolved. Brand compliance confirmed.',
  source_epoch: 0,
  text_hash: 'sha256-approved',
  decided_at: '2026-10-23T08:00:00Z',
};

// ---------------------------------------------------------------------------
// @pending S4 — Comment fixture
// ---------------------------------------------------------------------------

export const FIXTURE_COMMENT: Comment = {
  id: 'cmt-0001',
  revision_id: FIXTURE_REVISION_ID_1,
  finding_id: 'find-0001',
  author_id: FIXTURE_CREATOR_USER_ID,
  text: 'Fixed the capitalisation — updated to "LumaDesk".',
  created_at: '2026-10-23T07:00:00Z',
};

// ---------------------------------------------------------------------------
// @pending S4/S5 — D4 Queue and Governance Fixtures
// ---------------------------------------------------------------------------

export const FIXTURE_CONTENT_PAGE: ContentPageOut = {
  items: [
    {
      id: FIXTURE_CONTENT_ID,
      brand_id: FIXTURE_BRAND_ID,
      title: 'LumaDesk Q4 Launch Campaign',
      creator_id: FIXTURE_CREATOR_USER_ID,
      reviewer_id: FIXTURE_REVIEWER_USER_ID,
      current_revision: 2,
      workflow_version: 2,
      approval_stale: false,
      state: 'in_review',
      created_at: '2026-10-23T06:00:00Z',
    },
    {
      id: '00000000-0000-0000-0000-000000000002',
      brand_id: FIXTURE_BRAND_ID,
      title: 'Black Friday Social Ads',
      creator_id: FIXTURE_CREATOR_USER_ID,
      reviewer_id: FIXTURE_REVIEWER_USER_ID,
      current_revision: 1,
      workflow_version: 1,
      approval_stale: false,
      state: 'changes_requested',
      created_at: '2026-10-23T07:15:00Z',
    },
    {
      id: '00000000-0000-0000-0000-000000000003',
      brand_id: FIXTURE_BRAND_ID,
      title: 'Product Launch Email Series',
      creator_id: FIXTURE_CREATOR_USER_ID,
      reviewer_id: FIXTURE_REVIEWER_USER_ID,
      current_revision: 3,
      workflow_version: 3,
      approval_stale: false,
      state: 'approved',
      created_at: '2026-10-22T14:30:00Z',
    },
    {
      id: '00000000-0000-0000-0000-000000000004',
      brand_id: FIXTURE_BRAND_ID,
      title: 'Winter Billboard Copy (Draft)',
      creator_id: FIXTURE_CREATOR_USER_ID,
      reviewer_id: null,
      current_revision: 1,
      workflow_version: 1,
      approval_stale: false,
      state: 'draft',
      created_at: '2026-10-23T09:00:00Z',
    },
  ],
  total: 4,
  limit: 20,
  offset: 0,
};

export const FIXTURE_INSIGHTS: InsightsOut = {
  brand_id: FIXTURE_BRAND_ID,
  reviewed_items_denominator: 12,
  denominator_definition: 'Distinct content items with at least one completed terminal analysis run',
  confirmed_total: 9,
  dismissed_total: 2,
  exception_total: 1,
  ambiguous_total: 3,
  ambiguity_definition: 'Reports filed by creators or reviewers flagging unclear or conflicting guidelines',
  rules: [
    {
      source_key: 'lumadesk-identity',
      rule_id: 'rule-terminology-001',
      category: 'terminology',
      confirmed_items: 6,
      dismissed_items: 0,
      exception_items: 0,
      confirmed_per_reviewed_item: 0.5,
    },
    {
      source_key: 'lumadesk-identity',
      rule_id: 'rule-facts-trial-duration',
      category: 'facts_claims',
      confirmed_items: 3,
      dismissed_items: 1,
      exception_items: 1,
      confirmed_per_reviewed_item: 0.25,
    },
    {
      source_key: 'lumadesk-tone',
      rule_id: 'rule-tone-calm',
      category: 'tone',
      confirmed_items: 2,
      dismissed_items: 1,
      exception_items: 0,
      confirmed_per_reviewed_item: 0.17,
    },
    {
      source_key: 'lumadesk-accessibility',
      rule_id: 'rule-accessibility-alt',
      category: 'accessibility',
      confirmed_items: 1,
      dismissed_items: 0,
      exception_items: 0,
      confirmed_per_reviewed_item: 0.08,
    },
  ],
};

export const FIXTURE_EXPORT: ExportOut = {
  revision_id: FIXTURE_REVISION_ID_2,
  content_id: FIXTURE_CONTENT_ID,
  text: 'LumaDesk helps teams focus with evidence-based workspace management. Get your 14-day free trial.',
  text_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  channel: 'paid_social',
  audience: 'b2b_decision_makers',
  purpose: 'lead_generation',
  decision: FIXTURE_DECISION,
  evidence_record: {
    run_id: FIXTURE_RUN_ID,
    source_epoch: 0,
    evaluated_rules: ['rule-terminology-001', 'rule-facts-trial-duration', 'rule-tone-calm'],
    resolved_findings: 5,
    exceptions_granted: 0,
    timestamp: '2026-10-23T08:00:00Z',
    tamper_proof_checksum: 'BG-SHA256-CERT-8F39A1',
  },
  exported_at: '2026-10-23T08:05:00Z',
};

export const FIXTURE_REVIEW_RECORD: ReviewRecordOut = {
  run_id: FIXTURE_RUN_ID,
  workflow_version: 1,
  stale: false,
  evidence: {
    rule_terminology_001: 'passed',
    rule_facts_trial: 'passed',
    rule_tone_calm: 'passed',
  },
  decisions: [FIXTURE_DECISION],
};

export const FIXTURE_AMBIGUITY_OUT: AmbiguityOut = {
  id: 'amb-0001',
  source_id: 'src-0001',
  actor_id: FIXTURE_CREATOR_USER_ID,
  rule_id: 'rule-facts-trial-duration',
  revision_id: FIXTURE_REVISION_ID_1,
  rationale: 'Guideline states 14-day free trial, but sales promotion policy allows 30 days for enterprise accounts. Need clarification on B2B tier applicability.',
  created_at: '2026-10-23T07:30:00Z',
};

