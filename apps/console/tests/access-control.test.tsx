import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { AccessControlWorkspace } from '../src/apps/access-control/AccessControlApp';
import {
  createAccessControlApi,
  type AccessControlApi,
  type AppInstallation,
  type AppPolicy,
} from '../src/apps/access-control/access-control-client';
import { createAppPackageApi, type AppPackageApi, type AppPackageJob } from '../src/apps/access-control/app-package-client';
import {
  createDeploymentSettingsApi,
  type DeploymentSettingsApi,
  type DeploymentSettingsDocument,
} from '../src/apps/access-control/deployment-settings-client';
import type { IdentityMember } from '../src/shared/auth/identityClient';

const admin: IdentityMember = {
  uid: 'admin-1', email: 'admin@example.com', displayName: 'Admin', provider: 'google.com',
  emailVerified: true, role: 'admin', status: 'active', plan: 'free', appGrants: [],
  appAccess: [{ appKey: 'access-control', allowed: true, reason: 'protected_admin', entitlements: [] }],
};
const member: IdentityMember = {
  uid: 'member-1', email: 'member@example.com', displayName: 'Member', provider: 'google.com',
  emailVerified: true, role: 'member', status: 'active', plan: 'free', appGrants: [],
  appAccess: [{ appKey: 'premium-course', allowed: false, reason: 'grant_required', entitlements: [] }],
};
const policies: AppPolicy[] = [
  {
    appKey: 'premium-course', displayName: '付費課程', accessMode: 'grant_required',
    allowedAccessModes: ['all_members', 'grant_required', 'admins_only', 'disabled'],
    entitlements: [{ key: 'course', displayName: '課程學員功能', description: '解鎖課程模板與進階分析。' }],
    adminAllowed: false, protected: false, updatedAt: '2026-09-17T00:00:00Z',
  },
  {
    appKey: 'access-control', displayName: '會員與權限', accessMode: 'admins_only',
    allowedAccessModes: ['admins_only'], entitlements: [], adminAllowed: true, protected: true, updatedAt: '2026-09-17T00:00:00Z',
  },
];
const installations: AppInstallation[] = [
  {
    appKey: 'premium-course', displayName: '付費課程', status: 'installed', category: 'application',
    removable: true, protected: false, requiredServices: ['course-content-api'], updatedAt: '2026-09-17T00:00:00Z',
    deploymentJobId: '00000000-0000-4000-8000-000000000000', runtimeRevision: 'course-content-api-00001', runtimeVerifiedAt: '2026-09-17T00:00:00Z',
  },
  {
    appKey: 'access-control', displayName: '會員與權限', status: 'installed', category: 'core',
    removable: false, protected: true, requiredServices: ['identity-api'], updatedAt: '2026-09-17T00:00:00Z',
  },
];

describe('會員與權限 App', () => {
  test('separates member grants from App policy and keeps the protected App locked', async () => {
    const user = userEvent.setup();
    const setGrant = vi.fn(async () => ({
      ...member,
      appGrants: [{
        appKey: 'premium-course', enabled: true, roles: [], entitlements: [], source: 'manual' as const,
        updatedAt: '2026-09-17T00:00:00Z', updatedBy: 'admin-1',
      }],
      appAccess: [{ appKey: 'premium-course', allowed: true, reason: 'active_grant', entitlements: [] }],
    }));
    const api: AccessControlApi = {
      listMembers: vi.fn(async () => ({ members: [member], nextCursor: null })),
      listPolicies: vi.fn(async () => policies),
      listInstallations: vi.fn(async () => installations),
      reorderInstallations: vi.fn(async () => installations),
      updateMember: vi.fn(async () => member),
      setGrant,
      setPolicy: vi.fn(async (_appKey, patch) => ({ ...policies[0], ...patch })),
      updateInstallation: vi.fn(async (_appKey, action) => ({
        ...installations[0], status: action === 'uninstall' ? 'uninstalled' as const : 'installed' as const,
      })),
    };

    render(<AccessControlWorkspace actor={admin} api={api} />);

    const membersTab = await screen.findByRole('tab', { name: '會員' });
    const folderPanel = screen.getByRole('tabpanel');
    expect(membersTab.getAttribute('aria-controls')).toBe(folderPanel.id);
    expect(folderPanel.classList.contains('platform-folder-panel')).toBe(true);
    expect(folderPanel.parentElement?.classList.contains('platform-folder-stack')).toBe(true);
    const grantButton = screen.getAllByRole('button', { name: '授權' })
      .find((button) => !button.hasAttribute('disabled'));
    expect(grantButton).toBeTruthy();
    await user.click(grantButton!);
    await waitFor(() => expect(setGrant).toHaveBeenCalledWith(
      'member-1', 'premium-course', { enabled: true, entitlements: [] }, undefined,
    ));

    await user.click(screen.getByRole('tab', { name: 'App 權限' }));
    const protectedSelect = screen.getByRole('combobox', { name: '會員與權限一般會員政策' });
    expect(protectedSelect.hasAttribute('disabled')).toBe(true);

    const appSelect = screen.getByRole('combobox', { name: '付費課程一般會員政策' });
    expect(appSelect.hasAttribute('disabled')).toBe(false);
    expect(Array.from((appSelect as HTMLSelectElement).options).map((option) => option.value)).toEqual([
      'all_members', 'grant_required', 'admins_only', 'disabled',
    ]);
    await user.selectOptions(appSelect, 'admins_only');
    await waitFor(() => expect(api.setPolicy).toHaveBeenCalledWith(
      'premium-course', { accessMode: 'admins_only', adminAllowed: true }, undefined,
    ));

    await user.click(screen.getByRole('tab', { name: 'App 管理' }));
    expect(screen.getByText('系統保護')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '移除' }));
    const confirmation = screen.getByLabelText('請輸入「付費課程」確認');
    const confirmButton = screen.getByRole('button', { name: '確認移除' });
    expect(confirmButton.hasAttribute('disabled')).toBe(true);
    await user.type(confirmation, '付費課程');
    expect(confirmButton.hasAttribute('disabled')).toBe(false);
    await user.click(confirmButton);
    await waitFor(() => expect(api.updateInstallation).toHaveBeenCalledWith(
      'premium-course', 'uninstall', undefined,
    ));
  });

  test('pages members through the Identity API without reloading the whole workspace', async () => {
    const user = userEvent.setup();
    const nextMember: IdentityMember = {
      ...member, uid: 'member-2', email: 'next@example.com', displayName: 'Next Member',
    };
    const listMembers = vi.fn(async (options?: { cursor?: string | null }) => options?.cursor
      ? { members: [nextMember], nextCursor: null }
      : { members: [member], nextCursor: 'member-1' });
    const listPolicies = vi.fn(async () => policies);
    const listInstallations = vi.fn(async () => installations);
    const api: AccessControlApi = {
      listMembers,
      listPolicies,
      listInstallations,
      reorderInstallations: vi.fn(async () => installations),
      updateMember: vi.fn(async () => member),
      setGrant: vi.fn(async () => member),
      setPolicy: vi.fn(async (_appKey, patch) => ({ ...policies[0], ...patch })),
      updateInstallation: vi.fn(async () => installations[0]),
    };

    render(<AccessControlWorkspace actor={admin} api={api} />);
    expect(await screen.findByText('第 1 頁')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '下一頁' }));

    await waitFor(() => expect(screen.getAllByText('Next Member')).toHaveLength(2));
    expect(screen.getByText('第 2 頁')).toBeTruthy();
    expect(listMembers).toHaveBeenNthCalledWith(1, { limit: 10 }, undefined);
    expect(listMembers).toHaveBeenNthCalledWith(2, { limit: 10, cursor: 'member-1' }, undefined);
    expect(listPolicies).toHaveBeenCalledTimes(1);
    expect(listInstallations).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '上一頁' }));
    await waitFor(() => expect(screen.getAllByText('Member')).toHaveLength(2));
    expect(screen.getByText('第 1 頁')).toBeTruthy();
  });

  test('encodes member pagination options in the Identity API request', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ members: [member], nextCursor: 'member-2' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const api = createAccessControlApi(vi.fn(async () => 'firebase-id-token'), request);

    const page = await api.listMembers({ limit: 10, cursor: 'member-1' });

    expect(page.nextCursor).toBe('member-2');
    expect(request).toHaveBeenCalledWith(
      '/api/identity/v1/admin/members?limit=10&cursor=member-1',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  test('grants an App-defined feature without creating another platform role', async () => {
    const user = userEvent.setup();
    const setGrant = vi.fn(async () => ({
      ...member,
      appGrants: [{
        appKey: 'premium-course', enabled: true, roles: [], entitlements: ['course'], source: 'manual' as const,
        updatedAt: '2026-09-17T00:00:00Z', updatedBy: 'admin-1',
      }],
      appAccess: [{
        appKey: 'premium-course', allowed: true, reason: 'active_grant', entitlements: ['course'],
      }],
    }));
    const api: AccessControlApi = {
      listMembers: vi.fn(async () => ({ members: [member], nextCursor: null })),
      listPolicies: vi.fn(async () => policies),
      listInstallations: vi.fn(async () => installations),
      reorderInstallations: vi.fn(async () => installations),
      updateMember: vi.fn(async () => member),
      setGrant,
      setPolicy: vi.fn(async (_appKey, patch) => ({ ...policies[0], ...patch })),
      updateInstallation: vi.fn(async () => installations[0]),
    };

    render(<AccessControlWorkspace actor={admin} api={api} />);
    await user.click(await screen.findByRole('checkbox', { name: /課程學員功能/ }));

    await waitFor(() => expect(setGrant).toHaveBeenCalledWith(
      'member-1', 'premium-course', { enabled: true, entitlements: ['course'] }, undefined,
    ));
  });

  test('sends administrator writes through the same-origin Identity API', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify(member), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const api = createAccessControlApi(vi.fn(async () => 'firebase-id-token'), request);

    await api.setGrant('member/1', 'course-app', { enabled: true });

    expect(request).toHaveBeenCalledWith(
      '/api/identity/v1/admin/members/member%2F1/app-grants/course-app',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ Authorization: 'Bearer firebase-id-token' }),
      }),
    );
  });

  test('persists keyboard reordering from the App management drag handle', async () => {
    const user = userEvent.setup();
    const reorderInstallations = vi.fn(async (appKeys: string[]) => appKeys.map(
      (appKey) => installations.find((installation) => installation.appKey === appKey)!,
    ));
    const api: AccessControlApi = {
      listMembers: vi.fn(async () => ({ members: [member], nextCursor: null })),
      listPolicies: vi.fn(async () => policies),
      listInstallations: vi.fn(async () => installations),
      reorderInstallations,
      updateMember: vi.fn(async () => member),
      setGrant: vi.fn(async () => member),
      setPolicy: vi.fn(async (_appKey, patch) => ({ ...policies[0], ...patch })),
      updateInstallation: vi.fn(async () => installations[0]),
    };

    render(<AccessControlWorkspace actor={admin} api={api} />);
    await user.click(await screen.findByRole('tab', { name: 'App 管理' }));
    const handle = screen.getByRole('button', { name: '調整 付費課程 排序' });
    handle.focus();
    await user.keyboard('{ArrowDown}');

    await waitFor(() => expect(reorderInstallations).toHaveBeenCalledWith(
      ['access-control', 'premium-course'], undefined,
    ));
  });

  test('uploads a ZIP for inspection and requires the exact package confirmation before apply', async () => {
    const user = userEvent.setup();
    const packageJob: AppPackageJob = {
      schemaVersion: 1,
      jobId: '00000000-0000-4000-8000-000000000000',
      fileName: 'course-app-1.0.0.zip',
      status: 'ready',
      appKey: 'course-app',
      version: '1.0.0',
      previousVersion: null,
      installStatus: 'new',
      packageSha256: 'a'.repeat(64),
      planFingerprint: 'b'.repeat(64),
      planContext: {
        platformContractDigest: 'c'.repeat(64),
        serviceRegistryDigest: 'd'.repeat(64),
        packageLockDigest: 'e'.repeat(64),
        installationContextDigest: 'f'.repeat(64),
      },
      signatureStatus: 'development-unsigned',
      applyAllowed: true,
      confirmation: 'course-app@1.0.0',
      blockers: [],
      changes: [{ path: 'apps/console/src/apps/course-app/App.tsx', action: 'add' }],
      options: { adoptExisting: false, allowDowngrade: false },
      createdAt: '2026-09-18T00:00:00Z',
      updatedAt: '2026-09-18T00:00:00Z',
      createdBy: { uid: 'admin-1', email: 'admin@example.com' },
      sourceRegistration: { required: true, status: 'pending' },
    };
    const inspectPackage = vi.fn(async () => packageJob);
    const applyJob = vi.fn(async () => ({ ...packageJob, status: 'succeeded' as const, applyAllowed: false }));
    const activateSource = vi.fn(async () => ({ ...packageJob, status: 'succeeded' as const, applyAllowed: false,
      sourceRegistration: { required: true, status: 'succeeded' as const } }));
    const packageApi: AppPackageApi = {
      listJobs: vi.fn(async () => []),
      inspectPackage,
      applyJob,
      activateSource,
    };
    const api: AccessControlApi = {
      listMembers: vi.fn(async () => ({ members: [member], nextCursor: null })),
      listPolicies: vi.fn(async () => policies),
      listInstallations: vi.fn(async () => installations),
      reorderInstallations: vi.fn(async () => installations),
      updateMember: vi.fn(async () => member),
      setGrant: vi.fn(async () => member),
      setPolicy: vi.fn(async (_appKey, patch) => ({ ...policies[0], ...patch })),
      updateInstallation: vi.fn(async () => installations[0]),
    };

    render(<AccessControlWorkspace actor={admin} api={api} packageApi={packageApi} />);
    await user.click(await screen.findByRole('tab', { name: 'App 管理' }));
    const input = screen.getByLabelText('App 套件 ZIP') as HTMLInputElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    const file = new File(['zip'], 'course-app-1.0.0.zip', { type: 'application/zip' });
    await user.upload(input, file);
    await user.click(screen.getByRole('button', { name: '預檢 ZIP' }));
    await waitFor(() => expect(inspectPackage).toHaveBeenCalledWith(
      file, { adoptExisting: false, allowDowngrade: false }, undefined,
    ));
    const confirmation = screen.getByLabelText('輸入「course-app@1.0.0」才可套用');
    const applyButton = screen.getByRole('button', { name: '套用來源套件' });
    expect(applyButton.hasAttribute('disabled')).toBe(true);
    await user.type(confirmation, 'course-app@1.0.0');
    expect(applyButton.hasAttribute('disabled')).toBe(false);
    await user.click(applyButton);
    await waitFor(() => expect(applyJob).toHaveBeenCalledWith(
      packageJob.jobId, 'course-app@1.0.0', undefined,
    ));
    expect(await screen.findByText(/來源套件已完成驗證與套用/)).toBeTruthy();
    expect(screen.getByText(/目前網站版本尚未包含此 App 版本/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '同步平台資料' }).hasAttribute('disabled')).toBe(true);
    expect(activateSource).not.toHaveBeenCalled();
  });

  test('activates an App already compiled into this website without requiring a ZIP', async () => {
    const user = userEvent.setup();
    const activated: AppInstallation = {
      appKey: 'options-strategy-lab', displayName: '選擇權策略分析', status: 'installed',
      category: 'application', removable: true, protected: false, requiredServices: [],
      updatedAt: '2026-10-09T00:00:00Z',
    };
    const activateBundledApp = vi.fn(async () => activated);
    const api: AccessControlApi = {
      listMembers: vi.fn(async () => ({ members: [member], nextCursor: null })),
      listPolicies: vi.fn(async () => policies),
      listInstallations: vi.fn(async () => installations),
      reorderInstallations: vi.fn(async () => installations),
      updateMember: vi.fn(async () => member),
      setGrant: vi.fn(async () => member),
      setPolicy: vi.fn(async () => policies[0]),
      updateInstallation: vi.fn(async () => installations[0]),
      activateBundledApp,
    };
    render(<AccessControlWorkspace actor={admin} api={api} />);
    await user.click(await screen.findByRole('tab', { name: 'App 管理' }));
    await user.click(screen.getByRole('button', { name: '啟用現有 App' }));
    await waitFor(() => expect(activateBundledApp).toHaveBeenCalledWith(
      'options-strategy-lab', expect.objectContaining({ defaultAccessMode: 'admins_only' }), undefined,
    ));
    expect(await screen.findByText('選擇權策略分析')).toBeTruthy();
  });

  test('sends bundled activation through the authenticated Identity API', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      appKey: 'options-strategy-lab', status: 'installed',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const api = createAccessControlApi(vi.fn(async () => 'firebase-id-token'), request);
    await api.activateBundledApp?.('options-strategy-lab', {
      displayName: '選擇權策略分析', category: 'application', removable: true, protected: false,
      defaultAccessMode: 'admins_only', allowedAccessModes: ['admins_only'], entitlements: [], adminAllowed: true,
    });
    expect(request).toHaveBeenCalledWith(
      '/api/identity/v1/admin/app-installations/options-strategy-lab/source-activation',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer firebase-id-token' }) }),
    );
  });

  test('allows source sync when a completed App matches the current website bundle', async () => {
    const user = userEvent.setup();
    const job: AppPackageJob = {
      schemaVersion: 1, jobId: '11111111-1111-4111-8111-111111111111',
      fileName: 'options-strategy-lab-0.8.0.zip', status: 'succeeded', appKey: 'options-strategy-lab', version: '0.8.0',
      installStatus: 'new', packageSha256: 'a'.repeat(64), planFingerprint: 'b'.repeat(64),
      planContext: {
        platformContractDigest: 'c'.repeat(64), serviceRegistryDigest: 'd'.repeat(64),
        packageLockDigest: 'e'.repeat(64), installationContextDigest: 'f'.repeat(64),
      },
      signatureStatus: 'development-unsigned', applyAllowed: false,
      confirmation: 'options-strategy-lab@0.8.0', blockers: [], changes: [],
      options: { adoptExisting: false, allowDowngrade: false },
      createdAt: '2026-09-18T00:00:00Z', updatedAt: '2026-09-18T00:00:00Z',
      createdBy: { uid: 'admin-1', email: 'admin@example.com' },
      sourceRegistration: { required: true, status: 'succeeded' },
    };
    const activateSource = vi.fn(async () => job);
    const packageApi: AppPackageApi = {
      listJobs: vi.fn(async () => [job]), inspectPackage: vi.fn(), applyJob: vi.fn(), activateSource,
    };
    const api: AccessControlApi = {
      listMembers: vi.fn(async () => ({ members: [member], nextCursor: null })),
      listPolicies: vi.fn(async () => policies),
      listInstallations: vi.fn(async () => installations),
      reorderInstallations: vi.fn(async () => installations),
      updateMember: vi.fn(async () => member),
      setGrant: vi.fn(async () => member),
      setPolicy: vi.fn(async (_appKey, patch) => ({ ...policies[0], ...patch })),
      updateInstallation: vi.fn(async () => installations[0]),
    };

    render(<AccessControlWorkspace actor={admin} api={api} packageApi={packageApi} />);
    await user.click(await screen.findByRole('tab', { name: 'App 管理' }));
    await user.click(await screen.findByRole('button', { name: '同步平台資料' }));
    await waitFor(() => expect(activateSource).toHaveBeenCalledWith(job.jobId, undefined));
  });

  test('sends ZIP bytes and apply confirmation to the same-origin Package Agent', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ jobs: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const api = createAppPackageApi(vi.fn(async () => 'firebase-id-token'), request);

    await api.inspectPackage(new File(['zip'], '課程.zip', { type: 'application/zip' }), {
      adoptExisting: true, allowDowngrade: false,
    });

    expect(request).toHaveBeenCalledWith(
      '/api/app-packages/v1/inspect?adoptExisting=true&allowDowngrade=false',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer firebase-id-token',
          'Content-Type': 'application/zip',
          'X-StratExec-Package-Name': '__.zip',
        }),
      }),
    );

    await api.installAndPublish?.('11111111-1111-4111-8111-111111111111', 'options-strategy-lab@0.8.0', 'fixture-installation');
    expect(request).toHaveBeenCalledWith(
      '/api/app-packages/v1/jobs/11111111-1111-4111-8111-111111111111/frontend-release',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ confirmation: 'options-strategy-lab@0.8.0', installationKey: 'fixture-installation' }),
      }),
    );
  });

  test('renders deployment-schema settings and requires confirmation for a high-impact value', async () => {
    const user = userEvent.setup();
    const appSettings: DeploymentSettingsDocument = {
      schemaVersion: 1,
      scope: 'app',
      installation: { installationKey: 'customer-a', projectId: 'customer-a-project', region: 'asia-east1' },
      appKey: 'premium-course',
      appVersion: '0.1.0',
      secretManagerMode: 'disabled',
      platformConfiguration: { managedSeparately: true, endpoint: '/platform-settings' },
      services: [{
        serviceKey: 'course-content-api',
        configuration: [{
          name: 'RATE_LIMIT', source: 'operator-input', purpose: 'quota',
          input: { label: '每位會員每分鐘查詢上限', type: 'integer', required: true, impact: 'high', description: null, default: 60, minimum: 10, maximum: 600 },
          current: null,
        }],
        secrets: [],
      }],
      stateRevision: 0,
    };
    const platformSettings: DeploymentSettingsDocument = {
      ...appSettings,
      scope: 'platform', appKey: 'platform', appVersion: 'platform', services: [],
      platformConfiguration: { oauthBrandDisplayName: 'Customer A', supportEmail: 'owner@example.com', authorizedDomains: ['example.com'], note: 'separate' },
    };
    const setConfiguration = vi.fn(async () => ({}));
    const settingsApi: DeploymentSettingsApi = {
      getAppSettings: vi.fn(async () => appSettings),
      getPlatformSettings: vi.fn(async () => platformSettings),
      setConfiguration,
      createSecretVersion: vi.fn(), setSecretReference: vi.fn(), disableSecretVersion: vi.fn(),
      rollbackSecret: vi.fn(), deleteSecret: vi.fn(),
    };
    const api: AccessControlApi = {
      listMembers: vi.fn(async () => ({ members: [member], nextCursor: null })), listPolicies: vi.fn(async () => policies),
      listInstallations: vi.fn(async () => installations), updateMember: vi.fn(async () => member),
      reorderInstallations: vi.fn(async () => installations),
      setGrant: vi.fn(async () => member), setPolicy: vi.fn(async (_key, patch) => ({ ...policies[0], ...patch })),
      updateInstallation: vi.fn(async () => installations[0]),
    };
    render(<AccessControlWorkspace actor={admin} api={api} settingsApi={settingsApi} installationKey="customer-a" />);
    await user.click(await screen.findByRole('tab', { name: 'App 管理' }));
    await user.click(screen.getByRole('button', { name: '設定' }));
    expect(await screen.findByText('OAuth 品牌：Customer A')).toBeTruthy();
    const value = screen.getByLabelText(/每位會員每分鐘查詢上限/) as HTMLInputElement;
    await user.clear(value);
    await user.type(value, '120');
    const confirmation = screen.getByLabelText(/輸入「SET premium-course\/course-content-api\/RATE_LIMIT」確認/);
    await user.type(confirmation, 'SET premium-course/course-content-api/RATE_LIMIT');
    await user.click(screen.getByRole('button', { name: '儲存設定' }));
    await waitFor(() => expect(setConfiguration).toHaveBeenCalledWith(
      'customer-a', 'premium-course', 'course-content-api', 'RATE_LIMIT', 120,
      'SET premium-course/course-content-api/RATE_LIMIT', undefined,
    ));
  });

  test('sends write-only secret input to the protected Deployment Agent route', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      secretResource: 'projects/customer-a-project/secrets/course-key', version: '2', state: 'ENABLED',
      createTime: null, updatedAt: '2026-09-18T00:00:00Z', updatedBy: { uid: 'admin-1', email: 'admin@example.com' },
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    const api = createDeploymentSettingsApi(vi.fn(async () => 'firebase-id-token'), request);
    await api.createSecretVersion('customer-a', 'course-app', 'course-api', 'COURSE_API_KEY', 'write-only-value');
    expect(request).toHaveBeenCalledWith(
      '/api/deployments/v1/installations/customer-a/apps/course-app/settings/services/course-api/secrets/COURSE_API_KEY/versions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer firebase-id-token', 'Content-Type': 'application/json' }),
        body: JSON.stringify({ secretValue: 'write-only-value' }),
      }),
    );
  });
});
