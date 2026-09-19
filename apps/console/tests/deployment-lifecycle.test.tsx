import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { DeploymentLifecycleManager } from '../src/apps/access-control/DeploymentLifecycleManager';
import { createDeploymentApi, type DeploymentApi, type DeploymentJob } from '../src/apps/access-control/deployment-client';
import type { AppPackageJob } from '../src/apps/access-control/app-package-client';

const source: AppPackageJob = {
  schemaVersion: 1, jobId: '00000000-0000-4000-8000-000000000000', fileName: 'course-app-1.0.0.zip',
  status: 'succeeded', appKey: 'course-app', version: '1.0.0', installStatus: 'new',
  packageSha256: 'a'.repeat(64), planFingerprint: 'b'.repeat(64),
  planContext: { platformContractDigest: 'c'.repeat(64), serviceRegistryDigest: 'd'.repeat(64), packageLockDigest: 'e'.repeat(64), installationContextDigest: 'f'.repeat(64) },
  signatureStatus: 'trusted-signed', applyAllowed: false, confirmation: 'course-app@1.0.0', blockers: [], changes: [],
  options: { adoptExisting: false, allowDowngrade: false }, createdAt: '2026-09-19T00:00:00Z', updatedAt: '2026-09-19T00:00:00Z',
  createdBy: { uid: 'admin-1', email: 'admin@example.com' },
};
const verified: DeploymentJob = {
  jobId: '10000000-0000-4000-8000-000000000000', packageJobId: source.jobId, appKey: 'course-app', status: 'verified',
  package: { appKey: 'course-app', version: '1.0.0', packageSha256: 'a'.repeat(64), signatureStatus: 'trusted-signed' },
  installation: { installationKey: 'customer-a', projectId: 'customer-a-project', region: 'asia-east1' },
  planFingerprint: 'b'.repeat(64), plan: { app: { displayName: '課程 App', requiredServices: ['course-api'] }, services: [{ serviceKey: 'course-api', selectedTarget: 'cloud-run-service' }] },
  blockers: [], requiredRiskConfirmations: ['cost-impact-reviewed'], approval: null,
  runtimeEvidence: { revision: 'course-api-00001', appliedAt: '2026-09-19T00:01:00Z' },
  verificationEvidence: { revision: 'course-api-00001', verifiedAt: '2026-09-19T00:02:00Z' },
  activationEvidence: null, revision: 8, updatedAt: '2026-09-19T00:02:00Z',
};

const vmVerified: DeploymentJob = {
  ...verified,
  jobId: '20000000-0000-4000-8000-000000000000',
  plan: { app: { displayName: '交易 Worker', requiredServices: ['account-worker'] }, services: [{ serviceKey: 'account-worker', selectedTarget: 'vm-docker' }] },
  runtimeEvidence: {
    revision: 'account-worker-00001',
    services: [{
      serviceKey: 'account-worker', revision: 'account-worker-00001', vmHostRef: 'gce://customer-project/asia-east1-b/worker-1',
      runtimeStatus: { vm: 'ready', agent: 'ready', worker: 'ready', strategy: 'disabled', tradingEnabled: false },
    }],
  },
  verificationEvidence: {
    revision: 'account-worker-00001', verifiedAt: '2026-09-19T00:02:00Z',
    services: [{
      serviceKey: 'account-worker', revision: 'account-worker-00001', vmHostRef: 'gce://customer-project/asia-east1-b/worker-1',
      runtimeStatus: { vm: 'ready', agent: 'ready', worker: 'ready', strategy: 'disabled', tradingEnabled: false },
    }],
  },
};

function api(overrides: Partial<DeploymentApi> = {}): DeploymentApi {
  const same = async () => verified;
  return {
    listJobs: vi.fn(async () => [verified]), inspect: vi.fn(same), plan: vi.fn(same), approve: vi.fn(same),
    apply: vi.fn(same), verify: vi.fn(same), promote: vi.fn(same), rollback: vi.fn(same), reconcile: vi.fn(same),
    cancel: vi.fn(same), activate: vi.fn(async () => ({ ...verified, activationEvidence: { status: 'installed', runtimeRevision: 'course-api-00001' } })),
    evidence: vi.fn(async () => ({ jobId: verified.jobId, status: 'verified' })),
    events: vi.fn(async () => [{ sequence: 1, type: 'verification.completed', at: '2026-09-19T00:02:00Z', outcome: 'succeeded' }]),
    ...overrides,
  };
}

describe('App deployment lifecycle', () => {
  test('keeps source, runtime, verification and logical activation as separate states', async () => {
    const user = userEvent.setup();
    const deployment = api();
    const activated = vi.fn();
    render(<DeploymentLifecycleManager api={deployment} packageJobs={[source]} installations={[]}
      installationKey="customer-a" onOpenSettings={vi.fn()} onActivated={activated} />);
    expect((await screen.findAllByText('課程 App')).length).toBeGreaterThan(0);
    expect(screen.getByText('已套用')).toBeTruthy();
    expect(screen.getByText('已部署')).toBeTruthy();
    expect(screen.getAllByText('已驗證').length).toBeGreaterThan(0);
    expect(screen.getByText('尚未登錄')).toBeTruthy();
    const input = screen.getByLabelText('輸入「ENABLE course-app@1.0.0」啟用 App');
    const button = screen.getByRole('button', { name: '驗證後啟用' });
    expect(button.hasAttribute('disabled')).toBe(true);
    await user.type(input, 'ENABLE course-app@1.0.0');
    await user.click(button);
    await waitFor(() => expect(deployment.activate).toHaveBeenCalledWith(verified.jobId, 'ENABLE course-app@1.0.0', undefined));
    expect(activated).toHaveBeenCalled();
  });

  test('uses same-origin authenticated deployment endpoints', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ ...verified, status: 'cancelled' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const client = createDeploymentApi(vi.fn(async () => 'firebase-id-token'), request);
    await client.cancel(verified.jobId);
    expect(request).toHaveBeenCalledWith(
      `/api/deployments/v1/jobs/${verified.jobId}/cancel`,
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer firebase-id-token' }) }),
    );
  });

  test('shows VM, Agent, Worker and Strategy separately without implying trading authorization', async () => {
    render(<DeploymentLifecycleManager api={api({ listJobs: vi.fn(async () => [vmVerified]) })} packageJobs={[source]} installations={[]}
      installationKey="customer-a" onOpenSettings={vi.fn()} onActivated={vi.fn()} />);
    expect(await screen.findByLabelText('VM 持續執行狀態')).toBeTruthy();
    for (const label of ['VM', 'Agent', 'Worker', '策略']) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText('交易：未授權')).toBeTruthy();
    expect(screen.getByText(/部署與健康驗證不會啟用 PAPER/)).toBeTruthy();
  });
});
