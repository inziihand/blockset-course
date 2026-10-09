import { useCallback, useEffect as useReactEffect, useMemo, useRef, useState } from 'react';
import { useAppEffect as useEffect, useAppLayoutEffect as useLayoutEffect, useAppActive } from '../../shared/lifecycle/AppActivity';
import { flushSync } from 'react-dom';
import { ArrowLeftRight, ArrowUpDown } from 'lucide-react';
import type {
  ChartMode,
  ChartScaleMode,
  ModelParams,
  PositionRow,
  StrategyDraft,
  StrategyTemplateKey,
  StrikeSettings,
  UserStrategyRecord,
} from './types';
import { initialParams, initialRows, initialStrikeSettings } from './constants';
import { aggregate } from './logic/greeks';
import { generateEmptyRows } from './logic/strikeRows';
import { templateRows } from './logic/strategyTemplates';
import FileMenu from './components/FileMenu';
import TemplateMenu from './components/StrategyTemplateMenu';
import ToolMenu from './components/ToolMenu';
import PositionMatrix from './components/PositionPanel';
import ParameterPanel from './components/ModelParamsPanel';
import StrategyChart from './components/StrategyChart';
import StrategySummaryPanel from './components/StrategySummaryPanel';
import IvCalculatorModal from './components/IvCalculatorModal';
import CourseAccessDialog from './components/CourseAccessDialog';
import {
  DeleteStrategyDialog,
  LoadStrategyDialog,
  SaveStrategyDialog,
  UnsavedStrategyDialog,
} from './components/StrategyFileDialogs';
import { isCourseChartMode } from './courseAccess';
import { AppHeaderActions } from '../../shared/ui/AppHeaderActions';
import {
  deleteUserStrategy,
  getUserStrategies,
  saveStrategy,
  updateUserStrategy,
} from './strategyRepository';
import {
  downloadStrategyFile,
  readStrategyFile,
  type ImportedStrategyFile,
} from './strategyFile';

export type OptionsStrategyLabProps = {
  onOpenAppMenu?: () => void;
  hasCourseAccess?: boolean;
  isSignedIn?: boolean;
  userId?: string | null;
};

type CurrentStrategyDocument = {
  id: string;
  name: string;
  ownerUid: string;
};

type PendingStrategyAction = 'new' | 'load' | 'import' | null;

type StrategyFileMessage = {
  tone: 'success' | 'info' | 'error';
  text: string;
};

const copyRows = (rows: PositionRow[]) => rows.map((row) => ({ ...row }));

const createInitialDraft = (): StrategyDraft => ({
  schemaVersion: 3,
  strikeSettings: { ...initialStrikeSettings },
  rows: copyRows(initialRows),
  underlyingQty: 0,
  params: { ...initialParams },
  entryCost: 0,
  chart: {
    modes: ['pnl'],
    scaleMode: 'auto',
  },
});

const createBlankDraft = (): StrategyDraft => ({
  ...createInitialDraft(),
  rows: generateEmptyRows(),
});

const draftSignature = (draft: StrategyDraft) => JSON.stringify(draft);

const strategyFileError = (error: unknown, fallback: string) => {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  if (code.includes('permission-denied')) return '沒有權限存取這筆策略，請確認目前登入帳號。';
  if (code.includes('unavailable')) return '目前無法連線到資料庫，請稍後再試。';
  if (error instanceof TypeError) return error.message;
  return fallback;
};

export function OptionsStrategyLab({
  onOpenAppMenu,
  hasCourseAccess = false,
  isSignedIn = false,
  userId = null,
}: OptionsStrategyLabProps = {}) {
  const appActive = useAppActive();
  const requestScope = useRef(0);
  const acceptingResponses = useRef(false);
  const [strikeSettings, setStrikeSettings] = useState<StrikeSettings>(initialStrikeSettings);
  const [rows, setRows] = useState<PositionRow[]>(initialRows);
  const [underlyingQty, setUnderlyingQty] = useState(0);
  const [params, setParams] = useState<ModelParams>(initialParams);
  const [entryCost, setEntryCost] = useState(0);
  const [modes, setModes] = useState<ChartMode[]>(['pnl']);
  const [scaleMode, setScaleMode] = useState<ChartScaleMode>('auto');
  const [panelsSwapped, setPanelsSwapped] = useState(false);
  const [useVerticalSwapIcon, setUseVerticalSwapIcon] = useState(false);
  const [showIvCalculator, setShowIvCalculator] = useState(false);
  const [lockedFeature, setLockedFeature] = useState('');
  const [currentStrategy, setCurrentStrategy] = useState<CurrentStrategyDocument | null>(null);
  const [draftStrategyName, setDraftStrategyName] = useState('');
  const [savedDraftSignature, setSavedDraftSignature] = useState(() => draftSignature(createInitialDraft()));
  const [pendingStrategyAction, setPendingStrategyAction] = useState<PendingStrategyAction>(null);
  const [pendingImportedStrategy, setPendingImportedStrategy] = useState<ImportedStrategyFile | null>(null);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [strategyToDelete, setStrategyToDelete] = useState<UserStrategyRecord | null>(null);
  const [savedStrategies, setSavedStrategies] = useState<UserStrategyRecord[]>([]);
  const [loadingStrategies, setLoadingStrategies] = useState(false);
  const [filePending, setFilePending] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [fileMessage, setFileMessage] = useState<StrategyFileMessage | null>(null);
  const fileMessageTimer = useRef<number | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const leftPanelRef = useRef<HTMLElement | null>(null);
  const rightPanelRef = useRef<HTMLElement | null>(null);
  const greeks = useMemo(() => aggregate(rows, params, underlyingQty), [rows, params, underlyingQty]);
  const hasActiveLegs = underlyingQty !== 0 || rows.some((row) => row.callQty !== 0 || row.putQty !== 0);
  const strategyDraft = useMemo<StrategyDraft>(() => ({
    schemaVersion: 3,
    strikeSettings: { ...strikeSettings },
    rows: copyRows(rows),
    underlyingQty,
    params: { ...params },
    entryCost,
    chart: {
      modes: [...modes],
      scaleMode,
    },
  }), [entryCost, modes, params, rows, scaleMode, strikeSettings, underlyingQty]);
  const currentDraftSignature = useMemo(() => draftSignature(strategyDraft), [strategyDraft]);
  const hasUnsavedChanges = currentDraftSignature !== savedDraftSignature;
  const canUpdateCurrentStrategy = Boolean(
    currentStrategy
      && userId
      && currentStrategy.ownerUid === userId,
  );

  const showFileMessage = useCallback((text: string, tone: StrategyFileMessage['tone'] = 'success') => {
    setFileMessage({ text, tone });
    if (fileMessageTimer.current !== null) window.clearTimeout(fileMessageTimer.current);
    fileMessageTimer.current = window.setTimeout(() => setFileMessage(null), 2600);
  }, []);

  useEffect(() => {
    acceptingResponses.current = true;
    return () => {
      acceptingResponses.current = false;
      requestScope.current++;
      setLoadingStrategies(false);
    };
  }, [userId]);
  const responseIsCurrent = (scope: number) => acceptingResponses.current && requestScope.current === scope;

  useEffect(() => () => {
    if (fileMessageTimer.current !== null) window.clearTimeout(fileMessageTimer.current);
  }, []);

  // A retained, hidden draft still needs its existing page-close protection.
  useReactEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!currentStrategy || !userId || currentStrategy.ownerUid === userId) return;
    setCurrentStrategy(null);
  }, [currentStrategy, userId]);

  useEffect(() => {
    if (hasCourseAccess) return;
    setModes((previous) => {
      const firstPublicMode = previous.find((mode) => !isCourseChartMode(mode));
      return [firstPublicMode ?? 'pnl'];
    });
  }, [hasCourseAccess]);

  useLayoutEffect(() => {
    const updateSwapIconDirection = () => {
      const leftPanel = leftPanelRef.current?.getBoundingClientRect();
      const rightPanel = rightPanelRef.current?.getBoundingClientRect();
      if (!leftPanel?.width || !rightPanel?.width) return;

      const panelsAreStacked = Math.abs(leftPanel.left - rightPanel.left) < 1;
      setUseVerticalSwapIcon(panelsAreStacked || rightPanel.width <= 520);
    };

    updateSwapIconDirection();
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateSwapIconDirection);
    if (workspaceRef.current) resizeObserver?.observe(workspaceRef.current);
    if (rightPanelRef.current) resizeObserver?.observe(rightPanelRef.current);
    window.addEventListener('resize', updateSwapIconDirection);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateSwapIconDirection);
    };
  }, []);

  const swapControlLabel = panelsSwapped
    ? useVerticalSwapIcon ? '還原上下區塊排列' : '還原左右欄排列'
    : useVerticalSwapIcon ? '上下區塊對調' : '左右欄對調';

  const openPositionAtStrategyPrice = () => {
    if (!hasActiveLegs) return;
    setEntryCost(greeks.price);
  };

  const swapPanels = () => {
    const panels = [leftPanelRef.current, rightPanelRef.current].filter(
      (panel): panel is HTMLElement => panel !== null,
    );
    const previousBounds = panels.map((panel) => panel.getBoundingClientRect());

    flushSync(() => setPanelsSwapped((value) => !value));
    if (typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    window.requestAnimationFrame(() => {
      panels.forEach((panel, index) => {
        const previous = previousBounds[index];
        const current = panel.getBoundingClientRect();
        const deltaX = previous.left - current.left;
        const deltaY = previous.top - current.top;
        if ((Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1)
          || typeof panel.animate !== 'function') return;

        panel.animate([
          { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)`, opacity: 0.72 },
          { transform: 'translate3d(0, 0, 0)', opacity: 1 },
        ], {
          duration: 320,
          easing: 'cubic-bezier(.22, 1, .36, 1)',
        });
      });
    });
  };

  const updateStrikeSettings = (patch: Partial<StrikeSettings>) => {
    setStrikeSettings((prev) => {
      const next = {
        ...prev,
        ...patch,
        strikeStep: Math.max(patch.strikeStep ?? prev.strikeStep, 0.01),
      };
      const nextRows = generateEmptyRows(next.initialSpot, next.strikeStep);
      setRows((previousRows) => nextRows.map((row, index) => ({
        ...row,
        callQty: previousRows[index]?.callQty ?? 0,
        putQty: previousRows[index]?.putQty ?? 0,
      })));
      if (patch.initialSpot !== undefined) setParams((old) => ({ ...old, spot: next.initialSpot }));
      return next;
    });
  };

  const applyTemplate = (template: StrategyTemplateKey) => {
    setUnderlyingQty(0);
    setRows((prevRows) => templateRows(prevRows, params.spot, template));
  };

  const normalizeDraftForAccess = useCallback((draft: StrategyDraft): StrategyDraft => {
    if (hasCourseAccess) return {
      ...draft,
      strikeSettings: { ...draft.strikeSettings },
      rows: copyRows(draft.rows),
      params: { ...draft.params },
      chart: { ...draft.chart, modes: [...draft.chart.modes] },
    };

    const publicModes = draft.chart.modes.filter((mode) => !isCourseChartMode(mode));
    return {
      ...draft,
      strikeSettings: { ...draft.strikeSettings },
      rows: copyRows(draft.rows),
      params: { ...draft.params },
      chart: {
        modes: publicModes.length > 0 ? publicModes : ['pnl'],
        scaleMode: draft.chart.scaleMode,
      },
    };
  }, [hasCourseAccess]);

  const applyDraft = useCallback((draft: StrategyDraft) => {
    const nextDraft = normalizeDraftForAccess(draft);
    setStrikeSettings({ ...nextDraft.strikeSettings });
    setRows(copyRows(nextDraft.rows));
    setUnderlyingQty(nextDraft.underlyingQty);
    setParams({ ...nextDraft.params });
    setEntryCost(nextDraft.entryCost);
    setModes([...nextDraft.chart.modes]);
    setScaleMode(nextDraft.chart.scaleMode);
    return nextDraft;
  }, [normalizeDraftForAccess]);

  const startNewStrategy = useCallback((message = '已建立空白策略。') => {
    const nextDraft = applyDraft(createBlankDraft());
    setCurrentStrategy(null);
    setDraftStrategyName('');
    setSavedDraftSignature(draftSignature(nextDraft));
    showFileMessage(message, 'info');
  }, [applyDraft, showFileMessage]);

  const applyImportedStrategy = useCallback((imported: ImportedStrategyFile) => {
    applyDraft(imported.strategy);
    setCurrentStrategy(null);
    setDraftStrategyName(imported.name);
    setSavedDraftSignature('');
    setPendingImportedStrategy(null);
    showFileMessage(`已匯入「${imported.name}」，尚未儲存至雲端。`, 'info');
  }, [applyDraft, showFileMessage]);

  const clearCurrentStrategy = () => {
    setRows((previousRows) => previousRows.map((row) => ({
      ...row,
      callQty: 0,
      putQty: 0,
    })));
    setUnderlyingQty(0);
    setEntryCost(0);
    showFileMessage('已清空目前部位，策略名稱與模型參數已保留。', 'info');
  };

  const openLoadDialog = useCallback(async () => {
    if (!acceptingResponses.current) return;
    const scope = requestScope.current;
    setShowLoadDialog(true);
    setLoadingStrategies(true);
    setLoadError('');
    try {
      if (!userId) throw new TypeError('請先登入會員帳號。');
      const records = await getUserStrategies(userId);
      if (responseIsCurrent(scope)) setSavedStrategies(records);
    } catch (error) {
      if (responseIsCurrent(scope)) setLoadError(strategyFileError(error, '無法載入策略，請稍後再試。'));
    } finally {
      if (responseIsCurrent(scope)) setLoadingStrategies(false);
    }
  }, [userId]);

  const requireSignedIn = () => {
    if (isSignedIn && userId) return true;
    showFileMessage('請先使用 Google 帳號登入，再存取私人策略。', 'info');
    onOpenAppMenu?.();
    return false;
  };

  const requestNewStrategy = () => {
    if (!hasUnsavedChanges) {
      startNewStrategy();
      return;
    }
    setPendingStrategyAction('new');
    setShowUnsavedDialog(true);
  };

  const requestLoadStrategy = () => {
    if (!requireSignedIn()) return;
    if (!hasUnsavedChanges) {
      void openLoadDialog();
      return;
    }
    setPendingStrategyAction('load');
    setShowUnsavedDialog(true);
  };

  const requestSaveStrategy = () => {
    if (!requireSignedIn()) return;
    setSaveError('');
    setPendingStrategyAction(null);
    setShowSaveDialog(true);
  };

  const requestImportStrategy = async (file: File) => {
    if (!appActive) return;
    const scope = requestScope.current;
    setFilePending(true);
    try {
      const imported = await readStrategyFile(file);
      if (!responseIsCurrent(scope)) return;
      if (hasUnsavedChanges) {
        setPendingImportedStrategy(imported);
        setPendingStrategyAction('import');
        setShowUnsavedDialog(true);
        return;
      }
      applyImportedStrategy(imported);
    } catch (error) {
      if (responseIsCurrent(scope)) showFileMessage(strategyFileError(error, '無法匯入策略檔案。'), 'error');
    } finally {
      setFilePending(false);
    }
  };

  const exportCurrentStrategy = () => {
    const name = (currentStrategy?.name ?? draftStrategyName) || '未命名策略';
    try {
      downloadStrategyFile(name, strategyDraft);
      showFileMessage(`已匯出「${name}」。`);
    } catch (error) {
      showFileMessage(strategyFileError(error, '無法匯出策略檔案。'), 'error');
    }
  };

  const continuePendingAction = useCallback((action: PendingStrategyAction, afterSave = false) => {
    setPendingStrategyAction(null);
    if (action === 'new') {
      startNewStrategy(afterSave ? '策略已儲存，並已建立空白策略。' : undefined);
      return;
    }
    if (action === 'load') void openLoadDialog();
    if (action === 'import' && pendingImportedStrategy) applyImportedStrategy(pendingImportedStrategy);
  }, [applyImportedStrategy, openLoadDialog, pendingImportedStrategy, startNewStrategy]);

  const handleDiscardUnsaved = () => {
    const action = pendingStrategyAction;
    setShowUnsavedDialog(false);
    continuePendingAction(action);
  };

  const handleSaveBeforeContinue = () => {
    if (!requireSignedIn()) {
      setShowUnsavedDialog(false);
      setPendingStrategyAction(null);
      setPendingImportedStrategy(null);
      return;
    }
    setShowUnsavedDialog(false);
    setSaveError('');
    setShowSaveDialog(true);
  };

  const handleSaveStrategy = async (mode: 'new' | 'update', name: string) => {
    if (!appActive || filePending) return;
    const scope = requestScope.current;
    if (!userId) {
      setSaveError('登入狀態已失效，請重新登入。');
      return;
    }

    setFilePending(true);
    setSaveError('');
    try {
      if (mode === 'update' && currentStrategy && currentStrategy.ownerUid === userId) {
        await updateUserStrategy(userId, currentStrategy.id, name, strategyDraft);
        if (!responseIsCurrent(scope)) {
          setSaveError('先前儲存已送出；請重新載入確認結果，不會自動重送。'); return;
        }
        setCurrentStrategy({ ...currentStrategy, name });
      } else {
        const id = await saveStrategy(userId, name, strategyDraft);
        if (!responseIsCurrent(scope)) {
          setSaveError('先前儲存已送出；請重新載入確認結果，不會自動重送。'); return;
        }
        setCurrentStrategy({ id, name, ownerUid: userId });
      }
      setDraftStrategyName('');
      setSavedDraftSignature(currentDraftSignature);
      setShowSaveDialog(false);
      const action = pendingStrategyAction;
      if (action) {
        continuePendingAction(action, true);
      } else {
        showFileMessage(mode === 'update' ? `已更新「${name}」。` : `已儲存「${name}」。`);
      }
    } catch (error) {
      setSaveError(responseIsCurrent(scope) ? strategyFileError(error, '無法儲存策略，請稍後再試。')
        : '先前儲存結果尚未確認；請重新載入檢查，不會自動重送。');
    } finally {
      setFilePending(false);
    }
  };

  const handleLoadStrategy = (record: UserStrategyRecord) => {
    const nextDraft = applyDraft(record.strategy);
    setCurrentStrategy({ id: record.id, name: record.name, ownerUid: record.ownerUid });
    setDraftStrategyName('');
    setSavedDraftSignature(draftSignature(nextDraft));
    setShowLoadDialog(false);
    showFileMessage(`已載入「${record.name}」。`);
  };

  const requestDeleteStrategy = (record: UserStrategyRecord) => {
    setDeleteError('');
    setShowLoadDialog(false);
    setStrategyToDelete(record);
  };

  const cancelDeleteStrategy = () => {
    if (filePending) return;
    setStrategyToDelete(null);
    setDeleteError('');
    setShowLoadDialog(true);
  };

  const handleDeleteStrategy = async () => {
    if (!appActive || filePending) return;
    const scope = requestScope.current;
    if (!strategyToDelete) return;
    if (!userId || strategyToDelete.ownerUid !== userId) {
      setDeleteError('登入狀態已失效，請重新登入。');
      return;
    }

    const target = strategyToDelete;
    setFilePending(true);
    setDeleteError('');
    try {
      await deleteUserStrategy(userId, target.id);
      if (!responseIsCurrent(scope)) {
        setDeleteError('先前刪除已送出；請重新載入確認結果，不會自動重送。'); return;
      }
      setSavedStrategies((previous) => previous.filter((strategy) => strategy.id !== target.id));

      const deletedCurrentStrategy = currentStrategy?.id === target.id;
      if (deletedCurrentStrategy) {
        setCurrentStrategy(null);
        setDraftStrategyName(target.name);
        setSavedDraftSignature('');
      }

      setStrategyToDelete(null);
      setShowLoadDialog(true);
      showFileMessage(
        deletedCurrentStrategy
          ? `已刪除「${target.name}」，目前畫面已轉為未儲存策略。`
          : `已刪除「${target.name}」。`,
      );
    } catch (error) {
      setDeleteError(responseIsCurrent(scope) ? strategyFileError(error, '無法刪除策略，請稍後再試。')
        : '先前刪除結果尚未確認；請重新載入檢查，不會自動重送。');
    } finally {
      setFilePending(false);
    }
  };

  return (
    <>
      <AppHeaderActions className="options-strategy-lab-root options-header-actions">
        <div className="toolbar">
          <FileMenu
            pending={filePending || loadingStrategies}
            currentName={currentStrategy?.name ?? draftStrategyName}
            hasUnsavedChanges={hasUnsavedChanges}
            onNew={requestNewStrategy}
            onLoad={requestLoadStrategy}
            onSave={requestSaveStrategy}
            onImport={(file) => void requestImportStrategy(file)}
            onExport={exportCurrentStrategy}
          />
          <TemplateMenu
            hasCourseAccess={hasCourseAccess}
            onApplyTemplate={applyTemplate}
            onRequireCourseAccess={setLockedFeature}
          />
          <ToolMenu onOpenIvCalculator={() => setShowIvCalculator(true)} />
          <button
            type="button"
            className={`panel-swap-button${useVerticalSwapIcon ? ' is-vertical' : ''}`}
            aria-label={swapControlLabel}
            aria-pressed={panelsSwapped}
            title={swapControlLabel}
            onClick={swapPanels}
          >
            <ArrowLeftRight className="panel-swap-icon panel-swap-icon-horizontal" size={15} strokeWidth={2} aria-hidden="true" />
            <ArrowUpDown className="panel-swap-icon panel-swap-icon-vertical" size={15} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </AppHeaderActions>
      <main className="options-strategy-lab-root">
      <div ref={workspaceRef} className={`workspace${panelsSwapped ? ' panels-swapped' : ''}`}>
        <aside ref={leftPanelRef} className="left-panel">
          <PositionMatrix
            rows={rows}
            setRows={setRows}
            underlyingQty={underlyingQty}
            onUnderlyingQtyChange={setUnderlyingQty}
            strikeSettings={strikeSettings}
            onStrikeSettingsChange={updateStrikeSettings}
            onClearPositions={clearCurrentStrategy}
          />
          <ParameterPanel params={params} setParams={setParams} onOpenIvCalculator={() => setShowIvCalculator(true)} />
        </aside>

        <section ref={rightPanelRef} className="right-panel">
          <StrategyChart
            rows={rows}
            params={params}
            setParams={setParams}
            modes={modes}
            setModes={setModes}
            scaleMode={scaleMode}
            setScaleMode={setScaleMode}
            entryCost={entryCost}
            underlyingQty={underlyingQty}
            hasCourseAccess={hasCourseAccess}
            onRequireCourseAccess={setLockedFeature}
          />
          <StrategySummaryPanel
            greeks={greeks}
            rows={rows}
            underlyingQty={underlyingQty}
            entryCost={entryCost}
            onUseStrategyPrice={openPositionAtStrategyPrice}
          />
        </section>
      </div>

      {showIvCalculator ? (
        <IvCalculatorModal
          rows={rows}
          params={params}
          onApplyIv={(iv, days) => setParams((prev) => ({ ...prev, iv, days }))}
          onClose={() => setShowIvCalculator(false)}
        />
      ) : null}

      {lockedFeature ? (
        <CourseAccessDialog
          feature={lockedFeature}
          isSignedIn={isSignedIn}
          onClose={() => setLockedFeature('')}
          onOpenAccount={onOpenAppMenu}
        />
      ) : null}

      {showUnsavedDialog ? (
        <UnsavedStrategyDialog
          pending={filePending}
          onCancel={() => {
            setShowUnsavedDialog(false);
            setPendingStrategyAction(null);
            setPendingImportedStrategy(null);
          }}
          onDiscard={handleDiscardUnsaved}
          onSave={handleSaveBeforeContinue}
        />
      ) : null}

      {showSaveDialog ? (
        <SaveStrategyDialog
          initialName={currentStrategy?.name ?? draftStrategyName}
          canUpdate={canUpdateCurrentStrategy}
          pending={filePending}
          error={saveError}
          onClose={() => {
            if (filePending) return;
            setShowSaveDialog(false);
            setPendingStrategyAction(null);
            setPendingImportedStrategy(null);
            setSaveError('');
          }}
          onSave={(mode, name) => void handleSaveStrategy(mode, name)}
        />
      ) : null}

      {showLoadDialog ? (
        <LoadStrategyDialog
          strategies={savedStrategies}
          currentStrategyId={currentStrategy?.id ?? null}
          loading={loadingStrategies}
          pending={filePending}
          error={loadError}
          onClose={() => {
            if (filePending) return;
            setShowLoadDialog(false);
            setLoadError('');
          }}
          onSelect={handleLoadStrategy}
          onDelete={requestDeleteStrategy}
        />
      ) : null}

      {strategyToDelete ? (
        <DeleteStrategyDialog
          strategy={strategyToDelete}
          pending={filePending}
          error={deleteError}
          onCancel={cancelDeleteStrategy}
          onConfirm={() => void handleDeleteStrategy()}
        />
      ) : null}

      {fileMessage ? (
        <div className={`strategy-file-toast ${fileMessage.tone}`} role="status" aria-live="polite">
          {fileMessage.text}
        </div>
      ) : null}
      <div id="options-strategy-lab-portals" />
      </main>
    </>
  );
}

export default OptionsStrategyLab;
