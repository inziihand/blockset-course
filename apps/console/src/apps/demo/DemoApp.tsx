import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Blocks, FolderOpen, Monitor, Ruler, Smartphone } from 'lucide-react';
import { createApiClient } from '../../shared/api';
import { readPreference, writePreference } from '../../shared/preferences';
import { useApiRead } from '../../shared/useApiRead';
import { Button, ConfirmDialog, EmptyState, ErrorState, Field, LoadingState } from '../../shared/ui/controls';
import { useNotifications } from '../../shared/ui/Notifications';
import { navigate } from '../../shell/navigation';
import type { ShellAppProps } from '../../shell/types';
import { demoFetch, isDemoData, type DemoScenario } from './demoTransport';
import DemoComponentGallery from './DemoComponentGallery';
import './demo.css';

const demoApi = createApiClient({ baseUrl: '/demo-local/', fetch: demoFetch });
const preferenceScope = { app: 'demo' };
const validName = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 40;
const initialName = () => readPreference(preferenceScope, 'display-name', validName, '我的工作台');

export default function DemoApp({ displayMode, signal }: ShellAppProps) {
  const content = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState<number>();
  const [appliedName, setAppliedName] = useState(initialName);
  const [draftName, setDraftName] = useState(appliedName);
  const [nameError, setNameError] = useState<string>();
  const [confirmName, setConfirmName] = useState<string>();
  const [scenario, setScenario] = useState<DemoScenario>('normal');
  const [refresh, setRefresh] = useState(0);
  const { notify } = useNotifications();
  const read = useApiRead<unknown>({
    client: demoApi, path: `projects?state=${scenario}`, scopeKey: `demo:${scenario}:${refresh}`, signal,
  });
  const data = read.status === 'ready' && isDemoData(read.data) ? read.data : undefined;
  const modeLabel = displayMode === 'compact' ? '窄版模式' : '通用模式';

  useEffect(() => {
    const element = content.current;
    if (!element || signal.aborted || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && !signal.aborted) setContentWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    const stop = () => observer.disconnect();
    signal.addEventListener('abort', stop, { once: true });
    return () => { stop(); signal.removeEventListener('abort', stop); };
  }, [signal]);

  const preview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = draftName.trim();
    if (!validName(name)) { setNameError('請輸入 1～40 個字的展示名稱。'); return; }
    setNameError(undefined);
    setConfirmName(name);
  };
  const applyName = () => {
    if (!confirmName) return;
    const saved = writePreference(preferenceScope, 'display-name', confirmName);
    setAppliedName(confirmName);
    setDraftName(confirmName);
    setConfirmName(undefined);
    notify(saved ? '展示名稱已更新' : '展示名稱已套用，但此瀏覽器無法儲存；離開後可能不保留。', saved ? 'success' : 'error');
  };
  const chooseScenario = (next: DemoScenario) => { setScenario(next); setRefresh((count) => count + 1); };

  return <div className="demo-app" ref={content}>
    <header className="demo-intro">
      <div className="demo-eyebrow"><Blocks size={16} aria-hidden="true" /><span>DEMO APP</span><span className="demo-badge">離線示範</span></div>
      <h2>介面展示工作台</h2>
      <p>切換顯示模式、調整展示名稱，體驗平台共用的互動與資料狀態。</p>
      <div className="demo-mode-switch" role="group" aria-label="展示模式">
        <Button aria-pressed={displayMode === 'responsive'} onClick={() => { if (displayMode !== 'responsive') navigate('/apps/demo'); }}><Monitor size={16} aria-hidden="true" />通用模式</Button>
        <Button aria-pressed={displayMode === 'compact'} onClick={() => { if (displayMode !== 'compact') navigate('/apps/demo-compact'); }}><Smartphone size={16} aria-hidden="true" />窄版模式</Button>
      </div>
    </header>

    <div className="demo-summary-grid platform-grid">
      <section className="demo-summary"><span className="demo-summary-label"><Monitor size={16} aria-hidden="true" />顯示模式</span><strong>{modeLabel}</strong><small>{displayMode === 'compact' ? '整個 App 視窗保持窄版，寬畫面置中' : '視窗隨可用空間展開'}</small></section>
      <section className="demo-summary"><span className="demo-summary-label"><Ruler size={16} aria-hidden="true" />內容寬度</span><strong>{contentWidth === undefined ? '—' : `${contentWidth} px`}</strong><small>目前分配到的內容空間</small></section>
      <section className="demo-summary"><span className="demo-summary-label"><FolderOpen size={16} aria-hidden="true" />範例資料</span><strong>{data ? `${data.projects.length} 筆` : '—'}</strong><small>本機示範清單</small></section>
    </div>

    <div className="demo-workspace-grid platform-grid platform-grid--two">
      <section className="demo-panel" aria-labelledby="demo-preferences-title">
        <div className="demo-panel-heading"><span className="demo-step">01</span><h3 id="demo-preferences-title">試試共用操作</h3></div>
        <p className="demo-description">輸入名稱，經過確認後更新下方預覽。</p>
        <form onSubmit={preview} noValidate>
          <Field label="展示名稱" value={draftName} maxLength={40} error={nameError} hint="1～40 個字；只儲存在此瀏覽器，兩種模式共用。" onChange={(event) => { setDraftName(event.target.value); setNameError(undefined); }} />
          <Button type="submit" className="demo-primary-action">預覽確認<ArrowRight size={15} aria-hidden="true" /></Button>
        </form>
        <div className="demo-name-preview"><span className="demo-preview-label">本機預覽</span><p aria-label="已套用展示名稱">{appliedName}</p><small>確認視窗、欄位與通知由平台提供。</small></div>
      </section>

      <section className="demo-panel" aria-labelledby="demo-data-title">
        <div className="demo-panel-heading"><span className="demo-step">02</span><h3 id="demo-data-title">看看資料狀態</h3></div>
        <p className="demo-description">範例資料在本機產生，沒有連接外部服務。</p>
        <div className="demo-data-actions" role="group" aria-label="範例資料情境">
          <Button aria-pressed={scenario === 'normal'} onClick={() => chooseScenario('normal')}>正常資料</Button>
          <Button aria-pressed={scenario === 'empty'} onClick={() => chooseScenario('empty')}>空資料</Button>
          <Button aria-pressed={scenario === 'error'} onClick={() => chooseScenario('error')}>模擬失敗</Button>
          <Button onClick={() => setRefresh((count) => count + 1)}>重新整理</Button>
        </div>
        <div className="demo-data-results" aria-busy={read.status === 'loading'}>
          {(read.status === 'loading' || read.status === 'idle') && <LoadingState message="正在載入範例資料…" />}
          {(read.status === 'error' || (read.status === 'ready' && !data)) && <ErrorState title="範例資料暫時無法顯示"><p>這是刻意產生的離線錯誤；可切回正常資料再次查看。</p></ErrorState>}
          {data && data.projects.length === 0 && <EmptyState title="目前沒有範例資料"><p>切回「正常資料」即可看到範例清單。</p></EmptyState>}
          {data && data.projects.length > 0 && <ul className="demo-projects" aria-label="範例清單">{data.projects.map((project) => <li key={project.id}>
            <div className="demo-project-heading"><h4>{project.title}</h4><span>{project.tag}</span></div><p>{project.description}</p>
          </li>)}</ul>}
        </div>
      </section>
    </div>
    <DemoComponentGallery />
    <ConfirmDialog open={confirmName !== undefined} title="確認展示內容" confirmLabel="套用展示" onConfirm={applyName} onClose={() => setConfirmName(undefined)}>
      <p>將展示名稱更新為「{confirmName}」。</p>
      <p>這項設定只影響此瀏覽器中的 Demo 外觀。</p>
    </ConfirmDialog>
  </div>;
}
