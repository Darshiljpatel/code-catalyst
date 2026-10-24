import type { PolicyOut } from '../api/types';

/** Draft bytes are a lower bound: the worker also sends instructions and source rules. */
export function ExternalInputBudget({ text, policy }: { text: string; policy: PolicyOut | null }) {
  if (!policy?.enabled || !Number.isFinite(policy.max_input_bytes) || policy.max_input_bytes <= 0) return null;
  const bytes = new TextEncoder().encode(text).byteLength;
  const oversized = bytes > policy.max_input_bytes;
  return (
    <p className={oversized ? 'alert alert--warning' : undefined} data-testid="external-input-budget" style={{ margin: 'var(--space-3) 0 0', fontSize: '0.8125rem' }}>
      Draft: {bytes.toLocaleString()} UTF-8 bytes. External request limit: {policy.max_input_bytes.toLocaleString()} bytes.
      {' '}Instructions, context and approved source rules also use this budget; a smaller draft is not guaranteed to fit.
      {oversized && <> This draft alone exceeds the limit. Shorten it before external review, or uncheck external review to run local checks and complete the remaining categories manually. You can still save this draft.</>}
    </p>
  );
}
