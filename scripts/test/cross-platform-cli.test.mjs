import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  authDeploymentConfig,
  installationConfigReady,
  convertToInstallationKey,
  selectWebApp,
} from '../cli/setup.mjs';
import { runtimeInternals } from '../cli/runtime.mjs';

const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
const cliSource = await readFile(new URL('../stratexec.mjs', import.meta.url), 'utf8');
const setupSource = await readFile(new URL('../cli/setup.mjs', import.meta.url), 'utf8');
const runtimeSource = await readFile(new URL('../cli/runtime.mjs', import.meta.url), 'utf8');
const viteConfigSource = await readFile(new URL('../../apps/console/vite.config.ts', import.meta.url), 'utf8');

test('package scripts expose a Node-only local lifecycle', () => {
  assert.equal(packageJson.scripts.setup, 'node --use-system-ca scripts/stratexec.mjs setup');
  assert.equal(packageJson.scripts['start:local'], 'node --use-system-ca scripts/stratexec.mjs start');
  assert.equal(packageJson.scripts['stop:local'], 'node --use-system-ca scripts/stratexec.mjs stop');
  assert.match(packageJson.scripts['dev:app-packages'], /--env-file-if-exists=\.env\.local/);
  assert.match(packageJson.scripts['dev:deployments'], /--env-file-if-exists=\.env\.local/);
  assert.doesNotMatch(packageJson.scripts.setup, /powershell|pwsh|\.ps1/i);
});

test('cross-platform setup uses choice prompts and never launches PowerShell', () => {
  assert.match(setupSource, /askMenu/);
  assert.match(setupSource, /askYesNo/);
  assert.doesNotMatch(`${cliSource}\n${setupSource}\n${runtimeSource}`, /run\(['"](?:powershell|pwsh)/i);
  assert.doesNotMatch(setupSource, /readline.*自訂|請輸入.*路徑|請輸入.*email/i);
});

test('cross-platform runtime resolves both Windows and POSIX virtual environments', () => {
  assert.match(runtimeSource, /Scripts', 'python\.exe/);
  assert.match(runtimeSource, /'bin', 'python'/);
  assert.match(runtimeSource, /taskkill\.exe/);
  assert.match(runtimeSource, /process\.kill\(-pid/);
  assert.match(runtimeSource, /--use-feature=truststore/);
  assert.match(runtimeSource, /--no-build-isolation/);
});

test('local lifecycle allocates consecutive ports for multiple checkouts', () => {
  assert.deepEqual(runtimeInternals.portRange(5175, 5180), [5175, 5176, 5177, 5178, 5179, 5180]);
  assert.match(runtimeSource, /IDENTITY_PORTS = \[8180, 8181, \.\.\.portRange\(8184, 8189\)\]/);
  assert.doesNotMatch(runtimeSource.match(/const IDENTITY_PORTS = .+;/)?.[0] ?? '', /8182|8183/);
  assert.match(runtimeSource, /FRONTEND_PORTS = portRange\(5175, 5180\)/);
  assert.match(runtimeSource, /STRATEXEC_IDENTITY_BASE_URL: identityUrl/);
  assert.match(viteConfigSource, /STRATEXEC_IDENTITY_BASE_URL/);
  assert.match(viteConfigSource, /target: identityOrigin/);
  assert.match(viteConfigSource, /STRATEXEC_APP_PACKAGE_AGENT_PORT/);
  assert.match(viteConfigSource, /target: packageAgentOrigin/);
  assert.match(viteConfigSource, /STRATEXEC_DEPLOYMENT_AGENT_PORT/);
  assert.match(viteConfigSource, /target: deploymentAgentOrigin/);
  assert.match(viteConfigSource, /fileURLToPath\(new URL\('\.\.\/\.\.'/);
  assert.match(viteConfigSource, /loadEnv\(mode, environmentRoot/);
});

test('managed health rejects a response served by another checkout', async () => {
  let processChecks = 0;
  const response = { ok: true };
  const result = await runtimeInternals.waitForManagedHttp('http://127.0.0.1:5176/', 123, {
    attempts: 1,
    fetchImpl: async () => response,
    processExistsImpl: () => {
      processChecks += 1;
      return processChecks === 1;
    },
    sleepImpl: async () => {},
  });

  assert.equal(result, null);
  assert.equal(processChecks, 2);
});

test('local lifecycle retries the next port when another checkout wins the race', async () => {
  const availability = new Map([
    [5176, [true, false]],
    [5177, [true]],
  ]);
  const launched = [];
  const stopped = [];
  const result = await runtimeInternals.launchOnAvailablePort([5176, 5177], {
    label: 'StratExec Console',
    portAvailableImpl: async (port) => availability.get(port).shift(),
    launch: (port) => {
      launched.push(port);
      return { pid: port };
    },
    ready: async (_managedProcess, port) => port === 5177,
    stopProcessImpl: (pid) => stopped.push(pid),
    waitForProcessExitImpl: async () => {},
  });

  assert.deepEqual(launched, [5176, 5177]);
  assert.deepEqual(stopped, [5176]);
  assert.equal(result.port, 5177);
  assert.equal(result.managedProcess.pid, 5177);
});

test('installation keys and ready overlays stay deterministic', () => {
  assert.equal(convertToInstallationKey('My Project 123'), 'my-project-123');
  assert.equal(convertToInstallationKey('123'), 'customer-installation');
  assert.equal(installationConfigReady({
    installationKey: 'customer-a',
    displayName: 'Customer A',
    gcpProjectId: 'customer-a-12345',
    region: 'asia-east1',
    auth: { supportEmail: 'owner@example.com' },
    servicePlacements: [{
      serviceKey: 'identity-api',
      selectedTarget: 'cloud-run-service',
      region: 'asia-east1',
      serviceName: 'customer-a-identity',
    }],
  }, 'identity-api'), true);
});

test('setup keeps local installation separate from formal cloud deployment', () => {
  assert.match(setupSource, /本次流程不會進入正式部署/);
  assert.doesNotMatch(setupSource, /ConfirmBillableResources|ConfirmPublicIngress/);
  assert.match(setupSource, /firestoreReady/);
  assert.match(setupSource, /configureLocalAuth/);
  assert.match(setupSource, /startLocal/);
});

test('Firebase Auth bootstrap separates OAuth redirects from local authorized domains', () => {
  assert.deepEqual(authDeploymentConfig('Customer', 'owner@example.com'), {
    auth: {
      providers: {
        googleSignIn: {
          oAuthBrandDisplayName: 'Customer',
          supportEmail: 'owner@example.com',
        },
      },
    },
  });
  assert.doesNotMatch(JSON.stringify(authDeploymentConfig('Customer', 'owner@example.com')), /localhost|127\.0\.0\.1/);
  assert.match(setupSource, /updateMask=authorizedDomains/);
  assert.ok(setupSource.indexOf("'apps:create'") < setupSource.indexOf("'deploy', '--only', 'auth'"));
});

test('Firebase Auth bootstrap resumes from the CLI auto-created default Web App', () => {
  const defaultApp = { appId: 'default-app', displayName: 'Default Web App' };
  const requestedApp = { appId: 'requested-app', displayName: 'Customer Web App' };
  assert.equal(selectWebApp([defaultApp], 'Customer Web App'), defaultApp);
  assert.equal(selectWebApp([defaultApp, requestedApp], 'Customer Web App'), requestedApp);
  assert.equal(selectWebApp([{ appId: 'other', displayName: 'Other App' }], 'Customer Web App'), null);
});
