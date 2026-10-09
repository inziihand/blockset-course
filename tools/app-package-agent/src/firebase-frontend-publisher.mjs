import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, readFile, writeFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHostingConfig } from '../../../scripts/lib/hosting-config.mjs';
import { createDeploymentPlan, loadAppManifests } from '../../../scripts/lib/deployment-plan.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const projectPattern = /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/;

function parseEnv(source) {
  return Object.fromEntries(source.split(/\r?\n/).filter((line) => /^VITE_[A-Z0-9_]+=/.test(line))
    .map((line) => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1).replace(/^['"]|['"]$/g, '')]; }));
}

async function firebaseEnvironment(root) {
  const environment = { ...process.env };
  if (!environment.GOOGLE_APPLICATION_CREDENTIALS) {
    const adc = process.platform === 'win32'
      ? join(environment.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'gcloud', 'application_default_credentials.json')
      : join(homedir(), '.config', 'gcloud', 'application_default_credentials.json');
    await access(adc).catch(() => { throw new Error('Firebase Hosting 發布需要先完成本機 Google Application Default Credentials 登入。'); });
    environment.GOOGLE_APPLICATION_CREDENTIALS = adc;
  }
  environment.XDG_CONFIG_HOME = join(root, '.stratexec', 'firebase-cli-adc');
  environment.NODE_OPTIONS = [environment.NODE_OPTIONS, '--use-system-ca'].filter(Boolean).join(' ');
  return environment;
}

async function runFirebase(root, args) {
  const cli = resolve(root, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
  const environment = await firebaseEnvironment(root);
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, ...args, '--json', '--non-interactive'], {
      cwd: root, env: environment, shell: false, windowsHide: true,
    });
    let output = '';
    let overflow = false;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 10 * 60_000);
    child.stdout.on('data', (chunk) => { output += chunk; if (output.length > 2_000_000) { overflow = true; child.kill(); } });
    child.stderr.on('data', () => { /* Firebase CLI diagnostics may include private context; do not return them. */ });
    child.on('error', (error) => { clearTimeout(timeout); fail(error); });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (timedOut) return fail(new Error('Firebase CLI 超過十分鐘未完成，需先核對 Hosting 狀態。'));
      if (overflow) return fail(new Error('Firebase CLI 回應超過安全上限。'));
      if (code !== 0) return fail(new Error('Firebase Hosting 發布失敗；請檢查 Package Agent 的受保護日誌與 ADC 權限。'));
      try { done(JSON.parse(output)); } catch { fail(new Error('Firebase CLI 未回傳可驗證的 JSON 結果。')); }
    });
  });
}

async function verifyHtml(fetchImpl, url, expected) {
  const response = await fetchImpl(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok || digest(await response.text()) !== digest(expected)) {
    throw new Error('Hosting 預覽或正式網址未回傳此次建置的 Console。');
  }
}

/** A local, admin-controlled Hosting publisher. It never accepts a path or command from a ZIP. */
export function createFirebaseFrontendPublisher({
  rootPath,
  runCli = runFirebase,
  fetchImpl = fetch,
} = {}) {
  if (!rootPath) throw new Error('Frontend publisher requires a repository root.');
  const root = resolve(rootPath);
  const rollback = async ({ site, priorVersion }) => {
    const versionId = priorVersion?.match(new RegExp(`^(?:projects/[^/]+/)?sites/${site}/versions/([A-Za-z0-9_-]+)$`))?.[1];
    if (!versionId) throw new Error('沒有可回復的上一個 Hosting 版本。');
    await runCli(root, ['hosting:clone', `${site}@${versionId}`, `${site}:live`, '--project', site]);
  };

  return Object.freeze({
    async publish({ installation, job }) {
      const site = installation.gcpProjectId;
      if (!projectPattern.test(site ?? '')) {
        throw new Error('Hosting 發布目標必須是已確認的 installation project ID。');
      }
      const localEnv = parseEnv(await readFile(join(root, '.env.local'), 'utf8'));
      if (localEnv.VITE_FIREBASE_PROJECT_ID !== site
        || localEnv.VITE_FIREBASE_AUTH_DOMAIN !== installation.auth?.authDomain) {
        throw new Error('本機 Console Firebase 設定與 Hosting 目標不一致。');
      }
      const registry = JSON.parse(await readFile(join(root, 'infrastructure', 'services.json'), 'utf8'));
      const deployment = createDeploymentPlan({ installation, registry,
        appManifests: await loadAppManifests(pathToFileURL(`${root}/`)) });
      const config = createHostingConfig(installation, registry, {
        publicDirectory: 'apps/console/dist', selectedServiceKeys: deployment.requiredServiceKeys,
      });
      const configPath = join(root, `.firebase-app-release-${job.jobId}.json`);
      const channel = `app-${job.jobId.slice(0, 8)}`;
      const expected = await readFile(join(root, 'apps', 'console', 'dist', 'index.html'), 'utf8');
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx' });
      let promotionAttempted = false;
      let priorVersion;
      try {
        const listed = await runCli(root, ['hosting:channel:list', '--site', site,
          '--project', site, '--config', configPath]);
        priorVersion = listed.result?.channels?.find((channel) => channel.name?.endsWith('/channels/live'))
          ?.release?.version?.name;
        if (!priorVersion?.match(new RegExp(`^(?:projects/[^/]+/)?sites/${site}/versions/[A-Za-z0-9_-]+$`))) {
          throw new Error('找不到 Hosting 正式站前一版本；不能安全發布或回復。');
        }
        const staged = await runCli(root, ['hosting:channel:deploy', channel, '--expires', '1d',
          '--no-authorized-domains', '--project', site, '--config', configPath]);
        const preview = staged.result?.[site];
        if (!preview?.url || !preview?.version || new URL(preview.url).protocol !== 'https:') {
          throw new Error('Hosting 預覽版缺少可驗證的網址或版本。');
        }
        await verifyHtml(fetchImpl, new URL(`/apps/${job.appKey}`, preview.url), expected);
        const mainAsset = expected.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1];
        if (!mainAsset) throw new Error('Console 建置缺少主程式資產。');
        const asset = await fetchImpl(new URL(mainAsset, preview.url), { signal: AbortSignal.timeout(30_000) });
        const localAsset = await readFile(join(root, 'apps', 'console', 'dist', mainAsset.slice(1)));
        if (!asset.ok || digest(Buffer.from(await asset.arrayBuffer())) !== digest(localAsset)) {
          throw new Error('Hosting 預覽版主程式資產與本次建置不一致。');
        }
        promotionAttempted = true;
        await runCli(root, ['hosting:clone', `${site}:${channel}`, `${site}:live`, '--project', site]);
        const hostingUrl = `https://${site}.web.app`;
        await verifyHtml(fetchImpl, new URL(`/apps/${job.appKey}`, hostingUrl), expected);
        if (installation.auth?.authDomain && installation.auth.authDomain !== `${site}.firebaseapp.com`) {
          await verifyHtml(fetchImpl, new URL(`/apps/${job.appKey}`, `https://${installation.auth.authDomain}`), expected);
        }
        return { site, channel, previewUrl: preview.url, version: preview.version,
          hostingUrl, priorVersion, publishedAt: new Date().toISOString() };
      } catch (error) {
        if (promotionAttempted) {
          try {
            await rollback({ site, priorVersion });
          } catch {
            throw Object.assign(new Error('Hosting 發布後驗證失敗，且前版回復未確認；需要人工核對正式站。', { cause: error }),
              { recoveryRequired: true });
          }
        }
        throw error;
      } finally {
        await rm(configPath, { force: true });
      }
    },
    async rollback(publication) {
      await rollback(publication);
    },
  });
}
