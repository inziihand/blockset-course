import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { FileCheck2, GripVertical, PackageCheck, Power, RotateCcw, Settings2, ShieldCheck, Trash2, Upload, UserRoundCog } from 'lucide-react';
import type { ShellAppProps } from '../../shell/types';
import { useAuth } from '../../shared/auth';
import type { IdentityMember } from '../../shared/auth/identityClient';
import { Button, ConfirmDialog, EmptyState, ErrorState, Field, LoadingState } from '../../shared/ui/controls';
import { FolderTabs, StatusBanner } from '../../shared/ui/patterns';
import { notifyAppLifecycleChanged, notifyAppOrderChanged, notifyAppPolicyChanged } from '../../shared/api/appLifecycle';
import {
  createAccessControlApi,
  type AccessControlApi,
  type AppAccessMode,
  type AppGrantPatch,
  type AppInstallation,
  type AppLifecycleAction,
  type AppPolicy,
} from './access-control-client';
import { createAppPackageApi, type AppPackageApi, type AppPackageJob } from './app-package-client';
import { createDeploymentSettingsApi, type DeploymentSettingsApi } from './deployment-settings-client';
import { DeploymentSettingsEditor } from './DeploymentSettingsEditor';
import { createDeploymentApi, type DeploymentApi } from './deployment-client';
import { DeploymentLifecycleManager } from './DeploymentLifecycleManager';
import './access-control.css';

type Tab = 'members' | 'apps' | 'management';
const tabs = [
  { value: 'members', label: '會員' },
  { value: 'apps', label: 'App 權限' },
  { value: 'management', label: 'App 管理' },
] as const;
const accessModeLabels: Record<AppAccessMode, string> = {
  public: '未登入亦可用',
  all_members: '所有登入會員',
  grant_required: '需要個別授權',
  admins_only: '僅管理員',
  disabled: '暫停開放',
};

const adminManagedAccessModes: AppAccessMode[] = ['public', 'all_members', 'grant_required'];
const MEMBER_PAGE_SIZE = 10;

export default function AccessControlApp({ signal }: ShellAppProps) {
  const { member, getIdToken } = useAuth();
  const api = useMemo(() => createAccessControlApi(getIdToken), [getIdToken]);
  const packageApi = useMemo(() => createAppPackageApi(getIdToken), [getIdToken]);
  const settingsApi = useMemo(() => createDeploymentSettingsApi(getIdToken), [getIdToken]);
  const deploymentApi = useMemo(() => createDeploymentApi(getIdToken), [getIdToken]);
  const installationKey = import.meta.env.VITE_STRATEXEC_INSTALLATION_KEY?.trim() ?? '';
  if (!member || member.role !== 'admin') {
    return <ErrorState title="需要平台管理員權限"><p>Google 登入只確認身分；此 App 仍由 Identity API 驗證管理員角色。</p></ErrorState>;
  }
  return <AccessControlWorkspace actor={member} api={api} packageApi={packageApi}
    settingsApi={settingsApi} deploymentApi={deploymentApi} installationKey={installationKey} signal={signal} />;
}

export function AccessControlWorkspace({ actor, api, packageApi, settingsApi, deploymentApi, installationKey = '', signal }: {
  actor: IdentityMember;
  api: AccessControlApi;
  packageApi?: AppPackageApi;
  settingsApi?: DeploymentSettingsApi;
  deploymentApi?: DeploymentApi;
  installationKey?: string;
  signal?: AbortSignal;
}) {
  const [tab, setTab] = useState<Tab>('members');
  const [members, setMembers] = useState<IdentityMember[]>([]);
  const [policies, setPolicies] = useState<AppPolicy[]>([]);
  const [installations, setInstallations] = useState<AppInstallation[]>([]);
  const [selectedUid, setSelectedUid] = useState('');
  const [memberCursor, setMemberCursor] = useState<string | null>(null);
  const [memberCursorHistory, setMemberCursorHistory] = useState<Array<string | null>>([]);
  const [nextMemberCursor, setNextMemberCursor] = useState<string | null>(null);
  const [memberPagePending, setMemberPagePending] = useState(false);
  const [memberPageError, setMemberPageError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [memberPage, nextPolicies, nextInstallations] = await Promise.all([
        api.listMembers({ limit: MEMBER_PAGE_SIZE }, signal), api.listPolicies(signal), api.listInstallations(signal),
      ]);
      setMembers(memberPage.members);
      setMemberCursor(null);
      setMemberCursorHistory([]);
      setNextMemberCursor(memberPage.nextCursor);
      setMemberPageError('');
      setPolicies(nextPolicies);
      setInstallations(nextInstallations);
      setSelectedUid((current) => memberPage.members.some((item) => item.uid === current)
        ? current : memberPage.members[0]?.uid || '');
    } catch (caught) {
      if (!signal?.aborted) setError(caught instanceof Error ? caught.message : '無法載入會員權限。');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [api, signal]);

  const showMemberPage = useCallback(async (cursor: string | null) => {
    setMemberPagePending(true);
    setMemberPageError('');
    try {
      const memberPage = await api.listMembers({ limit: MEMBER_PAGE_SIZE, cursor }, signal);
      if (signal?.aborted) return false;
      setMembers(memberPage.members);
      setNextMemberCursor(memberPage.nextCursor);
      setSelectedUid((current) => memberPage.members.some((item) => item.uid === current)
        ? current : memberPage.members[0]?.uid || '');
      return true;
    } catch (caught) {
      if (!signal?.aborted) {
        setMemberPageError(caught instanceof Error ? caught.message : '無法載入這一頁會員。');
      }
      return false;
    } finally {
      if (!signal?.aborted) setMemberPagePending(false);
    }
  }, [api, signal]);

  const showNextMemberPage = async () => {
    if (!nextMemberCursor || memberPagePending) return;
    const cursor = nextMemberCursor;
    if (await showMemberPage(cursor)) {
      setMemberCursorHistory((current) => [...current, memberCursor]);
      setMemberCursor(cursor);
    }
  };

  const showPreviousMemberPage = async () => {
    if (memberCursorHistory.length === 0 || memberPagePending) return;
    const cursor = memberCursorHistory.at(-1) ?? null;
    if (await showMemberPage(cursor)) {
      setMemberCursorHistory((current) => current.slice(0, -1));
      setMemberCursor(cursor);
    }
  };

  useEffect(() => { void load(); }, [load]);
  const selected = members.find((member) => member.uid === selectedUid) ?? null;
  const installedAppKeys = new Set(
    installations.filter((installation) => installation.status === 'installed' && (
      installation.protected || installation.requiredServices.length === 0 || Boolean(
        installation.deploymentJobId && installation.runtimeRevision && installation.runtimeVerifiedAt,
      )
    )).map((installation) => installation.appKey),
  );
  const installedPolicies = policies.filter((policy) => installedAppKeys.has(policy.appKey));
  const replaceMember = (updated: IdentityMember) => {
    setMembers((current) => current.map((member) => member.uid === updated.uid ? updated : member));
  };
  const run = async (key: string, action: () => Promise<void>) => {
    setPending(key);
    setError('');
    try { await action(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '權限異動失敗。'); }
    finally { setPending(''); }
  };

  return <div className="access-control-app">
    <StatusBanner title="伺服器端權限" icon={<ShieldCheck size={17} />} tone="info">
      登入只建立會員身分；付費或指定 App 仍需有效授權。所有異動由 Identity API 寫入稽核紀錄。
    </StatusBanner>
    <div className="platform-folder-stack">
      <FolderTabs id="access-control-tab" ariaLabel="會員與 App 權限" items={tabs} value={tab}
        panelId="access-control-panel" onChange={setTab} />
      <section id="access-control-panel" className="platform-folder-panel" role="tabpanel"
        aria-labelledby={`access-control-tab-${tab}`}>
        {loading ? <LoadingState message="正在載入會員與 App 權限…" /> : error && members.length === 0
          ? <ErrorState><p>{error}</p><Button onClick={() => void load()}>重試 Identity API</Button></ErrorState>
          : tab === 'members'
            ? <MembersPanel members={members} policies={installedPolicies} selected={selected} pending={pending}
                page={memberCursorHistory.length + 1} pagePending={memberPagePending} pageError={memberPageError}
                hasPrevious={memberCursorHistory.length > 0} hasNext={Boolean(nextMemberCursor)}
                onPrevious={() => void showPreviousMemberPage()} onNext={() => void showNextMemberPage()}
                onSelect={setSelectedUid} onUpdate={(uid, patch) => run(`member:${uid}`, async () => {
                  replaceMember(await api.updateMember(uid, patch, signal));
                })}
                onGrant={(uid, appKey, patch) => run(`grant:${uid}:${appKey}`, async () => {
                  replaceMember(await api.setGrant(uid, appKey, patch, signal));
                })} />
            : tab === 'apps'
              ? <PoliciesPanel policies={installedPolicies} pending={pending} onUpdate={(policy, accessMode, adminAllowed) =>
                  run(`policy:${policy.appKey}`, async () => {
                    const updated = await api.setPolicy(policy.appKey, { accessMode, adminAllowed }, signal);
                    setPolicies((current) => current.map((item) => item.appKey === updated.appKey ? updated : item));
                    notifyAppPolicyChanged();
                  })} />
              : <AppManagementPanel installations={installations} pending={pending} packageApi={packageApi}
                  settingsApi={settingsApi} deploymentApi={deploymentApi} installationKey={installationKey} signal={signal}
                  onReload={load}
                  onReorder={(nextInstallations) => {
                    const previousInstallations = installations;
                    setInstallations(nextInstallations);
                    void run('app-order', async () => {
                      try {
                        const saved = await api.reorderInstallations(
                          nextInstallations.map((installation) => installation.appKey), signal,
                        );
                        setInstallations(saved);
                        notifyAppOrderChanged(saved.map((installation) => installation.appKey));
                      } catch (caught) {
                        setInstallations(previousInstallations);
                        throw caught;
                      }
                    });
                  }}
                  onAction={(installation, action) => run(`lifecycle:${installation.appKey}`, async () => {
                    const updated = await api.updateInstallation(installation.appKey, action, signal);
                    setInstallations((current) => current.map((item) => item.appKey === updated.appKey ? updated : item));
                    notifyAppLifecycleChanged();
                  })} />}
        {error && members.length > 0 && <p className="access-control-error" role="alert">{error}</p>}
        <p className="access-control-actor">目前管理者：{actor.email}</p>
      </section>
    </div>
  </div>;
}

const installationStatusLabels = {
  installed: '已安裝', disabled: '已停用', uninstalled: '未安裝',
} as const;

function AppManagementPanel({ installations, pending, packageApi, settingsApi, deploymentApi, installationKey, signal, onReload, onReorder, onAction }: {
  installations: AppInstallation[];
  pending: string;
  packageApi?: AppPackageApi;
  settingsApi?: DeploymentSettingsApi;
  deploymentApi?: DeploymentApi;
  installationKey: string;
  signal?: AbortSignal;
  onReload(): Promise<void>;
  onReorder(installations: AppInstallation[]): void;
  onAction(installation: AppInstallation, action: AppLifecycleAction): void;
}) {
  const [removeTarget, setRemoveTarget] = useState<AppInstallation | null>(null);
  const [settingsTarget, setSettingsTarget] = useState<{ appKey: string; displayName: string } | null>(null);
  const [packageJobs, setPackageJobs] = useState<AppPackageJob[]>([]);
  const [confirmation, setConfirmation] = useState('');
  const [draggedAppKey, setDraggedAppKey] = useState('');
  const [dragOverAppKey, setDragOverAppKey] = useState('');
  const closeConfirmation = () => { setRemoveTarget(null); setConfirmation(''); };
  const reorder = (sourceAppKey: string, targetAppKey: string) => {
    const sourceIndex = installations.findIndex((item) => item.appKey === sourceAppKey);
    const targetIndex = installations.findIndex((item) => item.appKey === targetAppKey);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex || pending) return;
    const nextInstallations = [...installations];
    const [moved] = nextInstallations.splice(sourceIndex, 1);
    nextInstallations.splice(targetIndex, 0, moved);
    onReorder(nextInstallations);
  };
  const clearDragState = () => { setDraggedAppKey(''); setDragOverAppKey(''); };
  return <>
    {packageApi && <AppPackageInstaller api={packageApi} signal={signal} onJobsChange={setPackageJobs}
      onRegistered={onReload} />}
    {deploymentApi && <DeploymentLifecycleManager api={deploymentApi} packageJobs={packageJobs}
      installations={installations} installationKey={installationKey} signal={signal}
      onOpenSettings={(appKey, displayName) => setSettingsTarget({ appKey, displayName })}
      onActivated={onReload} />}
    {installations.length === 0 && <EmptyState title="目前沒有已登錄 App；可先上傳套件並完成部署驗證" />}
    <div className="access-app-management" role="list" aria-label="App 安裝狀態">
      {installations.map((installation, index) => {
        const busy = pending === `lifecycle:${installation.appKey}`;
        return <article key={installation.appKey} role="listitem"
          className={`${draggedAppKey === installation.appKey ? 'is-dragging' : ''} ${dragOverAppKey === installation.appKey ? 'is-drag-over' : ''}`.trim()}
          onDragEnter={() => { if (draggedAppKey && draggedAppKey !== installation.appKey) setDragOverAppKey(installation.appKey); }}
          onDragOver={(event) => { if (draggedAppKey && draggedAppKey !== installation.appKey) event.preventDefault(); }}
          onDrop={(event) => {
            event.preventDefault();
            reorder(event.dataTransfer.getData('text/plain') || draggedAppKey, installation.appKey);
            clearDragState();
          }}>
          <button type="button" className="access-app-drag-handle" draggable={!pending}
            disabled={Boolean(pending)} aria-label={`調整 ${installation.displayName} 排序`}
            title="拖曳調整順序；也可用鍵盤上下方向鍵"
            onDragStart={(event) => {
              setDraggedAppKey(installation.appKey);
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', installation.appKey);
            }}
            onDragEnd={clearDragState}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp' && index > 0) {
                event.preventDefault();
                reorder(installation.appKey, installations[index - 1].appKey);
              }
              if (event.key === 'ArrowDown' && index < installations.length - 1) {
                event.preventDefault();
                reorder(installation.appKey, installations[index + 1].appKey);
              }
            }}><GripVertical size={18} aria-hidden="true" /></button>
          <div className="access-app-identity">
            <PackageCheck size={18} aria-hidden="true" />
            <span><strong>{installation.displayName}</strong><small>{installation.appKey} · {installation.category === 'sample' ? '範例 App' : installation.category === 'core' ? '平台核心' : '一般 App'}</small></span>
          </div>
          <div className="access-app-runtime">
            <span className={`access-installation-status is-${installation.status}`}>{installationStatusLabels[installation.status]}</span>
            <small>{installation.requiredServices.length > 0 ? `相依服務：${installation.requiredServices.join('、')}` : '無獨立後端服務'}</small>
          </div>
          <div className="access-app-actions">
            {!installation.protected && installation.status === 'installed' && installation.requiredServices.length > 0
              && <Button className="access-lifecycle-action" disabled={!settingsApi || !installationKey || busy}
                title={!installationKey ? '尚未設定 VITE_STRATEXEC_INSTALLATION_KEY' : undefined}
                onClick={() => setSettingsTarget(installation)}><Settings2 size={14} />設定</Button>}
            {installation.protected ? <span className="access-protected-label"><ShieldCheck size={14} />系統保護</span> : <>
              {installation.status === 'installed' && <Button className="access-lifecycle-action" disabled={busy} onClick={() => onAction(installation, 'disable')}><Power size={14} />停用</Button>}
              {installation.status === 'disabled' && installation.requiredServices.length === 0 && <Button className="access-lifecycle-action" disabled={busy} onClick={() => onAction(installation, 'enable')}><RotateCcw size={14} />重新啟用</Button>}
              {installation.status === 'uninstalled' && installation.requiredServices.length === 0 && <Button className="access-lifecycle-action" disabled={busy} onClick={() => onAction(installation, 'install')}><PackageCheck size={14} />安裝</Button>}
              {['disabled', 'uninstalled'].includes(installation.status) && installation.requiredServices.length > 0
                && <span className="access-verified-required">須由已驗證部署重新啟用</span>}
              {installation.removable && installation.status !== 'uninstalled' && <Button className="access-lifecycle-action" disabled={busy}
                onClick={() => { setRemoveTarget(installation); setConfirmation(''); }}><Trash2 size={14} />移除</Button>}
            </>}
          </div>
        </article>;
      })}
    </div>
    {settingsTarget && settingsApi && installationKey && <DeploymentSettingsEditor
      api={settingsApi} installationKey={installationKey} appKey={settingsTarget.appKey}
      displayName={settingsTarget.displayName} signal={signal} onClose={() => setSettingsTarget(null)} />}
    <ConfirmDialog open={Boolean(removeTarget)} title="從平台移除 App" confirmLabel="確認移除"
      pending={Boolean(removeTarget && pending === `lifecycle:${removeTarget.appKey}`)}
      confirmDisabled={!removeTarget || confirmation !== removeTarget.displayName}
      onClose={closeConfirmation} onConfirm={() => {
        if (!removeTarget || confirmation !== removeTarget.displayName) return;
        onAction(removeTarget, 'uninstall');
        closeConfirmation();
      }}>
      <div className="access-remove-confirmation">
        <p>移除後將立即隱藏導覽並阻擋直接網址；App 程式、設定資料及相依服務會保留，之後可重新安裝。</p>
        {removeTarget && <Field label={`請輸入「${removeTarget.displayName}」確認`} value={confirmation}
          autoComplete="off" onChange={(event) => setConfirmation(event.currentTarget.value)} />}
      </div>
    </ConfirmDialog>
  </>;
}

function AppPackageInstaller({ api, signal, onJobsChange, onRegistered }: {
  api: AppPackageApi;
  signal?: AbortSignal;
  onJobsChange?(jobs: AppPackageJob[]): void;
  onRegistered(): Promise<void>;
}) {
  const fileInputId = useId();
  const [jobs, setJobs] = useState<AppPackageJob[]>([]);
  const [selectedJob, setSelectedJob] = useState<AppPackageJob | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [adoptExisting, setAdoptExisting] = useState(false);
  const [allowDowngrade, setAllowDowngrade] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState<'loading' | 'inspect' | 'apply' | 'register' | ''>('loading');
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState('');

  const loadJobs = useCallback(async () => {
    setBusy('loading');
    setError('');
    try {
      const next = await api.listJobs(signal);
      setJobs(next);
      setSelectedJob((current) => current ?? next[0] ?? null);
      onJobsChange?.(next);
      setAvailable(true);
    }
    catch (caught) {
      if (!signal?.aborted) {
        setAvailable(false);
        setError(caught instanceof Error ? caught.message : 'App Package Agent 無法連線。');
      }
    } finally {
      if (!signal?.aborted) setBusy('');
    }
  }, [api, onJobsChange, signal]);

  useEffect(() => { void loadJobs(); }, [loadJobs]);
  const replaceJob = (next: AppPackageJob) => {
    setJobs((current) => {
      const updated = [next, ...current.filter((job) => job.jobId !== next.jobId)];
      onJobsChange?.(updated);
      return updated;
    });
    setSelectedJob(next);
  };
  const inspect = async () => {
    if (!file) return;
    setBusy('inspect');
    setError('');
    setConfirmation('');
    try { replaceJob(await api.inspectPackage(file, { adoptExisting, allowDowngrade }, signal)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'App 套件預檢失敗。'); }
    finally { setBusy(''); }
  };
  const apply = async () => {
    if (!selectedJob) return;
    setBusy('apply');
    setError('');
    try {
      replaceJob(await api.applyJob(selectedJob.jobId, confirmation, signal));
      await onRegistered();
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'App 套件套用失敗。'); }
    finally { setBusy(''); }
  };
  const activateSource = async () => {
    if (!selectedJob) return;
    setBusy('register');
    setError('');
    try {
      replaceJob(await api.activateSource(selectedJob.jobId, signal));
      await onRegistered();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'App 平台登錄失敗。'); }
    finally { setBusy(''); }
  };
  const changeCounts = selectedJob?.changes.reduce<Record<string, number>>((counts, change) => {
    counts[change.action] = (counts[change.action] ?? 0) + 1;
    return counts;
  }, {}) ?? {};
  const statusLabels: Record<AppPackageJob['status'], string> = {
    ready: '可套用', blocked: '已阻擋', applying: '套用中', succeeded: '已完成', failed: '失敗', 'no-op': '無差異',
  };
  const actionLabels = { add: '新增', update: '更新', delete: '刪除', unchanged: '未變更' } as const;
  const needsRegistration = Boolean(selectedJob && ['succeeded', 'no-op'].includes(selectedJob.status)
    && selectedJob.sourceRegistration?.required
    && selectedJob.sourceRegistration.status !== 'succeeded');

  return <section className="access-package-installer" aria-labelledby="app-package-installer-title">
    <header>
      <div><h3 id="app-package-installer-title"><Upload size={17} />安裝 App ZIP</h3>
        <p>Package Agent 在本機隔離檢查套件；瀏覽器不直接修改平台原始碼。</p></div>
    </header>
    <div className="access-package-controls">
      <div className="access-package-file">
        <span className="access-package-control-label">App 套件 ZIP</span>
        <label className="access-package-picker" htmlFor={fileInputId}>
          <input id={fileInputId} className="access-package-file-input" aria-label="App 套件 ZIP"
            type="file" accept=".zip,application/zip" disabled={!available || Boolean(busy)}
            onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)} />
          <span className="access-package-picker-icon"><Upload size={18} aria-hidden="true" /></span>
          <span className="access-package-picker-copy">
            <strong>{file ? '已選擇套件' : '選擇 App 套件'}</strong>
            <small>{file?.name ?? '僅支援 .zip 檔案'}</small>
          </span>
          <span className="access-package-picker-action">{file ? '更換檔案' : '瀏覽檔案'}</span>
        </label>
      </div>
      <div className="access-package-options" role="group" aria-labelledby="access-package-options-label">
        <span id="access-package-options-label" className="access-package-control-label">進階選項</span>
        <div className="access-package-option-grid">
          <label><input type="checkbox" checked={adoptExisting} disabled={!available || Boolean(busy)}
            onChange={(event) => setAdoptExisting(event.currentTarget.checked)} />
            <span><strong>接管既有未管理 App</strong><small>將既有來源納入平台套件管理</small></span>
          </label>
          <label><input type="checkbox" checked={allowDowngrade} disabled={!available || Boolean(busy)}
            onChange={(event) => setAllowDowngrade(event.currentTarget.checked)} />
            <span><strong>允許降版預檢</strong><small>只放寬版本檢查，不會直接套用</small></span>
          </label>
        </div>
      </div>
    </div>
    <div className="access-package-toolbar">
      <span className={available ? 'is-connected' : ''}>
        {busy === 'loading' ? '正在連線 Package Agent…' : available ? 'Package Agent 已連線' : 'Package Agent 未連線'}
      </span>
      <Button className="access-package-inspect" disabled={!available || !file || Boolean(busy)} onClick={() => void inspect()}>
        <FileCheck2 size={15} />{busy === 'inspect' ? '預檢中…' : '預檢 ZIP'}
      </Button>
    </div>
    {error && <div className="access-retry-error">
      <p className="access-package-error" role="alert">{error}</p>
      {!available && <Button disabled={Boolean(busy)} onClick={() => void loadJobs()}>重試 Package Agent</Button>}
    </div>}
    {selectedJob && <div className="access-package-report">
      <div className="access-package-summary">
        <span><strong>{selectedJob.appKey}@{selectedJob.version}</strong><small>{selectedJob.fileName}</small></span>
        <em className={`is-${selectedJob.status}`}>{statusLabels[selectedJob.status]}</em>
      </div>
      <p>差異：新增 {changeCounts.add ?? 0}、更新 {changeCounts.update ?? 0}、刪除 {changeCounts.delete ?? 0}、未變更 {changeCounts.unchanged ?? 0}</p>
      <p className={`access-package-trust ${selectedJob.signatureStatus === 'trusted-signed' ? 'is-trusted' : ''}`}>
        {selectedJob.signatureStatus === 'trusted-signed'
          ? `信任狀態：發布者簽章有效（${selectedJob.publisherId}/${selectedJob.keyId}）。`
          : '信任狀態：未簽章開發套件。預設只能預檢；本機代理需明確啟用 unsigned apply。'}
      </p>
      {selectedJob.blockers.length > 0 && <ul>{selectedJob.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>}
      {selectedJob.changes.length > 0 && <details><summary>檢視檔案差異</summary><ul>
        {selectedJob.changes.slice(0, 100).map((change) => <li key={change.path}><span>{actionLabels[change.action]}</span>{change.path}</li>)}
      </ul></details>}
      {selectedJob.status === 'succeeded' || selectedJob.status === 'no-op'
        ? <>
          <p className="access-package-success">{selectedJob.status === 'succeeded' ? '來源套件已完成驗證與套用。' : '目前來源內容已與此套件一致。'}</p>
          {needsRegistration && <div className="access-package-apply">
            <p>此純前端 App 的平台資料尚未同步；同步後會更新名稱、entitlement 目錄與安裝狀態，但保留管理員選定的整體開放政策。</p>
            <Button disabled={Boolean(busy)} onClick={() => void activateSource()}>
              {busy === 'register' ? '同步中…' : '同步平台資料'}
            </Button>
          </div>}
        </>
        : <div className="access-package-apply">
          <Field label={`輸入「${selectedJob.confirmation}」才可套用`} value={confirmation}
            autoComplete="off" onChange={(event) => setConfirmation(event.currentTarget.value)} />
          <Button disabled={!selectedJob.applyAllowed || confirmation !== selectedJob.confirmation || Boolean(busy)}
            onClick={() => void apply()}>{busy === 'apply' ? '套用中…' : '套用來源套件'}</Button>
        </div>}
    </div>}
    {!selectedJob && jobs.length > 0 && <p className="access-package-history">最近工作：{jobs.slice(0, 3).map((job) => `${job.appKey}@${job.version}（${statusLabels[job.status]}）`).join('、')}</p>}
    {!selectedJob && !error && busy !== 'loading' && jobs.length === 0 && <p className="access-package-history">目前沒有 App 套件工作。</p>}
  </section>;
}

function MembersPanel({
  members, policies, selected, pending, page, pagePending, pageError, hasPrevious, hasNext,
  onPrevious, onNext, onSelect, onUpdate, onGrant,
}: {
  members: IdentityMember[];
  policies: AppPolicy[];
  selected: IdentityMember | null;
  pending: string;
  page: number;
  pagePending: boolean;
  pageError: string;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious(): void;
  onNext(): void;
  onSelect(uid: string): void;
  onUpdate(uid: string, patch: { role?: 'member' | 'admin'; status?: 'active' | 'disabled' }): void;
  onGrant(uid: string, appKey: string, patch: AppGrantPatch): void;
}) {
  return <div className="access-members-layout">
    <div className="access-members-sidebar">
      <div className={`access-members-list${pagePending ? ' is-loading' : ''}`} aria-label="會員清單" aria-busy={pagePending}>
        {members.length === 0
          ? <span className="access-members-empty">本頁沒有會員</span>
          : members.map((member) => <button type="button" key={member.uid}
            className={member.uid === selected?.uid ? 'is-selected' : ''} onClick={() => onSelect(member.uid)}>
            <UserRoundCog size={17} aria-hidden="true" />
            <span><strong>{member.displayName || member.email}</strong><small>{member.email}</small></span>
            <em>{member.status === 'active' ? (member.role === 'admin' ? '管理員' : '會員') : '已停用'}</em>
          </button>)}
      </div>
      <nav className="access-member-pagination" aria-label="會員分頁">
        <Button className="access-member-page-button" disabled={!hasPrevious || pagePending} onClick={onPrevious}>上一頁</Button>
        <span aria-live="polite">第 {page} 頁</span>
        <Button className="access-member-page-button" disabled={!hasNext || pagePending} onClick={onNext}>下一頁</Button>
        {pageError && <small role="alert">{pageError}</small>}
      </nav>
    </div>
    {selected && <div className="access-member-detail">
      <header><div><h3>{selected.displayName || selected.email}</h3><p>{selected.email}</p></div></header>
      <div className="access-member-fields">
        <label>平台角色<select value={selected.role} disabled={pending === `member:${selected.uid}`}
          onChange={(event) => onUpdate(selected.uid, { role: event.target.value as 'member' | 'admin' })}>
          <option value="member">會員</option><option value="admin">管理員</option>
        </select></label>
        <label>會員狀態<select value={selected.status} disabled={pending === `member:${selected.uid}`}
          onChange={(event) => onUpdate(selected.uid, { status: event.target.value as 'active' | 'disabled' })}>
          <option value="active">啟用</option><option value="disabled">停用</option>
        </select></label>
      </div>
      <h4>個別 App 授權</h4>
      <div className="access-grant-list">
        <div className="access-grant-head" aria-hidden="true">
          <span>App</span><span>整體存取</span><span>功能權限</span>
        </div>
        {policies.map((policy) => {
          const grant = selected.appGrants.find((item) => item.appKey === policy.appKey);
          const requiresGrant = policy.accessMode === 'grant_required';
          const busy = pending === `grant:${selected.uid}:${policy.appKey}`;
          const inheritedByAdmin = selected.role === 'admin' && policy.adminAllowed;
          return <div key={policy.appKey} className="access-grant-entry">
            <div className="access-grant-app">
              <span><strong>{policy.displayName}</strong><small>{requiresGrant ? '需要個別授權' : accessModeLabels[policy.accessMode]}</small></span>
            </div>
            <div className="access-grant-control">
              {requiresGrant ? <Button disabled={policy.protected || busy}
                onClick={() => onGrant(selected.uid, policy.appKey, {
                  enabled: !grant?.enabled,
                  entitlements: grant?.entitlements ?? [],
                })}>
                {grant?.enabled ? '撤銷' : '授權'}
              </Button> : <em>依全域政策開放</em>}
            </div>
            <div className={`access-grant-features${policy.entitlements.length === 0 ? ' is-empty' : ''}`}>
            {policy.entitlements.length > 0 ? <fieldset className="access-entitlement-list"
              aria-label={inheritedByAdmin ? '功能權限，管理員依政策全部開放' : '功能權限'}
              disabled={policy.protected || busy || inheritedByAdmin}>
              {inheritedByAdmin && <small className="access-entitlement-note">管理員依政策開放</small>}
              {policy.entitlements.map((entitlement) => {
                const currentEntitlements = grant?.entitlements ?? [];
                const checked = inheritedByAdmin || (grant?.enabled === true && currentEntitlements.includes(entitlement.key));
                return <label key={entitlement.key} title={entitlement.description ?? undefined}>
                  <input type="checkbox" checked={checked} onChange={() => {
                    const entitlements = checked
                      ? currentEntitlements.filter((key) => key !== entitlement.key)
                      : [...new Set([...currentEntitlements, entitlement.key])];
                    onGrant(selected.uid, policy.appKey, {
                      enabled: checked ? grant?.enabled === true : true,
                      entitlements,
                    });
                  }} />
                  <span><strong>{entitlement.displayName}</strong>{entitlement.description && <small>{entitlement.description}</small>}</span>
                </label>;
              })}
            </fieldset> : <span className="access-grant-empty">無額外功能</span>}
            </div>
          </div>;
        })}
      </div>
    </div>}
  </div>;
}

function PoliciesPanel({ policies, pending, onUpdate }: {
  policies: AppPolicy[];
  pending: string;
  onUpdate(policy: AppPolicy, accessMode: AppAccessMode, adminAllowed: boolean): void;
}) {
  if (policies.length === 0) return <EmptyState title="目前沒有已啟用 App" />;
  return <div className="access-policy-table" role="table" aria-label="App 存取政策">
    <div role="row" className="access-policy-head"><span role="columnheader">App</span><span role="columnheader">一般會員政策</span><span role="columnheader">管理員</span></div>
    {policies.map((policy) => {
      const busy = pending === `policy:${policy.appKey}`;
      const selectableModes = policy.protected
        ? policy.allowedAccessModes
        : [...adminManagedAccessModes, ...(
            adminManagedAccessModes.includes(policy.accessMode) ? [] : [policy.accessMode]
          )];
      const adminToggleRelevant = policy.accessMode === 'grant_required' || policy.accessMode === 'admins_only';
      return <div role="row" key={policy.appKey}>
        <span role="cell"><strong>{policy.displayName}</strong><small>{policy.appKey}{policy.protected ? ' · 系統保護' : ''}</small></span>
        <span role="cell"><select aria-label={`${policy.displayName}一般會員政策`} value={policy.accessMode}
          disabled={policy.protected || busy} onChange={(event) => onUpdate(policy, event.target.value as AppAccessMode, policy.adminAllowed)}>
          {selectableModes.map((value) => <option key={value} value={value}>{accessModeLabels[value]}</option>)}
        </select></span>
        <span role="cell"><label><input type="checkbox" checked={policy.adminAllowed}
          disabled={policy.protected || busy || !adminToggleRelevant}
          onChange={(event) => onUpdate(policy, policy.accessMode, event.target.checked)} />可用</label></span>
      </div>;
    })}
  </div>;
}
