import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { demoFetch, isDemoData } from '../src/apps/demo/demoTransport';

const network = vi.fn<typeof fetch>(() => { throw new Error('Demo must not call browser fetch'); });

beforeEach(() => {
  vi.useFakeTimers();
  network.mockClear();
  vi.stubGlobal('fetch', network);
});

afterEach(() => {
  expect(network).not.toHaveBeenCalled();
  vi.useRealTimers();
});

describe('Demo local transport', () => {
  it('returns valid normal sample data after the local loading delay', async () => {
    const pending = demoFetch('/demo-local/projects?state=normal');
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(400);
    const response = await pending;
    const data: unknown = await response.json();
    expect(response.status).toBe(200);
    expect(isDemoData(data)).toBe(true);
    if (!isDemoData(data)) throw new Error('Expected valid Demo data');
    expect(data.projects.length).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns a valid empty result for the empty scenario', async () => {
    const pending = demoFetch('/demo-local/projects?state=empty');
    await vi.advanceTimersByTimeAsync(400);
    const response = await pending;
    const data: unknown = await response.json();
    expect(response.status).toBe(200);
    expect(isDemoData(data)).toBe(true);
    expect(data).toEqual({ projects: [] });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns an intentional 503 result for the error scenario without network access', async () => {
    const pending = demoFetch('/demo-local/projects?state=error');
    await vi.advanceTimersByTimeAsync(400);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(isDemoData(await response.json())).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects an already cancelled signal without scheduling a timer', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(demoFetch('/demo-local/projects?state=normal', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels an in-flight Request and removes its pending timer when the App leaves', async () => {
    const controller = new AbortController();
    const request = new Request(`${window.location.origin}/demo-local/projects?state=normal`, { signal: controller.signal });
    const pending = demoFetch(request);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(250);
    controller.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    await vi.runAllTimersAsync();
    expect(vi.getTimerCount()).toBe(0);
  });
});
