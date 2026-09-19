/** Local sample transport: deliberately never delegates to browser fetch. */
export type DemoScenario = 'normal' | 'empty' | 'error';
export interface DemoProject { id: string; title: string; description: string; tag: string }
export interface DemoData { projects: DemoProject[] }

const projects: DemoProject[] = [
  { id: 'components', title: '介面元件整理', description: '把常用操作放在熟悉的位置。', tag: '元件' },
  { id: 'theme', title: '主題配色確認', description: '淺色、深色與暖紙共用同一份內容。', tag: '外觀' },
  { id: 'flow', title: '操作流程草稿', description: '從輸入、確認到通知，試走一次完整流程。', tag: '互動' },
];

export function isDemoData(value: unknown): value is DemoData {
  if (!value || typeof value !== 'object' || !('projects' in value) || !Array.isArray(value.projects)) return false;
  return value.projects.every((item: unknown) => item !== null && typeof item === 'object'
    && ['id', 'title', 'description', 'tag'].every((key) => key in item && typeof (item as Record<string, unknown>)[key] === 'string'));
}

export const demoFetch: typeof fetch = (input, init) => {
  const request = input instanceof Request ? input : undefined;
  const signal = init?.signal ?? request?.signal;
  const url = new URL(request?.url ?? String(input), window.location.origin);
  const method = init?.method ?? request?.method ?? 'GET';
  return new Promise<Response>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
    const cancel = () => { cleanup(); reject(new DOMException('Local sample cancelled', 'AbortError')); };
    if (signal?.aborted) { cancel(); return; }
    signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => {
      cleanup();
      const scenario = url.searchParams.get('state');
      const status = method !== 'GET' ? 405 : url.pathname !== '/demo-local/projects' ? 404 : scenario === 'error' ? 503 : 200;
      const body = status === 200 ? { projects: scenario === 'empty' ? [] : projects } : { error: 'offline-sample' };
      resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
    }, 400);
  });
};
