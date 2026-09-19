import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const jobIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

export class DeploymentStoreError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'DeploymentStoreError';
    this.status = status;
  }
}

export function createDeploymentJobStore({ stateRoot, maxJobs = 500 } = {}) {
  if (!stateRoot) throw new Error('Deployment job store requires stateRoot.');
  const jobsRoot = join(stateRoot, 'jobs');
  const jobPath = (jobId) => {
    if (!jobIdPattern.test(jobId ?? '')) throw new DeploymentStoreError('Invalid deployment job id.', 404);
    return join(jobsRoot, `${jobId}.json`);
  };

  async function exists(path) {
    try { await access(path); return true; }
    catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
  }

  async function recoverAtomicPath(path) {
    const backup = `${path}.bak`;
    if (!(await exists(path)) && await exists(backup)) await rename(backup, path);
    else if (await exists(path) && await exists(backup)) await rm(backup, { force: true });
  }

  async function atomicWrite(path, value) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    const backup = `${path}.bak`;
    await recoverAtomicPath(path);
    await writeFile(temporary, json(value), { encoding: 'utf8', flag: 'wx' });
    try {
      if (await exists(path)) await rename(path, backup);
      await rename(temporary, path);
      await rm(backup, { force: true });
    } catch (error) {
      if (!(await exists(path)) && await exists(backup)) await rename(backup, path);
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async function countJobs() {
    await mkdir(jobsRoot, { recursive: true });
    return (await readdir(jobsRoot)).filter((name) => name.endsWith('.json')).length;
  }

  return {
    async create(job) {
      if ((await countJobs()) >= maxJobs) throw new DeploymentStoreError('Deployment job capacity is exhausted.', 507);
      const path = jobPath(job.jobId);
      await recoverAtomicPath(path);
      try { await stat(path); throw new DeploymentStoreError('Deployment job already exists.', 409); }
      catch (error) { if (error instanceof DeploymentStoreError) throw error; if (error?.code !== 'ENOENT') throw error; }
      await atomicWrite(path, job);
      return job;
    },

    async read(jobId) {
      const path = jobPath(jobId);
      await recoverAtomicPath(path);
      try { return JSON.parse(await readFile(path, 'utf8')); }
      catch (error) {
        if (error instanceof DeploymentStoreError) throw error;
        if (error?.code === 'ENOENT') throw new DeploymentStoreError('Deployment job was not found.', 404);
        throw error;
      }
    },

    async write(job) {
      await atomicWrite(jobPath(job.jobId), job);
      return job;
    },

    async list(limit = 50) {
      await mkdir(jobsRoot, { recursive: true });
      const files = (await readdir(jobsRoot)).filter((name) => name.endsWith('.json'));
      const records = await Promise.all(files.map(async (name) => ({
        name,
        modifiedAt: (await stat(join(jobsRoot, name))).mtimeMs,
      })));
      records.sort((left, right) => right.modifiedAt - left.modifiedAt);
      return Promise.all(records.slice(0, Math.min(100, Math.max(1, limit))).map(({ name }) => (
        readFile(join(jobsRoot, name), 'utf8').then(JSON.parse)
      )));
    },
  };
}
