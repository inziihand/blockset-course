import { createServer } from 'node:http';
import { createPackageAgentApp } from './app.mjs';
import { createIdentitySourceClient } from './identity-source-client.mjs';
import { createPackageJobService } from './package-job-service.mjs';
import { resolveAgentConfig } from './runtime-config.mjs';

const config = resolveAgentConfig();
const jobs = createPackageJobService({
  rootPath: config.repositoryRoot,
  stateRoot: config.stateRoot,
  allowUnsignedApply: config.allowUnsignedApply,
  sourceActivator: createIdentitySourceClient(),
});
const handle = createPackageAgentApp({ jobs });

function bodyLimit(url) {
  return url?.startsWith('/api/app-packages/v1/inspect') ? 256 * 1024 * 1024 : 64 * 1024;
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  const limit = bodyLimit(request.url);
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > limit) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = createServer(async (request, response) => {
  try {
    const result = await handle({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: await readBody(request),
    });
    response.writeHead(result.status, result.headers);
    response.end(JSON.stringify(result.body));
  } catch (error) {
    const status = Number(error?.status) || 500;
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ error: status === 413 ? 'App package ZIP exceeds the upload limit.' : 'App Package Agent failed.' }));
  }
});

server.listen(config.port, config.host, () => {
  console.log(JSON.stringify({
    event: 'service.listening',
    service: 'app-package-agent',
    host: config.host,
    port: config.port,
    allowUnsignedApply: config.allowUnsignedApply,
  }));
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
