import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createFirebaseFrontendPublisher } from '../src/firebase-frontend-publisher.mjs';

const site = 'fixture-project';
const priorVersion = `projects/${site}/sites/${site}/versions/previous`;
const html = '<html><script src="/assets/main.js"></script></html>';
const asset = Buffer.from('console bundle');
const installation = {
  installationKey: 'fixture-installation', gcpProjectId: site,
  enabledApps: [], servicePlacements: [], auth: { authDomain: 'course.example.com' },
};

async function target() {
  const root = await mkdtemp(join(tmpdir(), 'stratexec-hosting-publisher-'));
  await mkdir(join(root, 'infrastructure', 'apps'), { recursive: true });
  await mkdir(join(root, 'apps', 'console', 'dist', 'assets'), { recursive: true });
  await writeFile(join(root, '.env.local'), `VITE_FIREBASE_PROJECT_ID=${site}\nVITE_FIREBASE_AUTH_DOMAIN=course.example.com\n`);
  await writeFile(join(root, 'infrastructure', 'services.json'), JSON.stringify({ services: [] }));
  await writeFile(join(root, 'infrastructure', 'apps', 'platform.json'), JSON.stringify({
    appKey: 'platform', kind: 'platform', requiredServices: [],
  }));
  await writeFile(join(root, 'apps', 'console', 'dist', 'index.html'), html);
  await writeFile(join(root, 'apps', 'console', 'dist', 'assets', 'main.js'), asset);
  return root;
}

test('publishes a signed frontend build through a verified preview and preserves a rollback version', async () => {
  const root = await target();
  const calls = [];
  const runCli = async (_root, args) => {
    calls.push(args);
    if (args[0] === 'hosting:channel:list') return { result: { channels: [
      { name: `sites/${site}/channels/live`, release: { version: { name: priorVersion } } },
    ] } };
    if (args[0] === 'hosting:channel:deploy') return { result: {
      [site]: { url: `https://preview--${site}.web.app`, version: 'next' },
    } };
    return { status: 'success' };
  };
  const fetchImpl = async (url) => new Response(String(url).endsWith('.js') ? asset : html);
  try {
    const publisher = createFirebaseFrontendPublisher({ rootPath: root, runCli, fetchImpl });
    const published = await publisher.publish({ installation, job: { jobId: '12345678-1234-4234-8234-123456789abc', appKey: 'fixture-app' } });
    assert.equal(published.priorVersion, priorVersion);
    assert.equal(calls.filter((call) => call[0] === 'hosting:clone').length, 1);
    await publisher.rollback(published);
    assert.deepEqual(calls.at(-1).slice(0, 3), ['hosting:clone', `${site}@previous`, `${site}:live`]);
    await assert.rejects(() => readFile(join(root, '.firebase-app-release-12345678-1234-4234-8234-123456789abc.json')), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects a preview with mismatched assets before changing the live channel', async () => {
  const root = await target();
  const calls = [];
  const runCli = async (_root, args) => {
    calls.push(args);
    if (args[0] === 'hosting:channel:list') return { result: { channels: [
      { name: `sites/${site}/channels/live`, release: { version: { name: priorVersion } } },
    ] } };
    return { result: { [site]: { url: `https://preview--${site}.web.app`, version: 'next' } } };
  };
  const fetchImpl = async (url) => new Response(String(url).endsWith('.js') ? 'wrong bundle' : html);
  try {
    const publisher = createFirebaseFrontendPublisher({ rootPath: root, runCli, fetchImpl });
    await assert.rejects(() => publisher.publish({ installation, job: { jobId: '12345678-1234-4234-8234-123456789abc', appKey: 'fixture-app' } }), /主程式資產與本次建置不一致/);
    assert.equal(calls.some((call) => call[0] === 'hosting:clone'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('restores the previous live version when the promoted website fails verification', async () => {
  const root = await target();
  const calls = [];
  const runCli = async (_root, args) => {
    calls.push(args);
    if (args[0] === 'hosting:channel:list') return { result: { channels: [
      { name: `sites/${site}/channels/live`, release: { version: { name: priorVersion } } },
    ] } };
    if (args[0] === 'hosting:channel:deploy') return { result: {
      [site]: { url: `https://preview--${site}.web.app`, version: 'next' },
    } };
    return { status: 'success' };
  };
  const fetchImpl = async (url) => {
    const targetUrl = String(url);
    if (targetUrl.endsWith('.js')) return new Response(asset);
    if (new URL(targetUrl).hostname === `${site}.web.app`) return new Response('wrong live version');
    return new Response(html);
  };
  try {
    const publisher = createFirebaseFrontendPublisher({ rootPath: root, runCli, fetchImpl });
    await assert.rejects(() => publisher.publish({ installation, job: {
      jobId: '12345678-1234-4234-8234-123456789abc', appKey: 'fixture-app',
    } }), /未回傳此次建置的 Console/);
    assert.deepEqual(calls.filter((call) => call[0] === 'hosting:clone').map((call) => call.slice(1, 3)), [
      [`${site}:app-12345678`, `${site}:live`],
      [`${site}@previous`, `${site}:live`],
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('marks an uncertain live state for reconciliation when rollback cannot be confirmed', async () => {
  const root = await target();
  const runCli = async (_root, args) => {
    if (args[0] === 'hosting:channel:list') return { result: { channels: [
      { name: `sites/${site}/channels/live`, release: { version: { name: priorVersion } } },
    ] } };
    if (args[0] === 'hosting:channel:deploy') return { result: {
      [site]: { url: `https://preview--${site}.web.app`, version: 'next' },
    } };
    if (args[0] === 'hosting:clone' && args[1] === `${site}@previous`) throw new Error('rollback failed');
    return { status: 'success' };
  };
  const fetchImpl = async (url) => {
    const targetUrl = String(url);
    if (targetUrl.endsWith('.js')) return new Response(asset);
    return new Response(new URL(targetUrl).hostname === `${site}.web.app` ? 'wrong live version' : html);
  };
  try {
    const publisher = createFirebaseFrontendPublisher({ rootPath: root, runCli, fetchImpl });
    await assert.rejects(() => publisher.publish({ installation, job: {
      jobId: '12345678-1234-4234-8234-123456789abc', appKey: 'fixture-app',
    } }), (error) => error.recoveryRequired === true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
