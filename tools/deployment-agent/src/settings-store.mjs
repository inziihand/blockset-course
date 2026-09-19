import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const keyPattern = /^[a-z][a-z0-9-]*$/;
const environmentPattern = /^[A-Z][A-Z0-9_]*$/;

export class DeploymentSettingsStoreError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'DeploymentSettingsStoreError';
    this.status = status;
  }
}

function assertKey(value, label) {
  if (!keyPattern.test(value ?? '')) throw new DeploymentSettingsStoreError(`Invalid ${label}.`, 422);
}

function emptyDocument(installationKey, appKey) {
  return {
    schemaVersion: 1,
    installationKey,
    appKey,
    revision: 0,
    configuration: {},
    secretReferences: {},
    updatedAt: null,
  };
}

function assertSafeDocument(document, installationKey, appKey) {
  if (document?.schemaVersion !== 1 || document.installationKey !== installationKey
    || document.appKey !== appKey || !Number.isInteger(document.revision)
    || !document.configuration || !document.secretReferences) {
    throw new DeploymentSettingsStoreError('Deployment settings state is invalid.', 500);
  }
  const visit = (value, path = 'settings') => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.replace(/[-_]/g, '').toLowerCase();
      if (['secretvalue', 'privatekey', 'credential', 'credentials', 'token', 'password'].includes(normalized)) {
        throw new DeploymentSettingsStoreError(`Sensitive field cannot be persisted: ${path}.${key}.`, 422);
      }
      visit(child, `${path}.${key}`);
    }
  };
  visit(document);
  return document;
}

export function createDeploymentSettingsStore({ stateRoot }) {
  if (!stateRoot) throw new Error('Deployment settings store requires stateRoot.');
  const settingsRoot = join(stateRoot, 'settings');
  const serial = new Map();

  const pathFor = (installationKey, appKey) => {
    assertKey(installationKey, 'installation key');
    assertKey(appKey, 'App key');
    return join(settingsRoot, installationKey, `${appKey}.json`);
  };

  async function read(installationKey, appKey) {
    const path = pathFor(installationKey, appKey);
    try {
      return assertSafeDocument(JSON.parse(await readFile(path, 'utf8')), installationKey, appKey);
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyDocument(installationKey, appKey);
      if (error instanceof DeploymentSettingsStoreError) throw error;
      throw new DeploymentSettingsStoreError('Deployment settings state cannot be read.', 500);
    }
  }

  async function atomicWrite(path, document) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    const backup = `${path}.bak`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    let backedUp = false;
    try {
      try { await rename(path, backup); backedUp = true; } catch (error) { if (error?.code !== 'ENOENT') throw error; }
      await rename(temporary, path);
      if (backedUp) await rm(backup, { force: true });
    } catch (error) {
      await rm(temporary, { force: true });
      if (backedUp) {
        try { await rename(backup, path); } catch { /* preserve original error */ }
      }
      throw error;
    }
  }

  async function update(installationKey, appKey, updater) {
    const lockKey = `${installationKey}:${appKey}`;
    const previous = serial.get(lockKey) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    serial.set(lockKey, tail);
    await previous;
    try {
      const existing = await read(installationKey, appKey);
      const candidate = await updater(structuredClone(existing));
      const next = assertSafeDocument({
        ...candidate,
        schemaVersion: 1,
        installationKey,
        appKey,
        revision: existing.revision + 1,
        updatedAt: new Date().toISOString(),
      }, installationKey, appKey);
      await atomicWrite(pathFor(installationKey, appKey), next);
      return structuredClone(next);
    } finally {
      release();
      if (serial.get(lockKey) === tail) serial.delete(lockKey);
    }
  }

  return { read, update, environmentPattern };
}
