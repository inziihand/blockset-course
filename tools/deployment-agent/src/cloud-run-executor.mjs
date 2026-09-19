import { createHash } from 'node:crypto';
import { DeploymentOperationError } from './executor.mjs';

const digestPattern = /^[a-f0-9]{64}$/;
const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

function orderedServices(services) {
  const byKey = new Map(services.map((service) => [service.serviceKey, service]));
  const visited = new Set();
  const visiting = new Set();
  const ordered = [];
  const visit = (service) => {
    if (visited.has(service.serviceKey)) return;
    if (visiting.has(service.serviceKey)) throw new DeploymentOperationError('Service dependency graph contains a cycle.');
    visiting.add(service.serviceKey);
    for (const dependency of service.dependsOn ?? []) if (byKey.has(dependency)) visit(byKey.get(dependency));
    visiting.delete(service.serviceKey);
    visited.add(service.serviceKey);
    ordered.push(service);
  };
  for (const service of services) visit(service);
  return ordered;
}

function configurationFor(context, service, candidateUrls) {
  const declared = context.requirements.configuration.filter((item) => item.serviceKey === service.serviceKey);
  const bound = new Map(context.runtimeBindings.configuration
    .filter((item) => item.serviceKey === service.serviceKey)
    .map((item) => [item.environment, item]));
  return declared.map((item) => {
    if (item.source === 'project-id') return { name: item.name, value: context.installation.projectId };
    if (item.source === 'operator-input') {
      const value = bound.get(item.name)?.configuredValue;
      if (value === undefined) throw new DeploymentOperationError(`Runtime configuration is missing: ${service.serviceKey}/${item.name}.`);
      return { name: item.name, value: String(value) };
    }
    if (item.source === 'service-url') {
      const value = candidateUrls.get(item.dependency?.serviceKey);
      if (value) return { name: item.name, value };
      return { name: item.name, dependency: item.dependency };
    }
    throw new DeploymentOperationError(`Unsupported runtime configuration source: ${item.source}.`);
  });
}

function secretsFor(context, service) {
  return context.runtimeBindings.secrets
    .filter((item) => item.serviceKey === service.serviceKey)
    .map((item) => ({
      environment: item.environment,
      resource: item.secretResource,
      version: String(item.version),
    }));
}

async function checks(control, service, url, token, authenticated = false) {
  const requests = authenticated
    ? service.verification?.authenticatedRequests ?? []
    : [{ method: 'GET', path: service.healthPath, expectedStatus: 200, health: true, kind: 'liveness' },
      ...(service.readinessPath === service.healthPath ? [] : [{ method: 'GET', path: service.readinessPath, expectedStatus: 200, health: true, kind: 'readiness' }]),
      ...(service.verification?.unauthenticatedRequests ?? [])];
  const results = [];
  for (const request of requests) {
    if (authenticated && !token) throw new DeploymentOperationError('Authenticated verification requires the current administrator token.', { status: 401 });
    const result = await control.verifyRequest({
      url: new URL(request.path, `${url}/`).toString(),
      method: request.method,
      token: authenticated ? token : null,
      expectedStatus: request.expectedStatus,
      requireJsonError: !authenticated && request.expectedStatus >= 400,
      requireHealthyBody: request.health === true,
    });
    results.push({ method: request.method, path: request.path, kind: request.kind ?? 'contract', expectedStatus: request.expectedStatus, status: result.status, passed: true });
  }
  return results;
}

function operationResult(services, message, extra = {}) {
  const last = services.at(-1) ?? {};
  return {
    outcome: 'succeeded',
    revision: last.revision ?? null,
    artifactDigest: last.imageDigest ?? null,
    services,
    message,
    ...extra,
  };
}

export function createCloudRunDeploymentExecutor({ control, sourceProvider, policy }) {
  if (!control || !sourceProvider || !policy) throw new Error('Cloud Run executor dependencies are incomplete.');
  return Object.freeze({
    capabilities: Object.freeze({
      mode: 'gcp-cloud-run-v1',
      supportedTargets: ['cloud-run-service'],
      requiresPromotion: true,
    }),

    async apply(context) {
      const candidateUrls = new Map();
      const evidence = [];
      for (const service of orderedServices(context.services)) {
        if (service.selectedTarget !== 'cloud-run-service') throw new DeploymentOperationError(`Unsupported target: ${service.selectedTarget}.`);
        const unresolvedDependencies = (service.dependsOn ?? []).filter((key) => (
          context.services.some((item) => item.serviceKey === key) && !candidateUrls.has(key)
        ));
        if (unresolvedDependencies.length > 0) {
          throw new DeploymentOperationError(`Dependencies are not staged and verified: ${unresolvedDependencies.join(', ')}.`);
        }
        const source = await sourceProvider.prepare(service);
        let built;
        try {
          built = await control.buildImmutableImage({
            context,
            service,
            source,
            repository: policy.cloudRun.artifactRepository,
            builderRoles: policy.cloudRun.builderServiceAccountRoles,
          });
        } finally {
          source.archive.fill(0);
        }
        if (!digestPattern.test(built.imageDigest ?? '') || !built.image?.includes(`@sha256:${built.imageDigest}`)) {
          throw new DeploymentOperationError('Cloud Build did not return an immutable image digest.', { indeterminate: true, status: 502 });
        }
        const identity = await control.ensureRuntimeIdentity({
          context,
          service,
          roles: context.requirements.runtimeServiceAccountRoles
            .filter((item) => item.serviceKey === service.serviceKey).map((item) => item.role),
        });
        const configuration = configurationFor(context, service, candidateUrls);
        for (const item of configuration) {
          if (item.dependency && !item.value) item.value = await control.resolveServiceUrl({ context, dependency: item.dependency });
          delete item.dependency;
        }
        const candidate = await control.deployCandidate({
          context,
          service,
          image: built.image,
          imageDigest: built.imageDigest,
          runtimeServiceAccount: identity.email,
          configuration,
          secrets: secretsFor(context, service),
          noProductionTraffic: true,
        });
        const stageChecks = await checks(control, service, candidate.candidateUrl, null, false);
        candidateUrls.set(service.serviceKey, candidate.candidateUrl);
        evidence.push({
          serviceKey: service.serviceKey,
          serviceName: service.serviceName,
          serviceUrl: candidate.serviceUrl,
          candidateUrl: candidate.candidateUrl,
          image: built.image,
          imageDigest: built.imageDigest,
          buildId: built.buildId,
          revision: candidate.revision,
          previousRevision: candidate.previousRevision ?? null,
          previousTraffic: candidate.previousTraffic ?? [],
          stageChecks,
          routes: service.routes ?? [],
        });
      }
      return operationResult(evidence, 'Candidate revisions built and staged without switching production routes.');
    },

    async verify(context) {
      const runtime = context.priorRuntime?.services ?? [];
      if (runtime.length !== context.services.length) throw new DeploymentOperationError('Staged runtime evidence is incomplete.');
      const verifiedAt = new Date().toISOString();
      const services = [];
      for (const service of orderedServices(context.services)) {
        const candidate = runtime.find((item) => item.serviceKey === service.serviceKey);
        if (!candidate) throw new DeploymentOperationError(`Candidate revision is missing: ${service.serviceKey}.`);
        const stageChecks = await checks(control, service, candidate.candidateUrl, null, false);
        const authenticatedChecks = await checks(control, service, candidate.candidateUrl, context.verificationToken, true);
        services.push({ ...candidate, stageChecks, authenticatedChecks, verifiedAt });
      }
      return operationResult(services, 'Candidate revisions passed staged health, authorization and contract checks.');
    },

    async promote(context) {
      const runtime = context.priorRuntime?.services ?? [];
      const verification = context.priorVerification?.services ?? [];
      if (runtime.length === 0 || verification.length !== runtime.length) {
        throw new DeploymentOperationError('Only a fully verified staged deployment can receive production traffic.');
      }
      const promoted = [];
      try {
        for (const service of orderedServices(context.services)) {
          const candidate = runtime.find((item) => item.serviceKey === service.serviceKey);
          const result = await control.promoteCandidate({ context, service, candidate });
          promoted.push({ ...candidate, serviceUrl: result.serviceUrl, promotedAt: result.promotedAt });
        }
        const hosting = await control.deployHostingRoutes({
          context,
          routes: context.services.flatMap((service) => (service.routes ?? []).map((route) => ({
            route, serviceName: service.serviceName, region: service.region,
          }))),
        });
        const routeChecks = [];
        for (const service of context.services) {
          for (const request of service.verification?.unauthenticatedRequests ?? []) {
            const route = await control.verifyRequest({
              url: new URL(request.path, `${hosting.url}/`).toString(), method: request.method,
              expectedStatus: request.expectedStatus, token: null, requireJsonError: true,
            });
            routeChecks.push({ serviceKey: service.serviceKey, path: request.path, status: route.status, passed: true });
          }
        }
        return operationResult(promoted, 'Verified revisions promoted and Hosting routes released.', { hosting: { ...hosting, routeChecks } });
      } catch (error) {
        for (const candidate of promoted.reverse()) {
          try { await control.restoreTraffic({ context, candidate }); } catch { /* original promotion error wins */ }
        }
        throw error;
      }
    },

    async rollback(context) {
      const runtime = context.priorRuntime?.services ?? [];
      if (runtime.length === 0) throw new DeploymentOperationError('Rollback requires prior runtime evidence.');
      const services = [];
      for (const service of [...orderedServices(context.services)].reverse()) {
        const candidate = runtime.find((item) => item.serviceKey === service.serviceKey);
        if (!candidate?.previousRevision) throw new DeploymentOperationError(`No prior healthy revision exists for ${service.serviceKey}.`);
        const restored = await control.restoreTraffic({ context, candidate });
        const rollbackChecks = await checks(control, service, restored.revisionUrl ?? restored.serviceUrl, null, false);
        services.push({ ...candidate, revision: restored.revision, serviceUrl: restored.serviceUrl, rollbackChecks, rolledBackAt: restored.rolledBackAt });
      }
      return operationResult(services.reverse(), 'Previous healthy revisions restored and checked.');
    },

    async reconcile(context) {
      const result = await control.reconcile(context);
      if (!result) return { outcome: 'unknown', message: 'Cloud Run operation is not yet observable.' };
      return result;
    },
  });
}
