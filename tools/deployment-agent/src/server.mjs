import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { GoogleAuth } from 'google-auth-library';
import { createDeploymentAgentApp } from './app.mjs';
import { createBuildSourceProvider } from './build-source.mjs';
import { createCloudRunDeploymentExecutor } from './cloud-run-executor.mjs';
import { createIdentityDeploymentAuthorizer } from './authorizer.mjs';
import { createIdentityLifecycleClient } from './identity-lifecycle-client.mjs';
import { createDeploymentJobService } from './deployment-job-service.mjs';
import { createDeploymentSettingsService } from './deployment-settings-service.mjs';
import { createUnavailableDeploymentExecutor } from './executor.mjs';
import { createGcpCloudControlPlane } from './gcp-cloud-control-plane.mjs';
import { createDeploymentJobStore } from './job-store.mjs';
import { createDeploymentLeaseStore } from './lease-store.mjs';
import { createPackageAgentPlanProvider } from './plan-provider.mjs';
import { assertKeylessCredentialConfiguration, resolveDeploymentAgentConfig } from './runtime-config.mjs';
import { createGcpSecretManager, createUnavailableSecretManager } from './secret-manager.mjs';
import { createDeploymentSettingsStore } from './settings-store.mjs';
import { createExternalEd25519DesiredStateSigner } from './desired-state-signer.mjs';
import { createMtlsJsonRequest, createVmAgentClient } from './vm-agent-client.mjs';
import { createVmDockerDeploymentExecutor } from './vm-docker-executor.mjs';
import { loadDeploymentAgentPolicy } from '../../../scripts/lib/deployment-agent-policy.mjs';

const installationKeyPattern = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;
const config = resolveDeploymentAgentConfig();
await assertKeylessCredentialConfiguration();
const policy = await loadDeploymentAgentPolicy(config.policyPath);
const store = createDeploymentJobStore({
  stateRoot: config.stateRoot,
  maxJobs: policy.limits.maxJobs,
});
const leases = createDeploymentLeaseStore({ stateRoot: config.stateRoot, leaseSeconds: policy.limits.leaseSeconds });
const googleAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const authenticatedRequest = async ({ method, url, data, headers }) => {
  const client = await googleAuth.getClient();
  const result = await client.request({ method, url, data, headers });
  return result.data;
};
const control = createGcpCloudControlPlane({ request: authenticatedRequest });
let executor = createUnavailableDeploymentExecutor();
if (config.targetMode === 'gcp-cloud-run') {
  executor = createCloudRunDeploymentExecutor({
    control,
    sourceProvider: createBuildSourceProvider({ repositoryRoot: config.repositoryRoot, maximumBytes: policy.limits.maxBuildSourceBytes }),
    policy,
  });
} else if (config.targetMode === 'gcp-vm-docker') {
  const tls = {
    certificate: await readFile(config.vm.clientCertificatePath),
    privateKey: await readFile(config.vm.clientPrivateKeyPath),
    certificateAuthority: await readFile(config.vm.certificateAuthorityPath),
  };
  const request = createMtlsJsonRequest(tls);
  executor = createVmDockerDeploymentExecutor({
    sourceProvider: createBuildSourceProvider({ repositoryRoot: config.repositoryRoot, maximumBytes: policy.limits.maxBuildSourceBytes }),
    imageBuilder: ({ context, service, source, repository }) => control.buildImmutableImage({
      context, service, source, repository, builderRoles: policy.cloudRun.builderServiceAccountRoles,
    }),
    signer: await createExternalEd25519DesiredStateSigner({
      keyId: config.vm.signingKeyId,
      privateKeyPath: config.vm.signingPrivateKeyPath,
    }),
    clientForService: (service) => createVmAgentClient({ baseUrl: service.vm.agentUrl, request }),
    configurationResolver: ({ context, dependency }) => control.resolveServiceUrl({ context, dependency }),
    policy,
  });
}
const installationProvider = async (installationKey) => {
  if (!installationKeyPattern.test(installationKey ?? '')) throw Object.assign(new Error('Invalid installation key.'), { status: 422 });
  try {
    return JSON.parse(await readFile(join(config.repositoryRoot, 'infrastructure', 'environments', `${installationKey}.json`), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') throw Object.assign(new Error('Installation configuration was not found.'), { status: 404 });
    throw error;
  }
};
const deploymentProvider = async (appKey) => {
  if (!/^[a-z][a-z0-9-]*$/.test(appKey ?? '')) throw Object.assign(new Error('Invalid App key.'), { status: 422 });
  try {
    return JSON.parse(await readFile(join(config.repositoryRoot, 'infrastructure', 'app-deployments', `${appKey}.json`), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') throw Object.assign(new Error('App deployment settings contract was not found.'), { status: 404 });
    throw error;
  }
};
const platformServiceProvider = async () => JSON.parse(await readFile(
  join(config.repositoryRoot, 'infrastructure', 'services', 'platform.json'), 'utf8',
));
const secretManager = config.secretManagerMode === 'gcp'
  ? createGcpSecretManager({
    request: authenticatedRequest,
  })
  : createUnavailableSecretManager();
const settings = createDeploymentSettingsService({
  store: createDeploymentSettingsStore({ stateRoot: config.stateRoot }),
  secretManager,
  installationProvider,
  deploymentProvider,
  platformServiceProvider,
  maxSecretBytes: policy.limits.maxSecretBytes,
});
const jobs = createDeploymentJobService({
  store,
  leases,
  planProvider: createPackageAgentPlanProvider({ baseUrl: config.packageAgentBaseUrl }),
  executor,
  policy,
  installationProvider,
  settingsProvider: (input) => settings.resolveBindings(input),
  lifecycleProvider: createIdentityLifecycleClient({ baseUrl: config.identityBaseUrl }),
});
await jobs.recover();
const handle = createDeploymentAgentApp({
  jobs,
  settings,
  authorizeDeployment: createIdentityDeploymentAuthorizer({ baseUrl: config.identityBaseUrl }),
});

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > policy.limits.requestBytes) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = createServer(async (request, serverResponse) => {
  try {
    const result = await handle({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: await readBody(request),
    });
    serverResponse.writeHead(result.status, result.headers);
    serverResponse.end(JSON.stringify(result.body));
  } catch (error) {
    const status = Number(error?.status) || 500;
    serverResponse.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    serverResponse.end(JSON.stringify({ error: status === 413 ? 'Deployment Agent request exceeds the size limit.' : 'Deployment Agent failed.' }));
  }
});

server.listen(config.port, config.host, () => {
  console.log(JSON.stringify({
    event: 'service.listening',
    service: 'deployment-agent',
    host: config.host,
    port: config.port,
    executorMode: executor.capabilities.mode,
    secretManagerMode: secretManager.mode,
    credentialMode: policy.credentialMode,
  }));
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
