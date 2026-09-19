import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const installationKeyPattern = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

export class DeploymentLeaseError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.name = 'DeploymentLeaseError';
    this.status = status;
  }
}

export function createDeploymentLeaseStore({ stateRoot, leaseSeconds = 60, now = () => new Date() } = {}) {
  if (!stateRoot) throw new Error('Deployment lease store requires stateRoot.');
  const leasesRoot = join(stateRoot, 'leases');
  const leasePath = (installationKey) => {
    if (!installationKeyPattern.test(installationKey ?? '')) throw new DeploymentLeaseError('Invalid installation key.', 422);
    return join(leasesRoot, `${installationKey}.json`);
  };

  async function read(installationKey) {
    try { return JSON.parse(await readFile(leasePath(installationKey), 'utf8')); }
    catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
  }

  async function acquire({ installationKey, jobId, operation }) {
    await mkdir(leasesRoot, { recursive: true });
    const path = leasePath(installationKey);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const acquiredAt = now();
      const lease = {
        schemaVersion: 1,
        token: randomUUID(),
        installationKey,
        jobId,
        operation,
        acquiredAt: acquiredAt.toISOString(),
        heartbeatAt: acquiredAt.toISOString(),
        expiresAt: new Date(acquiredAt.getTime() + leaseSeconds * 1000).toISOString(),
      };
      try {
        const handle = await open(path, 'wx');
        await handle.writeFile(json(lease), 'utf8');
        await handle.close();
        return lease;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const existing = await read(installationKey);
        if (existing?.uncertain === true) {
          if (existing.jobId === jobId && operation === 'reconcile') {
            await rm(path, { force: true });
            continue;
          }
          throw new DeploymentLeaseError(`Installation ${installationKey} is blocked pending UNKNOWN reconciliation.`);
        }
        if (existing && new Date(existing.expiresAt).getTime() > now().getTime()) {
          throw new DeploymentLeaseError(`Installation ${installationKey} is leased by another deployment job.`);
        }
        await rm(path, { force: true });
      }
    }
    throw new DeploymentLeaseError(`Could not acquire the ${installationKey} deployment lease.`);
  }

  async function heartbeat(lease) {
    const current = await read(lease.installationKey);
    if (!current || current.token !== lease.token || current.jobId !== lease.jobId) {
      throw new DeploymentLeaseError('Deployment lease ownership was lost.', 409);
    }
    const heartbeatAt = now();
    const next = {
      ...current,
      heartbeatAt: heartbeatAt.toISOString(),
      expiresAt: new Date(heartbeatAt.getTime() + leaseSeconds * 1000).toISOString(),
    };
    await writeFile(leasePath(lease.installationKey), json(next), 'utf8');
    return next;
  }

  async function release(lease) {
    const current = await read(lease.installationKey);
    if (current?.token === lease.token && current.jobId === lease.jobId) {
      await rm(leasePath(lease.installationKey), { force: true });
      return true;
    }
    return false;
  }

  async function holdForReconciliation(lease) {
    const current = await read(lease.installationKey);
    if (!current || current.token !== lease.token || current.jobId !== lease.jobId) {
      throw new DeploymentLeaseError('Deployment lease ownership was lost before UNKNOWN could be isolated.', 409);
    }
    const held = { ...current, uncertain: true };
    await writeFile(leasePath(lease.installationKey), json(held), 'utf8');
    return held;
  }

  return { acquire, heartbeat, release, holdForReconciliation, read };
}
