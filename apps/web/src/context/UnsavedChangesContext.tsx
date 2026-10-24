import React from 'react';
import { useBlocker, useNavigate } from 'react-router-dom';
import { useDialogFocus } from '../hooks/useDialogFocus';

type Guard = { dirty: boolean; busy: boolean; message?: string; busyMessage?: string };
type LeaveAction = () => boolean | void | Promise<boolean | void>;
type PendingAction = { label: string; action: LeaveAction; destination: string };
const UnsavedChangesContext = React.createContext<{
  setGuard: (guard: Guard) => void;
  requestLeave: (action: LeaveAction, label: string, destination: string) => void;
} | null>(null);

export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  const [guard, setGuardState] = React.useState<Guard>({ dirty: false, busy: false });
  const guardRef = React.useRef<Guard>({ dirty: false, busy: false });
  const setGuard = React.useCallback((next: Guard) => {
    guardRef.current = next;
    setGuardState(next);
  }, []);
  const [pending, setPending] = React.useState<PendingAction | null>(null);
  const [performingAction, setPerformingAction] = React.useState(false);
  const [cancelAfterAction, setCancelAfterAction] = React.useState(false);
  const [completedDestination, setCompletedDestination] = React.useState<string | null>(null);
  const navigate = useNavigate();
  const protectedDraft = guard.dirty || guard.busy;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (guardRef.current.dirty || guardRef.current.busy || performingAction) &&
    (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));
  const open = blocker.state === 'blocked' || pending !== null;
  const cancel = React.useCallback(() => {
    if (performingAction) return;
    setPending(null);
    if (blocker.state === 'blocked') blocker.reset();
  }, [blocker, performingAction]);
  const dialogRef = useDialogFocus(open, cancel);

  React.useEffect(() => {
    if (completedDestination) {
      // Finish the requested action, never replay an unrelated or cancelled Back.
      navigate(completedDestination, { replace: true });
      setCompletedDestination(null);
    } else if (cancelAfterAction) {
      if (blocker.state === 'blocked') blocker.reset();
      setCancelAfterAction(false);
    }
  }, [blocker, cancelAfterAction, completedDestination, navigate]);

  React.useEffect(() => {
    if (!protectedDraft) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (guardRef.current.dirty || guardRef.current.busy) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [protectedDraft]);

  const requestLeave = React.useCallback((action: LeaveAction, label: string, destination: string) => {
    if (protectedDraft) setPending({ action, label, destination });
    else void (async () => {
      try { if (await action() !== false) navigate(destination, { replace: true }); }
      catch { /* The action displays its own recovery error. */ }
    })();
  }, [protectedDraft, navigate]);
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
        if (succeeded) {
          setGuard({ dirty: false, busy: false });
          setCompletedDestination(pending.destination);
        }
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
        <div className="modal-header"><h2 id="unsaved-changes-title">{guard.dirty ? 'Leave with unsaved changes?' : guard.busy ? 'Request in progress' : 'Leave this view?'}</h2></div>
        <div className="modal-body">
          <p id="unsaved-changes-description">{guard.dirty
            ? guard.message || 'Your working draft has changes that have not been saved as a revision. Keep editing to save them, or discard them before leaving. Draft copy is not stored in browser storage.'
            : guard.busy ? 'A save or post request is still in progress. Wait for it to finish before leaving.'
            : 'No unsaved work remains in this view. You can leave or keep reviewing.'}</p>
          {guard.busy && <p role="status">{guard.busyMessage || 'Saving your revision. Wait for the request to finish before leaving.'}</p>}
          {performingAction && <p role="status">Finishing {pending?.label || 'your request'}… Your draft stays protected until the request succeeds.</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn--secondary" disabled={performingAction} onClick={cancel}>Keep editing</button>
          <button type="button" className="btn btn--danger" disabled={guard.busy || performingAction} onClick={confirm}>{guard.dirty ? `Discard edits and ${pending?.label || 'leave'}` : pending ? pending.label : 'Leave this view'}</button>
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
export function useUnsavedChanges(dirty: boolean, busy = false, message?: string, busyMessage?: string) {
  const { setGuard } = useLeaveConfirmation();
  React.useEffect(() => {
    setGuard({ dirty, busy, message, busyMessage });
    return () => setGuard({ dirty: false, busy: false });
  }, [dirty, busy, message, busyMessage, setGuard]);
}
