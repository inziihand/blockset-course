import { readFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createVmAgentService, createUnavailableVmRuntime } from './agent-service.mjs';
import { createVmAgentApp } from './app.mjs';
import { createDesiredStateVerifier } from './desired-state.mjs';
import { resolveVmAgentConfig } from './runtime-config.mjs';
import { createVmAgentStateStore } from './state-store.mjs';
import { createDockerVmRuntime, createFileSafetyProbe } from './docker-runtime.mjs';
import { GoogleAuth } from 'google-auth-library';
import { createGcpSecretResolver } from './gcp-secret-resolver.mjs';

const config = resolveVmAgentConfig();
const trust = JSON.parse(await readFile(config.trustStorePath, 'utf8'));
if (trust?.schemaVersion !== 1 || !Array.isArray(trust.keys)) throw new Error('VM Agent trust store is invalid.');
const googleAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const secretResolver = createGcpSecretResolver({
  request: async ({ method, url }) => {
    const client = await googleAuth.getClient();
    const result = await client.request({ method, url });
    return result.data;
  },
});
const service = createVmAgentService({
  verifier: createDesiredStateVerifier({ keys: trust.keys }),
  store: createVmAgentStateStore({ stateRoot: config.stateRoot }),
  runtime: config.runtimeMode === 'docker'
    ? createDockerVmRuntime({ safetyProbe: createFileSafetyProbe({ path: config.safetySnapshotPath }), secretResolver })
    : createUnavailableVmRuntime(),
});
const app = createVmAgentApp({ service });

async function listener(request, serverResponse) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > 65_536) { serverResponse.writeHead(413); serverResponse.end(); return; }
    chunks.push(chunk);
  }
  const peerAuthorized = config.insecureLoopback || request.socket.authorized === true;
  const result = await app({ method: request.method, url: request.url, body: Buffer.concat(chunks), peerAuthorized });
  serverResponse.writeHead(result.status, result.headers);
  serverResponse.end(JSON.stringify(result.body));
}

const server = config.insecureLoopback
  ? createHttpServer(listener)
  : createHttpsServer({
    cert: await readFile(config.tls.certificatePath), key: await readFile(config.tls.privateKeyPath),
    ca: await readFile(config.tls.clientCaPath), requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.3',
  }, listener);
server.listen(config.port, config.host, () => console.log(JSON.stringify({
  event: 'service.listening', service: 'vm-agent', host: config.host, port: config.port,
  transport: config.insecureLoopback ? 'loopback-http-development' : 'mtls', runtimeMode: config.runtimeMode,
})));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
