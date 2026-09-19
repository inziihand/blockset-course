import { createContext } from 'react';
import type { User } from 'firebase/auth';
import type { IdentityMember } from './identityClient';

export type AuthStatus = 'unconfigured' | 'loading' | 'ready' | 'error';
export type IdentityStatus = 'idle' | 'syncing' | 'ready' | 'error';

export type AuthContextValue = {
  user: User | null;
  status: AuthStatus;
  error: string;
  member: IdentityMember | null;
  identityStatus: IdentityStatus;
  identityError: string;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
  retryIdentitySync: () => void;
};

const unavailable = async () => { throw new Error('Firebase Authentication 尚未完成設定。'); };

export const fallbackAuthContext: AuthContextValue = {
  user: null,
  status: 'unconfigured',
  error: '',
  member: null,
  identityStatus: 'idle',
  identityError: '',
  signInWithGoogle: unavailable,
  signOut: unavailable,
  getIdToken: unavailable,
  retryIdentitySync: () => {},
};

export const AuthContext = createContext<AuthContextValue>(fallbackAuthContext);
