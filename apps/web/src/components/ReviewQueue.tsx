import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { ContentSummaryOut } from '../api/types';
import { getContentPage } from '../api/client';
import { Spinner, Alert, EmptyState } from './Primitives';

interface ReviewQueueProps {
  onItemSelect?: (itemId: string) => void;
}

export function ReviewQueue({ onItemSelect }: ReviewQueueProps) {
  const navigate = useNavigate();
  const [items, setItems] = React.useState<ContentSummaryOut[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [activeTab, setActiveTab] = React.useState<string>('all');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [offset, setOffset] = React.useState(0);
  const [total, setTotal] = React.useState(0);
  const [refresh, setRefresh] = React.useState(0);
  const limit = 20;

  React.useEffect(() => {
    if (searchQuery.trim() === search) return;
    const timer = setTimeout(() => { setSearch(searchQuery.trim()); setOffset(0); }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, search]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getContentPage({ state: activeTab === 'all' ? undefined : activeTab, q: search, limit, offset })
      .then(page => {
        if (cancelled) return;
        if (page.total > 0 && offset >= page.total) {
          setOffset(Math.floor((page.total - 1) / limit) * limit);
          return;
        }
        setItems(page.items); setTotal(page.total);
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load campaign review queue'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, search, offset, refresh]);

  const handleOpenItem = (id: string) => {
    if (onItemSelect) {
      onItemSelect(id);
    } else {
      navigate(`/content/${id}`);
    }
  };

  const getStateBadgeClass = (state: string) => {
    switch (state) {
      case 'approved':
        return 'badge--success';
      case 'in_review':
        return 'badge--warning';
      case 'changes_requested':
        return 'badge--error';
      default:
        return 'badge--neutral';
    }
  };

  return (
    <div className="review-queue-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
        <div>
          <p className="eyebrow">FROM DRAFT TO SIGN-OFF</p>
          <h2 style={{ margin: 0 }}>Campaigns</h2>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            The work in progress. And the work ready to go.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="search"
            aria-label="Filter campaigns by title or ID"
            className="input input--sm"
            placeholder="Search campaigns…"
            maxLength={200}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ width: '220px' }}
          />
          <button className="btn btn--ghost btn--sm" onClick={() => setRefresh(n => n + 1)} disabled={loading}>Refresh campaigns</button>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => navigate('/review/new')}
          >
            + New campaign
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="filter-bar" style={{ marginBottom: 'var(--space-4)' }}>
        {[
          { id: 'all', label: 'All Campaigns' },
          { id: 'in_review', label: 'In Review' },
          { id: 'changes_requested', label: 'Changes Requested' },
          { id: 'approved', label: 'Approved' },
          { id: 'draft', label: 'Drafts' },
          { id: 'analysing', label: 'Analysing' },
          { id: 'needs_changes', label: 'Needs Changes' },
          { id: 'ready_for_review', label: 'Ready for Review' },
          { id: 'incomplete', label: 'Incomplete' },
        ].map(tab => (
          <button
            key={tab.id}
            className={`filter-btn ${activeTab === tab.id ? 'filter-btn--active' : ''}`}
            aria-pressed={activeTab === tab.id}
            onClick={() => { setActiveTab(tab.id); setOffset(0); }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <Alert kind="error">{error} <button className="btn btn--ghost btn--sm" onClick={() => setRefresh(n => n + 1)}>Retry loading campaigns</button></Alert>}

      {error ? null : loading ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
          <Spinner size="md" label="Loading queue items…" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon="[ / ]"
          title={search ? 'No matching campaigns' : 'No campaigns found'}
          description={search ? `No campaigns match “${search}” in this filter. Try another title or ID.` : activeTab === 'all'
            ? 'No campaigns exist yet in this workspace. Create the first campaign to start review.'
            : `No campaigns currently in "${activeTab}" status.`}
          action={search ? <button className="btn btn--primary" onClick={() => setSearchQuery('')}>Clear search</button> : activeTab === 'all' ? <button className="btn btn--primary" onClick={() => navigate('/review/new')}>Start your first review ↗</button> : undefined}
        />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="campaign-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                <th style={{ padding: '10px 12px' }}>Campaign Title</th>
                <th style={{ padding: '10px 12px' }}>State</th>
                <th style={{ padding: '10px 12px' }}>Revision</th>
                <th style={{ padding: '10px 12px' }}>Reviewer</th>
                <th style={{ padding: '10px 12px' }}>Date</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr
                  key={item.id}
                  style={{
                    borderBottom: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                    transition: 'background 0.15s ease',
                  }}
                  onClick={() => handleOpenItem(item.id)}
                  className="queue-row"
                >
                  <td style={{ padding: '12px' }}>
                    <button className="campaign-title" onClick={e => { e.stopPropagation(); handleOpenItem(item.id); }}>{item.title}</button>
                  </td>
                  <td style={{ padding: '12px' }}>
                    <span className={`badge ${getStateBadgeClass(item.state)}`}>
                      {item.state.replace(/_/g, ' ')}
                    </span>
                    {item.approval_stale && (
                      <span className="badge badge--error" style={{ marginLeft: '6px' }} title="Guidelines updated since approval">
                        STALE
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '12px', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                    Rev #{item.current_revision}
                  </td>
                  <td style={{ padding: '12px', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                    {item.reviewer_id ? <span title={item.reviewer_id}>Assigned</span> : <span style={{ color: 'var(--text-muted)' }}>Unassigned</span>}
                  </td>
                  <td style={{ padding: '12px', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                    {new Date(item.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    <button
                      className="btn btn--secondary btn--sm"
                      onClick={e => {
                        e.stopPropagation();
                        handleOpenItem(item.id);
                      }}
                    >
                      Open review ↗
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && !error && total > 0 && <nav aria-label="Campaign pages" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', marginTop: '16px' }}>
        <span role="status">Showing {offset + 1}–{Math.min(offset + limit, total)} of {total} campaigns</span>
        <button className="btn btn--secondary btn--sm" disabled={offset === 0} onClick={() => setOffset(n => Math.max(0, n - limit))}>Previous page</button>
        <button className="btn btn--secondary btn--sm" disabled={offset + limit >= total || offset + limit > 10000} onClick={() => setOffset(n => n + limit)}>Next page</button>
      </nav>}
    </div>
  );
}
