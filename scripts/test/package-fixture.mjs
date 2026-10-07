import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packApp } from '../lib/app-package.mjs';

export const fixtureAppKey = 'package-fixture';
export const fixtureVersion = '0.1.0';

const workspaceRoot = new URL('../../', import.meta.url);

export async function packFixtureApp({ directory, outputDirectory, signing = null }) {
  const fixtureRoot = join(directory, 'fixture-source');
  const appSource = `apps/console/src/apps/${fixtureAppKey}`;
  const deploymentManifest = `infrastructure/app-deployments/${fixtureAppKey}.json`;
  const deploymentDocument = `${appSource}/DEPLOYMENT.md`;
  for (const path of [
    'infrastructure/apps', 'infrastructure/app-deployments', 'infrastructure/services', appSource,
  ]) await mkdir(join(fixtureRoot, path), { recursive: true });
  for (const path of [
    'infrastructure/platform-contract.json', 'infrastructure/apps/platform.json',
    'infrastructure/services/platform.json',
  ]) await cp(new URL(path, workspaceRoot), join(fixtureRoot, path));
  const app = {
    schemaVersion: 1,
    appKey: fixtureAppKey,
    version: fixtureVersion,
    platformCompatibility: { minimumVersion: '0.1.0', appContractVersion: 2 },
    kind: 'frontend-app',
    displayName: 'Package Fixture',
    source: appSource,
    routes: [`/apps/${fixtureAppKey}`],
    requiredServices: [],
    access: { defaultMode: 'public', allowedModes: ['public'], adminAllowed: true, protected: false },
    lifecycle: { category: 'sample', removable: true, defaultStatus: 'installed' },
    package: { installable: true, ownerApp: fixtureAppKey },
    deploymentDocument,
    deploymentManifest,
    frontend: {
      entryModule: 'FixtureApp.tsx', title: 'Package Fixture', subtitle: 'Installer test',
      description: 'Installer test fixture', icon: 'Monitor', status: 'preview',
      displayMode: 'responsive', order: 10,
    },
  };
  const deployment = {
    schemaVersion: 1, appKey: fixtureAppKey, appVersion: fixtureVersion,
    services: [], dataMigrations: [], sourceRollback: { strategy: 'transaction-backup' },
  };
  const writeJson = (path, value) => writeFile(join(fixtureRoot, path), `${JSON.stringify(value, null, 2)}\n`);
  await writeJson(`infrastructure/apps/${fixtureAppKey}.json`, app);
  await writeJson(deploymentManifest, deployment);
  await writeFile(join(fixtureRoot, deploymentDocument), `# Package Fixture\n\nDeployment contract: \`${deploymentManifest}\`.\n`);
  await writeFile(join(fixtureRoot, appSource, 'FixtureApp.tsx'),
    'export default function FixtureApp() { return <div>Package fixture</div>; }\n');
  return packApp({
    appKey: fixtureAppKey,
    outputDirectory,
    root: pathToFileURL(`${resolve(fixtureRoot)}/`),
    signing,
  });
}
