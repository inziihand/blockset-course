import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  askMenu,
  askYesNo,
  ensureGcloudSuccess,
  fetchJson,
  pathExists,
  readJson,
  run,
  runFirebase,
  runNode,
  runNpm,
  writeJsonAtomic,
} from './common.mjs';
import { startLocal } from './runtime.mjs';

const REQUIRED_LOCAL_APIS = ['firebase.googleapis.com', 'identitytoolkit.googleapis.com'];
const DEPLOYMENT_APIS = [
  'artifactregistry.googleapis.com',
  'cloudbuild.googleapis.com',
  'firebase.googleapis.com',
  'firebasehosting.googleapis.com',
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'run.googleapis.com',
  'secretmanager.googleapis.com',
];

export function convertToInstallationKey(value) {
  let candidate = String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!candidate || !/^[a-z]/.test(candidate)) return 'customer-installation';
  if (candidate.length > 40) candidate = candidate.slice(0, 40).replace(/-+$/g, '');
  return candidate.length >= 3 ? candidate : 'customer-installation';
}

function defaultServiceName(installationKey) {
  const prefix = installationKey.length > 53
    ? installationKey.slice(0, 53).replace(/-+$/g, '')
    : installationKey;
  return `${prefix}-identity`;
}

export function installationConfigReady(candidate, identityServiceKey) {
  const placement = candidate?.servicePlacements?.find((entry) => entry.serviceKey === identityServiceKey);
  return Boolean(
    /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/.test(candidate?.installationKey ?? '') &&
    candidate?.displayName && candidate.displayName !== 'Customer name' &&
    /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(candidate?.gcpProjectId ?? '') &&
    candidate.gcpProjectId !== 'customer-project-id' &&
    /^[a-z]+-[a-z]+[0-9]$/.test(candidate?.region ?? '') &&
    /^.+@.+\..+$/.test(candidate?.auth?.supportEmail ?? '') &&
    candidate.auth.supportEmail !== 'support@example.com' &&
    placement?.selectedTarget === 'cloud-run-service' &&
    placement.region === candidate.region &&
    /^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(placement.serviceName ?? ''),
  );
}

function gcloud(args, options = {}) {
  return run('gcloud', args, options);
}

function gcloudValue(args, action) {
  const result = gcloud(args, { capture: true, allowFailure: true });
  return ensureGcloudSuccess(action, result);
}

function parseJsonOutput(result, label) {
  if (result.exitCode !== 0) {
    throw new Error(`${label}失敗：${result.stderr || result.stdout || 'unknown error'}`);
  }
  try {
    return result.stdout ? JSON.parse(result.stdout) : null;
  } catch (error) {
    throw new Error(`${label}回傳的 JSON 無法解析：${error.message}`);
  }
}

function firebasePayload(value) {
  return value?.result ?? value;
}

function runFirebaseJson(repoRoot, args, options = {}) {
  const result = runFirebase(repoRoot, args, { capture: true, allowFailure: true, ...options });
  if (result.exitCode !== 0) return { succeeded: false, value: null, error: result.stderr || result.stdout };
  try {
    return { succeeded: true, value: result.stdout ? JSON.parse(result.stdout) : null, error: '' };
  } catch (error) {
    return { succeeded: false, value: null, error: error.message };
  }
}

async function gcloudContext() {
  let account = gcloudValue(
    ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'],
    '讀取目前登入帳號',
  );
  if (!account) {
    if (!await askYesNo('目前沒有啟用中的 gcloud 帳號。現在開啟 Google 登入嗎？')) {
      throw new Error('使用者取消 Google 登入，安裝設定未變更。');
    }
    gcloud(['auth', 'login']);
    account = gcloudValue(
      ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'],
      '重新讀取目前登入帳號',
    );
    if (!account) throw new Error('Google 登入完成後仍找不到啟用中的 gcloud 帳號。');
  }
  const configuredProject = gcloudValue(
    ['config', 'get-value', 'project'],
    '讀取預設 project',
  );
  const projects = JSON.parse(gcloudValue(
    ['projects', 'list', '--format=json(projectId,name)'],
    '列出可存取的 Google Cloud projects',
  ) || '[]').sort((left, right) =>
    String(left.name ?? left.projectId).localeCompare(String(right.name ?? right.projectId)));
  if (!projects.length) throw new Error('目前帳號沒有可列出的 Google Cloud project。');
  return { account: account.trim(), configuredProject: configuredProject.trim(), projects };
}

async function selectProject(context) {
  if (context.projects.length === 1) {
    const project = context.projects[0];
    console.log(`自動選用唯一可存取的 project：${project.name} (${project.projectId})`);
    return project;
  }
  console.log('\n可存取的 Google Cloud projects：');
  let defaultSelection = 1;
  context.projects.forEach((project, index) => {
    const current = project.projectId === context.configuredProject;
    if (current) defaultSelection = index + 1;
    console.log(`  ${index + 1}. ${project.name} [${project.projectId}]${current ? '（目前預設）' : ''}`);
  });
  const selection = await askMenu('請選擇 project 編號', 1, context.projects.length, defaultSelection);
  return context.projects[selection - 1];
}

async function findOrCreateInstallationConfig(repoRoot) {
  const environmentDirectory = path.join(repoRoot, 'infrastructure', 'environments');
  const serviceRegistry = await readJson(path.join(repoRoot, 'infrastructure', 'services.json'));
  const identityServices = serviceRegistry.services.filter((service) =>
    service.capabilities?.includes('identity:session') &&
    service.deployment?.allowedTargets?.includes('cloud-run-service'));
  if (identityServices.length !== 1) {
    throw new Error('安裝精靈需要恰好一個支援 Cloud Run 的 identity:session service。');
  }
  const identityServiceKey = identityServices[0].key;
  const entries = (await readdir(environmentDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.local.json'));
  const complete = [];
  for (const entry of entries) {
    const filePath = path.join(environmentDirectory, entry.name);
    try {
      const candidate = await readJson(filePath);
      if (installationConfigReady(candidate, identityServiceKey)) complete.push(filePath);
      else console.warn(`略過尚未填完的安裝設定：${filePath}`);
    } catch {
      console.warn(`略過無法解析的安裝設定：${filePath}`);
    }
  }
  if (complete.length === 1 && await askYesNo(`偵測到既有安裝設定 ${complete[0]}，直接使用嗎？`)) {
    return complete[0];
  }
  if (complete.length > 1) {
    console.log('偵測到多份可用的本機安裝設定：');
    complete.forEach((filePath, index) => console.log(`  ${index + 1}. ${filePath}`));
    console.log('  0. 建立新的安裝設定');
    const selection = await askMenu('請選擇設定編號', 0, complete.length, 0);
    if (selection > 0) return complete[selection - 1];
  }

  console.log('\nStratExec 跨平台安裝設定精靈');
  console.log('正在讀取目前 gcloud 帳號與可存取的既有 Google Cloud projects。\n');
  const context = await gcloudContext();
  console.log(`gcloud 帳號：${context.account}`);
  if (!/^.+@.+\..+$/.test(context.account)) throw new Error('目前 gcloud 帳號不是可用的 email。');
  const selected = await selectProject(context);
  const projectId = String(selected.projectId);
  const displayName = String(selected.name || projectId);
  const installationKey = convertToInstallationKey(projectId);
  const region = 'asia-east1';
  console.log('\n安裝設定摘要');
  console.log(`  顯示名稱：${displayName}`);
  console.log(`  安裝代號：${installationKey}`);
  console.log(`  GCP project：${projectId}`);
  console.log(`  GCP region：${region}`);
  console.log(`  Support email：${context.account}`);
  if (!await askYesNo('使用以上自動偵測設定並建立本機設定嗎？')) return null;

  const configPath = path.join(environmentDirectory, `${installationKey}.local.json`);
  if (await pathExists(configPath) && !await askYesNo('設定檔已存在，使用自動偵測值取代嗎？', false)) {
    return null;
  }
  const config = {
    schemaVersion: 1,
    installationKey,
    displayName,
    gcpProjectId: projectId,
    region,
    firebaseWebAppDisplayName: 'stratexec-platform',
    auth: {
      providers: ['google'],
      oauthBrandDisplayName: displayName,
      supportEmail: context.account,
      authorizedDomains: ['localhost', '127.0.0.1'],
    },
    enabledApps: ['demo', 'demo-compact', 'access-control'],
    servicePlacements: [{
      serviceKey: identityServiceKey,
      selectedTarget: 'cloud-run-service',
      region,
      serviceName: defaultServiceName(installationKey),
      status: 'planned',
    }],
  };
  await writeJsonAtomic(configPath, config);
  console.log(`\n已建立本機安裝設定：${configPath}`);
  console.log('管理員 email、OAuth secret、服務帳號 key 與其他秘密不會寫入此檔案。');
  return configPath;
}

async function ensureNpmDependencies(repoRoot) {
  const firebaseScript = path.join(repoRoot, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
  if (await pathExists(firebaseScript)) return;
  if (!await askYesNo('尚未安裝 repository 的 npm 相依套件。現在執行 npm ci 嗎？')) {
    throw new Error('使用者取消 npm ci；沒有修改雲端資源。');
  }
  runNpm(['ci'], { cwd: repoRoot });
  if (!await pathExists(firebaseScript)) throw new Error('npm ci 完成後仍找不到 Firebase CLI。');
}

async function runRepositoryChecks(repoRoot, configPath) {
  for (const script of [
    'check-installation-config.mjs',
    'check-service-registry.mjs',
    'check-app-manifests.mjs',
  ]) {
    runNode(path.join(repoRoot, 'scripts', script), [], { cwd: repoRoot, capture: true });
  }
  const plan = runNode(path.join(repoRoot, 'scripts', 'plan-deployment.mjs'), [
    '--installation', configPath, '--json',
  ], { cwd: repoRoot, capture: true });
  return parseJsonOutput(plan, '解析 App deployment plan');
}

async function printPreflight(installation, deploymentPlan) {
  const projectId = installation.gcpProjectId;
  const activeAccount = gcloudValue(
    ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'],
    '讀取目前登入帳號',
  );
  const projectCheck = gcloudValue(
    ['projects', 'describe', projectId, '--format=value(projectId)'],
    `驗證 project ${projectId} 的存取權`,
  );
  if (projectCheck !== projectId) throw new Error(`gcloud project 與安裝設定不一致：${projectCheck}`);
  const billing = gcloud(['billing', 'projects', 'describe', projectId, '--format=value(billingEnabled)'], {
    capture: true,
    allowFailure: true,
  }).stdout;
  const services = gcloud([
    'services', 'list', '--enabled', '--project', projectId, '--format=value(config.name)',
  ], { capture: true, allowFailure: true }).stdout.split(/\r?\n/).filter(Boolean);
  const registry = deploymentPlan.plan ?? [];
  console.log(`Installation: ${installation.installationKey}`);
  console.log(`Project:      ${projectId}`);
  console.log(`Region:       ${installation.region}`);
  console.log(`gcloud user:  ${activeAccount}`);
  console.log(`Billing:      ${billing === 'True' ? 'enabled' : 'disabled or unavailable'}`);
  console.log(`Apps:         ${(deploymentPlan.selectedApps ?? []).join(', ')}`);
  for (const entry of registry) {
    console.log(`Driver:       ${entry.serviceKey} -> ${entry.deploymentDriver} / ${entry.driverApplySupport}`);
  }
  console.log(`Missing APIs: ${DEPLOYMENT_APIS.filter((api) => !services.includes(api)).join(', ') || 'none'}`);
  console.log('Mode:         LOCAL INSTALL');
  console.log('Bootstrap administrator addresses are not printed or stored in the installation manifest.');
  console.log('\n唯讀 preflight 完成；此階段尚未修改雲端資源。');
  return activeAccount.trim().toLowerCase();
}

function authHeaders(projectId, accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'x-goog-user-project': projectId,
  };
}

function accessToken() {
  return gcloudValue(['auth', 'print-access-token'], '取得 Google Cloud access token');
}

async function identityReadiness(projectId, requiredDomains) {
  const missing = [];
  try {
    const headers = authHeaders(projectId, accessToken());
    const config = await fetchJson(`https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`, { headers });
    const domains = config.authorizedDomains ?? [];
    if (requiredDomains.some((domain) => !domains.includes(domain))) missing.push('authorized-domains');
    try {
      const provider = await fetchJson(
        `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/defaultSupportedIdpConfigs/google.com`,
        { headers },
      );
      if (!provider.enabled) missing.push('google-provider');
    } catch {
      missing.push('google-provider');
    }
  } catch {
    missing.push('identity-platform');
  }
  return [...new Set(missing)].sort();
}

async function ensureAuthorizedDomains(projectId, requiredDomains) {
  const configUri = `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`;
  const headers = authHeaders(projectId, accessToken());
  const config = await fetchJson(configUri, { headers });
  const authorizedDomains = [...new Set([
    ...(config.authorizedDomains ?? []),
    ...requiredDomains,
  ])];
  if (authorizedDomains.length === (config.authorizedDomains ?? []).length) return;
  await fetchJson(`${configUri}?updateMask=authorizedDomains`, {
    method: 'PATCH',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ authorizedDomains }),
  });
}

export function authDeploymentConfig(displayName, supportEmail) {
  return {
    auth: {
      providers: {
        googleSignIn: {
          oAuthBrandDisplayName: displayName,
          supportEmail,
        },
      },
    },
  };
}

export function selectWebApp(apps, displayName) {
  return apps.find((app) => app.displayName === displayName)
    ?? (apps.length === 1 && apps[0].displayName === 'Default Web App' ? apps[0] : null);
}

async function firebaseState(repoRoot, installation) {
  const projectsResult = runFirebaseJson(repoRoot, ['projects:list', '--json']);
  if (!projectsResult.succeeded) {
    return { status: 'firebase-cli-access-required', missing: ['firebase-cli-access'], error: projectsResult.error };
  }
  const projects = firebasePayload(projectsResult.value) ?? [];
  const firebaseEnabled = projects.some((project) => project.projectId === installation.gcpProjectId);
  const missing = [];
  let webApp = null;
  if (!firebaseEnabled) {
    missing.push('firebase-project', 'web-app');
  } else {
    const appsResult = runFirebaseJson(repoRoot, [
      'apps:list', 'WEB', '--project', installation.gcpProjectId, '--json',
    ]);
    if (!appsResult.succeeded) {
      return { status: 'firebase-cli-access-required', missing: ['firebase-cli-access'], error: appsResult.error };
    }
    const payload = firebasePayload(appsResult.value);
    const apps = payload?.apps ?? payload ?? [];
    webApp = selectWebApp(apps, installation.firebaseWebAppDisplayName);
    if (!webApp) missing.push('web-app');
  }
  missing.push(...await identityReadiness(installation.gcpProjectId, installation.auth.authorizedDomains ?? []));
  const unique = [...new Set(missing)].sort();
  return { status: unique.length ? 'needs-cloud-configuration' : 'ready', missing: unique, webApp, error: '' };
}

async function applyAuthConfiguration(repoRoot, installation, state) {
  const projectId = installation.gcpProjectId;
  if (state.missing.includes('firebase-project')) {
    runFirebase(repoRoot, ['projects:addfirebase', projectId, '--non-interactive']);
  }
  gcloud(['services', 'enable', ...REQUIRED_LOCAL_APIS, '--project', projectId, '--quiet']);
  if (state.missing.includes('web-app')) {
    runFirebase(repoRoot, [
      'apps:create', 'WEB', installation.firebaseWebAppDisplayName,
      '--project', projectId, '--json',
    ]);
  }
  const authConfigPath = path.join(
    repoRoot, '.stratexec', 'installations', installation.installationKey, 'local-auth.firebase.json',
  );
  await writeJsonAtomic(authConfigPath, authDeploymentConfig(
    installation.auth.oauthBrandDisplayName,
    installation.auth.supportEmail,
  ));
  runFirebase(repoRoot, [
    'deploy', '--only', 'auth', '--project', projectId,
    '--config', authConfigPath, '--non-interactive',
  ]);
  await ensureAuthorizedDomains(projectId, installation.auth.authorizedDomains ?? []);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const refreshed = await firebaseState(repoRoot, installation);
    if (refreshed.status === 'ready') return refreshed;
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('Firebase Authentication 設定完成後仍未就緒。');
}

async function writeManagedEnv(repoRoot, installation, sdk) {
  const envPath = path.join(repoRoot, '.env.local');
  const managed = new Map([
    ['VITE_STRATEXEC_INSTALLATION_KEY', installation.installationKey],
    ['VITE_FIREBASE_API_KEY', sdk.apiKey],
    ['VITE_FIREBASE_AUTH_DOMAIN', sdk.authDomain],
    ['VITE_FIREBASE_PROJECT_ID', sdk.projectId],
    ['VITE_FIREBASE_STORAGE_BUCKET', sdk.storageBucket ?? ''],
    ['VITE_FIREBASE_MESSAGING_SENDER_ID', sdk.messagingSenderId ?? ''],
    ['VITE_FIREBASE_APP_ID', sdk.appId],
    ['VITE_FIREBASE_MEASUREMENT_ID', sdk.measurementId ?? ''],
    ['STRATEXEC_IDENTITY_BASE_URL', 'http://127.0.0.1:8180'],
    ['STRATEXEC_ALLOW_UNSIGNED_APP_PACKAGES', 'true'],
  ]);
  const previous = await pathExists(envPath) ? (await readFile(envPath, 'utf8')).split(/\r?\n/) : [];
  const preserved = previous.filter((line) => ![...managed.keys()].some((key) => line.startsWith(`${key}=`)));
  while (preserved.length && !preserved.at(-1)?.trim()) preserved.pop();
  if (preserved.length) preserved.push('');
  preserved.push('# Managed by npm run setup. Firebase Web values are public project identifiers.');
  preserved.push('# Local source install accepts administrator-confirmed development packages; runtime deployment still requires trusted signatures.');
  for (const [key, value] of managed) preserved.push(`${key}=${value ?? ''}`);
  await writeFile(envPath, `${preserved.join('\n')}\n`, 'utf8');
  return envPath;
}

async function configureLocalAuth(repoRoot, installation) {
  let state = await firebaseState(repoRoot, installation);
  if (state.status === 'firebase-cli-access-required') {
    if (await askYesNo('Firebase CLI 尚未登入或無法讀取 projects。現在開啟 Google 登入嗎？')) {
      runFirebase(repoRoot, ['login']);
      state = await firebaseState(repoRoot, installation);
    }
  }
  if (state.status === 'needs-cloud-configuration') {
    console.warn(`本機 Google 登入尚缺：${state.missing.join(', ')}`);
    if (!await askYesNo('要設定 Firebase Authentication、Google Provider 與 Web App 嗎？', false)) return null;
    state = await applyAuthConfiguration(repoRoot, installation, state);
  }
  if (state.status !== 'ready') return null;
  const appId = state.webApp?.appId ?? state.webApp?.app_id ?? state.webApp?.name;
  if (!appId) throw new Error('無法解析 Firebase Web App appId。');
  const sdkResult = runFirebaseJson(repoRoot, [
    'apps:sdkconfig', 'WEB', appId, '--project', installation.gcpProjectId, '--json',
  ]);
  if (!sdkResult.succeeded) throw new Error(`無法讀取 Firebase Web SDK 設定：${sdkResult.error}`);
  const payload = firebasePayload(sdkResult.value);
  const sdk = payload?.sdkConfig ?? payload;
  for (const key of ['apiKey', 'authDomain', 'projectId', 'appId']) {
    if (!sdk?.[key]) throw new Error(`Firebase SDK 設定缺少 ${key}。`);
  }
  const outputPath = await writeManagedEnv(repoRoot, installation, sdk);
  console.log(`本機 Google 登入設定已就緒：${outputPath}`);
  return outputPath;
}

function adcReady() {
  return gcloud(['auth', 'application-default', 'print-access-token'], {
    capture: true,
    allowFailure: true,
  }).exitCode === 0;
}

async function firestoreReady(installation) {
  const projectId = installation.gcpProjectId;
  const database = gcloud([
    'firestore', 'databases', 'describe', '--database=(default)',
    '--project', projectId, '--format=value(name)',
  ], { capture: true, allowFailure: true });
  if (database.exitCode !== 0) return false;
  const headers = authHeaders(projectId, accessToken());
  const documents = ['platformMeta/schema'];
  for (const appKey of installation.enabledApps) {
    documents.push(`appInstallations/${appKey}`, `appPolicies/${appKey}`);
  }
  for (const documentPath of documents) {
    try {
      await fetchJson(
        `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${documentPath}`,
        { headers },
      );
    } catch {
      return false;
    }
  }
  return true;
}

const fsString = (value) => ({ stringValue: String(value) });
const fsBoolean = (value) => ({ booleanValue: Boolean(value) });
const fsTimestamp = (value) => ({ timestampValue: value });
const fsArray = (values) => ({ arrayValue: { values } });

async function documentExists(url, headers) {
  try {
    await fetchJson(url, { headers });
    return true;
  } catch (error) {
    if (error.status === 404) return false;
    throw error;
  }
}

async function patchFirestore(url, headers, fields, masks = []) {
  const suffix = masks.length
    ? `?${masks.map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join('&')}`
    : '';
  return fetchJson(`${url}${suffix}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
}

async function bootstrapFirestore(repoRoot, installation, adminEmail) {
  const projectId = installation.gcpProjectId;
  const projects = runFirebaseJson(repoRoot, ['projects:list', '--json']);
  if (!projects.succeeded) throw new Error(`Firebase CLI 無法讀取 projects：${projects.error}`);
  if (!(firebasePayload(projects.value) ?? []).some((project) => project.projectId === projectId)) {
    runFirebase(repoRoot, ['projects:addfirebase', projectId, '--non-interactive']);
  }
  gcloud([
    'services', 'enable',
    'firebase.googleapis.com', 'identitytoolkit.googleapis.com',
    'firestore.googleapis.com', 'firebaserules.googleapis.com',
    '--project', projectId, '--quiet',
  ]);
  const database = gcloud([
    'firestore', 'databases', 'describe', '--database=(default)',
    '--project', projectId, '--format=value(name)',
  ], { capture: true, allowFailure: true });
  if (database.exitCode !== 0) {
    gcloud([
      'firestore', 'databases', 'create', '--database=(default)',
      `--location=${installation.region}`, '--type=firestore-native',
      '--delete-protection', '--project', projectId, '--quiet',
    ]);
  }
  runFirebase(repoRoot, [
    'deploy', '--only', 'firestore:rules,firestore:indexes',
    '--project', projectId, '--config', path.join(repoRoot, 'firebase.json'), '--non-interactive',
  ]);

  const headers = authHeaders(projectId, accessToken());
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  await patchFirestore(`${base}/platformMeta/schema`, headers, {
    schemaVersion: { integerValue: '1' },
    installationKey: fsString(installation.installationKey),
    enabledApps: fsArray(installation.enabledApps.map(fsString)),
    updatedAt: fsTimestamp(new Date().toISOString()),
  });

  const appDirectory = path.join(repoRoot, 'infrastructure', 'apps');
  const manifestFiles = (await readdir(appDirectory)).filter((name) => name.endsWith('.json'));
  for (const fileName of manifestFiles) {
    const manifest = await readJson(path.join(appDirectory, fileName));
    if (manifest.kind !== 'frontend-app') continue;
    const appKey = manifest.appKey;
    const updatedAt = new Date().toISOString();
    const allowedModes = fsArray((manifest.access.allowedModes ?? []).map(fsString));
    const entitlements = fsArray((manifest.access.entitlements ?? []).map((entry) => ({
      mapValue: {
        fields: {
          key: fsString(entry.key),
          displayName: fsString(entry.displayName),
          ...(entry.description ? { description: fsString(entry.description) } : {}),
        },
      },
    })));
    const policyUrl = `${base}/appPolicies/${appKey}`;
    if (!await documentExists(policyUrl, headers)) {
      await patchFirestore(policyUrl, headers, {
        appKey: fsString(appKey),
        displayName: fsString(manifest.displayName),
        accessMode: fsString(manifest.access.defaultMode),
        allowedAccessModes: allowedModes,
        entitlements,
        adminAllowed: fsBoolean(manifest.access.adminAllowed),
        protected: fsBoolean(manifest.access.protected),
        updatedAt: fsTimestamp(updatedAt),
        updatedBy: fsString('installation-bootstrap'),
      });
    } else {
      await patchFirestore(policyUrl, headers, {
        allowedAccessModes: allowedModes,
        entitlements,
      }, ['allowedAccessModes', 'entitlements']);
    }

    const installationUrl = `${base}/appInstallations/${appKey}`;
    const installationFields = {
      appKey: fsString(appKey),
      displayName: fsString(manifest.displayName),
      category: fsString(manifest.lifecycle.category),
      removable: fsBoolean(manifest.lifecycle.removable),
      protected: fsBoolean(manifest.access.protected),
      requiredServices: fsArray((manifest.requiredServices ?? []).map(fsString)),
      updatedAt: fsTimestamp(updatedAt),
      updatedBy: fsString('installation-bootstrap'),
    };
    if (!await documentExists(installationUrl, headers)) {
      installationFields.status = fsString(
        installation.enabledApps.includes(appKey) ? 'installed' : 'uninstalled',
      );
      await patchFirestore(installationUrl, headers, installationFields);
    } else {
      await patchFirestore(installationUrl, headers, installationFields, Object.keys(installationFields));
    }
  }

  const envPath = path.join(repoRoot, '.env.local');
  const lines = (await readFile(envPath, 'utf8')).split(/\r?\n/)
    .filter((line) => !line.startsWith('STRATEXEC_BOOTSTRAP_ADMIN_EMAILS='));
  while (lines.length && !lines.at(-1)?.trim()) lines.pop();
  lines.push(`STRATEXEC_BOOTSTRAP_ADMIN_EMAILS=${adminEmail}`, '');
  await writeFile(envPath, lines.join('\n'), 'utf8');
}

export async function runSetup(repoRoot) {
  const gcloudCheck = gcloud(['--version'], { capture: true, allowFailure: true });
  if (gcloudCheck.exitCode !== 0) throw new Error('找不到 Google Cloud CLI（gcloud）。');
  const configPath = await findOrCreateInstallationConfig(repoRoot);
  if (!configPath) {
    console.warn('已取消安裝；沒有修改雲端資源。');
    return;
  }
  const installation = await readJson(configPath);
  await ensureNpmDependencies(repoRoot);
  const deploymentPlan = await runRepositoryChecks(repoRoot, configPath);
  const activeAccount = await printPreflight(installation, deploymentPlan);

  const envPath = await configureLocalAuth(repoRoot, installation);
  if (!envPath) {
    console.warn('本機安裝尚未完成；重新執行 npm run setup 可從此步繼續。');
    return;
  }
  if (!adcReady()) {
    if (!await askYesNo('完整本地模式需要 Application Default Credentials。現在開啟 Google 授權嗎？')) {
      console.warn('本機安裝尚未完成；未啟動 Identity API。');
      return;
    }
    gcloud(['auth', 'application-default', 'login']);
    if (!adcReady()) throw new Error('Application Default Credentials 授權未完成。');
  }

  let adminEmail = process.env.STRATEXEC_BOOTSTRAP_ADMIN_EMAILS?.split(',').map((value) => value.trim()).find(Boolean);
  if (!adminEmail) {
    if (!await askYesNo('使用目前 gcloud Google 帳號作為本機首位管理員嗎？')) {
      console.warn('本機安裝尚未完成；未初始化管理員與 App 清冊。');
      return;
    }
    adminEmail = activeAccount;
  }
  if (!await firestoreReady(installation)) {
    console.warn('本機測試尚缺 Firestore、Rules 或 App 清冊。');
    if (!await askYesNo('要初始化完整本地測試所需的 Firebase／Firestore 資料嗎？')) {
      console.warn('本機安裝尚未完成；未啟動依賴 Firestore 的 Identity API。');
      return;
    }
    await bootstrapFirestore(repoRoot, installation, adminEmail);
    if (!await firestoreReady(installation)) throw new Error('Firestore 初始化後仍缺少必要 App 清冊。');
  }

  await startLocal(repoRoot, {
    configPath,
    bootstrapAdminEmail: adminEmail,
    guided: true,
  });
  console.log('\n本地安裝與測試環境已就緒；本次流程不會進入正式部署。');
  console.log('日後準備正式部署時，Windows 相容入口仍為：.\\scripts\\deploy.ps1');
}

export const setupInternals = { defaultServiceName };
