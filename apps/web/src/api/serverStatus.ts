/**
 * Server status store — shared by the tolerant client and the status banner.
 *
 * `waking` is true while a request is being retried because the backend answered
 * with a proxy loading page, a 502/503/504 or a network error (a cold start).
 */

export interface ServerStatus {
  waking: boolean;
  workerOffline: boolean;
}

let state: ServerStatus = { waking: false, workerOffline: false };
let pendingRetries = 0;
const listeners = new Set<() => void>();

function emit(next: Partial<ServerStatus>) {
  const merged = { ...state, ...next };
  if (merged.waking === state.waking && merged.workerOffline === state.workerOffline) return;
  state = merged;
  listeners.forEach(listener => listener());
}

export function subscribeServerStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getServerStatus(): ServerStatus {
  return state;
}

export function retryStarted() {
  pendingRetries += 1;
  emit({ waking: true });
}

export function retryFinished() {
  pendingRetries = Math.max(0, pendingRetries - 1);
  if (pendingRetries === 0) emit({ waking: false });
}

export function setWorkerOffline(offline: boolean) {
  emit({ workerOffline: offline });
}
