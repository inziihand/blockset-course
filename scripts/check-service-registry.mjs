import { access, readFile } from 'node:fs/promises';
import { loadMergedServiceRegistry, renderServiceRegistry } from './lib/service-catalog.mjs';

const root = new URL('../', import.meta.url);
const registry = JSON.parse(await readFile(new URL('infrastructure/services.json', root), 'utf8'));
const generated = await loadMergedServiceRegistry(root);
if (renderServiceRegistry(registry) !== renderServiceRegistry(generated)) {
  throw new Error('Service registry drift: run npm run services:merge.');
}
if (registry.schemaVersion !== 3 || !Array.isArray(registry.services)) {
  throw new Error('Service registry requires schemaVersion 3 and a services array.');
}
const deploymentTargets = new Set([
  'firebase-hosting', 'firebase-functions-v2', 'cloud-run-service',
  'cloud-run-job', 'cloud-run-worker-pool', 'vm-docker',
]);
const workloadClasses = new Set(['static-web', 'request-http', 'event-handler', 'batch-job', 'continuous-worker']);
const keys = new Set();
const routes = new Set();
for (const service of registry.services) {
  if (!/^[a-z][a-z0-9-]*$/.test(service.key) || !/^[a-z][a-z0-9-]*$/.test(service.ownerApp)) {
    throw new Error(`Invalid service or owner App key: ${service.key}`);
  }
  if (keys.has(service.key)) throw new Error(`Duplicate service key: ${service.key}`);
  keys.add(service.key);
  if (!Array.isArray(service.dependsOn) || service.dependsOn.some((key) => !/^[a-z][a-z0-9-]*$/.test(key))) {
    throw new Error(`Service requires a valid dependsOn list: ${service.key}`);
  }
  if (!['bff', 'http-api', 'account-worker'].includes(service.kind)) throw new Error(`Invalid service kind: ${service.key}`);
  if (service.runtime?.production !== 'unassigned') throw new Error(`Mother-template service must not select production runtime: ${service.key}`);
  if (!['none', 'firebase-id-token'].includes(service.authorization)) {
    throw new Error(`Service requires an explicit authorization mode: ${service.key}`);
  }
  if (service.writesExternalState === true && service.authorization !== 'firebase-id-token') {
    throw new Error(`State-writing service must require Firebase ID tokens: ${service.key}`);
  }
  if (typeof service.writesExternalState !== 'boolean') {
    throw new Error(`Service must declare writesExternalState: ${service.key}`);
  }
  const localOrigin = new URL(service.runtime?.localOrigin ?? 'https://invalid.example');
  if (localOrigin.protocol !== 'http:' || localOrigin.hostname !== '127.0.0.1' || !localOrigin.port) {
    throw new Error(`Mother-template local service must use an explicit 127.0.0.1 HTTP port: ${service.key}`);
  }
  if (!Array.isArray(service.capabilities) || service.capabilities.length === 0) {
    throw new Error(`Service requires declared capabilities: ${service.key}`);
  }
  const deployment = service.deployment;
  if (!deployment || !workloadClasses.has(deployment.workloadClass)) {
    throw new Error(`Service requires a valid deployment workloadClass: ${service.key}`);
  }
  if (deployment.artifact?.type !== 'oci'
    || deployment.artifact?.context !== service.source
    || !deployment.artifact?.dockerfile) {
    throw new Error(`Service requires an OCI Dockerfile artifact with its service source as build context: ${service.key}`);
  }
  await access(new URL(`${deployment.artifact.context}/`, root));
  const dockerfileUrl = new URL(deployment.artifact.dockerfile, root);
  await access(dockerfileUrl);
  const dockerfile = await readFile(dockerfileUrl, 'utf8');
  if (!/^USER\s+\S+/m.test(dockerfile) || !/^CMD\s+/m.test(dockerfile)
    || /^\s*(COPY|ADD)\s+\.\s/m.test(dockerfile)) {
    throw new Error(`OCI Dockerfile must use a non-root USER, declare CMD, and avoid broad COPY/ADD: ${service.key}`);
  }
  if (!deploymentTargets.has(deployment.recommendedTarget)
    || !Array.isArray(deployment.allowedTargets)
    || !deployment.allowedTargets.includes(deployment.recommendedTarget)
    || deployment.allowedTargets.some((target) => !deploymentTargets.has(target))) {
    throw new Error(`Service has invalid recommended/allowed deployment targets: ${service.key}`);
  }
  if (deployment.workloadClass === 'request-http') {
    if (deployment.stateful !== false || deployment.continuous !== false
      || deployment.listen?.host !== '0.0.0.0'
      || deployment.listen?.portEnvironment !== 'PORT'
      || !deployment.listen?.healthPath?.startsWith('/')) {
      throw new Error(`Request HTTP service violates the portable container contract: ${service.key}`);
    }
    const cloudRun = deployment.cloudRun;
    if (!cloudRun || !['all', 'internal-and-cloud-load-balancing', 'internal'].includes(cloudRun.ingress)
      || !['public-app-auth', 'cloud-iam'].includes(cloudRun.iamInvocation)
      || !/^\d+(Mi|Gi)$/.test(cloudRun.memory)
      || !Number.isInteger(cloudRun.timeoutSeconds) || cloudRun.timeoutSeconds < 1
      || !Number.isInteger(cloudRun.concurrency) || cloudRun.concurrency < 1
      || !Number.isInteger(cloudRun.minInstances) || cloudRun.minInstances < 0
      || !Number.isInteger(cloudRun.maxInstances) || cloudRun.maxInstances < 1
      || cloudRun.minInstances > cloudRun.maxInstances) {
      throw new Error(`Request HTTP service requires bounded Cloud Run settings: ${service.key}`);
    }
    if (!Array.isArray(cloudRun.serviceAccountRoles)
      || !Array.isArray(cloudRun.environment) || !Array.isArray(cloudRun.secrets)) {
      throw new Error(`Cloud Run service requires declarative IAM, environment and secret settings: ${service.key}`);
    }
    for (const variable of cloudRun.environment) {
      const operatorInput = variable.source === 'operator-input';
      if (!/^[A-Z][A-Z0-9_]*$/.test(variable.name)
        || !['project-id', 'service-url', 'operator-input'].includes(variable.source)
        || (variable.source === 'service-url' && !service.dependsOn.includes(variable.serviceKey))
        || (operatorInput && (!variable.input?.label
          || !['string', 'integer', 'boolean', 'select'].includes(variable.input.type)
          || typeof variable.input.required !== 'boolean'
          || !['normal', 'high'].includes(variable.input.impact)))
        || (!operatorInput && variable.input !== undefined)) {
        throw new Error(`Cloud Run service has an invalid environment binding: ${service.key}`);
      }
    }
    for (const secret of cloudRun.secrets) {
      if (!/^[A-Z][A-Z0-9_]*$/.test(secret.environment)
        || !/^[a-z][a-z0-9-]*$/.test(secret.secretName)
        || secret.source !== 'bootstrap-admin-emails' || typeof secret.temporary !== 'boolean') {
        throw new Error(`Cloud Run service has an invalid secret binding: ${service.key}`);
      }
    }
    if (cloudRun.iamInvocation === 'public-app-auth' && service.authorization !== 'firebase-id-token'
      && deployment.productionReadiness !== 'blocked') {
      throw new Error(`Public Cloud Run invocation requires application authorization: ${service.key}`);
    }
    if (deployment.trafficControl) {
      const traffic = deployment.trafficControl;
      if (traffic.scope !== 'firebase-uid' || traffic.strategy !== 'fixed-window'
        || !Number.isInteger(traffic.limit) || traffic.limit < 1
        || !Number.isInteger(traffic.windowSeconds) || traffic.windowSeconds < 1
        || !Number.isInteger(traffic.cacheTtlSeconds) || traffic.cacheTtlSeconds < 1
        || !Number.isInteger(traffic.cacheMaxEntries) || traffic.cacheMaxEntries < 1
        || traffic.requiresSingleInstance !== true || cloudRun.maxInstances !== 1) {
        throw new Error(`Service traffic control requires a bounded single-instance profile: ${service.key}`);
      }
    }
  }
  if (deployment.workloadClass === 'continuous-worker') {
    if (deployment.recommendedTarget !== 'vm-docker' || deployment.stateful !== true || deployment.continuous !== true
      || deployment.vmDocker?.agentTransport !== 'mtls'
      || deployment.vmDocker?.desiredStateSignature !== 'Ed25519'
      || deployment.vmDocker?.immutableImage !== true
      || deployment.vmDocker?.hostLocalAccountLock !== true
      || deployment.vmDocker?.persistentData !== true
      || !Array.isArray(deployment.vmDocker?.environment)
      || !Array.isArray(deployment.vmDocker?.secrets)
      || Object.values(deployment.vmDocker?.preflight ?? {}).some((value) => value !== true)
      || deployment.vmDocker?.rollback?.previousImmutableImage !== true
      || deployment.vmDocker?.rollback?.preserveData !== true) {
      throw new Error(`Continuous Worker requires the reviewed VM Docker safety contract: ${service.key}`);
    }
    for (const variable of deployment.vmDocker.environment) {
      if (!/^[A-Z][A-Z0-9_]*$/.test(variable.name)
        || !['project-id', 'service-url', 'operator-input'].includes(variable.source)
        || (variable.source === 'service-url' && !service.dependsOn.includes(variable.serviceKey))) {
        throw new Error(`VM Docker service has an invalid environment binding: ${service.key}`);
      }
    }
    for (const secret of deployment.vmDocker.secrets) {
      if (!/^[A-Z][A-Z0-9_]*$/.test(secret.environment)
        || !/^[a-z][a-z0-9-]*$/.test(secret.secretName)
        || typeof secret.temporary !== 'boolean') {
        throw new Error(`VM Docker service has an invalid secret binding: ${service.key}`);
      }
    }
  }
  if (!['public-demo', 'authenticated', 'internal'].includes(deployment.intendedExposure)) {
    throw new Error(`Service requires an intended exposure: ${service.key}`);
  }
  if (!['blocked', 'candidate', 'ready'].includes(deployment.productionReadiness)
    || !Array.isArray(deployment.blockers)) {
    throw new Error(`Service requires production readiness evidence: ${service.key}`);
  }
  if (deployment.productionReadiness === 'blocked' && deployment.blockers.length === 0) {
    throw new Error(`Blocked service must declare blockers: ${service.key}`);
  }
  if (deployment.intendedExposure === 'authenticated'
    && service.authorization === 'none'
    && deployment.productionReadiness !== 'blocked') {
    throw new Error(`Authenticated service without authorization must stay blocked: ${service.key}`);
  }
  for (const route of service.routes ?? []) {
    if (!route.startsWith('/api/') || !route.endsWith('/**') || routes.has(route)) throw new Error(`Invalid or duplicate service route: ${route}`);
    routes.add(route);
  }
  if (service.ownerApp !== 'platform') {
    await access(new URL(`apps/console/src/apps/${service.ownerApp}/`, root));
  }
  const sourceManifest = service.runtime.local === 'python' ? 'pyproject.toml' : 'package.json';
  await access(new URL(`${service.source}/${sourceManifest}`, root));
  const contract = JSON.parse(await readFile(new URL(service.contract, root), 'utf8'));
  if (typeof contract.openapi !== 'string' || !contract.openapi.startsWith('3.')) {
    throw new Error(`Service contract must be OpenAPI 3: ${service.key}`);
  }
}
for (const service of registry.services) {
  for (const dependency of service.dependsOn) {
    if (!keys.has(dependency) || dependency === service.key) {
      throw new Error(`Service has an invalid dependency: ${service.key} -> ${dependency}`);
    }
  }
}
const visiting = new Set();
const visited = new Set();
function visit(key) {
  if (visiting.has(key)) throw new Error(`Service dependency cycle includes ${key}.`);
  if (visited.has(key)) return;
  visiting.add(key);
  const service = registry.services.find((item) => item.key === key);
  for (const dependency of service.dependsOn) visit(dependency);
  visiting.delete(key);
  visited.add(key);
}
for (const key of keys) visit(key);
console.log(`Service registry is valid (${registry.services.length} services, deployment schema v3).`);
