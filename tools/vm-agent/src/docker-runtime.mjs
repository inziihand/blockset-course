import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { VmAgentOperationError } from './agent-service.mjs';

const execFileAsync = promisify(execFile);

function safeName(value) {
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(value ?? '')) throw new VmAgentOperationError('Unsafe Docker container name.');
  return value;
}

export function createFileSafetyProbe({ path, readFileImpl = readFile, now = () => new Date() }) {
  return async () => {
    let snapshot;
    try { snapshot = JSON.parse(await readFileImpl(path, 'utf8')); }
    catch { throw new VmAgentOperationError('Worker safety snapshot is unavailable.'); }
    const generatedAt = new Date(snapshot?.generatedAt ?? 0).getTime();
    if (!Number.isFinite(generatedAt) || now().getTime() - generatedAt > 30_000 || generatedAt > now().getTime() + 5_000) {
      throw new VmAgentOperationError('Worker safety snapshot is stale.');
    }
    return snapshot;
  };
}

export function createDockerVmRuntime({
  docker = 'docker', safetyProbe, execFileImpl = execFileAsync, now = () => new Date(),
  mkdirImpl = mkdir, statImpl = stat, writeFileImpl = writeFile, renameImpl = rename, rmImpl = rm, secretResolver,
}) {
  if (!safetyProbe) throw new Error('Docker VM runtime requires a host-local safety probe.');
  const run = async (args, { allowFailure = false } = {}) => {
    try {
      const result = await execFileImpl(docker, args, { windowsHide: true, timeout: 60_000, maxBuffer: 1024 * 1024 });
      return String(result.stdout ?? '').trim();
    } catch (error) {
      if (allowFailure) return null;
      throw new VmAgentOperationError('Docker runtime operation failed.', { indeterminate: true });
    }
  };
  const inspectContainer = (name) => run([
    'container', 'inspect', '--format', '{{json .State}}', safeName(name),
  ], { allowFailure: true });

  return Object.freeze({
    mode: 'docker-v1',
    async inspect() { return safetyProbe(); },
    async prepareBindings(desired) {
      if (desired.bindings.secrets.length > 0 && !secretResolver) throw new VmAgentOperationError('Secret Manager resolver is unavailable.');
      await mkdirImpl(desired.data.mountPath, { recursive: true, mode: 0o700 });
      const lines = desired.bindings.configuration.map((item) => `${item.name}=${item.value}`);
      const secretBuffers = [];
      try {
        for (const item of desired.bindings.secrets) {
          const value = await secretResolver.access(item.resource);
          secretBuffers.push(value);
          if (value.byteLength > 32_768 || value.includes(0) || value.includes(10) || value.includes(13)) {
            throw new VmAgentOperationError(`Secret ${item.environment} cannot be represented as one environment value.`);
          }
          lines.push(`${item.environment}=${value.toString('utf8')}`);
        }
        const content = Buffer.from(`${lines.join('\n')}\n`, 'utf8');
        const temporary = `${desired.runtime.environmentFile}.${process.pid}.tmp`;
        let committed = false;
        try {
          await writeFileImpl(temporary, content, { mode: 0o600 });
          await renameImpl(temporary, desired.runtime.environmentFile);
          committed = true;
        } finally {
          content.fill(0);
          if (!committed) await rmImpl(temporary, { force: true }).catch(() => undefined);
        }
      } finally { for (const value of secretBuffers) value.fill(0); }
    },
    async stage(desired) {
      await run(['image', 'pull', desired.image.uri]);
      const output = await run(['image', 'inspect', '--format', '{{json .RepoDigests}}', desired.image.uri]);
      let digests;
      try { digests = JSON.parse(output); } catch { throw new VmAgentOperationError('Docker image digest evidence is invalid.', { indeterminate: true }); }
      if (!Array.isArray(digests) || !digests.some((item) => String(item).endsWith(`@${desired.image.digest}`))) {
        throw new VmAgentOperationError('Docker did not resolve the reviewed immutable image digest.', { indeterminate: true });
      }
      return { imageDigest: desired.image.digest.slice(7), image: desired.image.uri };
    },
    async activate(desired) {
      const name = safeName(desired.runtime.containerName);
      await mkdirImpl(desired.data.mountPath, { recursive: true, mode: 0o700 });
      const environment = await statImpl(desired.runtime.environmentFile);
      if (!environment.isFile() || (environment.mode & 0o077) !== 0 || (environment.uid != null && environment.uid !== 0)) {
        throw new VmAgentOperationError('Runtime environment file must be a root-owned private file.');
      }
      const existing = await inspectContainer(name);
      let previousName = null;
      if (existing) {
        previousName = `${name}-previous-${Math.floor(now().getTime() / 1000)}`.slice(0, 63).replace(/-+$/, '');
        await run(['container', 'stop', '--time', '30', name]);
        await run(['container', 'rename', name, previousName]);
      }
      try {
        await run([
          'container', 'run', '--detach', '--name', name,
          '--restart', 'unless-stopped', '--read-only', '--user', desired.runtime.runAsUser,
          '--env-file', desired.runtime.environmentFile,
          '--env', 'STRATEXEC_TRADING_MODE=disabled', '--env', 'STRATEXEC_STRATEGY_AUTOSTART=false',
          '--mount', `type=bind,src=${desired.data.mountPath},dst=${desired.data.mountPath}`,
          '--log-driver', 'json-file', '--log-opt', 'max-size=10m', '--log-opt', 'max-file=3',
          '--label', `stratexec.service=${desired.serviceKey}`, '--label', `stratexec.revision=${desired.revision}`,
          '--security-opt', 'no-new-privileges', '--cap-drop', 'ALL',
          desired.image.uri,
        ]);
      } catch (error) {
        if (previousName) {
          await run(['container', 'rename', previousName, name], { allowFailure: true });
          await run(['container', 'start', name], { allowFailure: true });
        }
        throw error;
      }
      const state = await inspectContainer(name);
      if (!state) throw new VmAgentOperationError('New Worker container cannot be observed.', { indeterminate: true });
      let parsed;
      try { parsed = JSON.parse(state); } catch { throw new VmAgentOperationError('Docker container state is invalid.', { indeterminate: true }); }
      if (parsed.Running !== true || (parsed.Health && parsed.Health.Status !== 'healthy')) {
        throw new VmAgentOperationError('New Worker container is not healthy.', { indeterminate: true });
      }
      return {
        revision: desired.revision,
        imageDigest: desired.image.digest.slice(7),
        previousContainer: previousName,
        layers: { vm: 'ready', worker: 'ready', strategy: 'disabled' },
      };
    },
    async reconcile(desired) {
      if (!desired) return { outcome: 'absent', message: 'No desired Worker state is recorded.' };
      const raw = await inspectContainer(desired.runtime.containerName);
      if (!raw) return { outcome: 'absent', message: 'Worker container is absent.' };
      const safety = await safetyProbe().catch(() => null);
      if (!safety || safety.reconciliation?.consistent !== true || Number(safety.reconciliation?.unknownWrites ?? 1) !== 0
        || safety.worker?.externalExposure === true) {
        return { outcome: 'unknown', message: 'Worker exposure or reconciliation cannot be proven safe.' };
      }
      return { outcome: 'succeeded', layers: { vm: 'ready', agent: 'ready', worker: 'ready', strategy: 'disabled' } };
    },
  });
}
