import { createRequestId } from './requestId';

export type ApiErrorKind = 'http' | 'network' | 'timeout' | 'aborted' | 'invalid_response';
export type ApiMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const messages: Record<ApiErrorKind, string> = {
  http: '服務拒絕或未能完成請求。',
  network: '無法確認服務回應。',
  timeout: '請求逾時。',
  aborted: '已停止等待請求。',
  invalid_response: '服務回應格式不正確。',
};

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly requestId: string;
  readonly status?: number;
  readonly outcomeUnknown: boolean;

  constructor(kind: ApiErrorKind, requestId: string, outcomeUnknown: boolean, status?: number) {
    // Never expose a response body, URL, credentials or native exception text.
    super(messages[kind]);
    this.name = 'ApiError';
    this.kind = kind;
    this.requestId = requestId;
    this.status = status;
    this.outcomeUnknown = outcomeUnknown;
  }
}

export interface ApiRequestOptions {
  method?: ApiMethod;
  body?: unknown;
  /** Per-request application headers such as Authorization. Transport-owned headers cannot be replaced. */
  headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Explicitly opt in for GET/HEAD only; at most one additional attempt. */
  safeReadRetry?: boolean;
}

export interface ApiResponse<T> {
  /** T is transport typing only, not runtime validation or a business schema. */
  data: T;
  requestId: string;
}

export interface ApiClient {
  request<T = unknown>(path: string, options?: ApiRequestOptions): Promise<ApiResponse<T>>;
}

export interface ApiClientOptions {
  /** Same-origin root path or same-origin absolute URL; default /api/. */
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const RETRY_DELAY_MS = 150;
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const METHODS = new Set<ApiMethod>(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const RESERVED_HEADERS = new Set(['accept', 'content-type', 'x-request-id']);

function checkedTimeout(value: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) {
    throw new TypeError('API timeout must be an integer between 1 and 60000 milliseconds.');
  }
  return value;
}

function checkedHeaders(input: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(input ?? {})) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || RESERVED_HEADERS.has(name.toLowerCase())
      || typeof value !== 'string' || /[\r\n\0]/.test(value)) {
      throw new TypeError('Invalid or transport-owned API request header.');
    }
    result[name] = value;
  }
  return result;
}

function checkPathSegments(path: string): void {
  for (const segment of path.split('/')) {
    let decoded = segment;
    try {
      // Reject nested encodings too, rather than relying on a server's decode policy.
      for (let depth = 0; decoded.includes('%') && depth < 8; depth += 1) {
        decoded = decodeURIComponent(decoded);
      }
    } catch {
      throw new TypeError('Invalid API path.');
    }
    if (decoded.includes('%') || decoded === '.' || decoded === '..' || /[\\/:\x00-\x20\x7f]/.test(decoded)) {
      throw new TypeError('Invalid API path.');
    }
  }
}

function checkedBaseUrl(input: string): URL {
  const origin = window.location.origin;
  const rootPath = input.startsWith(`${origin}/`) ? input.slice(origin.length) : input;
  if (!rootPath.startsWith('/') || rootPath.startsWith('//') || /[?#\x00-\x20\x7f]/.test(rootPath)) {
    throw new TypeError('API base URL must be a same-origin root path without query or fragment.');
  }
  checkPathSegments(rootPath);
  const base = new URL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`, origin);
  if (!['http:', 'https:'].includes(base.protocol) || base.origin !== origin || base.username || base.password) {
    throw new TypeError('API base URL must be same-origin HTTP(S).');
  }
  return base;
}

function requestUrl(base: URL, path: string): URL {
  if (path.startsWith('/') || /[#\x00-\x20\x7f]/.test(path)) {
    throw new TypeError('API request path must be relative to its configured base.');
  }
  checkPathSegments(path.split('?')[0]);
  const url = new URL(path, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.username || url.password) {
    throw new TypeError('API request path must remain inside its configured base.');
  }
  return url;
}

function abortable<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Request no longer awaited.'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => {
      if (signal.aborted) throw new Error('Request no longer awaited.');
      return operation();
    }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

async function backoff(signal: AbortSignal): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await abortable(() => new Promise<void>((resolve) => { timer = setTimeout(resolve, RETRY_DELAY_MS); }), signal);
  } finally {
    clearTimeout(timer);
  }
}

/** A transport only: no authentication provider, generated business client or broker access. */
export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const base = checkedBaseUrl(options.baseUrl ?? '/api/');
  const defaultTimeout = checkedTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const send = options.fetch ?? globalThis.fetch.bind(globalThis);

  return {
    async request<T = unknown>(path: string, request: ApiRequestOptions = {}): Promise<ApiResponse<T>> {
      const url = requestUrl(base, path);
      const method = request.method ?? 'GET';
      if (!METHODS.has(method)) throw new TypeError('Unsupported API method.');
      const readOnly = method === 'GET' || method === 'HEAD';
      if (readOnly && request.body !== undefined) throw new TypeError('GET and HEAD requests cannot have a body.');
      let body: string | undefined;
      try { body = request.body === undefined ? undefined : JSON.stringify(request.body); }
      catch { throw new TypeError('API request body must be JSON serializable.'); }
      if (request.body !== undefined && body === undefined) throw new TypeError('API request body must be JSON serializable.');
      const timeout = checkedTimeout(request.timeoutMs ?? defaultTimeout);
      const applicationHeaders = checkedHeaders(request.headers);
      const id = createRequestId();
      const controller = new AbortController();
      let abortKind: 'aborted' | 'timeout' | undefined;
      let dispatched = false;
      const cancel = (kind: 'aborted' | 'timeout') => {
        if (!controller.signal.aborted) { abortKind = kind; controller.abort(); }
      };
      const callerAbort = () => cancel('aborted');
      request.signal?.addEventListener('abort', callerAbort, { once: true });
      if (request.signal?.aborted) callerAbort();
      const deadline = setTimeout(() => cancel('timeout'), timeout);
      const unknownWrite = () => !readOnly && dispatched;
      const cancelledError = () => new ApiError(abortKind ?? 'aborted', id, unknownWrite());

      try {
        const attempts = readOnly && request.safeReadRetry === true ? 2 : 1;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          try {
            if (controller.signal.aborted) throw cancelledError();
            let response: Response;
            try {
              response = await abortable(() => {
                dispatched = true;
                return send(url.href, {
                  method,
                  body,
                  signal: controller.signal,
                  credentials: 'same-origin',
                  redirect: 'error',
                  headers: {
                    Accept: 'application/json',
                    'X-Request-ID': id,
                    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
                    ...applicationHeaders,
                  },
                });
              }, controller.signal);
            } catch {
              if (controller.signal.aborted) throw cancelledError();
              throw new ApiError('network', id, unknownWrite());
            }
            if (!response.ok) {
              // Transport status alone cannot prove a mutation had no side effects
              // (including deduplication/conflict responses). Domain reconciliation
              // must establish a definite rejection before offering another attempt.
              throw new ApiError('http', id, unknownWrite(), response.status);
            }
            if (method === 'HEAD' || response.status === 204) return { data: undefined as T, requestId: id };
            try {
              const data = await abortable(() => response.json() as Promise<T>, controller.signal);
              return { data, requestId: id };
            } catch {
              if (controller.signal.aborted) throw cancelledError();
              throw new ApiError('invalid_response', id, unknownWrite(), response.status);
            }
          } catch (error) {
            if (controller.signal.aborted) throw cancelledError();
            if (!(error instanceof ApiError)) throw error;
            const retryable = error.kind === 'network' || (error.kind === 'http' && RETRY_STATUSES.has(error.status ?? 0));
            if (!retryable || attempt + 1 >= attempts) throw error;
            await backoff(controller.signal);
          }
        }
        throw new Error('Unreachable request state.');
      } catch (error) {
        if (controller.signal.aborted) throw cancelledError();
        throw error;
      } finally {
        clearTimeout(deadline);
        request.signal?.removeEventListener('abort', callerAbort);
      }
    },
  };
}
