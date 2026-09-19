import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiRequestOptions } from '../src/shared/api';
import { useApiRead, type ApiReadClient, type ApiReadOptions, type ApiReadState } from '../src/shared/useApiRead';

interface Item { label: string }
interface Response<T> { data: T; requestId: string }

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fakeClient() {
  const calls: {
    path: string;
    signal: AbortSignal | undefined;
    method: string | undefined;
    pending: ReturnType<typeof deferred<Response<Item>>>;
  }[] = [];
  const client: ApiReadClient = {
    request<T>(path: string, options: ApiRequestOptions = {}) {
      const pending = deferred<Response<Item>>();
      calls.push({ path, signal: options.signal, method: options.method, pending });
      // Deliberately ignores cancellation to test stale-response protection.
      return pending.promise as Promise<Response<T>>;
    },
  };
  const complete = (index: number, label: string) => act(async () => {
    calls[index].pending.resolve({ data: { label }, requestId: `request-${index}` });
    await calls[index].pending.promise;
  });
  return { client, calls, complete };
}

describe('useApiRead lifecycle', () => {
  it('does not read when disabled, then issues a GET and exposes the request identity', async () => {
    const fake = fakeClient();
    const initialProps: ApiReadOptions = { client: fake.client, path: null, scopeKey: 'one' };
    const { result, rerender } = renderHook((options) => useApiRead<Item>(options), { initialProps });
    expect(result.current.status).toBe('idle');
    expect(fake.calls).toHaveLength(0);

    rerender({ ...initialProps, path: 'items' });
    expect(result.current.status).toBe('loading');
    expect(fake.calls[0].method).toBe('GET');
    await fake.complete(0, 'first');
    expect(result.current).toEqual({
      status: 'ready', data: { label: 'first' }, error: undefined, requestId: 'request-0',
    });
  });

  it('hides data on the very first render of a different scope before effects run', async () => {
    const fake = fakeClient();
    const renders: { scope: string; state: ApiReadState<Item> }[] = [];
    const initialProps = { client: fake.client, path: 'items', scopeKey: 'one' };
    const { rerender, result } = renderHook((options) => {
      const state = useApiRead<Item>(options);
      renders.push({ scope: options.scopeKey, state });
      return state;
    }, { initialProps });
    await fake.complete(0, 'private-one');
    rerender({ ...initialProps, scopeKey: 'two' });

    const firstOtherScope = renders.find((entry) => entry.scope === 'two')!;
    expect(firstOtherScope.state.status).toBe('loading');
    expect(firstOtherScope.state.data).toBeUndefined();
    expect(fake.calls[0].signal?.aborted).toBe(true);
    await fake.complete(1, 'private-two');
    expect(result.current.data?.label).toBe('private-two');
  });

  it('drops a late response after a path change even if the transport ignores abort', async () => {
    const fake = fakeClient();
    const initialProps = { client: fake.client, path: 'one', scopeKey: 'same' };
    const { rerender, result } = renderHook((options) => useApiRead<Item>(options), { initialProps });
    rerender({ ...initialProps, path: 'two' });
    expect(fake.calls[0].signal?.aborted).toBe(true);
    await fake.complete(1, 'new');
    await fake.complete(0, 'old');
    expect(result.current.data?.label).toBe('new');
    expect(result.current.requestId).toBe('request-1');
  });

  it('invalidates the old result when the client changes', async () => {
    const first = fakeClient();
    const second = fakeClient();
    const initialProps = { client: first.client, path: 'items', scopeKey: 'one' };
    const { rerender, result } = renderHook((options) => useApiRead<Item>(options), { initialProps });
    await first.complete(0, 'old-server');
    rerender({ ...initialProps, client: second.client });
    expect(result.current.data).toBeUndefined();
    expect(first.calls[0].signal?.aborted).toBe(true);
    await second.complete(0, 'new-server');
    expect(result.current.data?.label).toBe('new-server');
  });

  it('aborts the active read and ignores its late resolution after unmount', async () => {
    const fake = fakeClient();
    let renderCount = 0;
    const { unmount } = renderHook(() => {
      renderCount += 1;
      return useApiRead<Item>({ client: fake.client, path: 'items', scopeKey: 'one' });
    });
    unmount();
    const previousCount = renderCount;
    expect(fake.calls[0].signal?.aborted).toBe(true);
    await fake.complete(0, 'too-late');
    expect(renderCount).toBe(previousCount);
  });

  it('links the App signal and keeps cancellation idle rather than displaying a stale result', async () => {
    const fake = fakeClient();
    const parent = new AbortController();
    const { result } = renderHook(() => useApiRead<Item>({
      client: fake.client, path: 'items', scopeKey: 'one', signal: parent.signal,
    }));
    act(() => parent.abort());
    expect(fake.calls[0].signal?.aborted).toBe(true);
    expect(result.current.status).toBe('idle');
    await fake.complete(0, 'late');
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeUndefined();
  });

  it('never starts a request with an already aborted App signal', () => {
    const fake = fakeClient();
    const parent = new AbortController();
    parent.abort();
    const { result } = renderHook(() => useApiRead<Item>({
      client: fake.client, path: 'items', scopeKey: 'one', signal: parent.signal,
    }));
    expect(result.current.status).toBe('idle');
    expect(fake.calls).toHaveLength(0);
  });

  it('reports a read failure without retaining data from the previous result', async () => {
    const fake = fakeClient();
    const initialProps = { client: fake.client, path: 'one', scopeKey: 'same' };
    const { result, rerender } = renderHook((options) => useApiRead<Item>(options), { initialProps });
    await fake.complete(0, 'old');
    rerender({ ...initialProps, path: 'two' });
    const error = new ApiError('network', 'failed-request', false);
    await act(async () => { fake.calls[1].pending.reject(error); });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe(error);
    expect(result.current.data).toBeUndefined();
    expect(result.current.requestId).toBe('failed-request');
  });

  it('normalizes an unexpected error without exposing its private text', async () => {
    const fake = fakeClient();
    const { result } = renderHook(() => useApiRead<Item>({ client: fake.client, path: 'items', scopeKey: 'one' }));
    await act(async () => { fake.calls[0].pending.reject(new Error('private-token-value')); });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(result.current.error?.message).not.toContain('private-token-value');
    expect(result.current.requestId).toMatch(/^local-read-/);
  });

  it('clears successful data and aborts the request when disabled again', async () => {
    const fake = fakeClient();
    const initialProps: ApiReadOptions = { client: fake.client, path: 'items', scopeKey: 'one' };
    const { result, rerender } = renderHook((options) => useApiRead<Item>(options), { initialProps });
    await fake.complete(0, 'old');
    rerender({ ...initialProps, path: null });
    expect(result.current.status).toBe('idle');
    expect(result.current.data).toBeUndefined();
    expect(fake.calls[0].signal?.aborted).toBe(true);
    expect(fake.calls).toHaveLength(1);
  });

  it('still reports unexpected errors when crypto.randomUUID is unavailable', async () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const fake = fakeClient();
    const { result } = renderHook(() => useApiRead<Item>({ client: fake.client, path: 'items', scopeKey: 'one' }));
    await act(async () => { fake.calls[0].pending.reject(new Error('private-token-value')); });
    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).not.toContain('private-token-value');
    expect(result.current.requestId).toMatch(/^local-read-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('survives StrictMode setup/cleanup without accepting the first setup response', async () => {
    const fake = fakeClient();
    const { result } = renderHook(() => useApiRead<Item>({ client: fake.client, path: 'items', scopeKey: 'one' }), {
      reactStrictMode: true,
    });
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0].signal?.aborted).toBe(true);
    await fake.complete(1, 'current');
    await fake.complete(0, 'discarded');
    expect(result.current.data?.label).toBe('current');
  });
});
