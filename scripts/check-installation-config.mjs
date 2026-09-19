import { readdir, readFile } from 'node:fs/promises';
import { createDeploymentPlan, loadAppManifests } from './lib/deployment-plan.mjs';

const root = new URL('../', import.meta.url);
const environmentDirectory = new URL('infrastructure/environments/', root);
const registry = JSON.parse(await readFile(new URL('infrastructure/services.json', root), 'utf8'));
const services = new Map(registry.services.map((service) => [service.key, service]));
const appManifests = await loadAppManifests(root);
const apps = new Map(appManifests.filter((app) => app.kind === 'frontend-app').map((app) => [app.appKey, app]));
const files = (await readdir(environmentDirectory))
  .filter((name) => name.endsWith('.json') && !name.endsWith('.local.json'));
if (!files.includes('installation.example.json')) {
  throw new Error('Installation catalog requires the generic installation.example.json.');
}

const keys = new Set();
for (const file of files) {
  const config = JSON.parse(await readFile(new URL(file, environmentDirectory), 'utf8'));
  const label = `infrastructure/environments/${file}`;
  if (config.schemaVersion !== 1) throw new Error(`${label}: unsupported schemaVersion.`);
  if (!/^[a-z][a-z0-9-]{1,38}[a-z0-9]$/.test(config.installationKey)) {
    throw new Error(`${label}: invalid installationKey.`);
  }
  if (keys.has(config.installationKey)) throw new Error(`${label}: duplicate installationKey.`);
  keys.add(config.installationKey);
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(config.gcpProjectId)) {
    throw new Error(`${label}: invalid gcpProjectId.`);
  }
  if (!/^[a-z]+-[a-z]+[0-9]$/.test(config.region)) throw new Error(`${label}: invalid region.`);
  if (!/^[a-z][a-z0-9-]{1,38}[a-z0-9]$/.test(config.firebaseWebAppDisplayName)) {
    throw new Error(`${label}: invalid Firebase Web App display name.`);
  }
  if (JSON.stringify(config.auth?.providers) !== JSON.stringify(['google'])) {
    throw new Error(`${label}: only the reviewed Google provider is supported.`);
  }
  if (typeof config.auth?.supportEmail !== 'string' || !/^.+@.+\..+$/.test(config.auth.supportEmail)) {
    throw new Error(`${label}: auth supportEmail is required.`);
  }
  const domains = config.auth?.authorizedDomains;
  if (!Array.isArray(domains) || !domains.includes('localhost') || !domains.includes('127.0.0.1')) {
    throw new Error(`${label}: local Firebase Auth domains are required.`);
  }
  if (!Array.isArray(config.enabledApps) || new Set(config.enabledApps).size !== config.enabledApps.length) {
    throw new Error(`${label}: enabledApps must be a unique array.`);
  }
  for (const appKey of config.enabledApps) {
    if (!apps.has(appKey)) throw new Error(`${label}: unknown enabled App ${appKey}.`);
  }
  if (!Array.isArray(config.servicePlacements)) throw new Error(`${label}: servicePlacements are required.`);
  const placementKeys = new Set();
  for (const placement of config.servicePlacements) {
    const service = services.get(placement.serviceKey);
    if (!service || placementKeys.has(placement.serviceKey)) {
      throw new Error(`${label}: unknown or duplicate service placement ${placement.serviceKey}.`);
    }
    placementKeys.add(placement.serviceKey);
    if (!/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(placement.serviceName)) {
      throw new Error(`${label}: invalid serviceName for ${placement.serviceKey}.`);
    }
    if (!/^[a-z]+-[a-z]+[0-9]$/.test(placement.region)) {
      throw new Error(`${label}: invalid region for ${placement.serviceKey}.`);
    }
    if (placement.selectedTarget === 'cloud-run-service' && placement.region !== config.region) {
      throw new Error(`${label}: Cloud Run placement must use installation region ${config.region} so its Artifact Registry is available.`);
    }
    if (placement.selectedTarget === 'vm-docker') {
      const target = placement.targetConfig ?? {};
      if (!/^gce:\/\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/[a-z0-9-]+\/[a-z][a-z0-9-]{0,62}$/.test(target.hostRef ?? '')
        || !/^https:\/\//.test(target.agentUrl ?? '')
        || !String(target.persistentDataPath ?? '').startsWith('/var/lib/stratexec/')) {
        throw new Error(`${label}: VM Docker placement requires reviewed hostRef, mTLS Agent URL and persistent data path for ${placement.serviceKey}.`);
      }
    }
    if (placement.selectedTarget !== 'unassigned'
      && !service.deployment.allowedTargets.includes(placement.selectedTarget)) {
      throw new Error(`${label}: ${placement.serviceKey} cannot use ${placement.selectedTarget}.`);
    }
    if (!['planned', 'deployed'].includes(placement.status)) {
      throw new Error(`${label}: invalid placement status for ${placement.serviceKey}.`);
    }
    if (placement.status === 'deployed') {
      if (placement.selectedTarget === 'unassigned') {
        throw new Error(`${label}: deployed service cannot be unassigned: ${placement.serviceKey}.`);
      }
      if (service.deployment.productionReadiness !== 'ready') {
        throw new Error(`${label}: non-ready service cannot be marked deployed: ${placement.serviceKey}.`);
      }
    }
  }
  createDeploymentPlan({ installation: config, registry, appManifests });
}
console.log(`Installation configurations are valid (${files.length} environments).`);
