export type FixtureScope = 'alpha' | 'beta';
export type FixtureReadMode = 'normal' | 'delayed' | 'error' | 'empty';
export type FixtureResult = { scope: FixtureScope; items: string[] };

/** A completely offline response substitute: never delegates to global fetch. */
export const offlineFetch: typeof fetch = async (input, options) => {
  const address = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(address, window.location.origin);
  if (options?.method !== 'GET' || url.pathname !== '/offline-fixtures/fixture-status') {
    return new Response(null, { status: 404 });
  }
  const scope: FixtureScope = url.searchParams.get('scope') === 'beta' ? 'beta' : 'alpha';
  const mode = url.searchParams.get('mode');
  const delay = mode === 'delayed' ? (scope === 'alpha' ? 800 : 80) : 40;
  // Deliberately ignore AbortSignal. The real transport/hook must still discard
  // a late result from an old scope even when an underlying operation ignores it.
  await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
  if (mode === 'error') return new Response(null, { status: 503 });
  const result: FixtureResult = { scope, items: mode === 'empty' ? [] : [`${scope} 離線資料`] };
  return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
