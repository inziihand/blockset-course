import assert from 'node:assert/strict';
import test from 'node:test';
import { createDockerVmRuntime, createFileSafetyProbe } from '../src/docker-runtime.mjs';

test('starts only the reviewed immutable container with hardened fixed Docker arguments', async () => {
  const calls = [];
  let inspectCount = 0;
  const execFileImpl = async (program, args) => {
    calls.push({ program, args });
    if (args[0] === 'container' && args[1] === 'inspect') {
      inspectCount += 1;
      if (inspectCount === 1) throw new Error('absent');
      return { stdout: JSON.stringify({ Running: true, Health: { Status: 'healthy' } }) };
    }
    return { stdout: args[0] === 'image' && args[1] === 'inspect'
      ? JSON.stringify([`repo/worker@sha256:${'a'.repeat(64)}`]) : 'container-id' };
  };
  const runtime = createDockerVmRuntime({
    safetyProbe: async () => ({}), execFileImpl,
    mkdirImpl: async () => undefined,
    statImpl: async () => ({ isFile: () => true, mode: 0o100600, uid: 0 }),
  });
  const desired = {
    serviceKey: 'account-worker', revision: 'worker-00001',
    image: { uri: `repo/worker@sha256:${'a'.repeat(64)}`, digest: `sha256:${'a'.repeat(64)}` },
    runtime: {
      containerName: 'account-worker', runAsUser: '10001:10001', readOnlyRootFilesystem: true,
      restartPolicy: 'unless-stopped', environmentFile: '/var/lib/stratexec/account-worker/runtime.env',
    },
    data: { mountPath: '/var/lib/stratexec/account-worker' },
  };
  assert.equal((await runtime.stage(desired)).imageDigest, 'a'.repeat(64));
  assert.equal((await runtime.activate(desired)).revision, 'worker-00001');
  const run = calls.find((item) => item.args[0] === 'container' && item.args[1] === 'run');
  assert.ok(run);
  assert.equal(run.program, 'docker');
  assert.ok(run.args.includes('--read-only'));
  assert.ok(run.args.includes('no-new-privileges'));
  assert.ok(run.args.includes('STRATEXEC_TRADING_MODE=disabled'));
  assert.ok(run.args.includes(desired.image.uri));
  assert.equal(run.args.some((item) => /^(?:sh|bash|powershell|cmd\.exe)$/i.test(item)), false);
});

test('rejects a stale host-local Worker safety snapshot', async () => {
  const probe = createFileSafetyProbe({
    path: '/state.json',
    readFileImpl: async () => JSON.stringify({ generatedAt: '2026-09-19T03:00:00.000Z' }),
    now: () => new Date('2026-09-19T04:00:00.000Z'),
  });
  await assert.rejects(() => probe(), /stale/);
});

test('materializes normal settings and concrete secret versions into a private host file, then wipes buffers', async () => {
  let written;
  let secretBuffer;
  const runtime = createDockerVmRuntime({
    safetyProbe: async () => ({}),
    secretResolver: {
      access: async () => {
        secretBuffer = Buffer.from('secret-value');
        return secretBuffer;
      },
    },
    mkdirImpl: async () => undefined,
    writeFileImpl: async (_path, content, options) => { written = Buffer.from(content); assert.equal(options.mode, 0o600); },
    renameImpl: async () => undefined,
  });
  await runtime.prepareBindings({
    data: { mountPath: '/var/lib/stratexec/account-worker' },
    runtime: { environmentFile: '/var/lib/stratexec/account-worker/runtime.env' },
    bindings: {
      configuration: [{ name: 'NORMAL_SETTING', value: 'reviewed' }],
      secrets: [{ environment: 'BROKER_TOKEN', resource: 'projects/customer-project/secrets/broker-token/versions/7', version: '7' }],
    },
  });
  assert.equal(written.toString('utf8'), 'NORMAL_SETTING=reviewed\nBROKER_TOKEN=secret-value\n');
  assert.equal(secretBuffer.every((item) => item === 0), true);
});
