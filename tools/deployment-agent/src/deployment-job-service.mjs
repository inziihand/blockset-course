import { createHash, randomUUID } from 'node:crypto';
import { deploymentIdentityPlan } from '../../../scripts/lib/deployment-agent-policy.mjs';
import { DeploymentLeaseError } from './lease-store.mjs';
import { DeploymentOperationError, maskDeploymentError, normalizeOperationResult } from './executor.mjs';
import { DeploymentStoreError } from './job-store.mjs';

const jobIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keyPattern = /^[a-z][a-z0-9-]*$/;
const installationKeyPattern = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;
const digestPattern = /^[a-f0-9]{64}$/;
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const transientStates = new Set(['applying', 'verifying', 'promoting', 'rolling-back']);
const forbiddenPlanFields = new Set([
  'authorization', 'credential', 'credentials', 'environmentvariables', 'password', 'privatekey',
  'secretvalue', 'token', 'value',
]);
const safeActor = (actor) => ({ uid: actor.uid, email: actor.email });
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export class DeploymentJobError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = 'DeploymentJobError';
    this.status = status;
  }
}

function assertActor(actor) {
  if (!actor?.uid || !actor?.email || !actor.permissions?.includes('deployment:manage')) {
    throw new DeploymentJobError('Deployment administrator context is invalid.', 403);
  }
}

function assertPlan(plan, { packageJobId, installationKey, appKey }) {
  if (plan?.jobId !== packageJobId
    || plan.planKind !== 'app-runtime-impact'
    || plan.mode !== 'read-only'
    || !['reviewable', 'blocked'].includes(plan.decision)
    || !digestPattern.test(plan.planFingerprint ?? '')
    || plan.installation?.installationKey !== installationKey
    || plan.package?.appKey !== appKey
    || !keyPattern.test(plan.package?.appKey ?? '')
    || !versionPattern.test(plan.package?.version ?? '')
    || !digestPattern.test(plan.package?.packageSha256 ?? '')
    || !Array.isArray(plan.services)
    || !Array.isArray(plan.blockers)
    || !Array.isArray(plan.changes?.services)
    || !Array.isArray(plan.changes?.routes)
    || !Array.isArray(plan.changes?.secretReferences)
    || !Array.isArray(plan.changes?.cloudResources)
    || !Array.isArray(plan.requirements?.deploymentAgentIamRoles)
    || !Array.isArray(plan.migrations)) {
    throw new DeploymentJobError('Normalized deployment plan does not match the requested package and installation.', 409);
  }
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (forbiddenPlanFields.has(key.replace(/[-_]/g, '').toLowerCase())) {
        throw new DeploymentJobError(`Normalized deployment plan contains a forbidden sensitive field: ${key}.`, 409);
      }
      visit(item);
    }
  };
  visit(plan);
}

function assertSettingsBindings(bindings, { installationKey, appKey }) {
  if (bindings?.schemaVersion !== 1 || bindings.installationKey !== installationKey || bindings.appKey !== appKey
    || !Number.isInteger(bindings.stateRevision) || !digestPattern.test(bindings.bindingsFingerprint ?? '')
    || !Array.isArray(bindings.configuration) || !Array.isArray(bindings.secrets) || !Array.isArray(bindings.blockers)
    || bindings.secrets.some((item) => !item.serviceKey || !item.environment || !item.secretResource
      || !/^[1-9][0-9]*$/.test(String(item.version ?? '')))) {
    throw new DeploymentJobError('Deployment settings bindings are invalid.', 409);
  }
  const serialized = JSON.stringify(bindings);
  if (/secretValue|private_key|BEGIN [A-Z ]*PRIVATE KEY|Bearer\s/i.test(serialized)) {
    throw new DeploymentJobError('Deployment settings bindings contain sensitive payload data.', 409);
  }
}

function riskConfirmations(plan) {
  const required = new Set(['cost-impact-reviewed']);
  if (plan.services.some((service) => service.publicIngress === true)) required.add('public-ingress-reviewed');
  if (plan.changes?.cloudResources?.some((item) => ['add', 'update'].includes(item.action))) required.add('cloud-resource-change-reviewed');
  if (plan.changes?.cloudResources?.some((item) => item.action === 'remove')
    || plan.changes?.services?.some((item) => item.action === 'remove')
    || plan.changes?.routes?.some((item) => item.action === 'remove')) required.add('destructive-change-reviewed');
  if (plan.migrations?.some((migration) => migration.backupRequired)) required.add('backup-plan-reviewed');
  if (plan.migrations?.some((migration) => migration.reversible === false)) required.add('irreversible-migration-reviewed');
  if (plan.services.some((service) => service.selectedTarget === 'vm-docker')) {
    required.add('vm-bootstrap-and-iam-reviewed');
    required.add('account-state-and-backup-reviewed');
    required.add('trading-remains-disabled-reviewed');
  }
  return [...required].sort();
}

function capabilityBlockers({ plan, policy, executor, identity }) {
  const blockers = [...plan.blockers];
  if (plan.decision !== 'reviewable') blockers.push('The normalized deployment plan is blocked.');
  if (plan.package.signatureStatus !== 'trusted-signed') blockers.push('Deployment Agent accepts only trusted-signed packages.');
  blockers.push(...identity.disallowedRoles.map((role) => `IAM role is outside the Deployment Agent allowlist: ${role}.`));
  blockers.push(...(plan.requirements.runtimeServiceAccountRoles ?? [])
    .filter((item) => !policy.allowedRuntimeIamRoles.includes(item.role))
    .map((item) => `Runtime IAM role is outside the Deployment Agent allowlist: ${item.serviceKey}/${item.role}.`));
  const supportedTargets = new Set(executor.capabilities?.supportedTargets ?? []);
  for (const service of plan.services) {
    if (!policy.allowedTargets.includes(service.selectedTarget)) {
      blockers.push(`Deployment target is outside the platform allowlist: ${service.selectedTarget}.`);
    } else if (!supportedTargets.has(service.selectedTarget)) {
      blockers.push(`Deployment target driver is unavailable in the active Agent: ${service.selectedTarget}.`);
    }
  }
  return [...new Set(blockers)].sort();
}

function publicJob(job) {
  return structuredClone(job);
}

function operationContext(job, operation) {
  return Object.freeze({
    jobId: job.jobId,
    operation,
    idempotencyKey: sha256(`${job.jobId}:${job.planFingerprint}:${operation}`),
    installation: Object.freeze({ ...job.installation }),
    package: Object.freeze({ ...job.package }),
    planFingerprint: job.planFingerprint,
    deployerIdentity: Object.freeze({ ...job.deployerIdentity }),
    services: Object.freeze(job.plan.services.map((service) => Object.freeze({
      serviceKey: service.serviceKey,
      dependsOn: structuredClone(service.dependsOn ?? []),
      routes: structuredClone(service.routes ?? []),
      artifact: service.artifact ? structuredClone(service.artifact) : null,
      healthPath: service.healthPath ?? '/healthz',
      readinessPath: service.readinessPath ?? service.healthPath ?? '/healthz',
      verification: structuredClone(service.verification ?? { unauthenticatedRequests: [], authenticatedRequests: [] }),
      selectedTarget: service.selectedTarget,
      region: service.region,
      serviceName: service.serviceName,
      resources: service.resources ? structuredClone(service.resources) : null,
      publicIngress: service.publicIngress,
      ingress: service.ingress ?? null,
      costTier: service.costTier ?? 'unknown',
      vm: service.vm ? structuredClone(service.vm) : null,
    }))),
    changes: Object.freeze({
      services: structuredClone(job.plan.changes.services ?? []),
      routes: structuredClone(job.plan.changes.routes ?? []),
      secretReferences: structuredClone(job.plan.changes.secretReferences ?? []),
      cloudResources: structuredClone(job.plan.changes.cloudResources ?? []),
    }),
    requirements: Object.freeze({
      configuration: structuredClone(job.plan.requirements.configuration ?? []),
      secrets: structuredClone(job.plan.requirements.secrets ?? []),
      runtimeServiceAccountRoles: structuredClone(job.plan.requirements.runtimeServiceAccountRoles ?? []),
    }),
    runtimeBindings: Object.freeze({
      stateRevision: job.settingsBindings?.stateRevision ?? 0,
      bindingsFingerprint: job.settingsBindings?.bindingsFingerprint ?? null,
      configuration: structuredClone(job.settingsBindings?.configuration ?? []),
      secrets: structuredClone(job.settingsBindings?.secrets ?? []),
    }),
    migrations: Object.freeze(structuredClone(job.plan.migrations ?? [])),
    priorRuntime: job.runtimeEvidence ? Object.freeze({ ...job.runtimeEvidence }) : null,
    priorVerification: job.verificationEvidence ? Object.freeze({ ...job.verificationEvidence }) : null,
  });
}

function evidence(job, events) {
  return {
    schemaVersion: 1,
    jobId: job.jobId,
    status: job.status,
    package: job.package,
    installation: job.installation,
    planFingerprint: job.planFingerprint,
    settingsBindingsFingerprint: job.settingsBindings?.bindingsFingerprint ?? null,
    deployerIdentity: job.deployerIdentity,
    approval: job.approval ? {
      planFingerprint: job.approval.planFingerprint,
      packageSha256: job.approval.packageSha256,
      appVersion: job.approval.appVersion,
      riskConfirmations: job.approval.riskConfirmations,
      approvedBy: job.approval.approvedBy,
      approvedAt: job.approval.approvedAt,
      expiresAt: job.approval.expiresAt,
    } : null,
    runtimeEvidence: job.runtimeEvidence ?? null,
    verificationEvidence: job.verificationEvidence ?? null,
    promotionEvidence: job.promotionEvidence ?? null,
    activationEvidence: job.activationEvidence ?? null,
    rollbackEvidence: job.rollbackEvidence ?? null,
    events: events.map(({ sequence, type, at, actor, status, planFingerprint, operationId, outcome }) => ({
      sequence, type, at, actor, status, planFingerprint, operationId, outcome,
    })),
  };
}

export function createDeploymentJobService({
  store,
  leases,
  planProvider,
  executor,
  policy,
  installationProvider,
  settingsProvider,
  lifecycleProvider,
  now = () => new Date(),
  operationTimeoutMs = policy?.limits?.operationTimeoutSeconds * 1000,
} = {}) {
  if (!store || !leases || !planProvider || !executor || !policy || !installationProvider) {
    throw new Error('Deployment Job Service requires store, leases, planProvider, executor, policy and installationProvider.');
  }
  const serial = new Map();

  function assertOperationAllowed(operation) {
    if (!policy.allowedOperations.includes(operation)) {
      throw new DeploymentJobError(`Deployment operation is not allowed by policy: ${operation}.`, 403);
    }
  }

  async function withJobLock(jobId, operation) {
    if (!jobIdPattern.test(jobId ?? '')) throw new DeploymentJobError('Invalid deployment job id.', 404);
    const previous = serial.get(jobId) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    serial.set(jobId, tail);
    await previous;
    try { return await operation(); }
    finally { release(); if (serial.get(jobId) === tail) serial.delete(jobId); }
  }

  async function append(job, type, actor, extra = {}) {
    if (!Array.isArray(job.events) || job.events.length >= policy.limits.maxEventsPerJob) {
      throw new DeploymentJobError('Deployment job event capacity is exhausted.', 507);
    }
    const timestamp = now().toISOString();
    const event = {
      sequence: job.nextEventSequence,
      type,
      at: timestamp,
      actor: actor ? safeActor(actor) : { uid: 'system', email: null },
      status: job.status,
      planFingerprint: job.planFingerprint,
      ...extra,
    };
    const next = {
      ...job,
      revision: job.revision + 1,
      nextEventSequence: job.nextEventSequence + 1,
      updatedAt: timestamp,
      events: [...job.events, event],
    };
    await store.write(next);
    return next;
  }

  async function runWithLease(job, operation, actor, execute) {
    let lease;
    let heartbeat;
    let preserveForReconciliation = false;
    try {
      lease = await leases.acquire({ installationKey: job.installation.installationKey, jobId: job.jobId, operation });
      heartbeat = setInterval(() => { leases.heartbeat(lease).catch(() => {}); }, Math.max(5_000, policy.limits.leaseSeconds * 1000 / 3));
      heartbeat.unref?.();
      let timeoutHandle;
      const timeout = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new DeploymentOperationError('Deployment operation timed out.', { indeterminate: true, status: 504 })), operationTimeoutMs);
      });
      try {
        const result = await Promise.race([execute(operationContext(job, operation)), timeout]);
        preserveForReconciliation = result?.outcome === 'unknown';
        return result;
      } catch (error) {
        preserveForReconciliation = error instanceof DeploymentOperationError && error.indeterminate;
        throw error;
      }
      finally { clearTimeout(timeoutHandle); }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (lease && preserveForReconciliation) await leases.holdForReconciliation(lease);
      else if (lease) await leases.release(lease);
    }
  }

  async function buildJobPlan({ packageJobId, installationKey, appKey, token, actor }) {
    if (!jobIdPattern.test(packageJobId ?? '')) throw new DeploymentJobError('Invalid package job id.');
    if (!installationKeyPattern.test(installationKey ?? '')) throw new DeploymentJobError('Invalid installation key.');
    if (!keyPattern.test(appKey ?? '')) throw new DeploymentJobError('Invalid App key.');
    const [plan, installation] = await Promise.all([
      planProvider({ packageJobId, installationKey, token }),
      installationProvider(installationKey),
    ]);
    assertPlan(plan, { packageJobId, installationKey, appKey });
    if (plan.installation.projectId !== installation.gcpProjectId
      || plan.installation.region !== installation.region) {
      throw new DeploymentJobError('Normalized deployment plan does not match the installation project or region.', 409);
    }
    const requiredRoles = plan.requirements.deploymentAgentIamRoles.map((item) => item.role);
    const identity = deploymentIdentityPlan({ installation, policy, requiredRoles });
    let settingsBindings = null;
    if (settingsProvider) {
      settingsBindings = await settingsProvider({ installationKey, appKey, actor });
      assertSettingsBindings(settingsBindings, { installationKey, appKey });
    }
    const blockers = capabilityBlockers({ plan, policy, executor, identity });
    if (settingsBindings) blockers.push(...settingsBindings.blockers);
    const planFingerprint = settingsBindings
      ? sha256(`${plan.planFingerprint}:${settingsBindings.bindingsFingerprint}`)
      : plan.planFingerprint;
    return { plan, installation, identity, blockers: [...new Set(blockers)].sort(), settingsBindings, planFingerprint };
  }

  async function refreshPlan(job, { token, actor }) {
    const built = await buildJobPlan({
      packageJobId: job.packageJobId,
      installationKey: job.installation.installationKey,
      appKey: job.appKey,
      token,
      actor,
    });
    if (built.plan.package.packageSha256 !== job.package.packageSha256
      || built.plan.package.version !== job.package.version) {
      throw new DeploymentJobError('Package identity changed after Deployment Agent inspection.', 409);
    }
    const changed = built.planFingerprint !== job.planFingerprint;
    const next = {
      ...job,
      status: built.blockers.length > 0 ? 'blocked' : 'awaiting-approval',
      planFingerprint: built.planFingerprint,
      plan: built.plan,
      settingsBindings: built.settingsBindings,
      blockers: built.blockers,
      requiredRiskConfirmations: riskConfirmations(built.plan),
      deployerIdentity: built.identity,
      approval: null,
      lastError: null,
    };
    return append(next, changed ? 'plan.changed' : 'plan.refreshed', actor);
  }

  async function reconcileUnknown(job, actor) {
    const operation = job.lastOperation?.type ?? 'apply';
    const result = normalizeOperationResult(await runWithLease(job, 'reconcile', actor, (context) => (
      executor.reconcile({ ...context, reconcileOperation: operation })
    )));
    let status = 'unknown';
    let approval = job.approval;
    if (result.outcome === 'succeeded') {
      status = operation === 'rollback' ? 'rolled-back'
        : operation === 'promote' ? 'verified'
          : operation === 'verify' ? executor.capabilities?.requiresPromotion === true ? 'staged-verified' : 'verified'
            : 'applied';
    } else if (result.outcome === 'absent' && operation === 'apply') {
      status = 'awaiting-approval';
      approval = null;
    } else if (result.outcome === 'failed') {
      status = operation === 'rollback' ? 'rollback-failed' : operation === 'verify' ? 'verification-failed' : 'failed';
    }
    const next = { ...job, status, approval, lastError: result.message, runtimeEvidence: result.revision ? result : job.runtimeEvidence };
    return append(next, 'operation.reconciled', actor, {
      operationId: job.lastOperation?.idempotencyKey ?? null,
      outcome: result.outcome,
    });
  }

  return {
    policy() {
      return {
        credentialMode: policy.credentialMode,
        allowServiceAccountKeys: false,
        allowedTargets: policy.allowedTargets,
        executorMode: executor.capabilities?.mode ?? 'unknown',
        requiresPromotion: executor.capabilities?.requiresPromotion === true,
        operationTimeoutSeconds: policy.limits.operationTimeoutSeconds,
        approvalTtlSeconds: policy.limits.approvalTtlSeconds,
      };
    },

    async listJobs() {
      return (await store.list(50)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map(publicJob);
    },

    async getJob(jobId) {
      try { return publicJob(await store.read(jobId)); }
      catch (error) { if (error instanceof DeploymentStoreError) throw new DeploymentJobError(error.message, error.status); throw error; }
    },

    async inspect({ packageJobId, installationKey, appKey, token, actor }) {
      assertOperationAllowed('inspect');
      assertActor(actor);
      if (!actor.permissions.includes(`app:${appKey}:access`)) throw new DeploymentJobError('App access permission is required.', 403);
      const built = await buildJobPlan({ packageJobId, installationKey, appKey, token, actor });
      const createdAt = now().toISOString();
      const job = {
        schemaVersion: 1,
        jobId: randomUUID(),
        revision: 1,
        nextEventSequence: 2,
        packageJobId,
        appKey,
        status: built.blockers.length > 0 ? 'blocked' : 'awaiting-approval',
        package: {
          appKey,
          version: built.plan.package.version,
          packageSha256: built.plan.package.packageSha256,
          signatureStatus: built.plan.package.signatureStatus,
          publisherId: built.plan.package.publisherId,
          keyId: built.plan.package.keyId,
        },
        installation: {
          installationKey,
          projectId: built.installation.gcpProjectId,
          region: built.installation.region,
        },
        planFingerprint: built.planFingerprint,
        plan: built.plan,
        settingsBindings: built.settingsBindings,
        deployerIdentity: built.identity,
        requiredRiskConfirmations: riskConfirmations(built.plan),
        blockers: built.blockers,
        approval: null,
        runtimeEvidence: null,
        verificationEvidence: null,
        rollbackEvidence: null,
        activationEvidence: null,
        lastOperation: null,
        lastError: null,
        createdAt,
        updatedAt: createdAt,
        createdBy: safeActor(actor),
        events: [{
          sequence: 1,
          type: 'job.inspected',
          at: createdAt,
          actor: safeActor(actor),
          status: built.blockers.length > 0 ? 'blocked' : 'awaiting-approval',
          planFingerprint: built.planFingerprint,
        }],
      };
      await store.create(job);
      return publicJob(job);
    },

    async plan({ jobId, token, actor }) {
      assertOperationAllowed('plan');
      assertActor(actor);
      return withJobLock(jobId, async () => {
        const job = await store.read(jobId);
        if (['cancelled', 'rolled-back'].includes(job.status)) {
          throw new DeploymentJobError('Terminal deployment jobs cannot be reopened; create a new job from the source package.', 409);
        }
        return publicJob(await refreshPlan(job, { token, actor }));
      });
    },

    async approve({ jobId, confirmation, planFingerprint, packageSha256, appVersion, riskConfirmations: confirmed, expiresInSeconds, actor }) {
      assertOperationAllowed('approve');
      assertActor(actor);
      return withJobLock(jobId, async () => {
        let job = await store.read(jobId);
        if (job.status !== 'awaiting-approval' || job.blockers.length > 0) throw new DeploymentJobError('Deployment job is not ready for approval.', 409);
        const expected = `APPROVE ${job.appKey}@${job.package.version} ${job.planFingerprint}`;
        if (confirmation !== expected
          || planFingerprint !== job.planFingerprint
          || packageSha256 !== job.package.packageSha256
          || appVersion !== job.package.version) {
          throw new DeploymentJobError(`Approval must match the current immutable plan: ${expected}`, 409);
        }
        const actualRisks = [...new Set(Array.isArray(confirmed) ? confirmed : [])].sort();
        if (JSON.stringify(actualRisks) !== JSON.stringify(job.requiredRiskConfirmations)) {
          throw new DeploymentJobError('Approval must confirm the exact current risk set.', 409);
        }
        const ttl = expiresInSeconds ?? policy.limits.approvalTtlSeconds;
        if (!Number.isInteger(ttl) || ttl < 60 || ttl > policy.limits.approvalTtlSeconds) {
          throw new DeploymentJobError(`Approval expiry must be between 60 and ${policy.limits.approvalTtlSeconds} seconds.`);
        }
        const approvedAt = now();
        job = {
          ...job,
          status: 'approved',
          approval: {
            planFingerprint: job.planFingerprint,
            packageSha256: job.package.packageSha256,
            appVersion: job.package.version,
            riskConfirmations: actualRisks,
            approvedBy: safeActor(actor),
            approvedAt: approvedAt.toISOString(),
            expiresAt: new Date(approvedAt.getTime() + ttl * 1000).toISOString(),
          },
        };
        return publicJob(await append(job, 'job.approved', actor));
      });
    },

    async apply({ jobId, token, actor }) {
      assertOperationAllowed('apply');
      assertActor(actor);
      return withJobLock(jobId, async () => {
        let job = await store.read(jobId);
        if (job.status === 'unknown') return publicJob(await reconcileUnknown(job, actor));
        if (job.status !== 'approved') throw new DeploymentJobError('Deployment job is not approved for apply.', 409);
        if (!job.approval || new Date(job.approval.expiresAt).getTime() <= now().getTime()) {
          job = await append({ ...job, status: 'awaiting-approval', approval: null }, 'approval.expired', actor);
          throw new DeploymentJobError('Deployment approval expired; refresh and approve the plan again.', 409);
        }
        const built = await buildJobPlan({
          packageJobId: job.packageJobId,
          installationKey: job.installation.installationKey,
          appKey: job.appKey,
          token,
          actor,
        });
        if (built.planFingerprint !== job.planFingerprint || built.blockers.length > 0) {
          const invalidated = {
            ...job,
            status: built.blockers.length > 0 ? 'blocked' : 'awaiting-approval',
            planFingerprint: built.planFingerprint,
            plan: built.plan,
            settingsBindings: built.settingsBindings,
            blockers: built.blockers,
            approval: null,
            requiredRiskConfirmations: riskConfirmations(built.plan),
            deployerIdentity: built.identity,
          };
          await append(invalidated, 'approval.invalidated', actor);
          throw new DeploymentJobError('Deployment plan changed after approval; review and approve the new plan.', 409);
        }
        const idempotencyKey = sha256(`${job.jobId}:${job.planFingerprint}:apply`);
        job = await append({ ...job, status: 'applying', lastOperation: { type: 'apply', idempotencyKey, startedAt: now().toISOString() } }, 'operation.started', actor, { operationId: idempotencyKey });
        try {
          const result = normalizeOperationResult(await runWithLease(job, 'apply', actor, (context) => executor.apply(context)));
          const status = result.outcome === 'succeeded' ? 'applied' : result.outcome === 'unknown' ? 'unknown' : 'failed';
          job = { ...job, status, runtimeEvidence: result.outcome === 'succeeded' ? { ...result, appliedAt: now().toISOString() } : job.runtimeEvidence, lastError: result.message };
          return publicJob(await append(job, 'operation.completed', actor, { operationId: idempotencyKey, outcome: result.outcome }));
        } catch (error) {
          const unknown = error instanceof DeploymentOperationError && error.indeterminate;
          job = { ...job, status: unknown ? 'unknown' : 'failed', lastError: maskDeploymentError(error, 'Deployment apply failed.') };
          await append(job, 'operation.failed', actor, { operationId: idempotencyKey, outcome: unknown ? 'unknown' : 'failed' });
          throw new DeploymentJobError(job.lastError, Number(error?.status) || 409);
        }
      });
    },

    async verify({ jobId, actor, token }) {
      assertOperationAllowed('verify');
      assertActor(actor);
      return withJobLock(jobId, async () => {
        let job = await store.read(jobId);
        if (job.status === 'unknown') return publicJob(await reconcileUnknown(job, actor));
        if (!['applied', 'verification-failed'].includes(job.status)) throw new DeploymentJobError('Deployment job is not ready for verification.', 409);
        const idempotencyKey = sha256(`${job.jobId}:${job.planFingerprint}:verify`);
        job = await append({ ...job, status: 'verifying', lastOperation: { type: 'verify', idempotencyKey, startedAt: now().toISOString() } }, 'verification.started', actor, { operationId: idempotencyKey });
        try {
          const result = normalizeOperationResult(await runWithLease(job, 'verify', actor, (context) => executor.verify({ ...context, verificationToken: token })));
          const status = result.outcome === 'succeeded'
            ? executor.capabilities?.requiresPromotion === true ? 'staged-verified' : 'verified'
            : result.outcome === 'unknown' ? 'unknown' : 'verification-failed';
          job = { ...job, status, verificationEvidence: result.outcome === 'succeeded' ? { ...result, verifiedAt: now().toISOString() } : job.verificationEvidence, lastError: result.message };
          return publicJob(await append(job, 'verification.completed', actor, { operationId: idempotencyKey, outcome: result.outcome }));
        } catch (error) {
          const unknown = error instanceof DeploymentOperationError && error.indeterminate;
          job = { ...job, status: unknown ? 'unknown' : 'verification-failed', lastError: maskDeploymentError(error, 'Deployment verification failed.') };
          await append(job, 'verification.failed', actor, { operationId: idempotencyKey, outcome: unknown ? 'unknown' : 'failed' });
          throw new DeploymentJobError(job.lastError, Number(error?.status) || 409);
        }
      });
    },

    async promote({ jobId, confirmation, actor }) {
      assertOperationAllowed('promote');
      assertActor(actor);
      if (typeof executor.promote !== 'function') throw new DeploymentJobError('Traffic promotion is unavailable.', 501);
      return withJobLock(jobId, async () => {
        let job = await store.read(jobId);
        if (job.status === 'unknown') return publicJob(await reconcileUnknown(job, actor));
        if (!['staged-verified', 'promotion-failed'].includes(job.status) || !job.verificationEvidence) {
          throw new DeploymentJobError('Deployment job must pass staged verification before promotion.', 409);
        }
        const expected = `PROMOTE ${job.appKey}@${job.package.version} ${job.planFingerprint.slice(0, 12)}`;
        if (confirmation !== expected) throw new DeploymentJobError(`Traffic promotion requires exact confirmation: ${expected}`, 409);
        const idempotencyKey = sha256(`${job.jobId}:${job.planFingerprint}:promote`);
        job = await append({ ...job, status: 'promoting', lastOperation: { type: 'promote', idempotencyKey, startedAt: now().toISOString() } }, 'promotion.started', actor, { operationId: idempotencyKey });
        try {
          const result = normalizeOperationResult(await runWithLease(job, 'promote', actor, (context) => executor.promote(context)));
          const status = result.outcome === 'succeeded' ? 'verified' : result.outcome === 'unknown' ? 'unknown' : 'promotion-failed';
          job = { ...job, status, promotionEvidence: result.outcome === 'succeeded' ? { ...result, promotedAt: now().toISOString() } : job.promotionEvidence, lastError: result.message };
          return publicJob(await append(job, 'promotion.completed', actor, { operationId: idempotencyKey, outcome: result.outcome }));
        } catch (error) {
          const unknown = error instanceof DeploymentOperationError && error.indeterminate;
          job = { ...job, status: unknown ? 'unknown' : 'promotion-failed', lastError: maskDeploymentError(error, 'Deployment promotion failed.') };
          await append(job, 'promotion.failed', actor, { operationId: idempotencyKey, outcome: unknown ? 'unknown' : 'failed' });
          throw new DeploymentJobError(job.lastError, Number(error?.status) || 409);
        }
      });
    },

    async rollback({ jobId, confirmation, actor }) {
      assertOperationAllowed('rollback');
      assertActor(actor);
      return withJobLock(jobId, async () => {
        let job = await store.read(jobId);
        if (job.status === 'unknown') return publicJob(await reconcileUnknown(job, actor));
        if (!['applied', 'staged-verified', 'verified', 'verification-failed', 'promotion-failed', 'failed', 'rollback-failed'].includes(job.status) || !job.runtimeEvidence?.revision) {
          throw new DeploymentJobError('Deployment job has no reviewed runtime revision to roll back.', 409);
        }
        const expected = `ROLLBACK ${job.appKey}@${job.package.version} ${job.runtimeEvidence.revision}`;
        if (confirmation !== expected) throw new DeploymentJobError(`Rollback requires exact confirmation: ${expected}`, 409);
        const idempotencyKey = sha256(`${job.jobId}:${job.planFingerprint}:rollback:${job.runtimeEvidence.revision}`);
        job = await append({ ...job, status: 'rolling-back', lastOperation: { type: 'rollback', idempotencyKey, startedAt: now().toISOString() } }, 'rollback.started', actor, { operationId: idempotencyKey });
        try {
          const result = normalizeOperationResult(await runWithLease(job, 'rollback', actor, (context) => executor.rollback(context)));
          const status = result.outcome === 'succeeded' ? 'rolled-back' : result.outcome === 'unknown' ? 'unknown' : 'rollback-failed';
          job = { ...job, status, rollbackEvidence: result.outcome === 'succeeded' ? { ...result, rolledBackAt: now().toISOString() } : job.rollbackEvidence, lastError: result.message };
          return publicJob(await append(job, 'rollback.completed', actor, { operationId: idempotencyKey, outcome: result.outcome }));
        } catch (error) {
          const unknown = error instanceof DeploymentOperationError && error.indeterminate;
          job = { ...job, status: unknown ? 'unknown' : 'rollback-failed', lastError: maskDeploymentError(error, 'Deployment rollback failed.') };
          await append(job, 'rollback.failed', actor, { operationId: idempotencyKey, outcome: unknown ? 'unknown' : 'failed' });
          throw new DeploymentJobError(job.lastError, Number(error?.status) || 409);
        }
      });
    },

    async reconcile({ jobId, actor }) {
      assertOperationAllowed('reconcile');
      assertActor(actor);
      return withJobLock(jobId, async () => {
        const job = await store.read(jobId);
        if (job.status !== 'unknown' && !transientStates.has(job.status)) throw new DeploymentJobError('Deployment job does not require reconciliation.', 409);
        return publicJob(await reconcileUnknown(job, actor));
      });
    },

    async cancel({ jobId, actor }) {
      assertOperationAllowed('cancel');
      assertActor(actor);
      return withJobLock(jobId, async () => {
        const job = await store.read(jobId);
        if (!['blocked', 'awaiting-approval', 'approved'].includes(job.status)) {
          throw new DeploymentJobError(
            'Only a job without external writes can be cancelled; use reconcile or reviewed rollback after deployment starts.',
            409,
          );
        }
        return publicJob(await append({ ...job, status: 'cancelled', approval: null }, 'job.cancelled', actor));
      });
    },

    async activate({ jobId, confirmation, token, actor }) {
      assertOperationAllowed('activate');
      assertActor(actor);
      if (!lifecycleProvider) throw new DeploymentJobError('Identity lifecycle provider is unavailable.', 503);
      return withJobLock(jobId, async () => {
        let job = await store.read(jobId);
        if (job.status !== 'verified' || !job.runtimeEvidence?.revision || !job.verificationEvidence?.verifiedAt) {
          throw new DeploymentJobError('Every required runtime service must be deployed and verified before App activation.', 409);
        }
        const expected = `ENABLE ${job.appKey}@${job.package.version}`;
        if (confirmation !== expected) {
          throw new DeploymentJobError(`App activation requires exact confirmation: ${expected}`, 409);
        }
        const manifest = job.plan.app ?? {};
        if (manifest.protected === true) throw new DeploymentJobError('Protected platform Apps cannot be activated from a package.', 403);
        const activation = {
          displayName: manifest.displayName ?? job.appKey,
          category: manifest.category ?? 'application',
          removable: manifest.removable !== false,
          protected: false,
          requiredServices: manifest.requiredServices ?? job.plan.services.map((service) => service.serviceKey),
          defaultAccessMode: manifest.defaultAccessMode ?? 'admins_only',
          allowedAccessModes: manifest.allowedAccessModes ?? ['admins_only'],
          entitlements: manifest.entitlements ?? [],
          adminAllowed: manifest.adminAllowed !== false,
          deploymentJobId: job.jobId,
          planFingerprint: job.planFingerprint,
          runtimeRevision: job.promotionEvidence?.revision ?? job.verificationEvidence.revision ?? job.runtimeEvidence.revision,
          verifiedAt: job.verificationEvidence.verifiedAt,
        };
        const installed = await lifecycleProvider.activate({ appKey: job.appKey, token, activation });
        job = {
          ...job,
          activationEvidence: {
            activatedAt: now().toISOString(),
            appKey: installed.appKey ?? job.appKey,
            status: installed.status ?? 'installed',
            runtimeRevision: installed.runtimeRevision ?? activation.runtimeRevision,
          },
          lastError: null,
        };
        return publicJob(await append(job, 'app.activated', actor));
      });
    },

    async events(jobId) {
      return structuredClone((await store.read(jobId)).events);
    },

    async evidence(jobId) {
      const job = await store.read(jobId);
      return evidence(job, job.events);
    },

    async recover() {
      const jobs = await store.list(100);
      const recovered = [];
      for (const job of jobs.filter((item) => item.status === 'unknown' || transientStates.has(item.status))) {
        const lease = await leases.read(job.installation.installationKey);
        if (lease && lease.uncertain !== true && new Date(lease.expiresAt).getTime() > now().getTime()) continue;
        try {
          const result = await withJobLock(job.jobId, () => reconcileUnknown(job, null));
          recovered.push({ jobId: job.jobId, status: result.status });
        } catch (error) {
          if (error instanceof DeploymentLeaseError) continue;
          const failed = await append({ ...job, status: 'unknown', lastError: 'Automatic recovery could not establish the external state.' }, 'recovery.deferred', null, { outcome: 'unknown' });
          recovered.push({ jobId: failed.jobId, status: failed.status });
        }
      }
      return recovered;
    },
  };
}
