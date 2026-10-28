/**
 * BrandGuard API client — thin fetch wrapper.
 *
 * Rules (CONTRACTS.md + CLAUDE.md):
 * - All mutations send x-csrf-token from session state; never store in localStorage.
 * - Cookies are same-origin + HttpOnly; client never reads the session cookie.
 * - Origin header is set by the browser; we never forge it.
 * - Errors always follow {code, message, request_id, details}.
 * - Mock transport is a DEV-only switch; never ships in production build.
 */

import type {
  LoginRequest,
  LoginResponse,
  MeResponse,
  Brand,
  BrandListResponse,
  NewBrandRequest,
  LiveResponse,
  ReadyResponse,
  SourceOut,
  SourceInput,
  RuleInput,
  ActivationInput,
  ContentInput,
  ContentOut,
  NewRevisionInput,
  AnalysisInput,
  RunOut,
  PolicyOut,
  PolicyInput,
  CommentInput,
  CommentOut,
  ResolutionInput,
  ResolutionOut,
  ReviewerOut,
  ContentPageOut,
  SubmissionInput,
  ReviewRecordOut,
  DecisionInput,
  DecisionOut,
  ExportOut,
  ManualCheckInput,
  ManualCheckOut,
  InsightsOut,
  AmbiguityInput,
  AmbiguityOut,
  ApiError,
  WorkerHealthResponse,
  ActivationOut,
  ImpactPreview,
  GuidelineChangeSummary,
  GuidelineChange,
  RecheckAssignment,
  GuidelineHealth,
  GuidelineRequest,
  GuidelineRequestSummary,
  Comparison,
  ExampleSet,
  ExampleExpectation,
  OcrOut,
  DemoMember,
  SandboxOut,
  RegionInput,
  DocumentImportOut,
  VerificationOut,
  RetentionOut,
  VersionResponse,
} from './types';
import { retryStarted, retryFinished } from './serverStatus';

// ---------------------------------------------------------------------------
// Transport abstraction — swap in mock during dev; real fetch in production
// ---------------------------------------------------------------------------

export type Transport = (
  input: RequestInfo,
  init?: RequestInit
) => Promise<Response>;

let _transport: Transport = fetch.bind(window);

/** Set the transport. Call with mockTransport() in Storybook/tests; never in main.tsx. */
export function setTransport(t: Transport) {
  _transport = t;
}

// ---------------------------------------------------------------------------
// CSRF token — held in memory only; populated after login
// ---------------------------------------------------------------------------

let _csrfToken = '';

export function setCsrfToken(token: string) {
  _csrfToken = token;
}

export function clearCsrfToken() {
  _csrfToken = '';
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const BASE = '/api/v1';

export class ApiResponseError extends Error {
  readonly status: number;
  readonly body: ApiError;
  constructor(status: number, body: ApiError) {
    super(body.message);
    this.name = 'ApiResponseError';
    this.status = status;
    this.body = body;
  }
}

/** Retry budget for a sleeping or restarting backend (Render cold starts take 30–40 s). */
const WAKE_BUDGET_MS = 60_000;
let _sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Test hook: replace the backoff timer. */
export function setRetrySleep(sleep: (ms: number) => Promise<void>) {
  _sleep = sleep;
}

function isJson(res: Response) {
  return (res.headers.get('content-type') || '').toLowerCase().includes('application/json');
}

function unavailable(status: number): ApiResponseError {
  return new ApiResponseError(status, {
    code: 'server_unavailable',
    message: 'The review server is not responding yet. Wait a moment and try again.',
    request_id: '',
    details: {},
  });
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(extraHeaders || {}),
  };
  // CSRF required for mutations (CONTRACTS.md)
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && _csrfToken) {
    headers['x-csrf-token'] = _csrfToken;
  }
  // Reads are always safe to repeat; writes only when the server deduplicates them.
  const retryable = method === 'GET' || Object.keys(headers).some(h => h.toLowerCase() === 'idempotency-key');
  const deadline = Date.now() + WAKE_BUDGET_MS;
  let delay = 1000;
  let retrying = false;
  try {
    for (;;) {
      let res: Response | undefined;
      let networkError: unknown;
      try {
        res = await _transport(`${BASE}${path}`, {
          method,
          credentials: 'same-origin',
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch (error) {
        networkError = error;
      }
      // Our API always answers errors with a JSON envelope. A 502/503/504 HTML page or a
      // dropped connection means a proxy is still waking the backend.
      const waking = res === undefined || (!res.ok && !isJson(res));
      if (waking && retryable && Date.now() + delay < deadline) {
        if (!retrying) { retrying = true; retryStarted(); }
        await _sleep(delay);
        delay = Math.min(delay * 2, 8000);
        continue;
      }
      if (res === undefined) {
        if (networkError instanceof Error && networkError.name === 'AbortError') throw networkError;
        throw unavailable(0);
      }
      if (res.status === 204) return undefined as unknown as T;
      if (!isJson(res)) {
        if (!res.ok) throw unavailable(res.status);
        throw unavailable(502);
      }
      const json = await res.json();
      if (!res.ok) throw new ApiResponseError(res.status, json as ApiError);
      return json as T;
    }
  } finally {
    if (retrying) retryFinished();
  }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function login(payload: LoginRequest): Promise<LoginResponse> {
  const data = await request<LoginResponse>('POST', '/sessions', payload);
  setCsrfToken(data.csrf_token);
  return data;
}

export async function logout(): Promise<void> {
  await request<void>('DELETE', '/sessions/current');
  clearCsrfToken();
}

// ---------------------------------------------------------------------------
// Private demo sandboxes and the role switcher
// ---------------------------------------------------------------------------

export async function createSandbox(role = 'creator'): Promise<SandboxOut> {
  const data = await request<SandboxOut>('POST', '/demo/sandboxes', { role });
  setCsrfToken(data.csrf_token);
  return data;
}

export async function getDemoMembers(): Promise<DemoMember[]> {
  return request<DemoMember[]>('GET', '/demo/members');
}

export async function switchDemoRole(membershipId: string): Promise<SandboxOut> {
  const data = await request<SandboxOut>('POST', '/demo/switch', { membership_id: membershipId });
  setCsrfToken(data.csrf_token);
  return data;
}

// ---------------------------------------------------------------------------
// Me
// ---------------------------------------------------------------------------

export async function getMe(): Promise<MeResponse> {
  const data = await request<MeResponse>('GET', '/me');
  if (data.csrf_token) setCsrfToken(data.csrf_token);
  return data;
}

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

export async function getBrands(): Promise<BrandListResponse> {
  return request<BrandListResponse>('GET', '/brands');
}

export async function getBrand(brandId: string): Promise<Brand> {
  return request<Brand>('GET', `/brands/${brandId}`);
}

export async function createBrand(payload: NewBrandRequest): Promise<Brand> {
  return request<Brand>('POST', '/brands', payload);
}

// ---------------------------------------------------------------------------
// Sources (S2)
// ---------------------------------------------------------------------------

export async function getSources(brandId: string): Promise<SourceOut[]> {
  return request<SourceOut[]>('GET', `/brands/${brandId}/sources`);
}

export async function createSource(
  brandId: string,
  payload: SourceInput
): Promise<SourceOut> {
  return request<SourceOut>('POST', `/brands/${brandId}/sources`, payload);
}

export async function activateSource(
  sourceId: string,
  payload: ActivationInput
): Promise<ActivationOut> {
  return request<ActivationOut>('POST', `/sources/${sourceId}/activate`, payload);
}

// ---------------------------------------------------------------------------
// Guideline change impact and re-review inbox (Improvement 1)
// ---------------------------------------------------------------------------

export async function getImpactPreview(sourceId: string, retireSourceIds: string[] = []): Promise<ImpactPreview> {
  const query = new URLSearchParams();
  retireSourceIds.forEach(id => query.append('retire_source_ids', id));
  const qs = query.toString();
  return request<ImpactPreview>('GET', `/sources/${sourceId}/impact-preview${qs ? `?${qs}` : ''}`);
}

export async function getGuidelineChanges(params?: { brand_id?: string; status?: 'open' | 'closed' }): Promise<GuidelineChangeSummary[]> {
  const query = new URLSearchParams();
  if (params?.brand_id) query.set('brand_id', params.brand_id);
  if (params?.status) query.set('status', params.status);
  const qs = query.toString();
  return request<GuidelineChangeSummary[]>('GET', `/guideline-changes${qs ? `?${qs}` : ''}`);
}

export async function getGuidelineChange(changeId: string): Promise<GuidelineChange> {
  return request<GuidelineChange>('GET', `/guideline-changes/${changeId}`);
}

export async function assignRecheckReviewer(
  assignments: Pick<RecheckAssignment, 'id' | 'version'>[],
  reviewerId: string
): Promise<RecheckAssignment[]> {
  return request<RecheckAssignment[]>('PUT', '/recheck-assignments/reviewer', {
    assignment_ids: assignments.map(a => a.id),
    reviewer_id: reviewerId,
    expected_versions: Object.fromEntries(assignments.map(a => [a.id, a.version])),
  });
}

// ---------------------------------------------------------------------------
// Guideline improvement requests (Improvement 3)
// ---------------------------------------------------------------------------

export async function getGuidelineHealth(brandId: string): Promise<GuidelineHealth> {
  return request<GuidelineHealth>('GET', `/brands/${brandId}/guideline-health`);
}

export async function createGuidelineRequest(payload: {
  brand_id: string; source_id: string; rule_id?: string | null; ambiguity_report_id?: string; title: string; problem: string;
}): Promise<GuidelineRequest> {
  return request<GuidelineRequest>('POST', '/guideline-requests', payload);
}

export async function getGuidelineRequests(brandId?: string): Promise<GuidelineRequestSummary[]> {
  return request<GuidelineRequestSummary[]>('GET', `/guideline-requests${brandId ? `?brand_id=${encodeURIComponent(brandId)}` : ''}`);
}

export async function getGuidelineRequest(requestId: string): Promise<GuidelineRequest> {
  return request<GuidelineRequest>('GET', `/guideline-requests/${requestId}`);
}

export async function updateGuidelineRequest(requestId: string, payload: {
  expected_version: number; labels?: { example_id: string; expected: ExampleExpectation }[]; status?: 'in_review' | 'withdrawn';
}): Promise<GuidelineRequest> {
  return request<GuidelineRequest>('PATCH', `/guideline-requests/${requestId}`, payload);
}

export async function saveRequestDraft(requestId: string, payload: {
  expected_version: number; title: string; text: string; rules: RuleInput[];
}): Promise<GuidelineRequest> {
  return request<GuidelineRequest>('PUT', `/guideline-requests/${requestId}/draft`, payload);
}

export async function saveRequestExamples(requestId: string): Promise<ExampleSet> {
  return request<ExampleSet>('POST', `/guideline-requests/${requestId}/example-set`);
}

export async function getExampleSets(brandId: string): Promise<ExampleSet[]> {
  return request<ExampleSet[]>('GET', `/brands/${brandId}/example-sets`);
}

export async function ensureExampleSet(brandId: string): Promise<ExampleSet> {
  return request<ExampleSet>('POST', `/brands/${brandId}/example-sets/default`);
}

export async function addExampleCase(setId: string, payload: {
  label: string; text?: string; revision_id?: string; expectations: ExampleSet['cases'][number]['expectations'];
}): Promise<ExampleSet> {
  return request<ExampleSet>('POST', `/example-sets/${setId}/cases`, payload);
}

export async function runComparison(requestId: string): Promise<Comparison> {
  return request<Comparison>('POST', `/guideline-requests/${requestId}/comparisons`);
}

export async function reviewGuidelineRequest(requestId: string, payload: {
  decision: 'approved' | 'changes_requested' | 'rejected'; rationale: string; comparison_run_id?: string | null;
}): Promise<GuidelineRequest> {
  return request<GuidelineRequest>('POST', `/guideline-requests/${requestId}/reviews`, payload);
}

export async function requeueRechecks(changeId: string): Promise<{ change_id: string; queued: string[] }> {
  return request<{ change_id: string; queued: string[] }>('POST', `/guideline-changes/${changeId}/rechecks`);
}

// ---------------------------------------------------------------------------
// Content Items & Revisions (S2)
// ---------------------------------------------------------------------------

export async function createContent(payload: ContentInput): Promise<ContentOut> {
  return request<ContentOut>('POST', '/content', payload);
}

export async function getContent(itemId: string): Promise<ContentOut> {
  return request<ContentOut>('GET', `/content/${itemId}`);
}

export async function createRevision(
  itemId: string,
  payload: NewRevisionInput
): Promise<ContentOut> {
  return request<ContentOut>('POST', `/content/${itemId}/revisions`, payload);
}

// ---------------------------------------------------------------------------
// Image campaigns (Improvement 2)
// ---------------------------------------------------------------------------

export const IMAGE_LIMITS = { maxBytes: 8 * 1024 * 1024, maxMegapixels: 25, types: ['image/png', 'image/jpeg'] };

export function assetUrl(assetId: string) {
  return `${BASE}/assets/${assetId}`;
}

export async function uploadImageCampaign(fields: {
  brand_id: string; title: string; channel: string; audience: string; purpose: string; reviewer_id?: string | null; file: File;
}): Promise<ContentOut> {
  const form = new FormData();
  for (const key of ['brand_id', 'title', 'channel', 'audience', 'purpose'] as const) form.append(key, fields[key]);
  if (fields.reviewer_id) form.append('reviewer_id', fields.reviewer_id);
  form.append('file', fields.file);
  const headers: Record<string, string> = {};
  if (_csrfToken) headers['x-csrf-token'] = _csrfToken;
  let res: Response;
  try {
    // Multipart: the browser sets the boundary. Uploads are never retried automatically.
    res = await _transport(`${BASE}/content/image`, { method: 'POST', credentials: 'same-origin', headers, body: form });
  } catch {
    throw unavailable(0);
  }
  if (!isJson(res)) throw unavailable(res.status);
  const json = await res.json();
  if (!res.ok) throw new ApiResponseError(res.status, json as ApiError);
  return json as ContentOut;
}

// PDF and DOCX drafts: text is extracted server-side; only the file hash and text are kept.
export const DOCUMENT_LIMITS = { maxBytes: 10 * 1024 * 1024, maxPages: 50 };

export async function importDocument(file: File): Promise<DocumentImportOut> {
  const form = new FormData();
  form.append('file', file);
  const headers: Record<string, string> = {};
  if (_csrfToken) headers['x-csrf-token'] = _csrfToken;
  let res: Response;
  try {
    res = await _transport(`${BASE}/imports/document`, { method: 'POST', credentials: 'same-origin', headers, body: form });
  } catch {
    throw unavailable(0);
  }
  if (!isJson(res)) throw unavailable(res.status);
  const json = await res.json();
  if (!res.ok) throw new ApiResponseError(res.status, json as ApiError);
  return json as DocumentImportOut;
}

export async function getOcr(assetId: string): Promise<OcrOut> {
  return request<OcrOut>('GET', `/assets/${assetId}/ocr`);
}

export async function confirmImageText(itemId: string, payload: {
  parent_revision_id: string | null; channel: string; audience: string; purpose: string; regions: RegionInput[]; deleted_line_ids: string[];
}): Promise<ContentOut> {
  return request<ContentOut>('POST', `/content/${itemId}/image-revisions`, payload);
}

// ---------------------------------------------------------------------------
// Analysis & Runs (S2 & S3)
// ---------------------------------------------------------------------------

export async function startAnalysis(
  revisionId: string,
  payload?: AnalysisInput,
  idempotencyKey?: string
): Promise<RunOut> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  return request<RunOut>(
    'POST',
    `/revisions/${revisionId}/analysis`,
    payload || {},
    headers
  );
}

export async function getRun(runId: string): Promise<RunOut> {
  return request<RunOut>('GET', `/runs/${runId}`);
}

// ---------------------------------------------------------------------------
// Processing Policy (S3)
// ---------------------------------------------------------------------------

export async function getProcessingPolicy(): Promise<PolicyOut> {
  return request<PolicyOut>('GET', '/processing-policy');
}

export async function updateProcessingPolicy(
  payload: PolicyInput
): Promise<PolicyOut> {
  return request<PolicyOut>('PUT', '/processing-policy', payload);
}

// ---------------------------------------------------------------------------
// Human Review & Workflow (S4)
// ---------------------------------------------------------------------------

export async function getComments(revisionId: string): Promise<CommentOut[]> {
  return request<CommentOut[]>('GET', `/revisions/${revisionId}/comments`);
}

export async function postComment(
  revisionId: string,
  payload: CommentInput
): Promise<CommentOut> {
  return request<CommentOut>('POST', `/revisions/${revisionId}/comments`, payload);
}

export async function postResolution(
  findingId: string,
  payload: ResolutionInput
): Promise<ResolutionOut> {
  return request<ResolutionOut>(
    'POST',
    `/findings/${findingId}/resolutions`,
    payload
  );
}

export async function getReviewers(): Promise<ReviewerOut[]> {
  return request<ReviewerOut[]>('GET', '/reviewers');
}

export async function assignReviewer(
  itemId: string,
  reviewerId: string,
  expectedItemVersion: number,
  rationale: string
): Promise<ContentOut> {
  return request<ContentOut>('PUT', `/content/${itemId}/reviewer`, {
    reviewer_id: reviewerId,
    expected_item_version: expectedItemVersion,
    rationale,
  });
}

export async function getContentPage(params?: {
  q?: string;
  state?: string;
  recheck?: 'mine' | 'any';
  limit?: number;
  offset?: number;
}): Promise<ContentPageOut> {
  const query = new URLSearchParams();
  if (params?.recheck) query.set('recheck', params.recheck);
  if (params?.q) query.set('q', params.q);
  if (params?.state) query.set('state', params.state);
  if (params?.limit !== undefined) query.set('limit', String(params.limit));
  if (params?.offset !== undefined) query.set('offset', String(params.offset));
  const qs = query.toString();
  return request<ContentPageOut>('GET', `/content${qs ? `?${qs}` : ''}`);
}

export async function submitRevision(
  revisionId: string,
  payload: SubmissionInput
): Promise<ContentOut> {
  return request<ContentOut>('POST', `/revisions/${revisionId}/submit`, payload);
}

export async function getReviewRecord(revisionId: string): Promise<ReviewRecordOut> {
  return request<ReviewRecordOut>('GET', `/revisions/${revisionId}/review`);
}

export async function createDecision(
  revisionId: string,
  payload: DecisionInput
): Promise<DecisionOut> {
  return request<DecisionOut>('POST', `/revisions/${revisionId}/decisions`, payload);
}

export async function exportRevision(revisionId: string): Promise<ExportOut> {
  return request<ExportOut>('GET', `/revisions/${revisionId}/export`);
}

export async function createManualCheck(
  runId: string,
  payload: ManualCheckInput
): Promise<ManualCheckOut> {
  return request<ManualCheckOut>('POST', `/runs/${runId}/manual-checks`, payload);
}

export async function getBrandInsights(brandId: string): Promise<InsightsOut> {
  return request<InsightsOut>('GET', `/brands/${brandId}/insights`);
}

export async function createAmbiguityReport(
  sourceId: string,
  payload: AmbiguityInput
): Promise<AmbiguityOut> {
  return request<AmbiguityOut>('POST', `/sources/${sourceId}/ambiguity-reports`, payload);
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export async function getLive(): Promise<LiveResponse> {
  return request<LiveResponse>('GET', '/health/live');
}

export async function getReady(): Promise<ReadyResponse> {
  return request<ReadyResponse>('GET', '/health/ready');
}

export async function getWorkerHealth(): Promise<WorkerHealthResponse> {
  return request<WorkerHealthResponse>('GET', '/health/worker');
}

export async function getVersion(): Promise<VersionResponse> {
  return request<VersionResponse>('GET', '/health/version');
}

// ---------------------------------------------------------------------------
// Approval-record verification
// ---------------------------------------------------------------------------

export async function verifyApprovalRecord(record: unknown): Promise<VerificationOut> {
  return request<VerificationOut>('POST', '/verify/approval-record', record);
}

export async function getRetention(): Promise<RetentionOut> {
  return request<RetentionOut>('GET', '/retention');
}

export async function updateRetention(payload: { retention_days: number | null; rationale: string }): Promise<RetentionOut> {
  return request<RetentionOut>('PUT', '/retention', payload);
}
