import { useCallback, useEffect, useState } from 'react';
import { KeyRound, RefreshCw, Save, ShieldAlert, Trash2, X } from 'lucide-react';
import { Button, EmptyState, LoadingState } from '../../shared/ui/controls';
import type {
  DeploymentSettingValue,
  DeploymentSettingsApi,
  DeploymentSettingsDocument,
} from './deployment-settings-client';

type Props = {
  api: DeploymentSettingsApi;
  installationKey: string;
  appKey: string;
  displayName: string;
  signal?: AbortSignal;
  onClose(): void;
};

const fieldKey = (serviceKey: string, environment: string) => `${serviceKey}:${environment}`;

export function DeploymentSettingsEditor({ api, installationKey, appKey, displayName, signal, onClose }: Props) {
  const [document, setDocument] = useState<DeploymentSettingsDocument | null>(null);
  const [platform, setPlatform] = useState<DeploymentSettingsDocument | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DeploymentSettingValue>>({});
  const [confirmations, setConfirmations] = useState<Record<string, string>>({});
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});
  const [references, setReferences] = useState<Record<string, { resource: string; version: string }>>({});
  const [busy, setBusy] = useState('loading');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setBusy('loading');
    setError('');
    try {
      const [next, nextPlatform] = await Promise.all([
        api.getAppSettings(installationKey, appKey, signal),
        api.getPlatformSettings(installationKey, signal),
      ]);
      setDocument(next);
      setPlatform(nextPlatform);
      const nextDrafts: Record<string, DeploymentSettingValue> = {};
      for (const service of next.services) {
        for (const setting of service.configuration) {
          if (setting.source === 'operator-input') {
            nextDrafts[fieldKey(service.serviceKey, setting.name)] = setting.current?.configuredValue
              ?? setting.input?.default ?? '';
          }
        }
      }
      setDrafts(nextDrafts);
    } catch (caught) {
      if (!signal?.aborted) setError(caught instanceof Error ? caught.message : '無法載入 App 設定。');
    } finally {
      if (!signal?.aborted) setBusy('');
    }
  }, [api, appKey, installationKey, signal]);

  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, action: () => Promise<unknown>, clearSecret = false) => {
    setBusy(key);
    setError('');
    try {
      await action();
      if (clearSecret) setSecretInputs((current) => ({ ...current, [key]: '' }));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '設定異動失敗。');
      setBusy('');
    }
  };

  return <section className="access-deployment-settings" aria-labelledby="deployment-settings-title">
    <header>
      <div><h3 id="deployment-settings-title">{displayName} · 設定與秘密</h3>
        <p>{installationKey}／{appKey}；秘密只寫入 Secret Manager，不會回傳明文。</p></div>
      <div><Button disabled={Boolean(busy)} onClick={() => void load()}><RefreshCw size={14} />重新整理</Button>
        <Button onClick={onClose}><X size={14} />關閉</Button></div>
    </header>
    {busy === 'loading' && !document ? <LoadingState message="正在載入部署設定…" /> : null}
    {error && <p className="access-package-error" role="alert">{error}</p>}
    {platform && <aside className="access-platform-settings">
      <strong>平台共用設定</strong>
      <span>OAuth 品牌：{platform.platformConfiguration.oauthBrandDisplayName || '未設定'}</span>
      <span>支援信箱：{platform.platformConfiguration.supportEmail || '未設定'}</span>
      <small>{platform.platformConfiguration.note}</small>
      <small>平台 bootstrap 與 OAuth 由平台層管理，本 App 不會再次要求輸入。</small>
    </aside>}
    {document && document.services.length === 0 ? <EmptyState title="此 App 沒有後端部署設定" /> : null}
    {document?.services.map((service) => <article key={service.serviceKey} className="access-settings-service">
      <header><div><strong>{service.serviceKey}</strong><small>Service 專屬設定</small></div></header>
      {service.configuration.length > 0 && <div className="access-settings-grid">
        {service.configuration.map((setting) => {
          const key = fieldKey(service.serviceKey, setting.name);
          if (setting.source !== 'operator-input') return <div className="access-setting-field is-derived" key={setting.name}>
            <span><strong>{setting.name}</strong><em>平台自動產生</em></span><small>{setting.purpose}</small>
          </div>;
          const input = setting.input!;
          const value = drafts[key] ?? input.default ?? '';
          const confirmation = `SET ${appKey}/${service.serviceKey}/${setting.name}`;
          return <div className={`access-setting-field ${input.impact === 'high' ? 'is-high-impact' : ''}`} key={setting.name}>
            <label><span><strong>{input.label}</strong>{input.impact === 'high' && <em><ShieldAlert size={12} />高影響</em>}</span>
              {input.type === 'boolean'
                ? <input type="checkbox" checked={Boolean(value)} onChange={(event) => {
                  const next = event.currentTarget.checked;
                  setDrafts((current) => ({ ...current, [key]: next }));
                }} />
                : input.type === 'select'
                  ? <select value={String(value)} onChange={(event) => {
                    const next = event.currentTarget.value;
                    setDrafts((current) => ({ ...current, [key]: next }));
                  }}>
                    {input.options?.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
                  : <input type={input.type === 'integer' ? 'number' : 'text'} value={String(value)}
                    min={input.minimum} max={input.maximum} required={input.required}
                    onChange={(event) => {
                      const raw = event.currentTarget.value;
                      setDrafts((current) => ({ ...current, [key]: input.type === 'integer' ? Number(raw) : raw }));
                    }} />}
            </label>
            <small>{input.description || setting.purpose}</small>
            {input.impact === 'high' && <label className="access-settings-confirm">輸入「{confirmation}」確認
              <input value={confirmations[key] ?? ''} autoComplete="off"
                onChange={(event) => { const next = event.currentTarget.value; setConfirmations((current) => ({ ...current, [key]: next })); }} /></label>}
            <Button disabled={Boolean(busy) || (input.impact === 'high' && confirmations[key] !== confirmation)}
              onClick={() => void run(key, () => api.setConfiguration(
                installationKey, appKey, service.serviceKey, setting.name, value,
                input.impact === 'high' ? confirmations[key] : undefined, signal,
              ))}><Save size={14} />儲存設定</Button>
          </div>;
        })}
      </div>}
      {service.secrets.map((secret) => {
        const key = fieldKey(service.serviceKey, secret.environment);
        const disableConfirmation = secret.current
          ? `DISABLE ${appKey}/${service.serviceKey}/${secret.environment}@${secret.current.version}` : '';
        const deleteConfirmation = `DELETE SECRET ${appKey}/${service.serviceKey}/${secret.environment}`;
        const referenceVersion = references[key]?.version ?? '';
        const referenceConfirmation = `REFERENCE ${appKey}/${service.serviceKey}/${secret.environment}@${referenceVersion}`;
        return <div className="access-secret-field" key={secret.environment}>
          <header><span><KeyRound size={15} /><strong>{secret.environment}</strong></span>
            <em>{secret.current ? `版本 ${secret.current.version} · ${secret.current.state}` : '尚未設定'}</em></header>
          <p>{secret.purpose}</p>
          <label>建立新版本（寫入後無法讀回）<input type="password" autoComplete="new-password"
            value={secretInputs[key] ?? ''} onChange={(event) => { const next = event.currentTarget.value; setSecretInputs((current) => ({ ...current, [key]: next })); }} /></label>
          <Button disabled={Boolean(busy) || document.secretManagerMode !== 'gcp-secret-manager' || !secretInputs[key]}
            onClick={() => void run(key, () => api.createSecretVersion(
              installationKey, appKey, service.serviceKey, secret.environment, secretInputs[key], signal,
            ), true)}>{secret.current ? '輪替並建立新版本' : '建立秘密版本'}</Button>
          <details><summary>引用既有的同 App 秘密版本</summary><div className="access-secret-reference">
            <label>Secret resource<input value={references[key]?.resource ?? ''} autoComplete="off"
              onChange={(event) => { const next = event.currentTarget.value; setReferences((current) => ({ ...current, [key]: { resource: next, version: current[key]?.version ?? '' } })); }} /></label>
            <label>版本<input value={referenceVersion} inputMode="numeric" autoComplete="off"
              onChange={(event) => { const next = event.currentTarget.value; setReferences((current) => ({ ...current, [key]: { resource: current[key]?.resource ?? '', version: next } })); }} /></label>
            <label>輸入「{referenceConfirmation}」確認<input value={confirmations[`${key}:reference`] ?? ''} autoComplete="off"
              onChange={(event) => { const next = event.currentTarget.value; setConfirmations((current) => ({ ...current, [`${key}:reference`]: next })); }} /></label>
            <Button disabled={Boolean(busy) || confirmations[`${key}:reference`] !== referenceConfirmation}
              onClick={() => void run(`${key}:reference`, () => api.setSecretReference(
                installationKey, appKey, service.serviceKey, secret.environment,
                { secretResource: references[key]?.resource ?? '', version: referenceVersion, confirmation: referenceConfirmation }, signal,
              ))}>引用版本</Button>
          </div></details>
          {secret.current && <div className="access-secret-danger">
            <label>版本操作確認<input value={confirmations[`${key}:danger`] ?? ''} autoComplete="off"
              onChange={(event) => { const next = event.currentTarget.value; setConfirmations((current) => ({ ...current, [`${key}:danger`]: next })); }} /></label>
            <Button disabled={Boolean(busy) || confirmations[`${key}:danger`] !== disableConfirmation}
              onClick={() => void run(`${key}:disable`, () => api.disableSecretVersion(
                installationKey, appKey, service.serviceKey, secret.environment, secret.current!.version, disableConfirmation, signal,
              ))}>停用目前版本</Button>
            <Button disabled={Boolean(busy) || confirmations[`${key}:danger`] !== deleteConfirmation}
              onClick={() => void run(`${key}:delete`, () => api.deleteSecret(
                installationKey, appKey, service.serviceKey, secret.environment, deleteConfirmation, signal,
              ))}><Trash2 size={14} />刪除整個秘密</Button>
            <small>停用請輸入「{disableConfirmation}」；刪除請另行輸入「{deleteConfirmation}」。</small>
          </div>}
          {secret.versions.some((version) => version.state === 'ENABLED' && version.version !== secret.current?.version) && <div className="access-secret-versions">
            <strong>可回滾版本</strong>{secret.versions.filter((version) => version.state === 'ENABLED' && version.version !== secret.current?.version).map((version) => {
              const expected = `ROLLBACK SECRET ${appKey}/${service.serviceKey}/${secret.environment}@${version.version}`;
              return <span key={version.version}>版本 {version.version}<Button disabled={Boolean(busy) || confirmations[`${key}:rollback`] !== expected}
                onClick={() => void run(`${key}:rollback`, () => api.rollbackSecret(
                  installationKey, appKey, service.serviceKey, secret.environment, version.version, expected, signal,
                ))}>回滾引用</Button><input aria-label={`回滾版本 ${version.version} 確認`} value={confirmations[`${key}:rollback`] ?? ''}
                  onChange={(event) => { const next = event.currentTarget.value; setConfirmations((current) => ({ ...current, [`${key}:rollback`]: next })); }} placeholder={expected} /></span>;
            })}</div>}
          {document.secretManagerMode !== 'gcp-secret-manager' && <small className="access-secret-disabled">本機 Secret Manager driver 尚未啟用；可檢視欄位但不會寫入雲端。</small>}
        </div>;
      })}
    </article>)}
  </section>;
}
