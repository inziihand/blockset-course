import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { DeploymentOperationError } from './executor.mjs';

const terminalBuild = new Set(['SUCCESS', 'FAILURE', 'INTERNAL_ERROR', 'TIMEOUT', 'CANCELLED', 'EXPIRED']);
const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
const lastName = (value) => String(value ?? '').split('/').at(-1);

function runtimeAccountId(serviceName) {
  const requested = `${serviceName}-runtime`;
  return requested.length <= 30 ? requested : `${serviceName.slice(0, 20).replace(/-+$/, '')}-${sha256(serviceName).slice(0, 8)}`;
}

function builderAccountId(serviceName) {
  const requested = `${serviceName}-builder`;
  return requested.length <= 30 ? requested : `${serviceName.slice(0, 20).replace(/-+$/, '')}-${sha256(`builder:${serviceName}`).slice(0, 8)}`;
}

function ingress(value) {
  return {
    all: 'INGRESS_TRAFFIC_ALL',
    'internal-and-cloud-load-balancing': 'INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER',
    internal: 'INGRESS_TRAFFIC_INTERNAL_ONLY',
  }[value];
}

export function createGcpCloudControlPlane({ request, fetchImpl = fetch, pollMilliseconds = 2_000, now = () => new Date() }) {
  if (typeof request !== 'function') throw new Error('GCP control plane requires an authenticated request function.');
  const call = async (input, fallback = 'Google Cloud operation failed.') => {
    try { return await request(input); }
    catch (error) {
      const status = Number(error?.response?.status ?? error?.status ?? 502);
      throw new DeploymentOperationError(status === 404 ? 'Google Cloud resource was not found.' : fallback, {
        status,
        indeterminate: status >= 500 || status === 408 || status === 429,
      });
    }
  };
  const optional = async (input) => {
    try { return await request(input); }
    catch (error) {
      const status = Number(error?.response?.status ?? error?.status ?? 502);
      if (status === 404) return null;
      throw new DeploymentOperationError('Google Cloud lookup failed.', {
        status,
        indeterminate: status >= 500 || status === 408 || status === 429,
      });
    }
  };
  const waitOperation = async (url, name) => {
    for (;;) {
      const operation = await call({ method: 'GET', url: `${url}/${name}` });
      if (operation.done) {
        if (operation.error) throw new DeploymentOperationError('Google Cloud long-running operation failed.', { status: 502 });
        return operation.response ?? operation;
      }
      await delay(pollMilliseconds);
    }
  };
  const serviceResource = ({ projectId, region, serviceName }) => `projects/${projectId}/locations/${region}/services/${serviceName}`;
  const getService = async (input) => optional({ method: 'GET', url: `https://run.googleapis.com/v2/${serviceResource(input)}` });

  async function ensureRepository(projectId, region, repository) {
    const name = `projects/${projectId}/locations/${region}/repositories/${repository}`;
    if (await optional({ method: 'GET', url: `https://artifactregistry.googleapis.com/v1/${name}` })) return;
    const operation = await call({
      method: 'POST',
      url: `https://artifactregistry.googleapis.com/v1/projects/${projectId}/locations/${region}/repositories?repositoryId=${repository}`,
      data: { format: 'DOCKER', description: 'StratExec immutable App images' },
    });
    await waitOperation('https://artifactregistry.googleapis.com/v1', operation.name);
  }

  async function grantProjectRoles(projectId, member, roles) {
    if (roles.length === 0) return;
    const url = `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}`;
    const current = await call({ method: 'POST', url: `${url}:getIamPolicy`, data: {} });
    const bindings = [...(current.bindings ?? [])].map((item) => ({ ...item, members: [...item.members] }));
    for (const role of roles) {
      let binding = bindings.find((item) => item.role === role && !item.condition);
      if (!binding) { binding = { role, members: [] }; bindings.push(binding); }
      if (!binding.members.includes(member)) binding.members.push(member);
      binding.members.sort();
    }
    await call({ method: 'POST', url: `${url}:setIamPolicy`, data: { policy: { ...current, bindings } } });
  }

  async function ensureServiceAccount(projectId, accountId, displayName) {
    const email = `${accountId}@${projectId}.iam.gserviceaccount.com`;
    const name = `projects/${projectId}/serviceAccounts/${email}`;
    if (!(await optional({ method: 'GET', url: `https://iam.googleapis.com/v1/${name}` }))) {
      await call({
        method: 'POST',
        url: `https://iam.googleapis.com/v1/projects/${projectId}/serviceAccounts`,
        data: { accountId, serviceAccount: { displayName } },
      });
    }
    return email;
  }

  async function grantSecretAccess(resource, member) {
    const url = `https://secretmanager.googleapis.com/v1/${resource}`;
    const current = await call({ method: 'POST', url: `${url}:getIamPolicy`, data: {} });
    const bindings = [...(current.bindings ?? [])].map((item) => ({ ...item, members: [...item.members] }));
    let binding = bindings.find((item) => item.role === 'roles/secretmanager.secretAccessor' && !item.condition);
    if (!binding) { binding = { role: 'roles/secretmanager.secretAccessor', members: [] }; bindings.push(binding); }
    if (!binding.members.includes(member)) binding.members.push(member);
    await call({ method: 'POST', url: `${url}:setIamPolicy`, data: { policy: { ...current, bindings } } });
  }

  async function patchService({ context, service, body, updateMask, allowMissing = false }) {
    const name = serviceResource({ projectId: context.installation.projectId, region: service.region, serviceName: service.serviceName });
    const query = new URLSearchParams({ updateMask, allowMissing: String(allowMissing) });
    const operation = await call({ method: 'PATCH', url: `https://run.googleapis.com/v2/${name}?${query}`, data: { name, ...body } });
    await waitOperation('https://run.googleapis.com/v2', operation.name);
    return getService({ projectId: context.installation.projectId, region: service.region, serviceName: service.serviceName });
  }

  return {
    async buildImmutableImage({ context, service, source, repository, builderRoles }) {
      const projectId = context.installation.projectId;
      await ensureRepository(projectId, service.region, repository);
      const builderEmail = await ensureServiceAccount(
        projectId,
        builderAccountId(service.serviceName),
        `StratExec ${service.serviceKey} isolated builder`,
      );
      await grantProjectRoles(projectId, `serviceAccount:${builderEmail}`, builderRoles);
      const bucket = `${projectId}_cloudbuild`;
      const object = `stratexec/${context.package.appKey}/${context.package.packageSha256}/${service.serviceKey}-${source.archiveSha256}.tgz`;
      try {
        await request({
          method: 'POST',
          url: `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(object)}&ifGenerationMatch=0`,
          headers: { 'Content-Type': 'application/gzip' },
          data: source.archive,
        });
      } catch (error) {
        const status = Number(error?.response?.status ?? error?.status ?? 502);
        if (status !== 412) {
          throw new DeploymentOperationError('Cloud Build source upload failed.', {
            status,
            indeterminate: status >= 500 || status === 408 || status === 429,
          });
        }
      }
      const tag = `${service.region}-docker.pkg.dev/${projectId}/${repository}/${service.serviceName}:stratexec-${context.package.packageSha256.slice(0, 12)}-${context.jobId.slice(0, 8)}`;
      const build = await call({
        method: 'POST',
        url: `https://cloudbuild.googleapis.com/v1/projects/${projectId}/locations/${service.region}/builds`,
        data: {
          source: { storageSource: { bucket, object } },
          steps: [{ name: 'gcr.io/cloud-builders/docker', args: ['build', '-f', 'Dockerfile', '-t', tag, '.'] }],
          images: [tag],
          timeout: '1200s',
          serviceAccount: `projects/${projectId}/serviceAccounts/${builderEmail}`,
          tags: ['stratexec-app', context.package.appKey, service.serviceKey],
          options: { logging: 'CLOUD_LOGGING_ONLY' },
        },
      }, 'Cloud Build submission failed.');
      let observed = build.metadata?.build ?? build;
      const buildId = observed.id;
      if (!buildId) throw new DeploymentOperationError('Cloud Build did not return a build id.', { indeterminate: true, status: 502 });
      while (!terminalBuild.has(observed.status)) {
        await delay(pollMilliseconds);
        observed = await call({ method: 'GET', url: `https://cloudbuild.googleapis.com/v1/projects/${projectId}/locations/${service.region}/builds/${buildId}` });
      }
      if (observed.status !== 'SUCCESS') throw new DeploymentOperationError(`Cloud Build ended with ${observed.status}.`, { status: 409 });
      const image = observed.results?.images?.find((item) => item.name === tag) ?? observed.results?.images?.[0];
      const imageDigest = String(image?.digest ?? '').replace(/^sha256:/, '');
      if (!/^[a-f0-9]{64}$/.test(imageDigest)) throw new DeploymentOperationError('Cloud Build result has no immutable image digest.', { status: 502 });
      return { buildId, imageDigest, image: `${tag.replace(/:[^/]+$/, '')}@sha256:${imageDigest}` };
    },

    async ensureRuntimeIdentity({ context, service, roles }) {
      const projectId = context.installation.projectId;
      const accountId = runtimeAccountId(service.serviceName);
      const email = await ensureServiceAccount(projectId, accountId, `StratExec ${service.serviceKey} runtime`);
      await grantProjectRoles(projectId, `serviceAccount:${email}`, roles.filter((role) => role !== 'roles/secretmanager.secretAccessor'));
      return { email };
    },

    async resolveServiceUrl({ context, dependency }) {
      const service = await getService({
        projectId: context.installation.projectId,
        region: dependency.region,
        serviceName: dependency.serviceName,
      });
      if (!service?.uri || service.reconciling) throw new DeploymentOperationError(`Dependency is not verified and ready: ${dependency.serviceKey}.`);
      return service.uri;
    },

    async deployCandidate({ context, service, image, imageDigest, runtimeServiceAccount, configuration, secrets, noProductionTraffic }) {
      if (!noProductionTraffic) throw new DeploymentOperationError('Cloud Run candidates must be staged without a production traffic switch.');
      const projectId = context.installation.projectId;
      const existing = await getService({ projectId, region: service.region, serviceName: service.serviceName });
      const suffix = `c${sha256(`${context.planFingerprint}:${service.serviceKey}`).slice(0, 12)}`;
      const revision = `${service.serviceName}-${suffix}`;
      for (const secret of secrets) await grantSecretAccess(secret.resource, `serviceAccount:${runtimeServiceAccount}`);
      const env = [
        ...configuration.map((item) => ({ name: item.name, value: item.value })),
        ...secrets.map((item) => ({ name: item.environment, valueSource: { secretKeyRef: { secret: item.resource, version: item.version } } })),
      ];
      const previousTraffic = existing?.traffic ?? [];
      const traffic = previousTraffic.length > 0
        ? [...previousTraffic, { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision, percent: 0, tag: `candidate-${context.jobId.slice(0, 8)}` }]
        : [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision, percent: 100, tag: `candidate-${context.jobId.slice(0, 8)}` }];
      const deployed = await patchService({
        context, service, allowMissing: true,
        updateMask: 'template,traffic,ingress,invokerIamDisabled,labels',
        body: {
          labels: { 'stratexec-app': context.package.appKey, 'stratexec-operation': context.idempotencyKey.slice(0, 63), 'stratexec-image': imageDigest.slice(0, 63) },
          ingress: ingress(service.ingress),
          invokerIamDisabled: service.publicIngress === true,
          template: {
            revision,
            serviceAccount: runtimeServiceAccount,
            timeout: `${service.resources.timeoutSeconds}s`,
            maxInstanceRequestConcurrency: service.resources.concurrency,
            scaling: { minInstanceCount: service.resources.minInstances, maxInstanceCount: service.resources.maxInstances },
            containers: [{ image, env, resources: { limits: { cpu: service.resources.cpu, memory: service.resources.memory } } }],
            labels: { 'stratexec-app': context.package.appKey, 'stratexec-service': service.serviceKey },
          },
          traffic,
        },
      });
      const status = deployed.trafficStatuses?.find((item) => lastName(item.revision) === revision || item.tag === `candidate-${context.jobId.slice(0, 8)}`);
      return {
        revision,
        serviceUrl: deployed.uri,
        candidateUrl: status?.uri ?? deployed.uri,
        previousRevision: existing ? lastName(existing.latestReadyRevision) : null,
        previousTraffic,
        initialDeploymentUnrouted: !existing,
      };
    },

    async verifyRequest({ url, method, token, expectedStatus, requireJsonError, requireHealthyBody }) {
      const headers = { Accept: 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (method !== 'GET' && method !== 'HEAD') headers['Content-Type'] = 'application/json';
      const response = await fetchImpl(url, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : '{}' });
      if (response.status !== expectedStatus) throw new DeploymentOperationError(`Verification returned HTTP ${response.status}; expected ${expectedStatus}.`);
      const contentType = response.headers.get('content-type') ?? '';
      if ((requireJsonError || requireHealthyBody) && !contentType.includes('application/json')) {
        throw new DeploymentOperationError('Verification returned non-JSON content; Hosting fallback or an invalid route may be active.');
      }
      if (requireHealthyBody) {
        const body = await response.json();
        if (body?.status !== 'ok') throw new DeploymentOperationError('Health response is not ok.');
      }
      return { status: response.status };
    },

    async promoteCandidate({ context, service, candidate }) {
      const deployed = await patchService({
        context, service,
        updateMask: 'traffic',
        body: { traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: candidate.revision, percent: 100 }] },
      });
      return { serviceUrl: deployed.uri, promotedAt: now().toISOString() };
    },

    async restoreTraffic({ context, candidate }) {
      const service = context.services.find((item) => item.serviceKey === candidate.serviceKey);
      const traffic = candidate.previousTraffic?.length > 0
        ? candidate.previousTraffic
        : [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: candidate.previousRevision, percent: 100 }];
      const deployed = await patchService({ context, service, updateMask: 'traffic', body: { traffic } });
      const status = deployed.trafficStatuses?.find((item) => lastName(item.revision) === candidate.previousRevision);
      return {
        revision: candidate.previousRevision,
        serviceUrl: deployed.uri,
        revisionUrl: status?.uri ?? deployed.uri,
        rolledBackAt: now().toISOString(),
      };
    },

    async deployHostingRoutes({ context, routes }) {
      const site = context.installation.projectId;
      const releases = await call({ method: 'GET', url: `https://firebasehosting.googleapis.com/v1beta1/sites/${site}/releases?pageSize=1` });
      const sourceVersionName = releases.releases?.[0]?.version?.name;
      if (!sourceVersionName) throw new DeploymentOperationError('Firebase Hosting has no existing release to clone.');
      const source = await call({ method: 'GET', url: `https://firebasehosting.googleapis.com/v1beta1/${sourceVersionName}` });
      const cloneOperation = await call({ method: 'POST', url: `https://firebasehosting.googleapis.com/v1beta1/sites/${site}/versions:clone`, data: {
        sourceVersion: sourceVersionName, finalize: false,
      } });
      const cloned = await waitOperation('https://firebasehosting.googleapis.com/v1beta1', cloneOperation.name);
      const name = cloned.name;
      const managedRoutes = new Set(routes.map((item) => item.route));
      const rewrites = [
        ...routes.map((item) => ({ glob: item.route, run: { serviceId: item.serviceName, region: item.region, pinTag: true } })),
        ...(source.config?.rewrites ?? []).filter((item) => !managedRoutes.has(item.glob) && item.glob !== '**'),
        ...(source.config?.rewrites ?? []).filter((item) => item.glob === '**'),
      ];
      await call({
        method: 'PATCH',
        url: `https://firebasehosting.googleapis.com/v1beta1/${name}?updateMask=config,status`,
        data: { name, status: 'FINALIZED', config: { ...(source.config ?? {}), rewrites } },
      });
      const release = await call({
        method: 'POST',
        url: `https://firebasehosting.googleapis.com/v1beta1/sites/${site}/releases?versionName=${encodeURIComponent(name)}`,
        data: { message: `StratExec ${context.package.appKey}@${context.package.version}` },
      });
      return { site, version: name, release: release.name ?? null, url: `https://${site}.web.app`, releasedAt: now().toISOString() };
    },

    async reconcile(context) {
      if (context.reconcileOperation === 'verify' && context.priorVerification) return { ...context.priorVerification, outcome: 'succeeded' };
      if ((context.reconcileOperation === 'apply' || context.reconcileOperation === 'promote') && context.priorRuntime) {
        const observed = [];
        for (const item of context.priorRuntime.services ?? []) {
          const service = context.services.find((candidate) => candidate.serviceKey === item.serviceKey);
          const current = await getService({ projectId: context.installation.projectId, region: service.region, serviceName: service.serviceName });
          if (!current || current.reconciling) return { outcome: 'unknown', message: 'Cloud Run is still reconciling.' };
          observed.push(item);
        }
        return { ...context.priorRuntime, outcome: 'succeeded', services: observed };
      }
      return { outcome: 'unknown', message: 'No durable Cloud Run evidence is available for reconciliation.' };
    },
  };
}
