import { readdir, readFile } from 'node:fs/promises';
import { deploymentDrivers } from '../deployment/drivers/index.mjs';

export async function loadAppManifests(root = new URL('../../', import.meta.url)) {
  const directory = new URL('infrastructure/apps/', root);
  const files = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  return Promise.all(files.map(async (name) => JSON.parse(await readFile(new URL(name, directory), 'utf8'))));
}

export function createDeploymentPlan({ installation, registry, appManifests }) {
  const manifests = new Map(appManifests.map((app) => [app.appKey, app]));
  const platform = manifests.get('platform');
  if (!platform || platform.kind !== 'platform') {
    throw new Error('App catalog requires the platform manifest.');
  }

  const selectedApps = [platform];
  for (const appKey of installation.enabledApps) {
    const app = manifests.get(appKey);
    if (!app || app.kind !== 'frontend-app') throw new Error(`Unknown enabled App: ${appKey}`);
    selectedApps.push(app);
  }

  const services = new Map(registry.services.map((service) => [service.key, service]));
  const directlyRequired = [...new Set(selectedApps.flatMap((app) => app.requiredServices))];
  const requiredServiceKeys = [];
  const visiting = new Set();
  const visited = new Set();
  const addService = (serviceKey) => {
    if (visiting.has(serviceKey)) throw new Error(`Service dependency cycle includes ${serviceKey}.`);
    if (visited.has(serviceKey)) return;
    const service = services.get(serviceKey);
    if (!service) throw new Error(`App catalog requires unknown service: ${serviceKey}`);
    visiting.add(serviceKey);
    for (const dependency of service.dependsOn ?? []) addService(dependency);
    visiting.delete(serviceKey);
    visited.add(serviceKey);
    requiredServiceKeys.push(serviceKey);
  };
  for (const serviceKey of directlyRequired) addService(serviceKey);
  const placements = new Map(installation.servicePlacements.map((placement) => [placement.serviceKey, placement]));
  const plan = requiredServiceKeys.map((serviceKey) => {
    const service = services.get(serviceKey);
    const placement = placements.get(serviceKey);
    if (!service) throw new Error(`App catalog requires unknown service: ${serviceKey}`);
    if (!placement) throw new Error(`Installation is missing required service placement: ${serviceKey}`);
    const driver = deploymentDrivers.get(placement.selectedTarget);
    const blockers = [...service.deployment.blockers];
    if (placement.selectedTarget === 'unassigned') {
      blockers.push('Installation placement is unassigned.');
    } else if (!driver) {
      blockers.push(`No deployment driver is registered for ${placement.selectedTarget}.`);
    } else {
      blockers.push(...driver.validate({ service, placement }));
    }
    if (service.deployment.productionReadiness !== 'ready') {
      blockers.push(`Service productionReadiness is ${service.deployment.productionReadiness}.`);
    }
    return {
      serviceKey,
      requiredByApps: selectedApps.filter((app) => app.requiredServices.includes(serviceKey)).map((app) => app.appKey),
      requiredByServices: registry.services.filter((item) => item.dependsOn?.includes(serviceKey)
        && requiredServiceKeys.includes(item.key)).map((item) => item.key),
      workloadClass: service.deployment.workloadClass,
      recommendedTarget: service.deployment.recommendedTarget,
      selectedTarget: placement.selectedTarget,
      deploymentDriver: driver?.key ?? null,
      driverApplySupport: driver?.applySupport ?? 'unavailable',
      executor: driver?.executor ?? null,
      region: placement.region,
      serviceName: placement.serviceName,
      status: placement.status,
      productionReadiness: service.deployment.productionReadiness,
      deployable: blockers.length === 0 && driver?.applySupport === 'implemented',
      artifact: service.deployment.artifact,
      blockers,
    };
  });

  return {
    installationKey: installation.installationKey,
    projectId: installation.gcpProjectId,
    selectedApps: selectedApps.map((app) => app.appKey),
    requiredServiceKeys,
    plan,
  };
}
