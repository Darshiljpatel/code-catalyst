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
  ApiError,
} from './types';

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

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  // CSRF required for mutations (CONTRACTS.md)
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && _csrfToken) {
    headers['x-csrf-token'] = _csrfToken;
  }
  const res = await _transport(`${BASE}${path}`, {
    method,
    credentials: 'same-origin',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as unknown as T;
  const json = await res.json();
  if (!res.ok) throw new ApiResponseError(res.status, json as ApiError);
  return json as T;
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
// Me
// ---------------------------------------------------------------------------

export async function getMe(): Promise<MeResponse> {
  return request<MeResponse>('GET', '/me');
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
// Health
// ---------------------------------------------------------------------------

export async function getLive(): Promise<LiveResponse> {
  return request<LiveResponse>('GET', '/health/live');
}

export async function getReady(): Promise<ReadyResponse> {
  return request<ReadyResponse>('GET', '/health/ready');
}
