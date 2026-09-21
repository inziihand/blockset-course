import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleDot, Download, RefreshCw, RotateCcw, Settings2, ShieldCheck, XCircle } from 'lucide-react';
import { Button, Field } from '../../shared/ui/controls';
import type { AppInstallation } from './access-control-client';
import type { AppPackageJob } from './app-package-client';
import type { DeploymentApi, DeploymentEvent, DeploymentJob } from './deployment-client';

const transient = new Set(['applying', 'verifying', 'promoting', 'rolling-back']);
const sourceReady = (job?: AppPackageJob) => Boolean(job && ['succeeded', 'no-op'].includes(job.status));
const deployed = (job?: DeploymentJob) => Boolean(job?.runtimeEvidence?.revision);
const verified = (job?: DeploymentJob) => job?.status === 'verified' && Boolean(job.verificationEvidence?.verifiedAt);
const stateLabel: Record<string, string> = {
  blocked: '受阻', 'awaiting-approval': '待核准', approved: '已核准', applying: '部署中', applied: '已部署',
  verifying: '驗證中', 'staged-verified': '預備環境已驗證', promoting: '切換流量中', verified: '已驗證',
  failed: '部署失敗', 'verification-failed': '驗證失敗', 'promotion-failed': '流量切換失敗', unknown: '狀態待核對',
  'rolling-back': '回復中', 'rollback-failed': '回復失敗', 'rolled-back': '已回復', cancelled: '已取消',
};
const riskLabel: Record<string, string> = {
  'cost-impact-reviewed': '已檢視費用影響',
  'public-ingress-reviewed': '已檢視公開入口',
  'cloud-resource-change-reviewed': '已檢視雲端資源異動',
  'destructive-change-reviewed': '已檢視破壞性異動',
  'backup-plan-reviewed': '已檢視備份計畫',
  'irreversible-migration-reviewed': '已檢視不可逆資料遷移',
  'vm-bootstrap-and-iam-reviewed': '已確認 VM bootstrap 與 IAM 影響',
  'account-state-and-backup-reviewed': '已確認帳戶狀態、SQLite 與備份',
  'trading-remains-disabled-reviewed': '已了解部署後交易仍保持停用',
};

function StateCell({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return <span className={ok ? 'is-ok' : 'is-pending'}>{ok ? <CheckCircle2 size={14} /> : <CircleDot size={14} />}
    <span><strong>{label}</strong><small>{detail}</small></span></span>;
}

export function DeploymentLifecycleManager({
  api, packageJobs, installations, installationKey, signal, onOpenSettings, onActivated,
}: {
  api: DeploymentApi;
  packageJobs: AppPackageJob[];
  installations: AppInstallation[];
  installationKey: string;
  signal?: AbortSignal;
  onOpenSettings(appKey: string, displayName: string): void;
  onActivated(): Promise<void> | void;
}) {
  const [jobs, setJobs] = useState<DeploymentJob[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [packageJobId, setPackageJobId] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [confirmedRisks, setConfirmedRisks] = useState<string[]>([]);
  const [events, setEvents] = useState<DeploymentEvent[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const readySourcePackages = useMemo(() => packageJobs.filter(sourceReady), [packageJobs]);
  const requiredServicesByApp = useMemo(
    () => new Map(installations.map((installation) => [installation.appKey, installation.requiredServices])),
    [installations],
  );
  const deploymentJobs = useMemo(
    () => jobs.filter((job) => requiredServicesByApp.has(job.appKey)
      ? (requiredServicesByApp.get(job.appKey)?.length ?? 0) > 0
      : (job.plan.app?.requiredServices ?? job.plan.services).length > 0),
    [jobs, requiredServicesByApp],
  );
  const readyPackages = useMemo(
    () => readySourcePackages.filter((job) => requiredServicesByApp.has(job.appKey)
      ? (requiredServicesByApp.get(job.appKey)?.length ?? 0) > 0
      : job.sourceRegistration?.required !== true),
    [readySourcePackages, requiredServicesByApp],
  );
  const frontendOnlyPackages = useMemo(
    () => readySourcePackages.filter((job) => requiredServicesByApp.has(job.appKey)
      ? requiredServicesByApp.get(job.appKey)?.length === 0
      : job.sourceRegistration?.required === true),
    [readySourcePackages, requiredServicesByApp],
  );
  const selected = deploymentJobs.find((job) => job.jobId === selectedId) ?? deploymentJobs[0];

  const load = useCallback(async () => {
    try {
      const next = await api.listJobs(signal);
      setJobs(next);
      setError('');
    } catch (caught) {
      if (!signal?.aborted) setError(caught instanceof Error ? caught.message : 'Deployment Agent 無法連線。');
    }
  }, [api, signal]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!deploymentJobs.some((job) => job.jobId === selectedId)) setSelectedId(deploymentJobs[0]?.jobId ?? '');
  }, [deploymentJobs, selectedId]);
  useEffect(() => {
    if (!jobs.some((job) => transient.has(job.status))) return undefined;
    const timer = window.setInterval(() => void load(), 2_000);
    return () => window.clearInterval(timer);
  }, [jobs, load]);
  useEffect(() => {
    setConfirmation('');
    setConfirmedRisks([]);
  }, [selectedId, selected?.status]);
  useEffect(() => {
    if (!selected?.jobId) { setEvents([]); return; }
    let active = true;
    const refresh = async () => {
      try { const next = await api.events(selected.jobId, signal); if (active) setEvents(next); }
      catch { if (active) setEvents([]); }
    };
    void refresh();
    if (!transient.has(selected.status)) return () => { active = false; };
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [api, selected?.jobId, selected?.status, signal]);

  const replace = (next: DeploymentJob) => {
    setJobs((current) => [next, ...current.filter((job) => job.jobId !== next.jobId)]);
    setSelectedId(next.jobId);
  };
  const run = async (name: string, action: () => Promise<DeploymentJob>, activated = false) => {
    setBusy(name); setError('');
    try {
      replace(await action());
      if (activated) await onActivated();
    } catch (caught) { setError(caught instanceof Error ? caught.message : '部署工作失敗。'); }
    finally { setBusy(''); }
  };
  const inspect = async () => {
    const source = readyPackages.find((job) => job.jobId === packageJobId);
    if (!source || !installationKey) return;
    await run('inspect', () => api.inspect(source.jobId, installationKey, source.appKey, signal));
  };
  const downloadEvidence = async () => {
    if (!selected) return;
    setBusy('evidence'); setError('');
    try {
      const payload = await api.evidence(selected.jobId, signal);
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = `${selected.appKey}-${selected.package.version}-deployment-evidence.json`; link.click();
      URL.revokeObjectURL(url);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '無法下載部署證據。'); }
    finally { setBusy(''); }
  };

  const latestPackage = new Map([...packageJobs].reverse().map((job) => [job.appKey, job]));
  const latestDeployment = new Map([...deploymentJobs].reverse().map((job) => [job.appKey, job]));
  const allAppKeys = [...new Set([...installations.map((item) => item.appKey), ...latestPackage.keys(), ...latestDeployment.keys()])];
  const installationByKey = new Map(installations.map((item) => [item.appKey, item]));
  const allRisksConfirmed = selected?.requiredRiskConfirmations.every((risk) => confirmedRisks.includes(risk)) ?? false;
  const expectedApprove = selected ? `APPROVE ${selected.appKey}@${selected.package.version} ${selected.planFingerprint}` : '';
  const expectedPromote = selected ? `PROMOTE ${selected.appKey}@${selected.package.version} ${selected.planFingerprint.slice(0, 12)}` : '';
  const expectedRollback = selected?.runtimeEvidence?.revision
    ? `ROLLBACK ${selected.appKey}@${selected.package.version} ${selected.runtimeEvidence.revision}` : '';
  const expectedEnable = selected ? `ENABLE ${selected.appKey}@${selected.package.version}` : '';
  const vmRuntime = selected && (selected.verificationEvidence?.services ?? selected.runtimeEvidence?.services ?? [])
    .find((service) => service.runtimeStatus && service.vmHostRef);
  const vmLayers = vmRuntime?.runtimeStatus;

  return <section className="access-deployment-lifecycle" aria-labelledby="deployment-lifecycle-title">
    <header><div><h3 id="deployment-lifecycle-title"><ShieldCheck size={17} />App 完整生命週期</h3>
      <p>來源安裝、後端部署、運行驗證與平台啟用分開記錄；部署期間會自動同步，關閉瀏覽器不會中止伺服器工作。</p></div></header>

    <div className="access-lifecycle-matrix" role="table" aria-label="App 四段狀態">
      <div className="access-lifecycle-head" role="row"><span>App</span><span>來源</span><span>後端</span><span>驗證</span><span>啟用</span></div>
      {allAppKeys.map((appKey) => {
        const app = installationByKey.get(appKey); const source = latestPackage.get(appKey); const job = latestDeployment.get(appKey);
        const frontendOnly = app?.requiredServices.length === 0;
        const logicallyAvailable = app?.status === 'installed' && (
          app.protected || app.requiredServices.length === 0 || Boolean(app.deploymentJobId && app.runtimeRevision && app.runtimeVerifiedAt)
        );
        return <div role="row" key={appKey}>
          <span><strong>{app?.displayName ?? job?.plan.app?.displayName ?? appKey}</strong><small>{appKey}</small></span>
          <StateCell ok={sourceReady(source)} label={sourceReady(source) ? '已套用' : '未完成'} detail={source ? source.status : '無工作'} />
          <StateCell ok={frontendOnly || deployed(job)} label={frontendOnly ? '不需要' : deployed(job) ? '已部署' : '未部署'}
            detail={frontendOnly ? '純前端 App' : job ? stateLabel[job.status] ?? job.status : '無工作'} />
          <StateCell ok={frontendOnly || verified(job)} label={frontendOnly ? '不需要' : verified(job) ? '已驗證' : '未驗證'}
            detail={frontendOnly ? '隨 Console 建置驗證' : job?.verificationEvidence?.verifiedAt ?? '無證據'} />
          <StateCell ok={logicallyAvailable} label={logicallyAvailable ? '可用' : '不可用'}
            detail={app?.status === 'installed' && !logicallyAvailable ? '缺少部署驗證證據' : app?.status ?? '尚未登錄'} />
        </div>;
      })}
    </div>

    <div className="access-deployment-create">
      {readyPackages.length > 0 ? <>
        <label>需部署後端的來源套件<select aria-label="需部署後端的來源套件" value={packageJobId} onChange={(event) => setPackageJobId(event.target.value)}>
          <option value="">選擇套件工作</option>
          {readyPackages.map((job) => <option key={job.jobId} value={job.jobId}>{job.appKey}@{job.version} · {job.fileName}</option>)}
        </select></label>
        <Button disabled={!packageJobId || !installationKey || Boolean(busy)} onClick={() => void inspect()}>
          {busy === 'inspect' ? '建立中…' : '建立部署計畫'}</Button>
        {!installationKey && <small>請先設定 VITE_STRATEXEC_INSTALLATION_KEY。</small>}
      </> : <small className="access-deployment-note">目前沒有需要部署後端的來源套件。</small>}
      {frontendOnlyPackages.length > 0 && <small className="access-deployment-note">
        純前端 App（{frontendOnlyPackages.map((job) => job.appKey).join('、')}）已完成來源套用，不需建立後端部署計畫。
      </small>}
    </div>

    {deploymentJobs.length > 0 && <div className="access-deployment-workspace">
      <label>部署工作<select aria-label="部署工作" value={selected?.jobId ?? ''} onChange={(event) => setSelectedId(event.target.value)}>
        {deploymentJobs.map((job) => <option key={job.jobId} value={job.jobId}>{job.appKey}@{job.package.version} · {stateLabel[job.status] ?? job.status}</option>)}
      </select></label>
      {selected && <>
        <ol className="access-deployment-steps" aria-label="部署步驟">
          <li className="is-done">1 信任與來源</li><li className={selected.plan ? 'is-done' : ''}>2 影響計畫</li>
          <li className={selected.blockers.length === 0 ? 'is-done' : ''}>3 設定與機密</li>
          <li className={selected.approval ? 'is-done' : ''}>4 核准</li><li className={deployed(selected) ? 'is-done' : ''}>5 部署</li>
          <li className={verified(selected) ? 'is-done' : ''}>6 驗證</li><li className={selected.activationEvidence ? 'is-done' : ''}>7 啟用</li>
        </ol>
        <div className="access-deployment-summary">
          <span><strong>{selected.plan.app?.displayName ?? selected.appKey}</strong><small>{selected.jobId}</small></span>
          <em className={`is-${selected.status}`}>{stateLabel[selected.status] ?? selected.status}</em>
        </div>
        {vmRuntime && vmLayers && <section className="access-vm-runtime" aria-label="VM 持續執行狀態">
          <header><span><strong>{vmRuntime.serviceKey}</strong><small>{vmRuntime.vmHostRef}</small></span>
            <em>交易：{vmLayers.tradingEnabled ? '已授權' : '未授權'}</em></header>
          <div>
            {([['VM', vmLayers.vm], ['Agent', vmLayers.agent], ['Worker', vmLayers.worker], ['策略', vmLayers.strategy]] as const)
              .map(([label, state]) => <span key={label} className={state === 'ready' || state === 'disabled' ? 'is-safe' : 'is-attention'}>
                <strong>{label}</strong><small>{state ?? 'unknown'}</small>
              </span>)}
          </div>
          <p>部署與健康驗證不會啟用 PAPER／LIVE；交易仍需獨立授權與驗收。</p>
        </section>}
        {selected.blockers.length > 0 && <ul className="access-deployment-blockers">{selected.blockers.map((item) => <li key={item}>{item}</li>)}</ul>}
        {selected.lastError && <p className="access-package-error" role="alert">{selected.lastError}</p>}
        <div className="access-deployment-actions">
          <Button disabled={Boolean(busy) || ['cancelled', 'rolled-back'].includes(selected.status)} onClick={() => void run('plan', () => api.plan(selected.jobId, signal))}><RefreshCw size={14} />重整計畫</Button>
          <Button disabled={Boolean(busy)} onClick={() => onOpenSettings(selected.appKey, selected.plan.app?.displayName ?? selected.appKey)}><Settings2 size={14} />設定</Button>
          {['blocked', 'awaiting-approval', 'approved'].includes(selected.status) && <Button disabled={Boolean(busy)} onClick={() => void run('cancel', () => api.cancel(selected.jobId, signal))}><XCircle size={14} />取消</Button>}
          {selected.status === 'approved' && <Button disabled={Boolean(busy)} onClick={() => void run('apply', () => api.apply(selected.jobId, signal))}>執行部署</Button>}
          {['applied', 'verification-failed'].includes(selected.status) && <Button disabled={Boolean(busy)} onClick={() => void run('verify', () => api.verify(selected.jobId, signal))}>驗證服務</Button>}
          {selected.status === 'unknown' && <Button disabled={Boolean(busy)} onClick={() => void run('reconcile', () => api.reconcile(selected.jobId, signal))}>核對外部狀態</Button>}
          <Button disabled={busy === 'evidence'} onClick={() => void downloadEvidence()}><Download size={14} />下載證據</Button>
        </div>
        {events.length > 0 && <details className="access-deployment-events"><summary>工作事件（{events.length}）</summary><ol>
          {events.slice(-20).reverse().map((event) => <li key={event.sequence}><time>{event.at}</time><strong>{event.type}</strong><span>{event.outcome ?? event.status ?? ''}</span></li>)}
        </ol></details>}
        {selected.status === 'awaiting-approval' && selected.blockers.length === 0 && <div className="access-deployment-confirm">
          <fieldset><legend>風險確認</legend>{selected.requiredRiskConfirmations.map((risk) => <label key={risk}>
            <input type="checkbox" checked={confirmedRisks.includes(risk)} onChange={(event) => setConfirmedRisks((current) => event.target.checked ? [...current, risk] : current.filter((item) => item !== risk))} />{riskLabel[risk] ?? risk}
          </label>)}</fieldset>
          <Field label={`輸入「${expectedApprove}」核准`} value={confirmation} onChange={(event) => setConfirmation(event.currentTarget.value)} />
          <Button disabled={!allRisksConfirmed || confirmation !== expectedApprove || Boolean(busy)} onClick={() => void run('approve', () => api.approve(selected, confirmation, signal))}>核准不可變計畫</Button>
        </div>}
        {['staged-verified', 'promotion-failed'].includes(selected.status) && <div className="access-deployment-confirm">
          <Field label={`輸入「${expectedPromote}」切換正式流量`} value={confirmation} onChange={(event) => setConfirmation(event.currentTarget.value)} />
          <Button disabled={confirmation !== expectedPromote || Boolean(busy)} onClick={() => void run('promote', () => api.promote(selected.jobId, confirmation, signal))}>切換正式流量</Button>
        </div>}
        {selected.status === 'verified' && <div className="access-deployment-confirm">
          <Field label={`輸入「${expectedEnable}」啟用 App`} value={confirmation} onChange={(event) => setConfirmation(event.currentTarget.value)} />
          <Button disabled={confirmation !== expectedEnable || Boolean(busy)} onClick={() => void run('activate', () => api.activate(selected.jobId, confirmation, signal), true)}>驗證後啟用</Button>
        </div>}
        {deployed(selected) && !['rolling-back', 'rolled-back'].includes(selected.status) && <details className="access-deployment-rollback"><summary>回復部署版本</summary>
          <Field label={`輸入「${expectedRollback}」回復`} value={confirmation} onChange={(event) => setConfirmation(event.currentTarget.value)} />
          <Button disabled={confirmation !== expectedRollback || Boolean(busy)} onClick={() => void run('rollback', () => api.rollback(selected.jobId, confirmation, signal))}><RotateCcw size={14} />回復</Button>
        </details>}
      </>}
    </div>}
    {error && <div className="access-retry-error">
      <p className="access-package-error" role="alert">{error}</p>
      {jobs.length === 0 && <Button disabled={Boolean(busy)} onClick={() => void load()}>重試 Deployment Agent</Button>}
    </div>}
  </section>;
}
