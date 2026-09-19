import { useEffect, useMemo, useState } from 'react';
import { ApiError, type ApiClient } from './api';
import { createRequestId } from './api/requestId';

export type ApiReadClient = Pick<ApiClient, 'request'>;

export interface ApiReadOptions {
  client: ApiReadClient;
  /** Relative to the client's API base (for example 'status'); null disables it. */
  path: string | null;
  /** Identifies the caller's data scope, not an authorization credential. */
  scopeKey: string;
  signal?: AbortSignal;
}

export interface ApiReadState<T> {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: T | undefined;
  error: ApiError | undefined;
  requestId: string | undefined;
}

const emptyState = <T,>(status: 'idle' | 'loading'): ApiReadState<T> => ({
  status, data: undefined, error: undefined, requestId: undefined,
});

/**
 * A cancellable GET tied to an App's current data scope. This is deliberately
 * not a command hook: retries, authorization and domain state belong elsewhere.
 * Callers should keep the client stable and pass their App lifecycle signal.
 */
export function useApiRead<T>({ client, path, scopeKey, signal }: ApiReadOptions): ApiReadState<T> {
  const key = useMemo(() => ({ client, path, scopeKey, signal }), [client, path, scopeKey, signal]);
  const [snapshot, setSnapshot] = useState<{ key: typeof key; state: ApiReadState<T> }>();

  useEffect(() => {
    if (key.path === null || key.signal?.aborted) {
      setSnapshot({ key, state: emptyState('idle') });
      return;
    }

    const controller = new AbortController();
    let active = true;
    const cancel = () => {
      controller.abort();
      if (active) setSnapshot({ key, state: emptyState('idle') });
    };
    key.signal?.addEventListener('abort', cancel, { once: true });
    setSnapshot({ key, state: emptyState('loading') });

    void (async () => {
      try {
        const result = await key.client.request<T>(key.path!, { method: 'GET', signal: controller.signal });
        if (active && !controller.signal.aborted) {
          setSnapshot({ key, state: {
            status: 'ready', data: result.data, error: undefined, requestId: result.requestId,
          } });
        }
      } catch (error) {
        if (active && !controller.signal.aborted) {
          const normalized = error instanceof ApiError ? error : new ApiError('network', `local-read-${createRequestId()}`, false);
          setSnapshot({ key, state: {
            status: 'error', data: undefined, error: normalized, requestId: normalized.requestId,
          } });
        }
      }
    })();

    return () => {
      active = false;
      key.signal?.removeEventListener('abort', cancel);
      controller.abort();
    };
  }, [key]);

  // Do not expose the previous scope's data even for the render before effects.
  if (path === null || signal?.aborted) return emptyState('idle');
  return snapshot?.key === key ? snapshot.state : emptyState('loading');
}
