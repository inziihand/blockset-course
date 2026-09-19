import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDeploymentLeaseStore } from '../src/lease-store.mjs';

test('serializes deployment operations per installation and permits expired lease recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stratexec-lease-'));
  let clock = new Date('2026-09-18T00:00:00.000Z');
  const leases = createDeploymentLeaseStore({ stateRoot: root, leaseSeconds: 15, now: () => clock });
  try {
    const first = await leases.acquire({ installationKey: 'customer-a', jobId: 'job-1', operation: 'apply' });
    await assert.rejects(
      () => leases.acquire({ installationKey: 'customer-a', jobId: 'job-2', operation: 'apply' }),
      /leased by another deployment job/,
    );
    clock = new Date('2026-09-18T00:00:16.000Z');
    const second = await leases.acquire({ installationKey: 'customer-a', jobId: 'job-2', operation: 'apply' });
    assert.equal(await leases.release(first), false);
    assert.equal(await leases.release(second), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('holds an UNKNOWN installation until the owning job reconciles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stratexec-lease-'));
  let clock = new Date('2026-09-18T00:00:00.000Z');
  const leases = createDeploymentLeaseStore({ stateRoot: root, leaseSeconds: 15, now: () => clock });
  try {
    const first = await leases.acquire({ installationKey: 'customer-a', jobId: 'job-1', operation: 'apply' });
    await leases.holdForReconciliation(first);
    clock = new Date('2026-09-18T01:00:00.000Z');
    await assert.rejects(
      () => leases.acquire({ installationKey: 'customer-a', jobId: 'job-2', operation: 'apply' }),
      /pending UNKNOWN reconciliation/,
    );
    const reconcile = await leases.acquire({ installationKey: 'customer-a', jobId: 'job-1', operation: 'reconcile' });
    assert.equal(await leases.release(reconcile), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
