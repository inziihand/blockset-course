import { createHash } from 'node:crypto';

const resourcePattern = /^projects\/([a-z][a-z0-9-]{4,28}[a-z0-9])\/secrets\/([A-Za-z0-9_-]{1,255})$/;
const versionPattern = /^[1-9][0-9]*$/;

export class SecretManagerError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.name = 'SecretManagerError';
    this.status = status;
  }
}

function shortSecretId(value) {
  if (value.length <= 220) return value;
  return `${value.slice(0, 203).replace(/-+$/, '')}-${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
}

export function appSecretIdentity({ projectId, installationKey, appKey, serviceKey, environment, secretName }) {
  const secretId = shortSecretId(`stratexec-${installationKey}-${appKey}-${serviceKey}-${secretName}`);
  return {
    resource: `projects/${projectId}/secrets/${secretId}`,
    labels: {
      'stratexec-installation': installationKey,
      'stratexec-app': appKey,
      'stratexec-service': serviceKey,
      'stratexec-environment': environment.toLowerCase().replace(/_/g, '-').slice(0, 63),
    },
  };
}

function publicVersion(version) {
  const name = String(version?.name ?? '');
  const number = name.split('/').at(-1);
  if (!versionPattern.test(number ?? '')) throw new SecretManagerError('Secret Manager returned an invalid version.', 502);
  return {
    version: number,
    state: String(version.state ?? 'STATE_UNSPECIFIED'),
    createTime: version.createTime ?? null,
    destroyTime: version.destroyTime ?? null,
    etag: version.etag ?? null,
  };
}

function unavailable() {
  throw new SecretManagerError('Secret Manager driver is not enabled for this Deployment Agent.', 503);
}

export function createUnavailableSecretManager() {
  return {
    mode: 'disabled',
    getSecretMetadata: unavailable,
    listVersions: unavailable,
    createVersion: unavailable,
    getVersionMetadata: unavailable,
    disableVersion: unavailable,
    deleteSecret: unavailable,
  };
}

export function createGcpSecretManager({ request }) {
  if (typeof request !== 'function') throw new Error('GCP Secret Manager requires an authenticated request function.');
  const call = async (input) => {
    try { return await request(input); }
    catch (error) {
      const status = Number(error?.response?.status ?? error?.status ?? 503);
      throw new SecretManagerError(status === 404 ? 'Secret Manager resource was not found.' : 'Secret Manager operation failed.', status);
    }
  };

  return {
    mode: 'gcp-secret-manager',
    async getSecretMetadata(resource) {
      if (!resourcePattern.test(resource ?? '')) throw new SecretManagerError('Invalid secret resource.', 422);
      const secret = await call({ method: 'GET', url: `https://secretmanager.googleapis.com/v1/${resource}` });
      return { resource: secret.name, labels: secret.labels ?? {}, createTime: secret.createTime ?? null };
    },
    async listVersions(resource) {
      if (!resourcePattern.test(resource ?? '')) throw new SecretManagerError('Invalid secret resource.', 422);
      const result = await call({
        method: 'GET',
        url: `https://secretmanager.googleapis.com/v1/${resource}/versions?pageSize=100&filter=${encodeURIComponent('state:ENABLED OR state:DISABLED')}`,
      });
      return (result.versions ?? []).map(publicVersion);
    },
    async createVersion({ projectId, resource, labels, secretBytes }) {
      const match = resourcePattern.exec(resource ?? '');
      if (!match || match[1] !== projectId || !Buffer.isBuffer(secretBytes)) {
        throw new SecretManagerError('Invalid secret version request.', 422);
      }
      try {
        try {
          await call({ method: 'GET', url: `https://secretmanager.googleapis.com/v1/${resource}` });
        } catch (error) {
          if (!(error instanceof SecretManagerError) || error.status !== 404) throw error;
          await call({
            method: 'POST',
            url: `https://secretmanager.googleapis.com/v1/projects/${projectId}/secrets?secretId=${encodeURIComponent(match[2])}`,
            data: { replication: { automatic: {} }, labels },
          });
        }
        const version = await call({
          method: 'POST',
          url: `https://secretmanager.googleapis.com/v1/${resource}:addVersion`,
          data: { payload: { data: secretBytes.toString('base64') } },
        });
        return { resource, ...publicVersion(version) };
      } finally {
        secretBytes.fill(0);
      }
    },
    async getVersionMetadata(resource, version) {
      if (!resourcePattern.test(resource ?? '') || !versionPattern.test(String(version ?? ''))) {
        throw new SecretManagerError('Invalid secret version reference.', 422);
      }
      return { resource, ...publicVersion(await call({
        method: 'GET', url: `https://secretmanager.googleapis.com/v1/${resource}/versions/${version}`,
      })) };
    },
    async disableVersion(resource, version) {
      if (!resourcePattern.test(resource ?? '') || !versionPattern.test(String(version ?? ''))) {
        throw new SecretManagerError('Invalid secret version reference.', 422);
      }
      return { resource, ...publicVersion(await call({
        method: 'POST', url: `https://secretmanager.googleapis.com/v1/${resource}/versions/${version}:disable`, data: {},
      })) };
    },
    async deleteSecret(resource) {
      if (!resourcePattern.test(resource ?? '')) throw new SecretManagerError('Invalid secret resource.', 422);
      await call({ method: 'DELETE', url: `https://secretmanager.googleapis.com/v1/${resource}` });
      return { resource, deleted: true };
    },
  };
}
