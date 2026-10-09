import { access, readFile } from 'node:fs/promises';
import { loadAppManifests } from './lib/deployment-plan.mjs';
import { validateDeploymentContract } from './lib/app-package.mjs';

const root = new URL('../', import.meta.url);
const registry = JSON.parse(await readFile(new URL('infrastructure/services.json', root), 'utf8'));
const platformContract = JSON.parse(await readFile(new URL('infrastructure/platform-contract.json', root), 'utf8'));
const services = new Map(registry.services.map((service) => [service.key, service]));
const manifests = await loadAppManifests(root);
const keys = new Set();
const routes = new Set();
const frontendOrders = new Set();
const sourceOwners = new Map();
const parseVersion = (value) => value.split('.').map(Number);
const versionAtLeast = (current, minimum) => {
  const left = parseVersion(current);
  const right = parseVersion(minimum);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
};

for (const app of manifests) {
  if (app.schemaVersion !== 1 || !/^[a-z][a-z0-9-]*$/.test(app.appKey)) {
    throw new Error(`Invalid App manifest identity: ${app.appKey ?? 'unknown'}`);
  }
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$/.test(app.version)
    || app.platformCompatibility?.appContractVersion !== platformContract.appContractVersion
    || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(app.platformCompatibility?.minimumVersion ?? '')) {
    throw new Error(`App manifest requires version and platform compatibility: ${app.appKey}`);
  }
  if (!versionAtLeast(platformContract.platformVersion, app.platformCompatibility.minimumVersion)) {
    throw new Error(`App ${app.appKey} requires platform ${app.platformCompatibility.minimumVersion}.`);
  }
  if (keys.has(app.appKey)) throw new Error(`Duplicate App manifest: ${app.appKey}`);
  keys.add(app.appKey);
  if (!['platform', 'frontend-app'].includes(app.kind)) throw new Error(`Invalid App kind: ${app.appKey}`);
  if (!app.displayName || !app.source || !app.deploymentDocument || !app.access || !app.lifecycle || !app.package) {
    throw new Error(`App manifest is missing display/source/document: ${app.appKey}`);
  }
  if (typeof app.package.installable !== 'boolean' || !/^[a-z][a-z0-9-]*$/.test(app.package.ownerApp)) {
    throw new Error(`App manifest requires a valid package policy: ${app.appKey}`);
  }
  if (app.package.installable && (app.package.ownerApp !== app.appKey || app.lifecycle.removable !== true)) {
    throw new Error(`Installable App must own its package and be removable: ${app.appKey}`);
  }
  if (app.package.installable) {
    const expectedDeploymentManifest = `infrastructure/app-deployments/${app.appKey}.json`;
    if (app.deploymentManifest !== expectedDeploymentManifest) {
      throw new Error(`Installable App must use its canonical deployment manifest: ${app.appKey}`);
    }
    const deployment = JSON.parse(await readFile(new URL(app.deploymentManifest, root), 'utf8'));
    const deploymentDocument = await readFile(new URL(app.deploymentDocument, root), 'utf8');
    validateDeploymentContract({
      deployment,
      app,
      services: registry.services.filter((service) => service.ownerApp === app.appKey),
      platform: platformContract,
      deploymentDocument,
    });
  }
  if (app.access.protected && (app.package.installable || app.package.ownerApp !== 'platform')) {
    throw new Error(`Protected App must remain platform-owned and non-installable: ${app.appKey}`);
  }
  const existingSourceOwner = sourceOwners.get(app.source);
  if (existingSourceOwner && existingSourceOwner !== app.package.ownerApp) {
    throw new Error(`Shared App source has conflicting package owners: ${app.source}`);
  }
  sourceOwners.set(app.source, app.package.ownerApp);
  await access(new URL(`${app.source}/`, root));
  await access(new URL(app.deploymentDocument, root));
  if (app.deploymentDocument !== `${app.source}/DEPLOYMENT.md`) {
    throw new Error(`App deployment document must be stored beside its source: ${app.appKey}`);
  }
  if (!Array.isArray(app.routes) || app.routes.length === 0 || !Array.isArray(app.requiredServices)) {
    throw new Error(`App manifest requires routes and requiredServices: ${app.appKey}`);
  }
  const accessModes = ['public', 'all_members', 'grant_required', 'admins_only', 'disabled'];
  if (!accessModes.includes(app.access.defaultMode)
    || !Array.isArray(app.access.allowedModes) || app.access.allowedModes.length === 0
    || app.access.allowedModes.some((mode) => !accessModes.includes(mode))
    || !app.access.allowedModes.includes(app.access.defaultMode)
    || typeof app.access.adminAllowed !== 'boolean' || typeof app.access.protected !== 'boolean') {
    throw new Error(`App manifest requires a valid access policy: ${app.appKey}`);
  }
  const entitlements = app.access.entitlements ?? [];
  if (!Array.isArray(entitlements) || entitlements.length > 32) {
    throw new Error(`App manifest has invalid entitlements: ${app.appKey}`);
  }
  const entitlementKeys = new Set();
  for (const entitlement of entitlements) {
    if (!entitlement || !/^[a-z][a-z0-9-]{0,63}$/.test(entitlement.key ?? '')
      || typeof entitlement.displayName !== 'string' || entitlement.displayName.length < 1 || entitlement.displayName.length > 128
      || (entitlement.description !== undefined && (
        typeof entitlement.description !== 'string' || entitlement.description.length < 1 || entitlement.description.length > 256
      )) || entitlementKeys.has(entitlement.key)) {
      throw new Error(`App manifest has invalid or duplicate entitlement definitions: ${app.appKey}`);
    }
    entitlementKeys.add(entitlement.key);
  }
  if (app.access.protected && (app.access.defaultMode !== 'admins_only'
    || app.access.allowedModes.length !== 1 || app.access.allowedModes[0] !== 'admins_only'
    || app.access.adminAllowed !== true)) {
    throw new Error(`Protected App must remain administrator-only: ${app.appKey}`);
  }
  if (!['core', 'sample', 'application'].includes(app.lifecycle.category)
    || !['installed', 'uninstalled'].includes(app.lifecycle.defaultStatus)
    || typeof app.lifecycle.removable !== 'boolean') {
    throw new Error(`App manifest requires a valid lifecycle policy: ${app.appKey}`);
  }
  if (app.access.protected && (app.lifecycle.category !== 'core' || app.lifecycle.removable)) {
    throw new Error(`Protected App lifecycle must be core and non-removable: ${app.appKey}`);
  }
  for (const route of app.routes) {
    if (!route.startsWith('/') || routes.has(route)) throw new Error(`Invalid or duplicate App route: ${route}`);
    routes.add(route);
  }
  for (const serviceKey of app.requiredServices) {
    const service = services.get(serviceKey);
    if (!service) throw new Error(`App ${app.appKey} requires unknown service ${serviceKey}.`);
    if (service.ownerApp !== 'platform' && service.ownerApp !== app.appKey) {
      throw new Error(`App ${app.appKey} cannot claim service owned by ${service.ownerApp}: ${serviceKey}`);
    }
  }
  if (app.kind === 'frontend-app') {
    const expectedRoute = `/apps/${app.appKey}`;
    if (!app.routes.includes(expectedRoute)) throw new Error(`Frontend App route must include ${expectedRoute}.`);
    const frontend = app.frontend;
    if (!frontend || !frontend.entryModule || !frontend.title || typeof frontend.subtitle !== 'string' || !frontend.description
      || !/^[A-Z][A-Za-z0-9]*$/.test(frontend.icon)
      || !['enabled', 'preview', 'planned'].includes(frontend.status)
      || !['compact', 'responsive'].includes(frontend.displayMode)
      || (frontend.keepAlive !== undefined && typeof frontend.keepAlive !== 'boolean')
      || !Number.isInteger(frontend.order) || frontend.order < 0 || frontend.order > 10000) {
      throw new Error(`Frontend App requires packageable Registry metadata: ${app.appKey}`);
    }
    if (frontendOrders.has(frontend.order)) throw new Error(`Duplicate frontend App order: ${frontend.order}`);
    frontendOrders.add(frontend.order);
    await access(new URL(`${app.source}/${frontend.entryModule}`, root));
  }
}

if (manifests.filter((app) => app.kind === 'platform').length !== 1 || !keys.has('platform')) {
  throw new Error('Exactly one platform App manifest is required.');
}

for (const app of manifests) {
  if (!keys.has(app.package.ownerApp)) {
    throw new Error(`App package owner does not exist: ${app.appKey} -> ${app.package.ownerApp}`);
  }
}

console.log(`App manifests are valid (${manifests.length - 1} frontend Apps plus platform).`);
