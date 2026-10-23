/** Spinner — accessible loading indicator */
interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

export function Spinner({ size = 'md', label = 'Loading…' }: SpinnerProps) {
  return (
    <span role="status" aria-label={label}>
      <span className={`spinner${size === 'sm' ? ' spinner--sm' : size === 'lg' ? ' spinner--lg' : ''}`} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Skeleton block for loading states */
export function Skeleton({ width, height = 18 }: { width?: string | number; height?: number }) {
  return (
    <span
      className="skeleton"
      aria-hidden="true"
      style={{ display: 'block', width: width ?? '100%', height }}
    />
  );
}

/** Inline alert */
interface AlertProps {
  kind: 'error' | 'warning' | 'info' | 'success';
  children: React.ReactNode;
  id?: string;
}

export function Alert({ kind, children, id }: AlertProps) {
  const icons = { error: '⚠', warning: '⚠', info: 'ℹ', success: '✓' };
  return (
    <div id={id} className={`alert alert--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span aria-hidden="true">{icons[kind]}</span>
      <span>{children}</span>
    </div>
  );
}

/** Severity badge */
import type { FindingSeverity } from '../api/types';

export function SeverityBadge({ severity }: { severity: FindingSeverity }) {
  const labels: Record<FindingSeverity, string> = {
    blocker: 'Blocker',
    warning: 'Warning',
    advisory: 'Advisory',
  };
  return (
    <span className={`badge badge--${severity}`}>{labels[severity]}</span>
  );
}

/** Check status chip (shows model/check result) */
import type { CheckStatus } from '../api/types';
import React from 'react';

export function CheckStatusChip({ status }: { status: CheckStatus }) {
  const map: Record<CheckStatus, { label: string; cls: string }> = {
    complete:           { label: 'Complete',              cls: 'complete' },
    unavailable:        { label: 'Unavailable',           cls: 'unavailable' },
    failed:             { label: 'Failed',                cls: 'failed' },
    needs_manual_review:{ label: 'Manual review required', cls: 'manual' },
    not_applicable:     { label: 'Not applicable',        cls: 'unavailable' },
  };
  const { label, cls } = map[status];
  return <span className={`status-chip status-chip--${cls}`}>{label}</span>;
}

/** Processing mode indicator (shows local vs external) */
export function ProcessingMode({ isExternal }: { isExternal: boolean }) {
  return (
    <span className="processing-mode" aria-label={isExternal ? 'External processing active' : 'Local processing only'}>
      <span className={`processing-mode__dot${!isExternal ? ' processing-mode__dot--local' : ''}`} aria-hidden="true" />
      {isExternal ? 'Semantic checks: external' : 'Local processing only'}
    </span>
  );
}

/** Empty state */
export function EmptyState({ icon, title, description, action }: {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state__icon" aria-hidden="true">{icon}</div>}
      <div className="empty-state__title">{title}</div>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
