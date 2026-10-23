/**
 * In-memory mock transport for frontend development.
 *
 * Rules:
 *  - Only active when import.meta.env.DEV === true AND VITE_USE_MOCK_API=true
 *  - Faithful to CONTRACTS.md error shapes and response envelopes
 *  - Stateful for the duration of the browser tab session
 */

import {
  FIXTURE_BRAND,
  FIXTURE_LOGIN_CREATOR,
  FIXTURE_LOGIN_MANAGER,
  FIXTURE_LOGIN_REVIEWER,
  FIXTURE_ME_CREATOR,
  FIXTURE_ME_MANAGER,
  FIXTURE_ME_REVIEWER,
  FIXTURE_LIVE,
  FIXTURE_READY,
  FIXTURE_SOURCES,
  FIXTURE_CONTENT_ITEM,
  FIXTURE_REVIEW_RUN,
  FIXTURE_POLICY,
  FIXTURE_CONTENT_PAGE,
  FIXTURE_INSIGHTS,
  FIXTURE_EXPORT,
  FIXTURE_REVIEW_RECORD,
  FIXTURE_ERROR_UNAUTHENTICATED,
  FIXTURE_ERROR_FORBIDDEN,
  FIXTURE_ERROR_RATE_LIMITED,
  FIXTURE_ERROR_INVALID_FIELDS,
} from './fixtures';
import type {
  SourceOut,
  ContentOut,
  RevisionOut,
  RunOut,
  PolicyOut,
  Brand,
  CommentOut,
  ResolutionOut,
  ReviewerOut,
  ContentPageOut,
  DecisionOut,
  ManualCheckOut,
  AmbiguityOut,
  ExportOut,
} from './types';

// Mutable in-memory state for local testing
let mockSession: { email: string; role: string; user_id?: string } | null = null;
let loginAttempts = 0;
const mockBrand: Brand = { ...FIXTURE_BRAND };
let mockSources: SourceOut[] = [...FIXTURE_SOURCES];
const mockContent: Record<string, ContentOut> = {
  [FIXTURE_CONTENT_ITEM.id]: JSON.parse(JSON.stringify(FIXTURE_CONTENT_ITEM)),
};
const mockRuns: Record<string, RunOut> = {
  [FIXTURE_REVIEW_RUN.id]: JSON.parse(JSON.stringify(FIXTURE_REVIEW_RUN)),
};
let mockPolicy: PolicyOut = { ...FIXTURE_POLICY };
const mockComments: CommentOut[] = [
  {
    id: 'cmt-1',
    revision_id: FIXTURE_CONTENT_ITEM.revisions[0]?.id || 'rev-1',
    finding_id: 'find-0001',
    author_id: 'creator@lumadesk.test',
    text: 'Understood, will fix capitalization to LumaDesk in revision 2.',
    created_at: new Date(Date.now() - 3600000).toISOString(),
  },
];
const mockResolutions: Record<string, ResolutionOut> = {};
const mockReviewers: ReviewerOut[] = [
  { id: 'mem-rev-1', user_id: 'user-reviewer', email: 'reviewer@lumadesk.test' },
];

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

export const mockTransport = async (
  input: RequestInfo,
  init?: RequestInit
): Promise<Response> => {
  const url = typeof input === 'string' ? input : (input as Request).url;
  const method = init?.method?.toUpperCase() ?? 'GET';

  // Artificial network latency
  await new Promise(r => setTimeout(r, 60));

  // POST /api/v1/sessions
  if (url.endsWith('/api/v1/sessions') && method === 'POST') {
    const body = JSON.parse((init?.body as string) ?? '{}');
    if (loginAttempts >= 20) return jsonResponse(429, FIXTURE_ERROR_RATE_LIMITED);
    loginAttempts++;

    if (!body.email || !body.password || !body.org_id)
      return jsonResponse(422, FIXTURE_ERROR_INVALID_FIELDS);

    const fixtures: Record<string, typeof FIXTURE_LOGIN_CREATOR> = {
      'creator@lumadesk.test': FIXTURE_LOGIN_CREATOR,
      'manager@lumadesk.test': FIXTURE_LOGIN_MANAGER,
      'reviewer@lumadesk.test': FIXTURE_LOGIN_REVIEWER,
      'admin@lumadesk.test': {
        csrf_token: 'fixture-csrf-admin-token',
        org_id: body.org_id,
        role: 'admin',
      },
    };
    const fixture = fixtures[body.email];
    if (!fixture) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);

    mockSession = { email: body.email, role: fixture.role, user_id: 'user-' + fixture.role };
    loginAttempts = 0;
    return jsonResponse(200, fixture);
  }

  // DELETE /api/v1/sessions/current
  if (url.endsWith('/api/v1/sessions/current') && method === 'DELETE') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    mockSession = null;
    return noContent();
  }

  // GET /api/v1/me
  if (url.endsWith('/api/v1/me') && method === 'GET') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    const meMap: Record<string, typeof FIXTURE_ME_CREATOR> = {
      'creator@lumadesk.test': FIXTURE_ME_CREATOR,
      'manager@lumadesk.test': FIXTURE_ME_MANAGER,
      'reviewer@lumadesk.test': FIXTURE_ME_REVIEWER,
      'admin@lumadesk.test': {
        user_id: 'cccccccc-0000-4000-a000-000000000004',
        org_id: FIXTURE_BRAND.id,
        role: 'admin',
      },
    };
    return jsonResponse(200, meMap[mockSession.email] ?? {
      user_id: 'mock-user',
      org_id: mockBrand.id,
      role: mockSession.role as any,
    });
  }

  // GET /api/v1/processing-policy
  if (url.endsWith('/api/v1/processing-policy') && method === 'GET') {
    return jsonResponse(200, mockPolicy);
  }

  // PUT /api/v1/processing-policy (admin only)
  if (url.endsWith('/api/v1/processing-policy') && method === 'PUT') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    if (mockSession.role !== 'admin') return jsonResponse(403, FIXTURE_ERROR_FORBIDDEN);
    const body = JSON.parse((init?.body as string) ?? '{}');
    if (body.expected_version !== mockPolicy.version) {
      return jsonResponse(409, {
        code: 'policy_conflict',
        message: 'Policy version mismatch.',
        request_id: 'mock',
        details: {},
      });
    }
    mockPolicy = {
      ...mockPolicy,
      enabled: Boolean(body.enabled),
      notice: body.notice || mockPolicy.notice,
      version: mockPolicy.version + 1,
    };
    return jsonResponse(200, mockPolicy);
  }

  // GET /api/v1/brands
  if (url.endsWith('/api/v1/brands') && method === 'GET') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    return jsonResponse(200, [mockBrand]);
  }

  // POST /api/v1/brands (manager only)
  if (url.endsWith('/api/v1/brands') && method === 'POST') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    if (mockSession.role !== 'manager')
      return jsonResponse(403, FIXTURE_ERROR_FORBIDDEN);
    const body = JSON.parse((init?.body as string) ?? '{}');
    if (!body.name) return jsonResponse(422, FIXTURE_ERROR_INVALID_FIELDS);
    mockBrand.name = body.name;
    return jsonResponse(201, mockBrand);
  }

  // GET /api/v1/brands/:id/sources
  const brandSourcesMatch = url.match(/\/api\/v1\/brands\/([^/]+)\/sources$/);
  if (brandSourcesMatch && method === 'GET') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    return jsonResponse(200, mockSources);
  }

  // POST /api/v1/brands/:id/sources (manager only)
  if (brandSourcesMatch && method === 'POST') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    if (mockSession.role !== 'manager')
      return jsonResponse(403, FIXTURE_ERROR_FORBIDDEN);
    const body = JSON.parse((init?.body as string) ?? '{}');
    const newSource: SourceOut = {
      id: 'src-' + Math.random().toString(36).substring(2, 9),
      brand_id: brandSourcesMatch[1],
      source_key: body.source_key,
      version: 1,
      owner_id: mockSession.email,
      title: body.title,
      text: body.text,
      text_hash: 'hash-' + Date.now(),
      rules: body.rules || [],
      valid_from: body.valid_from || new Date().toISOString(),
      valid_until: body.valid_until || null,
      state: 'draft',
      created_at: new Date().toISOString(),
      activated_by: null,
      activated_at: null,
    };
    mockSources.push(newSource);
    return jsonResponse(201, newSource);
  }

  // POST /api/v1/sources/:id/activate (manager only)
  const sourceActivateMatch = url.match(/\/api\/v1\/sources\/([^/]+)\/activate$/);
  if (sourceActivateMatch && method === 'POST') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    if (mockSession.role !== 'manager')
      return jsonResponse(403, FIXTURE_ERROR_FORBIDDEN);
    const body = JSON.parse((init?.body as string) ?? '{}');
    if (body.expected_epoch !== mockBrand.source_epoch) {
      return jsonResponse(409, {
        code: 'epoch_conflict',
        message: `Expected source epoch ${body.expected_epoch} does not match current epoch ${mockBrand.source_epoch}.`,
        request_id: 'mock',
        details: {},
      });
    }
    const target = mockSources.find(s => s.id === sourceActivateMatch[1]);
    if (!target) return jsonResponse(404, { code: 'not_found', message: 'Source not found.', request_id: 'mock', details: {} });

    // Retire specified sources
    if (body.retire_source_ids && Array.isArray(body.retire_source_ids)) {
      mockSources = mockSources.map(s =>
        body.retire_source_ids.includes(s.id) ? { ...s, state: 'retired' } : s
      );
    }

    target.state = 'active';
    target.activated_by = mockSession.email;
    target.activated_at = new Date().toISOString();
    mockBrand.source_epoch += 1;
    return jsonResponse(200, target);
  }

  // POST /api/v1/content
  if (url.endsWith('/api/v1/content') && method === 'POST') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    const body = JSON.parse((init?.body as string) ?? '{}');
    const contentId = 'cnt-' + Math.random().toString(36).substring(2, 9);
    const revId = 'rev-' + Math.random().toString(36).substring(2, 9);
    const firstRev: RevisionOut = {
      id: revId,
      item_id: contentId,
      number: 1,
      author_id: mockSession.email,
      text: body.text,
      text_hash: 'hash-' + Date.now(),
      channel: body.channel,
      audience: body.audience,
      purpose: body.purpose,
      created_at: new Date().toISOString(),
    };
    const newItem: ContentOut = {
      id: contentId,
      brand_id: body.brand_id,
      title: body.title,
      creator_id: mockSession.email,
      reviewer_id: body.reviewer_id || null,
      current_revision: 1,
      workflow_version: 1,
      approval_stale: false,
      state: 'draft',
      revisions: [firstRev],
    };
    mockContent[contentId] = newItem;
    return jsonResponse(201, newItem);
  }

  // GET /api/v1/content/:id
  const contentMatch = url.match(/\/api\/v1\/content\/([^/]+)$/);
  if (contentMatch && method === 'GET') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    const item = mockContent[contentMatch[1]];
    if (!item) return jsonResponse(404, { code: 'not_found', message: 'Content item not found.', request_id: 'mock', details: {} });
    return jsonResponse(200, item);
  }

  // POST /api/v1/content/:id/revisions
  const contentRevMatch = url.match(/\/api\/v1\/content\/([^/]+)\/revisions$/);
  if (contentRevMatch && method === 'POST') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    const item = mockContent[contentRevMatch[1]];
    if (!item) return jsonResponse(404, { code: 'not_found', message: 'Content not found.', request_id: 'mock', details: {} });
    const body = JSON.parse((init?.body as string) ?? '{}');
    const latestRev = item.revisions[item.revisions.length - 1];
    if (body.parent_revision_id !== latestRev.id) {
      return jsonResponse(409, {
        code: 'stale_revision',
        message: 'This revision is no longer current. Another edit has been saved.',
        request_id: 'mock',
        details: {},
      });
    }
    const newRevNumber = item.revisions.length + 1;
    const newRev: RevisionOut = {
      id: 'rev-' + Math.random().toString(36).substring(2, 9),
      item_id: item.id,
      number: newRevNumber,
      author_id: mockSession.email,
      text: body.text,
      text_hash: 'hash-' + Date.now(),
      channel: body.channel,
      audience: body.audience,
      purpose: body.purpose,
      created_at: new Date().toISOString(),
    };
    item.revisions.push(newRev);
    item.current_revision = newRevNumber;
    return jsonResponse(201, item);
  }

  // POST /api/v1/revisions/:id/analysis
  const analysisMatch = url.match(/\/api\/v1\/revisions\/([^/]+)\/analysis$/);
  if (analysisMatch && method === 'POST') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    const revId = analysisMatch[1];
    const runId = 'run-' + Math.random().toString(36).substring(2, 9);
    const newRun: RunOut = {
      id: runId,
      revision_id: revId,
      source_epoch: mockBrand.source_epoch,
      source_snapshot: mockSources.filter(s => s.state === 'active'),
      checks: [
        { category: 'terminology', status: 'complete', reason: 'Checked against active sources' },
        { category: 'facts_claims', status: 'complete', reason: 'Checked against active sources' },
        { category: 'tone', status: 'complete', reason: 'Checked against tone guidelines' },
        { category: 'visual', status: 'complete', reason: 'Checked against visual guidelines' },
        { category: 'accessibility', status: 'complete', reason: 'Checked accessibility requirements' },
        { category: 'messaging', status: mockPolicy.enabled ? 'complete' : 'unavailable', reason: mockPolicy.enabled ? 'Evaluated with Nebius Token Factory' : 'External provider disabled by policy' },
      ],
      status: 'completed',
      created_at: new Date().toISOString(),
      stale: false,
      processing_snapshot: {},
      engine_metadata: { engine_version: '0.1.0-deterministic' },
      findings: FIXTURE_REVIEW_RUN.findings,
    };
    mockRuns[runId] = newRun;
    return jsonResponse(202, newRun);
  }

  // GET /api/v1/runs/:id
  const runMatch = url.match(/\/api\/v1\/runs\/([^/]+)$/);
  if (runMatch && method === 'GET') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    const run = mockRuns[runMatch[1]];
    if (!run) return jsonResponse(404, { code: 'not_found', message: 'Run not found.', request_id: 'mock', details: {} });
    return jsonResponse(200, run);
  }

  // GET /api/v1/brands/:id
  const brandMatch = url.match(/\/api\/v1\/brands\/([^/]+)$/);
  if (brandMatch && method === 'GET') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    if (brandMatch[1] === mockBrand.id) return jsonResponse(200, mockBrand);
    return jsonResponse(404, { code: 'not_found', message: 'Brand not found.', request_id: 'mock', details: {} });
  }

  // GET /api/v1/reviewers
  if (url.endsWith('/api/v1/reviewers') && method === 'GET') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    return jsonResponse(200, mockReviewers);
  }

  // PUT /api/v1/content/:id/reviewer
  const reviewerAssignMatch = url.match(/\/api\/v1\/content\/([^/]+)\/reviewer$/);
  if (reviewerAssignMatch && method === 'PUT') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    const item = mockContent[reviewerAssignMatch[1]];
    if (!item) return jsonResponse(404, { code: 'not_found', message: 'Content not found', request_id: 'mock', details: {} });
    const body = JSON.parse((init?.body as string) ?? '{}');
    item.reviewer_id = body.reviewer_id;
    return jsonResponse(200, item);
  }

  // GET /api/v1/revisions/:id/comments
  const commentsMatch = url.match(/\/api\/v1\/revisions\/([^/]+)\/comments$/);
  if (commentsMatch && method === 'GET') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    const revId = commentsMatch[1];
    return jsonResponse(200, mockComments.filter(c => c.revision_id === revId));
  }

  // POST /api/v1/revisions/:id/comments
  if (commentsMatch && method === 'POST') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    const revId = commentsMatch[1];
    const body = JSON.parse((init?.body as string) ?? '{}');
    const newComment: CommentOut = {
      id: 'cmt-' + Math.random().toString(36).substring(2, 9),
      revision_id: revId,
      finding_id: body.finding_id || null,
      author_id: mockSession.email,
      text: body.text,
      created_at: new Date().toISOString(),
    };
    mockComments.push(newComment);
    return jsonResponse(201, newComment);
  }

  // POST /api/v1/findings/:id/resolutions
  const resolutionMatch = url.match(/\/api\/v1\/findings\/([^/]+)\/resolutions$/);
  if (resolutionMatch && method === 'POST') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    const findingId = resolutionMatch[1];
    const body = JSON.parse((init?.body as string) ?? '{}');

    if (!body.rationale || body.rationale.length < 20) {
      return jsonResponse(422, {
        code: 'validation_error',
        message: 'Resolution rationale must be at least 20 characters.',
        request_id: 'mock',
        details: {},
      });
    }

    const res: ResolutionOut = {
      id: 'res-' + Math.random().toString(36).substring(2, 9),
      finding_id: findingId,
      actor_id: mockSession.email,
      action: body.action,
      rationale: body.rationale,
      source_version_ids: body.source_version_ids || [],
      created_at: new Date().toISOString(),
    };
    mockResolutions[findingId] = res;
    return jsonResponse(201, res);
  }

  // GET /api/v1/content (queue listing with filters)
  if ((url.endsWith('/api/v1/content') || url.includes('/api/v1/content?')) && method === 'GET') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    const parsedUrl = new URL(url, 'http://localhost');
    const stateFilter = parsedUrl.searchParams.get('state');

    // Build summaries from mockContent
    const summaries = Object.values(mockContent).map(c => ({
      id: c.id,
      brand_id: c.brand_id,
      title: c.title,
      creator_id: c.creator_id,
      reviewer_id: c.reviewer_id,
      current_revision: c.current_revision,
      workflow_version: 1,
      approval_stale: false,
      state: c.state,
      created_at: c.revisions[0]?.created_at || new Date().toISOString(),
    }));

    // Merge with fixture page items if not already present
    for (const item of FIXTURE_CONTENT_PAGE.items) {
      if (!summaries.some(s => s.id === item.id)) {
        summaries.push(item);
      }
    }

    const filtered = stateFilter ? summaries.filter(s => s.state === stateFilter) : summaries;
    const page: ContentPageOut = {
      items: filtered,
      total: filtered.length,
      limit: 20,
      offset: 0,
    };
    return jsonResponse(200, page);
  }

  // POST /api/v1/revisions/:id/submit
  const submitMatch = url.match(/\/api\/v1\/revisions\/([^/]+)\/submit$/);
  if (submitMatch && method === 'POST') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    const revId = submitMatch[1];
    const body = JSON.parse((init?.body as string) ?? '{}');
    const item = Object.values(mockContent).find(c => c.revisions.some(r => r.id === revId));
    if (!item) return jsonResponse(404, { code: 'not_found', message: 'Revision not found', request_id: 'mock', details: {} });

    item.state = 'in_review';
    if (body.reviewer_id) item.reviewer_id = body.reviewer_id;
    return jsonResponse(200, item);
  }

  // GET /api/v1/revisions/:id/review
  const reviewMatch = url.match(/\/api\/v1\/revisions\/([^/]+)\/review$/);
  if (reviewMatch && method === 'GET') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    return jsonResponse(200, FIXTURE_REVIEW_RECORD);
  }

  // POST /api/v1/revisions/:id/decisions
  const decisionMatch = url.match(/\/api\/v1\/revisions\/([^/]+)\/decisions$/);
  if (decisionMatch && method === 'POST') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    const revId = decisionMatch[1];
    const body = JSON.parse((init?.body as string) ?? '{}');

    if (!body.rationale || body.rationale.length < 20) {
      return jsonResponse(422, {
        code: 'validation_error',
        message: 'Decision rationale must be at least 20 characters.',
        request_id: 'mock',
        details: {},
      });
    }

    const item = Object.values(mockContent).find(c => c.revisions.some(r => r.id === revId));
    if (item) {
      item.state = body.kind === 'approved' ? 'approved' : 'changes_requested';
    }

    const decision: DecisionOut = {
      id: 'dec-' + Math.random().toString(36).substring(2, 9),
      revision_id: revId,
      run_id: body.expected_run_id || 'run-mock',
      reviewer_id: mockSession.email,
      kind: body.kind,
      rationale: body.rationale,
      source_epoch: body.expected_source_epoch ?? 0,
      text_hash: 'sha256-mock-approved-hash',
      decided_at: new Date().toISOString(),
    };
    return jsonResponse(201, decision);
  }

  // GET /api/v1/revisions/:id/export
  const exportMatch = url.match(/\/api\/v1\/revisions\/([^/]+)\/export$/);
  if (exportMatch && method === 'GET') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    const revId = exportMatch[1];
    const item = Object.values(mockContent).find(c => c.revisions.some(r => r.id === revId));
    const rev = item?.revisions.find(r => r.id === revId);

    const exportRecord: ExportOut = {
      ...FIXTURE_EXPORT,
      revision_id: revId,
      content_id: item?.id || FIXTURE_EXPORT.content_id,
      text: rev?.text || FIXTURE_EXPORT.text,
      channel: rev?.channel || FIXTURE_EXPORT.channel,
      audience: rev?.audience || FIXTURE_EXPORT.audience,
      purpose: rev?.purpose || FIXTURE_EXPORT.purpose,
      exported_at: new Date().toISOString(),
    };
    return jsonResponse(200, exportRecord);
  }

  // POST /api/v1/runs/:id/manual-checks
  const manualCheckMatch = url.match(/\/api\/v1\/runs\/([^/]+)\/manual-checks$/);
  if (manualCheckMatch && method === 'POST') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    const runId = manualCheckMatch[1];
    const body = JSON.parse((init?.body as string) ?? '{}');
    const check: ManualCheckOut = {
      id: 'mc-' + Math.random().toString(36).substring(2, 9),
      run_id: runId,
      reviewer_id: mockSession.email,
      category: body.category,
      outcome: body.outcome,
      rationale: body.rationale,
      source_version_ids: body.source_version_ids || [],
      created_at: new Date().toISOString(),
    };
    return jsonResponse(201, check);
  }

  // GET /api/v1/brands/:id/insights
  const insightsMatch = url.match(/\/api\/v1\/brands\/([^/]+)\/insights$/);
  if (insightsMatch && method === 'GET') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    return jsonResponse(200, {
      ...FIXTURE_INSIGHTS,
      brand_id: insightsMatch[1],
    });
  }

  // POST /api/v1/sources/:id/ambiguity-reports
  const ambiguityMatch = url.match(/\/api\/v1\/sources\/([^/]+)\/ambiguity-reports$/);
  if (ambiguityMatch && method === 'POST') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    const body = JSON.parse((init?.body as string) ?? '{}');
    if (!body.rationale || body.rationale.length < 20) {
      return jsonResponse(422, {
        code: 'validation_error',
        message: 'Ambiguity rationale must be at least 20 characters.',
        request_id: 'mock',
        details: {},
      });
    }
    const report: AmbiguityOut = {
      id: 'amb-' + Math.random().toString(36).substring(2, 9),
      source_id: ambiguityMatch[1],
      actor_id: mockSession.email,
      rule_id: body.rule_id || null,
      revision_id: body.revision_id || null,
      rationale: body.rationale,
      created_at: new Date().toISOString(),
    };
    return jsonResponse(201, report);
  }

  // GET /api/v1/health/live
  if (url.endsWith('/api/v1/health/live')) return jsonResponse(200, FIXTURE_LIVE);

  // GET /api/v1/health/ready
  if (url.endsWith('/api/v1/health/ready')) return jsonResponse(200, FIXTURE_READY);

  // Unhandled
  console.warn('[mock] Unhandled request:', method, url);
  return jsonResponse(404, { code: 'not_found', message: `Mock: no handler for ${method} ${url}`, request_id: 'mock', details: {} });
};
