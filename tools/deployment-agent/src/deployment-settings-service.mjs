import { createHash } from 'node:crypto';
import { appSecretIdentity, SecretManagerError } from './secret-manager.mjs';
import { DeploymentSettingsStoreError } from './settings-store.mjs';

const keyPattern = /^[a-z][a-z0-9-]*$/;
const environmentPattern = /^[A-Z][A-Z0-9_]*$/;
const versionPattern = /^[1-9][0-9]*$/;
const safeActor = (actor) => ({ uid: actor.uid, email: actor.email });
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class DeploymentSettingsError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = 'DeploymentSettingsError';
    this.status = status;
  }
}

function assertActor(actor, appKey, platform = false) {
  if (!actor?.uid || !actor?.email || !actor.permissions?.includes('deployment:manage')) {
    throw new DeploymentSettingsError('Deployment administrator context is invalid.', 403);
  }
  if (!platform && !actor.permissions.includes(`app:${appKey}:access`)) {
    throw new DeploymentSettingsError('App deployment access is required.', 403);
  }
}

function assertIdentifier(value, label) {
  if (!keyPattern.test(value ?? '')) throw new DeploymentSettingsError(`Invalid ${label}.`, 422);
}

function configurationKey(serviceKey, name) { return `${serviceKey}:${name}`; }
function secretKey(serviceKey, environment) { return `${serviceKey}:${environment}`; }

function normalizeInput(input = {}) {
  const normalized = {
    label: String(input.label ?? ''),
    type: input.type ?? 'string',
    required: input.required !== false,
    impact: input.impact ?? 'normal',
    description: input.description ? String(input.description) : null,
  };
  if (input.default !== undefined) normalized.default = input.default;
  if (input.minimum !== undefined) normalized.minimum = input.minimum;
  if (input.maximum !== undefined) normalized.maximum = input.maximum;
  if (input.minLength !== undefined) normalized.minLength = input.minLength;
  if (input.maxLength !== undefined) normalized.maxLength = input.maxLength;
  if (input.pattern !== undefined) normalized.pattern = input.pattern;
  if (input.options !== undefined) normalized.options = structuredClone(input.options);
  return normalized;
}

function validateOperatorValue(setting, value) {
  const input = normalizeInput(setting.input);
  if (!['string', 'integer', 'boolean', 'select'].includes(input.type)) {
    throw new DeploymentSettingsError(`Unsupported input type for ${setting.name}.`, 409);
  }
  if (input.type === 'boolean') {
    if (typeof value !== 'boolean') throw new DeploymentSettingsError(`${setting.name} must be true or false.`);
    return value;
  }
  if (input.type === 'integer') {
    if (!Number.isInteger(value)) throw new DeploymentSettingsError(`${setting.name} must be an integer.`);
    if (input.minimum !== undefined && value < input.minimum) throw new DeploymentSettingsError(`${setting.name} is below its minimum.`);
    if (input.maximum !== undefined && value > input.maximum) throw new DeploymentSettingsError(`${setting.name} exceeds its maximum.`);
    return value;
  }
  if (typeof value !== 'string') throw new DeploymentSettingsError(`${setting.name} must be text.`);
  if (input.required && value.length === 0) throw new DeploymentSettingsError(`${setting.name} is required.`);
  if (input.minLength !== undefined && value.length < input.minLength) throw new DeploymentSettingsError(`${setting.name} is too short.`);
  if (input.maxLength !== undefined && value.length > input.maxLength) throw new DeploymentSettingsError(`${setting.name} is too long.`);
  if (input.pattern && !new RegExp(input.pattern).test(value)) throw new DeploymentSettingsError(`${setting.name} format is invalid.`);
  if (input.type === 'select' && !input.options?.some((option) => option.value === value)) {
    throw new DeploymentSettingsError(`${setting.name} is not an allowed option.`);
  }
  return value;
}

function publicReference(reference) {
  if (!reference) return null;
  return {
    secretResource: reference.secretResource,
    version: reference.version,
    state: reference.state,
    createTime: reference.createTime ?? null,
    updatedAt: reference.updatedAt,
    updatedBy: reference.updatedBy,
  };
}

function asPlatformContract(fragment) {
  return {
    schemaVersion: 1,
    appKey: 'platform',
    appVersion: 'platform',
    services: fragment.services.map((service) => ({
      serviceKey: service.key,
      configuration: (service.deployment?.cloudRun?.environment ?? []).map((setting) => ({
        ...setting,
        purpose: `平台服務 ${service.key} 的部署設定。`,
      })),
      secrets: (service.deployment?.cloudRun?.secrets ?? []).map((secret) => ({
        environment: secret.environment,
        secretName: secret.secretName,
        temporary: secret.temporary,
        purpose: secret.source === 'bootstrap-admin-emails'
          ? '初次建立首位平台管理員；完成管理員角色驗證後可停用此版本。'
          : `平台服務 ${service.key} 的伺服器端秘密。`,
      })),
    })),
  };
}

export function createDeploymentSettingsService({
  store,
  secretManager,
  installationProvider,
  deploymentProvider,
  platformServiceProvider,
  maxSecretBytes = 32_768,
  now = () => new Date(),
} = {}) {
  if (!store || !secretManager || !installationProvider || !deploymentProvider || !platformServiceProvider) {
    throw new Error('Deployment Settings Service dependencies are incomplete.');
  }

  async function context({ installationKey, appKey, platform = false, actor }) {
    assertIdentifier(installationKey, 'installation key');
    assertIdentifier(appKey, 'App key');
    assertActor(actor, appKey, platform);
    const [installation, contract] = await Promise.all([
      installationProvider(installationKey),
      platform ? platformServiceProvider().then(asPlatformContract) : deploymentProvider(appKey),
    ]);
    if (contract?.appKey !== appKey || !Array.isArray(contract.services)) {
      throw new DeploymentSettingsError('Deployment settings contract does not match the App.', 409);
    }
    return { installation, contract, platform };
  }

  function declaration(contract, serviceKey, environment, kind) {
    assertIdentifier(serviceKey, 'service key');
    if (!environmentPattern.test(environment ?? '')) throw new DeploymentSettingsError('Invalid environment name.', 422);
    const service = contract.services.find((item) => item.serviceKey === serviceKey);
    const item = service?.[kind].find((candidate) => (
      kind === 'configuration' ? candidate.name === environment : candidate.environment === environment
    ));
    if (!item) throw new DeploymentSettingsError(`Undeclared ${kind === 'configuration' ? 'configuration' : 'secret'} field.`, 404);
    return item;
  }

  async function describe({ installationKey, appKey, platform = false, actor }) {
    const { installation, contract } = await context({ installationKey, appKey, platform, actor });
    const state = await store.read(installationKey, appKey);
    const services = [];
    for (const service of contract.services) {
      const configuration = service.configuration.map((setting) => {
        const current = state.configuration[configurationKey(service.serviceKey, setting.name)] ?? null;
        return {
          name: setting.name,
          source: setting.source,
          purpose: setting.purpose,
          input: setting.source === 'operator-input' ? normalizeInput(setting.input) : null,
          current: current ? {
            configuredValue: current.configuredValue,
            updatedAt: current.updatedAt,
            updatedBy: current.updatedBy,
          } : null,
        };
      });
      const secrets = [];
      for (const secret of service.secrets) {
        const current = state.secretReferences[secretKey(service.serviceKey, secret.environment)] ?? null;
        let versions = [];
        if (current && secretManager.mode !== 'disabled') {
          try { versions = await secretManager.listVersions(current.secretResource); }
          catch { versions = []; }
        }
        secrets.push({
          environment: secret.environment,
          secretName: secret.secretName,
          temporary: secret.temporary,
          purpose: secret.purpose,
          writeOnly: true,
          current: publicReference(current),
          versions,
        });
      }
      services.push({ serviceKey: service.serviceKey, configuration, secrets });
    }
    return {
      schemaVersion: 1,
      scope: platform ? 'platform' : 'app',
      installation: {
        installationKey,
        projectId: installation.gcpProjectId,
        region: installation.region,
      },
      appKey,
      appVersion: contract.appVersion,
      secretManagerMode: secretManager.mode,
      platformConfiguration: platform ? {
        oauthBrandDisplayName: installation.auth?.oauthBrandDisplayName ?? null,
        supportEmail: installation.auth?.supportEmail ?? null,
        authorizedDomains: installation.auth?.authorizedDomains ?? [],
        note: '平台級 OAuth 與 bootstrap 資料獨立管理，App 不得重複要求輸入。',
      } : {
        managedSeparately: true,
        endpoint: `/api/deployments/v1/installations/${installationKey}/platform-settings`,
      },
      services,
      stateRevision: state.revision,
    };
  }

  async function setConfiguration({ installationKey, appKey, platform = false, serviceKey, environment, configuredValue, confirmation, actor }) {
    const { contract } = await context({ installationKey, appKey, platform, actor });
    const setting = declaration(contract, serviceKey, environment, 'configuration');
    if (setting.source !== 'operator-input') throw new DeploymentSettingsError('Derived configuration cannot be changed by an operator.', 409);
    const value = validateOperatorValue(setting, configuredValue);
    if (setting.input?.impact === 'high') {
      const expected = `SET ${appKey}/${serviceKey}/${environment}`;
      if (confirmation !== expected) throw new DeploymentSettingsError(`High-impact configuration requires exact confirmation: ${expected}`, 409);
    }
    const updatedAt = now().toISOString();
    const next = await store.update(installationKey, appKey, (draft) => {
      draft.configuration[configurationKey(serviceKey, environment)] = {
        configuredValue: value,
        updatedAt,
        updatedBy: safeActor(actor),
      };
      return draft;
    });
    return next.configuration[configurationKey(serviceKey, environment)];
  }

  async function createSecretVersion({ installationKey, appKey, platform = false, serviceKey, environment, secretValue, actor }) {
    const { installation, contract } = await context({ installationKey, appKey, platform, actor });
    const secret = declaration(contract, serviceKey, environment, 'secrets');
    if (typeof secretValue !== 'string' || Buffer.byteLength(secretValue, 'utf8') < 1
      || Buffer.byteLength(secretValue, 'utf8') > maxSecretBytes) {
      throw new DeploymentSettingsError(`Secret must contain 1 to ${maxSecretBytes} UTF-8 bytes.`, 422);
    }
    const identity = appSecretIdentity({
      projectId: installation.gcpProjectId,
      installationKey,
      appKey,
      serviceKey,
      environment,
      secretName: secret.secretName,
    });
    const secretBytes = Buffer.from(secretValue, 'utf8');
    let metadata;
    try {
      metadata = await secretManager.createVersion({
        projectId: installation.gcpProjectId,
        resource: identity.resource,
        labels: identity.labels,
        secretBytes,
      });
    } finally {
      secretBytes.fill(0);
    }
    const updatedAt = now().toISOString();
    const next = await store.update(installationKey, appKey, (draft) => {
      draft.secretReferences[secretKey(serviceKey, environment)] = {
        secretResource: metadata.resource,
        version: metadata.version,
        state: metadata.state,
        createTime: metadata.createTime ?? null,
        updatedAt,
        updatedBy: safeActor(actor),
      };
      return draft;
    });
    return publicReference(next.secretReferences[secretKey(serviceKey, environment)]);
  }

  async function setSecretReference({ installationKey, appKey, platform = false, serviceKey, environment, secretResource, version, confirmation, actor }) {
    const { installation, contract } = await context({ installationKey, appKey, platform, actor });
    const secret = declaration(contract, serviceKey, environment, 'secrets');
    const expected = `REFERENCE ${appKey}/${serviceKey}/${environment}@${version}`;
    if (confirmation !== expected || !versionPattern.test(String(version ?? ''))) {
      throw new DeploymentSettingsError(`Existing secret reference requires exact confirmation: ${expected}`, 409);
    }
    const expectedIdentity = appSecretIdentity({
      projectId: installation.gcpProjectId, installationKey, appKey, serviceKey, environment, secretName: secret.secretName,
    });
    const [resource, metadata] = await Promise.all([
      secretManager.getSecretMetadata(secretResource),
      secretManager.getVersionMetadata(secretResource, version),
    ]);
    const sameScope = Object.entries(expectedIdentity.labels).every(([key, value]) => resource.labels?.[key] === value);
    if (!secretResource.startsWith(`projects/${installation.gcpProjectId}/secrets/`) || !sameScope) {
      throw new DeploymentSettingsError('Existing secret is not labelled for this installation, App, service and environment.', 409);
    }
    if (metadata.state !== 'ENABLED') throw new DeploymentSettingsError('Only an enabled secret version can be referenced.', 409);
    const updatedAt = now().toISOString();
    const next = await store.update(installationKey, appKey, (draft) => {
      draft.secretReferences[secretKey(serviceKey, environment)] = {
        secretResource,
        version: String(version),
        state: metadata.state,
        createTime: metadata.createTime ?? null,
        updatedAt,
        updatedBy: safeActor(actor),
      };
      return draft;
    });
    return publicReference(next.secretReferences[secretKey(serviceKey, environment)]);
  }

  async function disableSecretVersion({ installationKey, appKey, platform = false, serviceKey, environment, version, confirmation, actor }) {
    const { contract } = await context({ installationKey, appKey, platform, actor });
    declaration(contract, serviceKey, environment, 'secrets');
    const expected = `DISABLE ${appKey}/${serviceKey}/${environment}@${version}`;
    if (confirmation !== expected) throw new DeploymentSettingsError(`Disabling a secret version requires exact confirmation: ${expected}`, 409);
    const state = await store.read(installationKey, appKey);
    const current = state.secretReferences[secretKey(serviceKey, environment)];
    if (!current) throw new DeploymentSettingsError('Secret reference has not been configured.', 409);
    const metadata = await secretManager.disableVersion(current.secretResource, version);
    if (current.version === String(version)) {
      await store.update(installationKey, appKey, (draft) => {
        draft.secretReferences[secretKey(serviceKey, environment)] = {
          ...draft.secretReferences[secretKey(serviceKey, environment)], state: metadata.state,
          updatedAt: now().toISOString(), updatedBy: safeActor(actor),
        };
        return draft;
      });
    }
    return metadata;
  }

  async function rollbackSecretReference({ installationKey, appKey, platform = false, serviceKey, environment, version, confirmation, actor }) {
    const { contract } = await context({ installationKey, appKey, platform, actor });
    declaration(contract, serviceKey, environment, 'secrets');
    const expected = `ROLLBACK SECRET ${appKey}/${serviceKey}/${environment}@${version}`;
    if (confirmation !== expected) throw new DeploymentSettingsError(`Secret rollback requires exact confirmation: ${expected}`, 409);
    const state = await store.read(installationKey, appKey);
    const current = state.secretReferences[secretKey(serviceKey, environment)];
    if (!current) throw new DeploymentSettingsError('Secret reference has not been configured.', 409);
    const metadata = await secretManager.getVersionMetadata(current.secretResource, version);
    if (metadata.state !== 'ENABLED') throw new DeploymentSettingsError('Rollback target must be an enabled secret version.', 409);
    const next = await store.update(installationKey, appKey, (draft) => {
      draft.secretReferences[secretKey(serviceKey, environment)] = {
        secretResource: current.secretResource,
        version: String(version),
        state: metadata.state,
        createTime: metadata.createTime ?? null,
        updatedAt: now().toISOString(),
        updatedBy: safeActor(actor),
      };
      return draft;
    });
    return publicReference(next.secretReferences[secretKey(serviceKey, environment)]);
  }

  async function deleteSecret({ installationKey, appKey, platform = false, serviceKey, environment, confirmation, actor }) {
    const { contract } = await context({ installationKey, appKey, platform, actor });
    declaration(contract, serviceKey, environment, 'secrets');
    const expected = `DELETE SECRET ${appKey}/${serviceKey}/${environment}`;
    if (confirmation !== expected) throw new DeploymentSettingsError(`Secret deletion requires independent exact confirmation: ${expected}`, 409);
    const state = await store.read(installationKey, appKey);
    const current = state.secretReferences[secretKey(serviceKey, environment)];
    if (!current) throw new DeploymentSettingsError('Secret reference has not been configured.', 409);
    await secretManager.deleteSecret(current.secretResource);
    await store.update(installationKey, appKey, (draft) => {
      delete draft.secretReferences[secretKey(serviceKey, environment)];
      return draft;
    });
    return { deleted: true, secretResource: current.secretResource };
  }

  async function resolveBindings({ installationKey, appKey, actor }) {
    const { contract } = await context({ installationKey, appKey, actor });
    const state = await store.read(installationKey, appKey);
    const configuration = [];
    const secrets = [];
    const blockers = [];
    for (const service of contract.services) {
      for (const setting of service.configuration) {
        const current = state.configuration[configurationKey(service.serviceKey, setting.name)];
        if (setting.source === 'operator-input' && !current && setting.input?.required !== false) {
          blockers.push(`Required configuration is missing: ${service.serviceKey}/${setting.name}.`);
        }
        configuration.push({
          serviceKey: service.serviceKey,
          environment: setting.name,
          source: setting.source,
          configuredValue: current?.configuredValue,
        });
      }
      for (const secret of service.secrets) {
        const current = state.secretReferences[secretKey(service.serviceKey, secret.environment)];
        if (!current || current.state !== 'ENABLED') {
          blockers.push(`Enabled secret version is missing: ${service.serviceKey}/${secret.environment}.`);
        } else {
          secrets.push({
            serviceKey: service.serviceKey,
            environment: secret.environment,
            secretResource: current.secretResource,
            version: current.version,
          });
        }
      }
    }
    return {
      schemaVersion: 1,
      installationKey,
      appKey,
      stateRevision: state.revision,
      bindingsFingerprint: fingerprint({ configuration, secrets }),
      configuration,
      secrets,
      blockers,
    };
  }

  const translateError = (error) => {
    if (error instanceof DeploymentSettingsError) throw error;
    if (error instanceof SecretManagerError || error instanceof DeploymentSettingsStoreError) {
      throw new DeploymentSettingsError(error.message, error.status);
    }
    throw error;
  };

  return {
    async getAppSettings(input) { try { return await describe(input); } catch (error) { return translateError(error); } },
    async getPlatformSettings(input) { try { return await describe({ ...input, appKey: 'platform', platform: true }); } catch (error) { return translateError(error); } },
    async setConfiguration(input) { try { return await setConfiguration(input); } catch (error) { return translateError(error); } },
    async createSecretVersion(input) { try { return await createSecretVersion(input); } catch (error) { return translateError(error); } },
    async setSecretReference(input) { try { return await setSecretReference(input); } catch (error) { return translateError(error); } },
    async disableSecretVersion(input) { try { return await disableSecretVersion(input); } catch (error) { return translateError(error); } },
    async rollbackSecretReference(input) { try { return await rollbackSecretReference(input); } catch (error) { return translateError(error); } },
    async deleteSecret(input) { try { return await deleteSecret(input); } catch (error) { return translateError(error); } },
    async resolveBindings(input) { try { return await resolveBindings(input); } catch (error) { return translateError(error); } },
  };
}
