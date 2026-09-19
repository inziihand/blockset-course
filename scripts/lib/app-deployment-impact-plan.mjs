import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { planAppPackageInstall } from './app-installer.mjs';
import { deploymentDrivers } from '../deployment/drivers/index.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const stableJson = (value) => JSON.stringify(value, (_, item) => (
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
    : item
));
const digest = (value) => sha256(Buffer.from(stableJson(value)));

const CLOUD_RUN_APIS = [
  'artifactregistry.googleapis.com', 'storage.googleapis.com',
  'cloudbuild.googleapis.com',
  'iam.googleapis.com',
  'run.googleapis.com',
  'serviceusage.googleapis.com',
];
const CLOUD_RUN_ROLES = [
  'roles/artifactregistry.admin',
  'roles/cloudbuild.builds.editor',
  'roles/iam.serviceAccountAdmin',
  'roles/iam.serviceAccountUser',
  'roles/resourcemanager.projectIamAdmin',
  'roles/run.admin',
  'roles/storage.objectCreator',
];
const FIREBASE_HOSTING_APIS = ['firebase.googleapis.com', 'firebasehosting.googleapis.com'];
const FIREBASE_HOSTING_ROLES = ['roles/firebasehosting.admin'];
const VM_DOCKER_APIS = [
  'artifactregistry.googleapis.com', 'cloudbuild.googleapis.com', 'compute.googleapis.com',
  'iam.googleapis.com', 'iap.googleapis.com', 'oslogin.googleapis.com', 'secretmanager.googleapis.com',
];
const VM_DOCKER_ROLES = [
  'roles/artifactregistry.admin', 'roles/cloudbuild.builds.editor', 'roles/compute.instanceAdmin.v1',
  'roles/compute.osAdminLogin', 'roles/iam.serviceAccountAdmin', 'roles/iam.serviceAccountUser',
  'roles/iap.tunnelResourceAccessor', 'roles/resourcemanager.projectIamAdmin', 'roles/secretmanager.admin',
  'roles/storage.objectCreator',
];

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function parseJson(payload, path, required = true) {
  const content = payload.get(path);
  if (!content && !required) return null;
  if (!content) throw new Error(`Verified package payload is missing ${path}.`);
  return JSON.parse(content.toString('utf8'));
}

async function readJsonIfPresent(path) {
  try {
    await access(path);
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function validateInventory(inventory, installation) {
  if (inventory?.schemaVersion !== 1
    || inventory.installationKey !== installation.installationKey
    || inventory.projectId !== installation.gcpProjectId
    || !['complete', 'partial', 'unavailable'].includes(inventory.collectionStatus)
    || Number.isNaN(new Date(inventory.observedAt).getTime())
    || !Array.isArray(inventory.enabledApis)
    || !Array.isArray(inventory.grantedIamRoles)
    || !Array.isArray(inventory.resources)
    || !Array.isArray(inventory.hostingRoutes)
    || !Array.isArray(inventory.secrets)
    || !Array.isArray(inventory.errors)) {
    throw new Error('Deployment inventory does not match the selected installation.');
  }
  for (const secret of inventory.secrets) {
    if (Object.keys(secret).some((key) => !['secretName', 'exists', 'ownerApp'].includes(key))) {
      throw new Error('Deployment inventory secret records may contain metadata only.');
    }
  }
  return inventory;
}

function runtimeAccountId(serviceName) {
  const initial = `${serviceName}-runtime`;
  return initial.length > 30 ? initial.slice(0, 30).replace(/-+$/, '') : initial;
}

function normalizedCloudRunSpec(service, placement) {
  const run = service.deployment.cloudRun;
  return {
    target: 'cloud-run-service',
    cpu: run.cpu,
    memory: run.memory,
    minInstances: run.minInstances,
    maxInstances: run.maxInstances,
    ingress: run.ingress,
    publicIngress: run.iamInvocation === 'public-app-auth',
  };
}

function costTier(service, target) {
  if (target === 'vm-docker') return 'host-dependent';
  if (target !== 'cloud-run-service') return 'unknown';
  const run = service.deployment.cloudRun;
  if (run.minInstances === 0 && run.maxInstances === 1) return 'low-variable';
  if (run.minInstances === 0 && run.maxInstances <= 3) return 'moderate-variable';
  if (run.minInstances > 0 && run.maxInstances <= 3) return 'moderate-baseline';
  return 'high-or-review-required';
}

function normalizedVmSpec(placement) {
  const target = placement.targetConfig;
  return {
    target: 'vm-docker', hostRef: target.hostRef, persistentDataPath: target.persistentDataPath,
    accountScope: target.accountScope, minimumFreeBytes: target.minimumFreeBytes,
    backupMaxAgeSeconds: target.backupMaxAgeSeconds,
  };
}

function actionForDesired(observed, desiredSpec, inventoryStatus) {
  if (!observed) return inventoryStatus === 'complete' ? 'add' : 'unknown';
  return digest(observed.spec ?? {}) === digest(desiredSpec ?? {}) ? 'retain' : 'update';
}

function sourceAction(action) {
  return ({ add: 'add', update: 'update', delete: 'remove', unchanged: 'retain' })[action] ?? 'unknown';
}

function routeRecords(services) {
  return services.flatMap((service) => (service.routes ?? []).map((route) => ({
    key: `${service.key}:${route}`,
    route,
    serviceKey: service.key,
    ownerApp: service.ownerApp,
  })));
}

function secretRecords(deployment) {
  return deployment.services.flatMap((service) => service.secrets.map((secret) => ({
    key: `${service.serviceKey}:${secret.environment}:${secret.secretName}`,
    serviceKey: service.serviceKey,
    environment: secret.environment,
    secretName: secret.secretName,
    temporary: secret.temporary,
    purpose: secret.purpose,
  })));
}

function changesBetween(previous, next, keyOf, details) {
  const before = new Map(previous.map((item) => [keyOf(item), item]));
  const after = new Map(next.map((item) => [keyOf(item), item]));
  return uniqueSorted([...before.keys(), ...after.keys()]).map((key) => {
    const oldValue = before.get(key);
    const nextValue = after.get(key);
    const action = !oldValue ? 'add' : !nextValue ? 'remove' : digest(oldValue) === digest(nextValue) ? 'retain' : 'update';
    return details({ key, oldValue, nextValue, action });
  });
}

export function buildNormalizedAppDeploymentPlan({
  sourcePlan,
  deployment,
  appManifest = null,
  nextServices,
  previousServices = [],
  installation,
  inventory,
}) {
  validateInventory(inventory, installation);
  const placements = new Map(installation.servicePlacements.map((item) => [item.serviceKey, item]));
  const observedByService = new Map(inventory.resources
    .filter((item) => item.serviceKey)
    .map((item) => [item.serviceKey, item]));
  const blockers = [...sourcePlan.blockers];
  const warnings = [];
  if (sourcePlan.verification.signatureStatus !== 'trusted-signed') {
    blockers.push('Runtime deployment requires a trusted-signed App package.');
  }
  if (inventory.collectionStatus !== 'complete') {
    blockers.push(`Cloud inventory is ${inventory.collectionStatus}; refresh the read-only inventory before approval.`);
  }
  blockers.push(...inventory.errors.map((error) => `Inventory: ${error}`));

  const serviceChanges = changesBetween(
    previousServices,
    nextServices,
    (service) => service.key,
    ({ key, oldValue, nextValue, action }) => ({
      serviceKey: key,
      action,
      previousTarget: oldValue?.deployment?.recommendedTarget ?? null,
      nextTarget: nextValue?.deployment?.recommendedTarget ?? null,
    }),
  );
  const oldRoutes = routeRecords(previousServices);
  const nextRoutes = routeRecords(nextServices);
  const observedRoutes = new Map(inventory.hostingRoutes.map((item) => [item.route, item]));
  const routeChanges = changesBetween(oldRoutes, nextRoutes, (item) => item.key, ({ oldValue, nextValue, action }) => {
    const selected = nextValue ?? oldValue;
    const placement = placements.get(selected.serviceKey);
    const observed = observedRoutes.get(selected.route);
    let inventoryAction = action;
    if (nextValue && inventory.collectionStatus === 'complete') {
      inventoryAction = !observed ? 'add'
        : observed.serviceName === placement?.serviceName && observed.region === placement?.region ? 'retain' : 'update';
    } else if (nextValue && inventory.collectionStatus !== 'complete') inventoryAction = 'unknown';
    return { route: selected.route, serviceKey: selected.serviceKey, action: inventoryAction };
  });

  const previousDeploymentSecrets = previousServices.flatMap((service) => (
    (service.deployment?.workloadClass === 'continuous-worker'
      ? service.deployment?.vmDocker?.secrets : service.deployment?.cloudRun?.secrets) ?? []
  ).map((secret) => ({
    key: `${service.key}:${secret.environment}:${secret.secretName}`,
    serviceKey: service.key,
    environment: secret.environment,
    secretName: secret.secretName,
  })));
  const nextSecrets = secretRecords(deployment);
  const observedSecrets = new Map(inventory.secrets.map((item) => [item.secretName, item]));
  const secretChanges = changesBetween(
    previousDeploymentSecrets,
    nextSecrets,
    (item) => item.key,
    ({ oldValue, nextValue, action }) => {
      const selected = nextValue ?? oldValue;
      const observed = observedSecrets.get(selected.secretName);
      const availability = inventory.collectionStatus !== 'complete' ? 'unknown' : observed?.exists ? 'existing' : 'missing';
      const resolvedAction = nextValue
        ? availability === 'unknown' ? 'unknown' : availability === 'existing' ? 'retain' : 'add'
        : action;
      return {
        serviceKey: selected.serviceKey,
        environment: selected.environment,
        secretName: selected.secretName,
        purpose: nextValue?.purpose ?? null,
        temporary: nextValue?.temporary ?? null,
        action: resolvedAction,
        availability,
      };
    },
  );

  const requiredApis = [];
  const requiredRoles = [];
  const runtimeRoles = [];
  const configurations = [];
  const migrations = [];
  const services = [];
  const cloudResources = [];
  const drift = [];
  for (const service of nextServices) {
    const contract = deployment.services.find((item) => item.serviceKey === service.key);
    const placement = placements.get(service.key);
    if (!placement) {
      blockers.push(`Installation is missing a service placement for ${service.key}.`);
      services.push({
        serviceKey: service.key,
        planState: 'planned',
        contractReadiness: service.deployment.productionReadiness,
        observedDeployment: 'unknown',
        verificationState: 'unverified',
        selectedTarget: null,
        region: null,
        serviceName: null,
        resources: null,
        publicIngress: null,
        costTier: 'unknown',
        downtimeImpact: 'unknown',
      });
      continue;
    }
    const target = placement.selectedTarget;
    const driver = deploymentDrivers.get(target);
    if (target === 'unassigned') blockers.push(`Service placement is unassigned: ${service.key}.`);
    if (target !== 'unassigned' && !contract.allowedTargets.includes(target)) {
      blockers.push(`Deployment contract does not allow ${service.key} on ${target}.`);
    }
    if (service.deployment.productionReadiness !== 'ready') {
      blockers.push(`Service contract readiness is ${service.deployment.productionReadiness}: ${service.key}.`);
    }
    if (driver) blockers.push(...driver.validate({ service, placement }).map((item) => `${service.key}: ${item}`));
    if (target !== 'unassigned' && driver?.applySupport !== 'implemented') {
      blockers.push(`Target driver is not implemented for ${service.key}: ${target}.`);
    }
    const observed = observedByService.get(service.key);
    const desiredSpec = target === 'cloud-run-service' ? normalizedCloudRunSpec(service, placement)
      : target === 'vm-docker' ? normalizedVmSpec(placement) : { target };
    const resourceAction = actionForDesired(observed, desiredSpec, inventory.collectionStatus);
    const observedDeployment = !observed
      ? inventory.collectionStatus === 'complete' ? 'absent' : 'unknown'
      : 'deployed';
    if (resourceAction === 'update') drift.push({
      kind: 'configuration-drift',
      resourceKey: observed.resourceKey,
      serviceKey: service.key,
      expectedDigest: digest(desiredSpec),
      observedDigest: digest(observed.spec ?? {}),
    });
    if (resourceAction === 'add') drift.push({
      kind: 'missing-resource',
      resourceKey: `${target}:${installation.gcpProjectId}:${placement.region}:${placement.serviceName}`,
      serviceKey: service.key,
    });
    const sourceChange = serviceChanges.find((item) => item.serviceKey === service.key)?.action ?? 'retain';
    const downtimeImpact = resourceAction === 'add' ? 'none-new-resource'
      : resourceAction === 'update' ? 'rolling-revision-expected'
        : sourceChange === 'retain' ? 'none' : 'review-required';
    const run = service.deployment.cloudRun;
    services.push({
      serviceKey: service.key,
      dependsOn: structuredClone(service.dependsOn ?? []),
      routes: structuredClone(service.routes ?? []),
      artifact: structuredClone(service.deployment.artifact),
      healthPath: contract.healthPath,
      readinessPath: contract.readinessPath,
      verification: structuredClone(service.deployment.verification ?? { unauthenticatedRequests: [], authenticatedRequests: [] }),
      planState: 'planned',
      contractReadiness: service.deployment.productionReadiness,
      observedDeployment,
      verificationState: 'unverified',
      selectedTarget: target,
      region: placement.region,
      serviceName: placement.serviceName,
      resources: target === 'cloud-run-service' ? {
        cpu: run.cpu,
        memory: run.memory,
        minInstances: run.minInstances,
        maxInstances: run.maxInstances,
        concurrency: run.concurrency,
        timeoutSeconds: run.timeoutSeconds,
      } : null,
      publicIngress: target === 'cloud-run-service' ? run.iamInvocation === 'public-app-auth' : false,
      ingress: target === 'cloud-run-service' ? run.ingress : null,
      costTier: costTier(service, target),
      downtimeImpact,
      vm: target === 'vm-docker' ? {
        hostRef: placement.targetConfig.hostRef,
        agentUrl: placement.targetConfig.agentUrl,
        persistentDataPath: placement.targetConfig.persistentDataPath,
        accountScope: placement.targetConfig.accountScope,
        containerName: placement.targetConfig.containerName ?? placement.serviceName,
        runAsUser: placement.targetConfig.runAsUser,
        minimumFreeBytes: placement.targetConfig.minimumFreeBytes,
        backupMaxAgeSeconds: placement.targetConfig.backupMaxAgeSeconds,
        allowedSqliteSchemaVersions: structuredClone(placement.targetConfig.allowedSqliteSchemaVersions),
        expectedOpenOrders: placement.targetConfig.expectedOpenOrders,
        expectedPositionFingerprint: placement.targetConfig.expectedPositionFingerprint,
      } : null,
    });
    if (target === 'cloud-run-service') {
      if (run.iamInvocation === 'public-app-auth') {
        warnings.push(`${service.key} requires public ingress with application-level authentication; traffic exposure needs separate confirmation.`);
      }
      requiredApis.push(...CLOUD_RUN_APIS);
      requiredRoles.push(...CLOUD_RUN_ROLES);
      if ((service.routes ?? []).length > 0) {
        requiredApis.push(...FIREBASE_HOSTING_APIS);
        requiredRoles.push(...FIREBASE_HOSTING_ROLES);
      }
      if (contract.secrets.length > 0) {
        requiredApis.push('secretmanager.googleapis.com');
        requiredRoles.push('roles/secretmanager.admin');
      }
      runtimeRoles.push(...run.serviceAccountRoles.map((role) => ({ serviceKey: service.key, role })));
      if (contract.secrets.length > 0) runtimeRoles.push({ serviceKey: service.key, role: 'roles/secretmanager.secretAccessor' });
      const cloudRunKey = `cloud-run-service:${installation.gcpProjectId}:${placement.region}:${placement.serviceName}`;
      cloudResources.push({
        resourceKey: cloudRunKey,
        type: 'cloud-run-service',
        serviceKey: service.key,
        action: resourceAction,
        shared: false,
      });
      const accountId = runtimeAccountId(placement.serviceName);
      const accountKey = `service-account:${installation.gcpProjectId}:${accountId}`;
      const observedAccount = inventory.resources.find((item) => item.resourceKey === accountKey);
      cloudResources.push({
        resourceKey: accountKey,
        type: 'service-account',
        serviceKey: service.key,
        action: observedAccount ? 'retain' : inventory.collectionStatus === 'complete' ? 'add' : 'unknown',
        shared: false,
      });
    } else if (target === 'vm-docker') {
      requiredApis.push(...VM_DOCKER_APIS);
      requiredRoles.push(...VM_DOCKER_ROLES);
      runtimeRoles.push(
        { serviceKey: service.key, role: 'roles/artifactregistry.reader' },
        { serviceKey: service.key, role: 'roles/logging.logWriter' },
        { serviceKey: service.key, role: 'roles/monitoring.metricWriter' },
        { serviceKey: service.key, role: 'roles/secretmanager.secretAccessor' },
      );
      const host = placement.targetConfig.hostRef;
      cloudResources.push({ resourceKey: host, type: 'gce-instance', serviceKey: service.key, action: resourceAction, shared: false });
      const persistentDiskKey = `${host}:persistent-data`;
      const observedDisk = inventory.resources.find((item) => item.resourceKey === persistentDiskKey);
      cloudResources.push({
        resourceKey: persistentDiskKey, type: 'persistent-disk', serviceKey: service.key,
        action: observedDisk ? 'retain' : inventory.collectionStatus === 'complete' ? 'add' : 'unknown', shared: false,
      });
      warnings.push(`${service.key} is a persistent VM Worker; deployment does not authorize PAPER or LIVE trading.`);
    }
    for (const setting of contract.configuration) {
      const dependency = setting.serviceKey ? placements.get(setting.serviceKey) : null;
      const availability = setting.source === 'operator-input' ? 'operator-required'
        : setting.source === 'project-id' ? 'platform-derived'
        : dependency && dependency.selectedTarget !== 'unassigned' ? 'resolved-at-deploy' : 'missing-dependency-placement';
      if (availability === 'missing-dependency-placement') {
        blockers.push(`Configuration dependency is unavailable: ${service.key}/${setting.name}.`);
      }
      configurations.push({
        serviceKey: service.key,
        name: setting.name,
        purpose: setting.purpose,
        source: setting.source,
        validation: setting.source === 'project-id' ? 'gcp-project-id'
          : setting.source === 'service-url' ? 'https-url' : setting.input,
        availability,
        dependency: dependency ? {
          serviceKey: setting.serviceKey,
          selectedTarget: dependency.selectedTarget,
          region: dependency.region,
          serviceName: dependency.serviceName,
        } : null,
      });
    }
    migrations.push({
      serviceKey: service.key,
      strategy: contract.migration.strategy,
      reversible: contract.migration.reversible,
      backupRequired: contract.migration.backupRequired,
      maintenanceWindow: contract.migration.maintenanceWindow,
      rollbackStrategy: contract.rollback.strategy,
      dataRollback: contract.rollback.data,
      blockers: contract.migration.strategy === 'none' ? [] : ['Migration execution requires a reviewed platform driver.'],
    });
    if (contract.migration.strategy !== 'none') blockers.push(`Migration driver is not available in Batch 5: ${service.key}.`);
  }

  for (const removed of previousServices.filter((service) => !nextServices.some((item) => item.key === service.key))) {
    const observed = observedByService.get(removed.key);
    if (observed) {
      cloudResources.push({
        resourceKey: observed.resourceKey,
        type: observed.type,
        serviceKey: removed.key,
        action: 'remove',
        shared: false,
      });
      warnings.push(`Removing ${removed.key} may interrupt traffic and requires a separate destructive-action review.`);
    }
  }
  const hasCloudRun = services.some((item) => item.selectedTarget === 'cloud-run-service');
  if (hasCloudRun) {
    const repositoryKey = `artifact-registry-repository:${installation.gcpProjectId}:${installation.region}:stratexec`;
    const observedRepository = inventory.resources.find((item) => item.resourceKey === repositoryKey);
    cloudResources.push({
      resourceKey: repositoryKey,
      type: 'artifact-registry-repository',
      serviceKey: null,
      action: observedRepository ? 'retain' : inventory.collectionStatus === 'complete' ? 'add' : 'unknown',
      shared: true,
    });
  }

  for (const resource of inventory.resources.filter((item) => item.ownerApp === sourcePlan.appKey
    && item.serviceKey && !nextServices.some((service) => service.key === item.serviceKey))) {
    if (!cloudResources.some((item) => item.resourceKey === resource.resourceKey)) {
      drift.push({ kind: 'unexpected-resource', resourceKey: resource.resourceKey, serviceKey: resource.serviceKey });
    }
  }

  const inventoryComplete = inventory.collectionStatus === 'complete';
  const apiRequirements = uniqueSorted(requiredApis).map((name) => {
    const enabled = inventoryComplete ? inventory.enabledApis.includes(name) : null;
    if (enabled === false) blockers.push(`Required API is not enabled: ${name}.`);
    return { name, enabled, missing: enabled === null ? null : !enabled };
  });
  const roleRequirements = uniqueSorted(requiredRoles).map((role) => {
    const granted = inventoryComplete ? inventory.grantedIamRoles.includes(role) : null;
    if (granted === false) blockers.push(`Deployment Agent IAM role is missing: ${role}.`);
    return { role, granted, missing: granted === null ? null : !granted };
  });
  for (const secret of secretChanges.filter((item) => item.action === 'add')) {
    blockers.push(`Required secret reference is missing: ${secret.secretName}.`);
  }

  const normalized = {
    schemaVersion: 1,
    planKind: 'app-runtime-impact',
    mode: 'read-only',
    package: {
      appKey: sourcePlan.appKey,
      version: sourcePlan.version,
      packageSha256: sourcePlan.packageSha256,
      signatureStatus: sourcePlan.verification.signatureStatus,
      publisherId: sourcePlan.verification.publisherId,
      keyId: sourcePlan.verification.keyId,
    },
    app: {
      displayName: appManifest?.displayName ?? sourcePlan.appKey,
      category: appManifest?.lifecycle?.category ?? 'application',
      removable: appManifest?.lifecycle?.removable !== false,
      protected: appManifest?.access?.protected === true,
      requiredServices: uniqueSorted(appManifest?.requiredServices ?? nextServices.map((service) => service.key)),
      defaultAccessMode: appManifest?.access?.defaultMode ?? 'admins_only',
      allowedAccessModes: appManifest?.access?.allowedModes ?? ['admins_only'],
      entitlements: appManifest?.access?.entitlements ?? [],
      adminAllowed: appManifest?.access?.adminAllowed !== false,
    },
    installation: {
      installationKey: installation.installationKey,
      projectId: installation.gcpProjectId,
      region: installation.region,
    },
    stateSemantics: {
      planned: 'Desired action only; no cloud write has occurred.',
      ready: 'Static service contract readiness only; not deployment evidence.',
      deployed: 'Resource observed by the read-only inventory.',
      verified: 'Post-deployment health and authorization evidence; never inferred by this plan.',
    },
    inventory: {
      observedAt: inventory.observedAt,
      collectionStatus: inventory.collectionStatus,
      collectorMode: inventory.collector.mode,
      drift: drift.sort((left, right) => left.resourceKey.localeCompare(right.resourceKey)),
    },
    changes: {
      files: sourcePlan.changes.map((item) => ({ path: item.path, action: sourceAction(item.action) })),
      services: serviceChanges,
      routes: routeChanges,
      secretReferences: secretChanges,
      cloudResources: cloudResources.sort((left, right) => left.resourceKey.localeCompare(right.resourceKey)),
    },
    services: services.sort((left, right) => left.serviceKey.localeCompare(right.serviceKey)),
    requirements: {
      apis: apiRequirements,
      deploymentAgentIamRoles: roleRequirements,
      runtimeServiceAccountRoles: runtimeRoles.sort((left, right) => `${left.serviceKey}:${left.role}`.localeCompare(`${right.serviceKey}:${right.role}`)),
      configuration: configurations.sort((left, right) => `${left.serviceKey}:${left.name}`.localeCompare(`${right.serviceKey}:${right.name}`)),
      secrets: secretChanges.filter((item) => item.action !== 'remove'),
    },
    migrations: migrations.sort((left, right) => left.serviceKey.localeCompare(right.serviceKey)),
    warnings: uniqueSorted(warnings),
    blockers: uniqueSorted(blockers),
  };
  const inputFingerprints = {
    sourcePlanFingerprint: sourcePlan.planFingerprint,
    deploymentContractDigest: digest(deployment),
    installationDigest: digest(installation),
    inventoryDigest: digest(inventory),
  };
  return {
    ...normalized,
    decision: normalized.blockers.length > 0 ? 'blocked' : 'reviewable',
    inputFingerprints,
    planFingerprint: digest({ normalized, inputFingerprints }),
  };
}

export async function createAppDeploymentImpactPlan({
  zipPath,
  rootPath,
  installation,
  inventory,
  adoptExisting = false,
  allowDowngrade = false,
}) {
  const repositoryRoot = resolve(rootPath);
  const sourcePlan = await planAppPackageInstall({
    zipPath,
    rootPath: repositoryRoot,
    adoptExisting,
    allowDowngrade,
    installationContext: installation,
  });
  const deploymentPath = `infrastructure/app-deployments/${sourcePlan.appKey}.json`;
  const fragmentPath = `infrastructure/app-services/${sourcePlan.appKey}.json`;
  const appManifestPath = `infrastructure/apps/${sourcePlan.appKey}.json`;
  const deployment = parseJson(sourcePlan.payload, deploymentPath);
  const nextFragment = parseJson(sourcePlan.payload, fragmentPath, false);
  const appManifest = parseJson(sourcePlan.payload, appManifestPath);
  const previousFragment = await readJsonIfPresent(resolve(repositoryRoot, fragmentPath));
  return buildNormalizedAppDeploymentPlan({
    sourcePlan,
    deployment,
    appManifest,
    nextServices: nextFragment?.services ?? [],
    previousServices: previousFragment?.services ?? [],
    installation,
    inventory,
  });
}
