import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRepositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

export function resolveAgentConfig(environment = process.env) {
  if (environment.PORT?.trim()) {
    throw new Error('App Package Agent refuses generic PORT hosting; it is a loopback source-management tool.');
  }
  const port = Number(environment.STRATEXEC_APP_PACKAGE_AGENT_PORT?.trim() || '8182');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('STRATEXEC_APP_PACKAGE_AGENT_PORT must be an integer between 1 and 65535.');
  }
  const host = environment.STRATEXEC_APP_PACKAGE_AGENT_HOST?.trim() || '127.0.0.1';
  if (host !== '127.0.0.1') {
    throw new Error('App Package Agent must bind to 127.0.0.1.');
  }
  const repositoryRoot = resolve(environment.STRATEXEC_REPOSITORY_ROOT?.trim() || defaultRepositoryRoot);
  return {
    host,
    port,
    repositoryRoot,
    stateRoot: resolve(repositoryRoot, '.stratexec', 'app-package-agent'),
    allowUnsignedApply: environment.STRATEXEC_ALLOW_UNSIGNED_APP_PACKAGES === 'true',
  };
}
