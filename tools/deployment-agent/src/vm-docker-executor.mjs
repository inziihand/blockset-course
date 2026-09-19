import { DeploymentOperationError } from './executor.mjs';
import { VmAgentClientError } from './vm-agent-client.mjs';

const rawDigest = (value) => String(value ?? '').replace(/^sha256:/, '');

function runtimeResult(service, state, extra = {}) {
  const current = state.current;
  if (!current?.revision || !/^[a-f0-9]{64}$/.test(current.imageDigest ?? '')) {
    throw new DeploymentOperationError('VM Agent returned incomplete immutable runtime evidence.', { indeterminate: true, status: 502 });
  }
  return {
    serviceKey: service.serviceKey,
    revision: current.revision,
    imageDigest: current.imageDigest,
    serviceUrl: null,
    candidateUrl: null,
    vmHostRef: service.vm.hostRef,
    runtimeStatus: { ...current.layers, tradingEnabled: current.tradingEnabled === true },
    ...extra,
  };
}

async function desiredState({ context, service, built, before, operation, revision, imageUri, imageDigest, configurationResolver }) {
  const now = new Date();
  return {
    schemaVersion: 1,
    generation: Number(before.generation ?? 0) + 1,
    operation,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    installationKey: context.installation.installationKey,
    hostRef: service.vm.hostRef,
    serviceKey: service.serviceKey,
    revision,
    image: { uri: imageUri ?? built.image, digest: `sha256:${rawDigest(imageDigest ?? built.imageDigest)}` },
    runtime: {
      containerName: service.vm.containerName,
      runAsUser: service.vm.runAsUser,
      readOnlyRootFilesystem: true,
      restartPolicy: 'unless-stopped',
      environmentFile: `${service.vm.persistentDataPath}/runtime.env`,
    },
    data: {
      mountPath: service.vm.persistentDataPath,
      minimumFreeBytes: service.vm.minimumFreeBytes,
      backupRequired: true,
      backupMaxAgeSeconds: service.vm.backupMaxAgeSeconds,
    },
    account: { scope: service.vm.accountScope, lockPath: `${service.vm.persistentDataPath}/account.lock` },
    bindings: await runtimeBindings(context, service, configurationResolver),
    preflight: {
      allowedSqliteSchemaVersions: service.vm.allowedSqliteSchemaVersions,
      expectedOpenOrders: service.vm.expectedOpenOrders,
      expectedPositionFingerprint: service.vm.expectedPositionFingerprint,
      requireReconciliation: true,
      requireAgentLease: true,
      requireBackup: true,
    },
    trading: { mode: 'disabled', activationRequired: true },
  };
}

async function runtimeBindings(context, service, configurationResolver) {
  const configured = new Map(context.runtimeBindings.configuration
    .filter((item) => item.serviceKey === service.serviceKey).map((item) => [item.environment, item.configuredValue]));
  const configuration = [];
  for (const item of context.requirements.configuration.filter((entry) => entry.serviceKey === service.serviceKey)) {
    if (item.source === 'operator-input' && configured.has(item.name)) { configuration.push({ name: item.name, value: String(configured.get(item.name)) }); continue; }
    if (item.source === 'project-id') { configuration.push({ name: item.name, value: context.installation.projectId }); continue; }
    if (item.source === 'service-url' && item.dependency) {
      const value = item.dependency.runtimeUrl ?? (configurationResolver ? await configurationResolver({ context, dependency: item.dependency }) : null);
      if (value) { configuration.push({ name: item.name, value }); continue; }
    }
    throw new DeploymentOperationError(`VM runtime configuration is unresolved: ${service.serviceKey}/${item.name}.`);
  }
  const secrets = context.runtimeBindings.secrets.filter((item) => item.serviceKey === service.serviceKey).map((item) => ({
    environment: item.environment,
    resource: `${item.secretResource}/versions/${item.version}`,
    version: String(item.version),
  }));
  return { configuration, secrets };
}

export function createVmDockerDeploymentExecutor({ sourceProvider, imageBuilder, signer, clientForService, configurationResolver, policy }) {
  if (!sourceProvider || !imageBuilder || !signer || !clientForService || !policy) throw new Error('VM Docker executor dependencies are incomplete.');
  const single = (context) => {
    if (context.services.length !== 1 || context.services[0].selectedTarget !== 'vm-docker') {
      throw new DeploymentOperationError('VM Docker job must contain exactly one continuous Worker service.');
    }
    return context.services[0];
  };
  return Object.freeze({
    capabilities: Object.freeze({ mode: 'gcp-vm-docker-v1', supportedTargets: ['vm-docker'], requiresPromotion: false }),
    async apply(context) {
      const service = single(context);
      const client = clientForService(service);
      const before = await client.state();
      const source = await sourceProvider.prepare(service);
      let built;
      try { built = await imageBuilder({ context, service, source, repository: policy.cloudRun.artifactRepository }); }
      finally { source.archive.fill(0); }
      if (!/^[a-f0-9]{64}$/.test(built.imageDigest ?? '') || !built.image?.endsWith(`@sha256:${built.imageDigest}`)) {
        throw new DeploymentOperationError('VM image build did not return an immutable digest.', { indeterminate: true, status: 502 });
      }
      const revision = `${service.serviceName}-${built.imageDigest.slice(0, 12)}`;
      const envelope = await signer.sign(await desiredState({ context, service, built, before, operation: 'deploy', revision, configurationResolver }));
      try {
        const state = await client.apply(envelope);
        return {
          outcome: 'succeeded', revision: state.current.revision, artifactDigest: state.current.imageDigest,
          services: [runtimeResult(service, state, {
            previousRevision: before.current?.revision ?? null,
            previousImage: before.current?.image ?? null,
            previousImageDigest: before.current?.imageDigest ?? null,
          })],
          message: 'Signed VM desired state applied; trading remains disabled pending separate authorization.',
        };
      } catch (error) {
        if (error instanceof VmAgentClientError) throw new DeploymentOperationError(error.message, { indeterminate: error.indeterminate, status: error.status });
        throw error;
      }
    },
    async verify(context) {
      const service = single(context);
      const state = await clientForService(service).state();
      const evidence = runtimeResult(service, state);
      const layers = evidence.runtimeStatus;
      if (state.status !== 'ready' || layers.vm !== 'ready' || layers.agent !== 'ready' || layers.worker !== 'ready'
        || layers.strategy !== 'disabled' || layers.tradingEnabled !== false) {
        throw new DeploymentOperationError('VM runtime layers are not safely verified.', { status: 409 });
      }
      return { outcome: 'succeeded', revision: evidence.revision, artifactDigest: evidence.imageDigest, services: [evidence], message: 'VM, Agent and Worker are ready; Strategy and trading remain disabled.' };
    },
    async promote() { throw new DeploymentOperationError('VM Docker does not use traffic promotion.', { status: 409 }); },
    async rollback(context) {
      const service = single(context);
      const prior = context.priorRuntime?.services?.[0];
      if (!prior?.previousRevision || !prior.previousImage || !/^[a-f0-9]{64}$/.test(prior.previousImageDigest ?? '')) {
        throw new DeploymentOperationError('VM rollback requires a reviewed prior immutable image.');
      }
      const client = clientForService(service);
      const before = await client.state();
      const envelope = await signer.sign(await desiredState({
        context, service, built: {}, before, operation: 'rollback', revision: prior.previousRevision,
        imageUri: prior.previousImage, imageDigest: prior.previousImageDigest, configurationResolver,
      }));
      const state = await client.apply(envelope);
      const evidence = runtimeResult(service, state);
      return { outcome: 'succeeded', revision: evidence.revision, artifactDigest: evidence.imageDigest, services: [evidence], message: 'Previous immutable Worker image restored; persistent data was preserved.' };
    },
    async reconcile(context) {
      const service = single(context);
      const state = await clientForService(service).reconcile();
      if (state.status === 'unknown') return { outcome: 'unknown', message: state.lastError ?? 'VM state remains unknown.' };
      if (!state.current) return { outcome: 'absent', message: 'VM Agent reports no active runtime.' };
      const evidence = runtimeResult(service, state);
      return { outcome: state.status === 'ready' ? 'succeeded' : 'failed', revision: evidence.revision, artifactDigest: evidence.imageDigest, services: [evidence], message: state.lastError };
    },
  });
}
