/**
 * Mock transport — DEV-ONLY.
 *
 * Intercepts fetch calls in local dev when VITE_USE_MOCK_API=true.
 * This is a development switch ONLY. It is excluded from the deployed build
 * by the import.meta.env.DEV guard in main.tsx (CONTRACTS.md + CLAUDE.md).
 *
 * To activate: set VITE_USE_MOCK_API=true in apps/web/.env.local
 * Never commit .env.local. Never set this in production .env.
 */

import type { Transport } from './client';
import {
  FIXTURE_LOGIN_CREATOR,
  FIXTURE_LOGIN_MANAGER,
  FIXTURE_LOGIN_REVIEWER,
  FIXTURE_ME_CREATOR,
  FIXTURE_ME_MANAGER,
  FIXTURE_ME_REVIEWER,
  FIXTURE_BRAND_LIST,
  FIXTURE_BRAND,
  FIXTURE_LIVE,
  FIXTURE_READY,
  FIXTURE_ERROR_UNAUTHENTICATED,
  FIXTURE_ERROR_FORBIDDEN,
  FIXTURE_ERROR_INVALID_FIELDS,
  FIXTURE_ERROR_RATE_LIMITED,
} from './fixtures';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

// Simple session simulation (in-memory; resets on page reload)
let mockSession: { email: string; role: string } | null = null;
let loginAttempts = 0;

export const mockTransport: Transport = async (input, init) => {
  const url = typeof input === 'string' ? input : input.toString();
  const method = (init?.method ?? 'GET').toUpperCase();

  // POST /api/v1/sessions
  if (url.endsWith('/api/v1/sessions') && method === 'POST') {
    const body = JSON.parse((init?.body as string) ?? '{}');
    if (loginAttempts >= 20)
      return jsonResponse(429, FIXTURE_ERROR_RATE_LIMITED);
    loginAttempts++;

    if (!body.email || !body.password || !body.org_id)
      return jsonResponse(422, FIXTURE_ERROR_INVALID_FIELDS);

    const fixtures: Record<string, typeof FIXTURE_LOGIN_CREATOR> = {
      'creator@lumadesk.test': FIXTURE_LOGIN_CREATOR,
      'manager@lumadesk.test': FIXTURE_LOGIN_MANAGER,
      'reviewer@lumadesk.test': FIXTURE_LOGIN_REVIEWER,
    };
    const fixture = fixtures[body.email];
    if (!fixture)
      return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);

    mockSession = { email: body.email, role: fixture.role };
    loginAttempts = 0; // reset on success
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
    };
    return jsonResponse(200, meMap[mockSession.email] ?? FIXTURE_ME_CREATOR);
  }

  // GET /api/v1/brands
  if (url.endsWith('/api/v1/brands') && method === 'GET') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    return jsonResponse(200, FIXTURE_BRAND_LIST);
  }

  // POST /api/v1/brands (manager only)
  if (url.endsWith('/api/v1/brands') && method === 'POST') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    if (mockSession.role !== 'manager')
      return jsonResponse(403, FIXTURE_ERROR_FORBIDDEN);
    const body = JSON.parse((init?.body as string) ?? '{}');
    if (!body.name) return jsonResponse(422, FIXTURE_ERROR_INVALID_FIELDS);
    return jsonResponse(201, { ...FIXTURE_BRAND, name: body.name });
  }

  // GET /api/v1/brands/:id
  const brandMatch = url.match(/\/api\/v1\/brands\/([^/]+)$/);
  if (brandMatch && method === 'GET') {
    if (!mockSession) return jsonResponse(401, FIXTURE_ERROR_UNAUTHENTICATED);
    if (brandMatch[1] === FIXTURE_BRAND.id)
      return jsonResponse(200, FIXTURE_BRAND);
    return jsonResponse(404, { code: 'not_found', message: 'Brand not found.', request_id: 'mock', details: {} });
  }

  // GET /api/v1/health/live
  if (url.endsWith('/api/v1/health/live')) return jsonResponse(200, FIXTURE_LIVE);

  // GET /api/v1/health/ready
  if (url.endsWith('/api/v1/health/ready')) return jsonResponse(200, FIXTURE_READY);

  // Unhandled — return 404 to surface missing mock coverage
  console.warn('[mock] Unhandled request:', method, url);
  return jsonResponse(404, { code: 'not_found', message: `Mock: no handler for ${method} ${url}`, request_id: 'mock', details: {} });
};
