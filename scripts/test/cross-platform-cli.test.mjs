import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { installationConfigReady, convertToInstallationKey } from '../cli/setup.mjs';

const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
const cliSource = await readFile(new URL('../stratexec.mjs', import.meta.url), 'utf8');
const setupSource = await readFile(new URL('../cli/setup.mjs', import.meta.url), 'utf8');
const runtimeSource = await readFile(new URL('../cli/runtime.mjs', import.meta.url), 'utf8');

test('package scripts expose a Node-only local lifecycle', () => {
  assert.equal(packageJson.scripts.setup, 'node --use-system-ca scripts/stratexec.mjs setup');
  assert.equal(packageJson.scripts['start:local'], 'node --use-system-ca scripts/stratexec.mjs start');
  assert.equal(packageJson.scripts['stop:local'], 'node --use-system-ca scripts/stratexec.mjs stop');
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
