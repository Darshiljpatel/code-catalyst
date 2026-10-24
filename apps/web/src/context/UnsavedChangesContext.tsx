import React from 'react';
import { useBlocker } from 'react-router-dom';
import { useDialogFocus } from '../hooks/useDialogFocus';

type Guard = { dirty: boolean; busy: boolean };
type LeaveAction = () => boolean | void | Promise<boolean | void>;
type PendingAction = { label: string; action: LeaveAction };
const UnsavedChangesContext = React.createContext<{
  setGuard: React.Dispatch<React.SetStateAction<Guard>>;
  requestLeave: (action: LeaveAction, label: string) => void;
} | null>(null);

export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  const [guard, setGuard] = React.useState<Guard>({ dirty: false, busy: false });
  const [pending, setPending] = React.useState<PendingAction | null>(null);
  const [performingAction, setPerformingAction] = React.useState(false);
  const [cancelAfterAction, setCancelAfterAction] = React.useState(false);
  const protectedDraft = guard.dirty || guard.busy;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => protectedDraft &&
    (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));
  const open = blocker.state === 'blocked' || pending !== null;
  const dialogRef = useDialogFocus(open);
  const cancel = React.useCallback(() => {
    if (performingAction) return;
    setPending(null);
    if (blocker.state === 'blocked') blocker.reset();
  }, [blocker, performingAction]);

  React.useEffect(() => {
    if (cancelAfterAction) {
      if (blocker.state === 'blocked') blocker.reset();
      setCancelAfterAction(false);
    } else if (!protectedDraft && !performingAction && blocker.state === 'blocked') {
      blocker.proceed();
    }
  }, [blocker, cancelAfterAction, protectedDraft, performingAction]);

  React.useEffect(() => {
    if (!protectedDraft) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [protectedDraft]);
  React.useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [open, cancel]);

  const requestLeave = React.useCallback((action: LeaveAction, label: string) => {
    if (protectedDraft) setPending({ action, label });
    else action();
  }, [protectedDraft]);
  const confirm = async () => {
    if (guard.busy || performingAction) return;
    if (pending) {
      const action = pending.action;
      setPerformingAction(true);
      let succeeded = false;
      try {
        succeeded = await action() !== false;
      } catch {
        // Preserve the draft and protection when an action fails unexpectedly.
      } finally {
        if (succeeded) setGuard({ dirty: false, busy: false });
        else setCancelAfterAction(true);
        setPending(null);
        setPerformingAction(false);
      }
    } else if (blocker.state === 'blocked') blocker.proceed();
  };

  return <UnsavedChangesContext.Provider value={{ setGuard, requestLeave }}>
    {children}
    {open && <div className="modal-backdrop" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="unsaved-changes-title" aria-describedby="unsaved-changes-description">
      <div className="modal-card">
        <div className="modal-header"><h2 id="unsaved-changes-title">Leave with unsaved changes?</h2></div>
        <div className="modal-body">
          <p id="unsaved-changes-description">Your working draft has changes that have not been saved as a revision. Keep editing to save them, or discard them before leaving. Draft copy is not stored in browser storage.</p>
          {guard.busy && <p role="status">Saving your revision. Wait for the request to finish before leaving.</p>}
          {performingAction && <p role="status">Finishing {pending?.label || 'your request'}… Your draft stays protected until the request succeeds.</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn--secondary" disabled={performingAction} onClick={cancel}>Keep editing</button>
          <button type="button" className="btn btn--danger" disabled={guard.busy || performingAction} onClick={confirm}>{guard.dirty ? 'Discard edits and ' : ''}{pending?.label || 'leave'}</button>
        </div>
      </div>
    </div>}
  </UnsavedChangesContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hooks share the private context
export function useLeaveConfirmation() {
  const context = React.useContext(UnsavedChangesContext);
  if (!context) throw new Error('UnsavedChangesProvider is required.');
  return context;
}

// eslint-disable-next-line react-refresh/only-export-components -- hooks share the private context
export function useUnsavedChanges(dirty: boolean, busy = false) {
  const { setGuard } = useLeaveConfirmation();
  React.useEffect(() => {
    setGuard({ dirty, busy });
    return () => setGuard({ dirty: false, busy: false });
  }, [dirty, busy, setGuard]);
}
