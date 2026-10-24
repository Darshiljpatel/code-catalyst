import React from 'react';

type Activity = { hasUnsentNotes: boolean; posting: boolean };
type Drafts = {
  drafts: Record<string, string>;
  updateDraft: (revisionId: string, text: string) => void;
  posting: boolean;
  setPosting: (posting: boolean) => void;
  refreshToken: number;
  refreshDiscussion: () => void;
};
const DraftContext = React.createContext<Drafts | null>(null);
const ActivityContext = React.createContext<Activity | null>(null);

/** Scoped to one campaign view; never persists copy or notes in browser storage. */
export function DiscussionDraftProvider({ children }: { children: React.ReactNode }) {
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [posting, setPosting] = React.useState(false);
  const [refreshToken, setRefreshToken] = React.useState(0);
  const updateDraft = React.useCallback((id: string, text: string) => setDrafts(current => {
    if ((current[id] || '') === text) return current;
    const next = { ...current };
    if (text) next[id] = text;
    else delete next[id];
    return next;
  }), []);
  const refreshDiscussion = React.useCallback(() => setRefreshToken(value => value + 1), []);
  const hasUnsentNotes = Object.values(drafts).some(text => Boolean(text.trim()));
  // Typing updates the discussion, without rerendering the entire findings workspace.
  const activity = React.useMemo(() => ({ hasUnsentNotes, posting }), [hasUnsentNotes, posting]);
  return <ActivityContext.Provider value={activity}>
    <DraftContext.Provider value={{ drafts, updateDraft, posting, setPosting, refreshToken, refreshDiscussion }}>{children}</DraftContext.Provider>
  </ActivityContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hooks share private contexts
export function useDiscussionDrafts() {
  const value = React.useContext(DraftContext);
  if (!value) throw new Error('DiscussionDraftProvider is required.');
  return value;
}

// eslint-disable-next-line react-refresh/only-export-components -- hooks share private contexts
export function useDiscussionActivity() {
  const value = React.useContext(ActivityContext);
  if (!value) throw new Error('DiscussionDraftProvider is required.');
  return value;
}

export function DiscussionDraftSummary({ revisions, currentId, disabled, onOpen }: {
  revisions: { id: string; number: number }[]; currentId?: string; disabled: boolean; onOpen: (index: number) => void;
}) {
  const { drafts } = useDiscussionDrafts();
  const entries = revisions.flatMap((revision, index) => drafts[revision.id]?.trim() ? [{ ...revision, index }] : []);
  if (!entries.length) return null;
  return <aside className="draft-findings-note" aria-label="Unsent discussion notes">
    <strong>Unsent discussion notes</strong>
    <p>Post notes to save them. Unsent text stays only in this campaign view.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      {entries.map(revision => revision.id === currentId ? <span key={revision.id}>Revision #{revision.number} (open)</span>
        : <button key={revision.id} type="button" className="btn btn--ghost btn--sm" disabled={disabled}
          title={disabled ? 'Wait for posting or analysis to finish, and save/discard campaign edits before changing revisions.' : undefined}
          onClick={() => onOpen(revision.index)}>Open note on Rev #{revision.number}</button>)}
    </div>
  </aside>;
}
