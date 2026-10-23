/**
 * AuthContext — holds the authenticated user's identity, derived entirely from
 * server responses. Never stores role in localStorage or infers it client-side.
 * Authorisation is always enforced server-side (CLAUDE.md, CONTRACTS.md).
 */
import React, { createContext, useContext, useEffect, useReducer } from 'react';
import { getMe, login, logout, ApiResponseError } from '../api/client';
import type { LoginRequest, MeResponse } from '../api/types';

export interface AuthState {
  status: 'loading' | 'authenticated' | 'unauthenticated';
  user: MeResponse | null;
  error: string | null;
}

type AuthAction =
  | { type: 'LOADING' }
  | { type: 'AUTHENTICATED'; user: MeResponse }
  | { type: 'UNAUTHENTICATED'; error?: string }
  | { type: 'CLEAR_ERROR' };

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'LOADING':
      return { ...state, status: 'loading', error: null };
    case 'AUTHENTICATED':
      return { status: 'authenticated', user: action.user, error: null };
    case 'UNAUTHENTICATED':
      return { status: 'unauthenticated', user: null, error: action.error ?? null };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    default:
      return state;
  }
}

interface AuthContextValue extends AuthState {
  signIn: (payload: LoginRequest) => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, {
    status: 'loading',
    user: null,
    error: null,
  });

  // On mount, try to restore session from the server cookie
  useEffect(() => {
    dispatch({ type: 'LOADING' });
    getMe()
      .then((user) => dispatch({ type: 'AUTHENTICATED', user }))
      .catch(() => dispatch({ type: 'UNAUTHENTICATED' }));
  }, []);

  const signIn = async (payload: LoginRequest) => {
    dispatch({ type: 'LOADING' });
    try {
      await login(payload);
      const user = await getMe();
      dispatch({ type: 'AUTHENTICATED', user });
    } catch (err) {
      const msg =
        err instanceof ApiResponseError ? err.body.message : 'Sign-in failed.';
      dispatch({ type: 'UNAUTHENTICATED', error: msg });
      throw err;
    }
  };

  const signOut = async () => {
    try {
      await logout();
    } catch {
      // Best-effort; clear state regardless
    }
    dispatch({ type: 'UNAUTHENTICATED' });
  };

  const clearError = () => dispatch({ type: 'CLEAR_ERROR' });

  return (
    <AuthContext.Provider value={{ ...state, signIn, signOut, clearError }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- hook shares the private provider context
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
