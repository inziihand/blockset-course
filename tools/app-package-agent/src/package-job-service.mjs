import { randomUUID } from 'node:crypto';
import { access, copyFile, mkdir, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createAppDeploymentImpactPlan } from '../../../scripts/lib/app-deployment-impact-plan.mjs';
import { installAppPackage, planAppPackageInstall } from '../../../scripts/lib/app-installer.mjs';
import { validateInstalledApp } from '../../../scripts/lib/app-validation.mjs';

const MAX_PACKAGE_BYTES = 256 * 1024 * 1024;
const jobIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const installationKeyPattern = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

export class PackageJobError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = 'PackageJobError';
    this.status = status;
  }
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

async function pathExists(path) {
  try { await access(path); return true; } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function safePackageName(value) {
  const name = basename(String(value ?? ''));
  if (name !== value || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/i.test(name)) {
    throw new PackageJobError('Package file name must be a simple .zip name.');
  }
  return name;
}

async function writeJob(path, job) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, json(job), 'utf8');
}

function publicJob(job) {
  const { artifactPath: _artifactPath, ...visible } = job;
  return visible;
}

export function createPackageJobService({
  rootPath,
  stateRoot = resolve(rootPath, '.stratexec', 'app-package-agent'),
  allowUnsignedApply = false,
  now = () => new Date(),
  inventoryProvider,
  validateInstall = ({ rootPath: installedRoot, plan }) => validateInstalledApp({
    rootPath: installedRoot,
    appKey: plan.appKey,
  }),
} = {}) {
  if (!rootPath) throw new Error('Package Job Service requires a repository root.');
  const repositoryRoot = resolve(rootPath);
  const jobsRoot = join(stateRoot, 'jobs');
  const quarantineRoot = join(stateRoot, 'quarantine');
  const artifactsRoot = join(stateRoot, 'artifacts');
  const applyLockPath = join(stateRoot, 'apply.lock');
  const inventoryRoot = resolve(repositoryRoot, '.stratexec', 'deployment-inventory');
  const jobPath = (jobId) => {
    if (!jobIdPattern.test(jobId)) throw new PackageJobError('Invalid package job id.', 404);
    return join(jobsRoot, `${jobId}.json`);
  };

  async function readJob(jobId) {
    try { return JSON.parse(await readFile(jobPath(jobId), 'utf8')); }
    catch (error) {
      if (error instanceof PackageJobError) throw error;
      if (error?.code === 'ENOENT') throw new PackageJobError('Package job was not found.', 404);
      throw error;
    }
  }

  async function loadInstallation(installationKey) {
    if (!installationKeyPattern.test(installationKey ?? '')) {
      throw new PackageJobError('Invalid installation key.');
    }
    try {
      return JSON.parse(await readFile(
        join(repositoryRoot, 'infrastructure', 'environments', `${installationKey}.json`),
        'utf8',
      ));
    } catch (error) {
      if (error?.code === 'ENOENT') throw new PackageJobError('Installation configuration was not found.', 404);
      throw error;
    }
  }

  async function loadInventory({ installation, job }) {
    if (inventoryProvider) return inventoryProvider({ installation, job });
    const inventoryPath = join(inventoryRoot, `${installation.installationKey}.json`);
    try {
      return JSON.parse(await readFile(inventoryPath, 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      return {
        schemaVersion: 1,
        installationKey: installation.installationKey,
        projectId: installation.gcpProjectId,
        observedAt: job.createdAt,
        collectionStatus: 'unavailable',
        collector: { mode: 'unavailable', principal: null },
        enabledApis: [],
        grantedIamRoles: [],
        resources: [],
        hostingRoutes: [],
        secrets: [],
        errors: ['No read-only cloud inventory snapshot is available.'],
      };
    }
  }

  return {
    policy() {
      return {
        bindScope: 'loopback-only',
        signaturePolicy: 'trusted-signed-or-explicit-development-unsigned',
        allowUnsignedApply,
        maxPackageBytes: MAX_PACKAGE_BYTES,
      };
    },

    async listJobs() {
      await mkdir(jobsRoot, { recursive: true });
      const files = (await readdir(jobsRoot)).filter((name) => name.endsWith('.json'));
      const recent = await Promise.all(files.map(async (name) => ({
        name,
        modifiedAt: (await stat(join(jobsRoot, name))).mtimeMs,
      })));
      recent.sort((left, right) => right.modifiedAt - left.modifiedAt);
      const jobs = await Promise.all(recent.slice(0, 50).map(async ({ name }) => (
        JSON.parse(await readFile(join(jobsRoot, name), 'utf8'))
      )));
      return jobs.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map(publicJob);
    },

    async inspect({ content, fileName, actor, adoptExisting = false, allowDowngrade = false }) {
      if (!Buffer.isBuffer(content) || content.byteLength === 0) {
        throw new PackageJobError('App package ZIP is empty.');
      }
      if (content.byteLength > MAX_PACKAGE_BYTES) {
        throw new PackageJobError('App package ZIP exceeds 256 MiB.', 413);
      }
      const normalizedName = safePackageName(fileName);
      const jobId = randomUUID();
      const quarantinePath = join(quarantineRoot, `${jobId}-${normalizedName}`);
      await mkdir(quarantineRoot, { recursive: true });
      await writeFile(quarantinePath, content, { flag: 'wx' });
      try {
        const plan = await planAppPackageInstall({
          zipPath: quarantinePath,
          rootPath: repositoryRoot,
          adoptExisting: Boolean(adoptExisting),
          allowDowngrade: Boolean(allowDowngrade),
        });
        await mkdir(artifactsRoot, { recursive: true });
        const artifactPath = join(artifactsRoot, `${plan.packageSha256}.zip`);
        if (!(await pathExists(artifactPath))) await copyFile(quarantinePath, artifactPath);
        const trusted = plan.verification.signatureStatus === 'trusted-signed';
        const developmentUnsigned = plan.verification.signatureStatus === 'development-unsigned';
        const policyBlockers = plan.status === 'no-op' || trusted || (developmentUnsigned && allowUnsignedApply)
          ? []
          : ['Development-unsigned package apply is disabled by the local Package Agent policy.'];
        const blockers = [...plan.blockers, ...policyBlockers];
        const createdAt = now().toISOString();
        const job = {
          schemaVersion: 1,
          jobId,
          fileName: normalizedName,
          status: plan.status === 'no-op' ? 'no-op' : blockers.length > 0 ? 'blocked' : 'ready',
          appKey: plan.appKey,
          version: plan.version,
          previousVersion: plan.previousVersion,
          installStatus: plan.status,
          packageSha256: plan.packageSha256,
          planFingerprint: plan.planFingerprint,
          planContext: plan.planContext,
          signatureStatus: plan.verification.signatureStatus,
          publisherId: plan.verification.publisherId,
          keyId: plan.verification.keyId,
          signedContentDigest: plan.verification.signedContentDigest,
          applyAllowed: plan.status !== 'no-op' && blockers.length === 0,
          confirmation: `${plan.appKey}@${plan.version}`,
          blockers,
          changes: plan.changes,
          options: { adoptExisting: Boolean(adoptExisting), allowDowngrade: Boolean(allowDowngrade) },
          createdAt,
          updatedAt: createdAt,
          createdBy: actor,
          artifactPath,
        };
        await writeJob(jobPath(jobId), job);
        return publicJob(job);
      } finally {
        await rm(quarantinePath, { force: true });
      }
    },

    async planDeployment({ jobId, installationKey }) {
      const job = await readJob(jobId);
      const installation = await loadInstallation(installationKey);
      const inventory = await loadInventory({ installation, job });
      const plan = await createAppDeploymentImpactPlan({
        zipPath: job.artifactPath,
        rootPath: repositoryRoot,
        installation,
        inventory,
        adoptExisting: job.options.adoptExisting,
        allowDowngrade: job.options.allowDowngrade,
      });
      if (plan.package.packageSha256 !== job.packageSha256
        || plan.package.appKey !== job.appKey || plan.package.version !== job.version) {
        throw new PackageJobError('Stored package artifact no longer matches its inspected job.', 409);
      }
      return { jobId: job.jobId, ...plan };
    },

    async apply({ jobId, confirmation, actor }) {
      let job = await readJob(jobId);
      if (job.status !== 'ready' || job.applyAllowed !== true) {
        throw new PackageJobError('Package job is not ready to apply.', 409);
      }
      if (job.signatureStatus === 'development-unsigned' && !allowUnsignedApply) {
        throw new PackageJobError('Development-unsigned package apply is disabled by the current Package Agent policy.', 403);
      }
      if (confirmation !== job.confirmation) {
        throw new PackageJobError(`Apply requires exact confirmation: ${job.confirmation}`);
      }
      await mkdir(stateRoot, { recursive: true });
      let lock;
      try {
        lock = await open(applyLockPath, 'wx');
        await lock.writeFile(json({ jobId, actor, acquiredAt: now().toISOString() }), 'utf8');
      } catch (error) {
        if (error?.code === 'EEXIST') throw new PackageJobError('Another App package apply job is active.', 409);
        throw error;
      }
      try {
        job = { ...job, status: 'applying', applyAllowed: false, updatedAt: now().toISOString(), appliedBy: actor };
        await writeJob(jobPath(jobId), job);
        const expectedArtifactPath = join(artifactsRoot, `${job.packageSha256}.zip`);
        if (resolve(job.artifactPath) !== resolve(expectedArtifactPath)) {
          throw new PackageJobError('Stored package artifact path differs from its inspected digest.', 409);
        }
        const plan = await planAppPackageInstall({
          zipPath: job.artifactPath,
          rootPath: repositoryRoot,
          adoptExisting: job.options.adoptExisting,
          allowDowngrade: job.options.allowDowngrade,
        });
        if (plan.packageSha256 !== job.packageSha256 || plan.appKey !== job.appKey || plan.version !== job.version) {
          throw new PackageJobError('Stored package artifact no longer matches its inspected job.', 409);
        }
        if (plan.planFingerprint !== job.planFingerprint) {
          throw new PackageJobError('Repository changed after package inspection; inspect the ZIP again.', 409);
        }
        const result = await installAppPackage({
          zipPath: job.artifactPath,
          rootPath: repositoryRoot,
          apply: true,
          confirmation,
          adoptExisting: job.options.adoptExisting,
          allowDowngrade: job.options.allowDowngrade,
          expectedPlanFingerprint: job.planFingerprint,
          postApply: validateInstall,
        });
        job = {
          ...job,
          status: result.applied ? 'succeeded' : 'no-op',
          applyAllowed: false,
          updatedAt: now().toISOString(),
          result,
        };
        await writeJob(jobPath(jobId), job);
        return publicJob(job);
      } catch (error) {
        job = {
          ...job,
          status: 'failed',
          applyAllowed: false,
          updatedAt: now().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown package apply failure.',
        };
        await writeJob(jobPath(jobId), job);
        if (error instanceof PackageJobError) throw error;
        throw new PackageJobError(`App package apply failed and was rolled back: ${job.error}`, 409);
      } finally {
        await lock?.close();
        await rm(applyLockPath, { force: true });
      }
    },
  };
}
