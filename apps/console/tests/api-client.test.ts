import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from '../src/shared/api';

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});
const fakeFetch = () => vi.fn<typeof fetch>();
const pendingResponse = () => new Promise<Response>(() => {});

afterEach(() => { vi.useRealTimers(); });

describe('API transport (offline, not backend authentication or trading)', () => {
  it('uses its same-origin base, JSON transport and a per-request correlation ID', async () => {
    const send = fakeFetch().mockImplementation(async () => response({ ok: true }));
    const client = createApiClient({ baseUrl: '/service/v1', fetch: send });
    const result = await client.request<{ ok: boolean }>('items?limit=2', { method: 'POST', body: { count: '1' } });
    expect(result.data).toEqual({ ok: true });
    expect(result.requestId).toMatch(/^[\da-f-]{36}$/);
    expect(send).toHaveBeenCalledWith(`${window.location.origin}/service/v1/items?limit=2`, expect.objectContaining({
      method: 'POST', body: '{"count":"1"}', credentials: 'same-origin', redirect: 'error',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Request-ID': result.requestId },
    }));
    const second = await client.request('items');
    expect(second.requestId).not.toBe(result.requestId);
  });

  it('accepts application authorization without allowing transport header replacement', async () => {
    const send = fakeFetch().mockResolvedValue(response({ ok: true }));
    const client = createApiClient({ fetch: send });
    await client.request('items', { headers: { Authorization: 'Bearer test-token' } });
    expect(send.mock.calls[0][1]?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer test-token' }));
    await expect(client.request('items', { headers: { 'X-Request-ID': 'forged' } })).rejects.toBeInstanceOf(TypeError);
    await expect(client.request('items', { headers: { Authorization: 'Bearer x\nforged' } })).rejects.toBeInstanceOf(TypeError);
  });

  it.each(['https://example.com/api/', '//example.com/api/', '/api/../private', '/api/%2e%2e/private', '/api/?token=x', '/api/#fragment'])('rejects unsafe base %s', (baseUrl) => {
    expect(() => createApiClient({ baseUrl, fetch: fakeFetch() })).toThrow(TypeError);
  });

  it.each(['https://example.com/private', '//example.com/private', '/outside', '../outside', 'a/../../outside', '%2e%2e/outside', '%252e%252e/outside', 'a%2fb', 'a%5cb', 'a\\b', 'a#fragment', 'a\nb'])('rejects escaping or ambiguous request path %s before dispatch', async (path) => {
    const send = fakeFetch();
    await expect(createApiClient({ fetch: send }).request(path)).rejects.toBeInstanceOf(TypeError);
    expect(send).not.toHaveBeenCalled();
  });

  it('accepts an absolute same-origin base and an encoded ordinary segment', async () => {
    const send = fakeFetch().mockResolvedValue(response({}));
    await createApiClient({ baseUrl: `${window.location.origin}/api/`, fetch: send }).request('%E5%B8%B3%E6%88%B6');
    expect(send).toHaveBeenCalledOnce();
  });

  it.each([0, -1, Infinity, 60_001, 1.5])('rejects unbounded/invalid timeout %s', (timeoutMs) => {
    expect(() => createApiClient({ timeoutMs, fetch: fakeFetch() })).toThrow(TypeError);
  });

  it('treats HEAD and 204 as valid without trying to parse an empty JSON body', async () => {
    const send = fakeFetch().mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(new Response(null));
    const client = createApiClient({ fetch: send });
    expect((await client.request('items', { method: 'DELETE' })).data).toBeUndefined();
    expect((await client.request('items', { method: 'HEAD' })).data).toBeUndefined();
  });

  it('does not retry reads unless the caller explicitly opts in', async () => {
    const send = fakeFetch().mockRejectedValue(new Error('sensitive transport text'));
    const error = await createApiClient({ fetch: send }).request('items').catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'network', outcomeUnknown: false });
    expect((error as Error).message).not.toContain('sensitive');
    expect(send).toHaveBeenCalledOnce();
  });

  it.each([429, 502, 503, 504])('retries opt-in safe read once for status %s using the same logical request ID', async (status) => {
    vi.useFakeTimers();
    const send = fakeFetch().mockResolvedValueOnce(response({ secret: 'not surfaced' }, status)).mockResolvedValueOnce(response({ ok: true }));
    const result = createApiClient({ fetch: send }).request('items', { safeReadRetry: true });
    await vi.advanceTimersByTimeAsync(150);
    const resolved = await result;
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][1]?.headers).toEqual(send.mock.calls[1][1]?.headers);
    expect(resolved.data).toEqual({ ok: true });
  });

  it('never retries an opted-in read more than once', async () => {
    vi.useFakeTimers();
    const send = fakeFetch().mockRejectedValue(new Error('offline'));
    const result = createApiClient({ fetch: send }).request('items', { safeReadRetry: true });
    const rejected = expect(result).rejects.toMatchObject({ kind: 'network', outcomeUnknown: false });
    await vi.advanceTimersByTimeAsync(150);
    await rejected;
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403])('does not retry authorization status %s and does not expose server content', async (status) => {
    const send = fakeFetch().mockResolvedValue(response({ error: 'private backend diagnostic' }, status));
    const error = await createApiClient({ fetch: send }).request('items', { safeReadRetry: true }).catch((value: unknown) => value);
    expect(error).toMatchObject({ kind: 'http', status, outcomeUnknown: false });
    expect((error as Error).message).not.toContain('private');
    expect(send).toHaveBeenCalledOnce();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)('never automatically retries %s even when safeReadRetry is set', async (method) => {
    const send = fakeFetch().mockRejectedValue(new Error('network after dispatch'));
    await expect(createApiClient({ fetch: send }).request('commands', { method, safeReadRetry: true })).rejects.toMatchObject({ kind: 'network', outcomeUnknown: true });
    expect(send).toHaveBeenCalledOnce();
  });

  it.each([400, 401, 403, 408, 409, 422, 429, 503])('treats mutation HTTP %s as unknown until domain evidence proves a rejection', async (status) => {
    const send = fakeFetch().mockResolvedValue(response({}, status));
    await expect(createApiClient({ fetch: send }).request('commands', { method: 'POST', safeReadRetry: true })).rejects.toMatchObject({ status, outcomeUnknown: true });
    expect(send).toHaveBeenCalledOnce();
  });

  it('marks an already-aborted write as not sent', async () => {
    const send = fakeFetch();
    const abort = new AbortController();
    abort.abort();
    await expect(createApiClient({ fetch: send }).request('commands', { method: 'POST', signal: abort.signal })).rejects.toMatchObject({ kind: 'aborted', outcomeUnknown: false });
    expect(send).not.toHaveBeenCalled();
  });

  it('marks an in-flight aborted write unknown and aborts transport without claiming a broker cancellation', async () => {
    const send = fakeFetch().mockImplementation(pendingResponse);
    const abort = new AbortController();
    const result = createApiClient({ fetch: send }).request('commands', { method: 'POST', signal: abort.signal });
    const rejected = expect(result).rejects.toMatchObject({ kind: 'aborted', outcomeUnknown: true });
    await Promise.resolve();
    expect(send).toHaveBeenCalledOnce();
    abort.abort();
    await rejected;
    expect(send.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('enforces the deadline even if a fetch implementation ignores its signal', async () => {
    vi.useFakeTimers();
    const send = fakeFetch().mockImplementation(pendingResponse);
    const result = createApiClient({ fetch: send, timeoutMs: 20 }).request('commands', { method: 'POST' });
    const rejected = expect(result).rejects.toMatchObject({ kind: 'timeout', outcomeUnknown: true });
    await vi.advanceTimersByTimeAsync(20);
    await rejected;
    expect(send.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('includes stalled response JSON consumption in the overall timeout', async () => {
    vi.useFakeTimers();
    const stalled = response({});
    vi.spyOn(stalled, 'json').mockImplementation(() => new Promise(() => {}));
    const send = fakeFetch().mockResolvedValue(stalled);
    const result = createApiClient({ fetch: send, timeoutMs: 20 }).request('commands', { method: 'POST' });
    const rejected = expect(result).rejects.toMatchObject({ kind: 'timeout', outcomeUnknown: true });
    await vi.advanceTimersByTimeAsync(20);
    await rejected;
  });

  it('cancels pending response JSON consumption and discards its late resolution', async () => {
    let finish!: (data: unknown) => void;
    const stalled = response({});
    vi.spyOn(stalled, 'json').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const send = fakeFetch().mockResolvedValue(stalled);
    const abort = new AbortController();
    const result = createApiClient({ fetch: send }).request('items', { signal: abort.signal });
    const rejected = expect(result).rejects.toMatchObject({ kind: 'aborted', outcomeUnknown: false });
    await vi.waitFor(() => expect(stalled.json).toHaveBeenCalledOnce());
    abort.abort();
    await rejected;
    finish({ fromOldPage: true });
  });

  it('aborts backoff and does not start a second attempt', async () => {
    vi.useFakeTimers();
    const send = fakeFetch().mockResolvedValue(response({}, 503));
    const abort = new AbortController();
    const result = createApiClient({ fetch: send }).request('items', { signal: abort.signal, safeReadRetry: true });
    const rejected = expect(result).rejects.toMatchObject({ kind: 'aborted' });
    await vi.advanceTimersByTimeAsync(10);
    abort.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(500);
    expect(send).toHaveBeenCalledOnce();
  });

  it('does not reset the overall deadline while waiting to retry', async () => {
    vi.useFakeTimers();
    const send = fakeFetch().mockResolvedValue(response({}, 503));
    const result = createApiClient({ fetch: send, timeoutMs: 100 }).request('items', { safeReadRetry: true });
    const rejected = expect(result).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(send).toHaveBeenCalledOnce();
  });

  it('does not retry malformed JSON and marks an acknowledged write response as uncertain', async () => {
    const send = fakeFetch().mockImplementation(async () => new Response('not JSON'));
    const client = createApiClient({ fetch: send });
    await expect(client.request('items', { safeReadRetry: true })).rejects.toMatchObject({ kind: 'invalid_response', outcomeUnknown: false });
    await expect(client.request('commands', { method: 'POST' })).rejects.toMatchObject({ kind: 'invalid_response', outcomeUnknown: true });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('keeps a 202 transport acknowledgement distinct from command execution completion', async () => {
    const send = fakeFetch().mockResolvedValue(response({ commandId: 'example', state: 'RECEIVED' }, 202));
    const result = await createApiClient({ fetch: send }).request('commands', { method: 'POST' });
    expect(result.data).toEqual({ commandId: 'example', state: 'RECEIVED' });
  });

  it('rejects invalid body input before dispatch', async () => {
    const send = fakeFetch();
    const client = createApiClient({ fetch: send });
    await expect(client.request('items', { body: {} })).rejects.toBeInstanceOf(TypeError);
    await expect(client.request('items', { method: 'POST', body: 1n })).rejects.toBeInstanceOf(TypeError);
    expect(send).not.toHaveBeenCalled();
  });
});
