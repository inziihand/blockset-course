import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { firebaseAuthConfiguration } from './config';
import { AuthContext, type AuthContextValue, type AuthStatus, type IdentityStatus } from './authContext';
import { IdentityApiError, synchronizeIdentitySession, type IdentityMember } from './identityClient';

const configurationError = firebaseAuthConfiguration.state === 'invalid'
  ? `Firebase Auth 環境變數不完整：${firebaseAuthConfiguration.missing.join('、')}`
  : '';

export function AuthProvider({ children }: { children: ReactNode }) {
  const initialStatus: AuthStatus = firebaseAuthConfiguration.state === 'unconfigured'
    ? 'unconfigured'
    : firebaseAuthConfiguration.state === 'invalid' ? 'error' : 'loading';
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>(initialStatus);
  const [error, setError] = useState(configurationError);
  const [member, setMember] = useState<IdentityMember | null>(null);
  const [identityStatus, setIdentityStatus] = useState<IdentityStatus>('idle');
  const [identityError, setIdentityError] = useState('');
  const [identitySyncRevision, setIdentitySyncRevision] = useState(0);

  useEffect(() => {
    if (firebaseAuthConfiguration.state !== 'configured') return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void import('./firebaseAuth')
      .then(({ observeFirebaseAuth }) => {
        if (cancelled) return;
        unsubscribe = observeFirebaseAuth(
          (nextUser) => {
            if (cancelled) return;
            setUser(nextUser);
            setStatus('ready');
            setError('');
          },
          () => {
            if (cancelled) return;
            setStatus('error');
            setError('Firebase Authentication 狀態同步失敗。');
          },
        );
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('error');
        setError('Firebase Authentication 初始化失敗。');
      });
    return () => { cancelled = true; unsubscribe?.(); };
  }, []);

  useEffect(() => {
    if (!user) {
      setMember(null);
      setIdentityStatus('idle');
      setIdentityError('');
      return;
    }
    let cancelled = false;
    setMember(null);
    setIdentityStatus('syncing');
    setIdentityError('');
    const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
    const synchronize = async () => {
      let lastError: unknown;
      const delays = [0, 400, 1_200];
      for (const [attempt, delay] of delays.entries()) {
        if (delay > 0) await wait(delay);
        if (cancelled) return null;
        try {
          const token = await user.getIdToken(attempt > 0 || identitySyncRevision > 0);
          return await synchronizeIdentitySession(token);
        } catch (caught) {
          lastError = caught;
          if (!shouldRetryIdentitySync(caught) || attempt === delays.length - 1) throw caught;
        }
      }
      throw lastError;
    };
    void synchronize()
      .then((nextMember) => {
        if (cancelled || !nextMember) return;
        setMember(nextMember);
        setIdentityStatus('ready');
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setMember(null);
        setIdentityStatus('error');
        setIdentityError(identitySyncErrorMessage(caught));
      });
    return () => { cancelled = true; };
  }, [identitySyncRevision, user]);

  const login = useCallback(async () => {
    setError('');
    try { await (await import('./firebaseAuth')).signInWithGoogle(); }
    catch (caught) {
      setError(authErrorMessage(caught));
      throw caught;
    }
  }, []);
  const logout = useCallback(async () => {
    setError('');
    try { await (await import('./firebaseAuth')).signOutFirebase(); }
    catch (caught) {
      setError('登出失敗，請稍後再試。');
      throw caught;
    }
  }, []);
  const getIdToken = useCallback(async (forceRefresh = false) => (
    (await import('./firebaseAuth')).getFirebaseIdToken(forceRefresh)
  ), []);
  const retryIdentitySync = useCallback(() => {
    setIdentitySyncRevision((revision) => revision + 1);
  }, []);

  const context = useMemo<AuthContextValue>(() => ({
    user, status, error, member, identityStatus, identityError,
    signInWithGoogle: login, signOut: logout, getIdToken, retryIdentitySync,
  }), [error, getIdToken, identityError, identityStatus, login, logout, member, retryIdentitySync, status, user]);
  return <AuthContext.Provider value={context}>{children}</AuthContext.Provider>;
}

function shouldRetryIdentitySync(error: unknown) {
  if (!(error instanceof IdentityApiError)) return true;
  return error.status === undefined || error.status === 401 || error.status >= 500;
}

function identitySyncErrorMessage(error: unknown) {
  return error instanceof IdentityApiError
    ? error.message
    : '已登入 Google，但平台權限同步失敗。';
}

function authErrorMessage(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === 'auth/popup-closed-by-user') return '登入視窗已關閉。';
  if (code === 'auth/popup-blocked') return '瀏覽器封鎖登入視窗，請允許彈出式視窗後重試。';
  if (code === 'auth/unauthorized-domain') return '目前網域尚未加入 Firebase Auth 授權網域。';
  if (code === 'auth/operation-not-allowed') return 'Google 登入尚未在 Firebase Console 開啟。';
  return 'Google 登入失敗，請稍後再試。';
}
