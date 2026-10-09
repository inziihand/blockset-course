import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useAppEffect as useEffect, useAppActive } from '../../../shared/lifecycle/AppActivity';
import { AlertTriangle, Clock3, FilePlus2, FolderOpen, Save, Trash2, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { portalHost } from '../portalHost';
import type { UserStrategyRecord } from '../types';

type DialogFrameProps = {
  title: string;
  description: string;
  children: ReactNode;
  actions: ReactNode;
  closeDisabled?: boolean;
  onClose: () => void;
};

function DialogFrame({ title, description, children, actions, closeDisabled = false, onClose }: DialogFrameProps) {
  const active = useAppActive();
  const titleId = useId();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !closeDisabled) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeDisabled, onClose]);

  if (!active) return null;
  return createPortal(
    <div className="modal-backdrop" onPointerDown={closeDisabled ? undefined : onClose}>
      <section
        className="modal-card strategy-file-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p>{description}</p>
          </div>
          <button type="button" className="modal-close" disabled={closeDisabled} onClick={onClose} aria-label={`關閉${title}`}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        {children}
        <div className="modal-actions strategy-file-actions">{actions}</div>
      </section>
    </div>,
    portalHost(),
  );
}

export function UnsavedStrategyDialog({
  pending,
  onCancel,
  onDiscard,
  onSave,
}: {
  pending: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <DialogFrame
      title="尚未儲存變更"
      description="目前策略已修改，繼續操作前請選擇處理方式。"
      closeDisabled={pending}
      onClose={onCancel}
      actions={(
        <>
          <button type="button" className="ghost-button" disabled={pending} onClick={onCancel}>取消</button>
          <button type="button" className="ghost-button danger-text-button" disabled={pending} onClick={onDiscard}>放棄變更</button>
          <button type="button" className="primary-button" disabled={pending} onClick={onSave}>
            <Save size={16} strokeWidth={2} />
            儲存後繼續
          </button>
        </>
      )}
    >
      <div className="strategy-dialog-message">
        <FilePlus2 size={22} strokeWidth={1.8} aria-hidden="true" />
        <p>未儲存的部位、模型參數、建倉成本與圖表設定將會遺失。</p>
      </div>
    </DialogFrame>
  );
}

export function SaveStrategyDialog({
  initialName,
  canUpdate,
  pending,
  error,
  onClose,
  onSave,
}: {
  initialName: string;
  canUpdate: boolean;
  pending: boolean;
  error: string;
  onClose: () => void;
  onSave: (mode: 'new' | 'update', name: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const normalizedName = name.trim();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!normalizedName || pending) return;
    onSave(canUpdate ? 'update' : 'new', normalizedName);
  };

  return (
    <DialogFrame
      title="儲存策略"
      description={canUpdate ? '更新目前策略，或另存成一筆新的私人策略。' : '策略只會儲存在你的會員帳號下。'}
      closeDisabled={pending}
      onClose={onClose}
      actions={(
        <>
          <button type="button" className="ghost-button" disabled={pending} onClick={onClose}>取消</button>
          {canUpdate ? (
            <button
              type="button"
              className="ghost-button"
              disabled={!normalizedName || pending}
              onClick={() => onSave('new', normalizedName)}
            >
              另存新策略
            </button>
          ) : null}
          <button
            type="submit"
            form="strategy-save-form"
            className="primary-button"
            disabled={!normalizedName || pending}
          >
            <Save size={16} strokeWidth={2} />
            {pending ? '正在儲存…' : canUpdate ? '更新原策略' : '儲存策略'}
          </button>
        </>
      )}
    >
      <form id="strategy-save-form" className="strategy-save-form" onSubmit={handleSubmit}>
        <label>
          <span>策略名稱</span>
          <input
            type="text"
            value={name}
            maxLength={120}
            autoFocus
            placeholder="例如：台指多頭價差"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <small>{normalizedName.length} / 120</small>
        {error ? <p className="strategy-dialog-error" role="alert">{error}</p> : null}
      </form>
    </DialogFrame>
  );
}

export function DeleteStrategyDialog({
  strategy,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  strategy: UserStrategyRecord;
  pending: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <DialogFrame
      title="刪除策略"
      description="此動作會永久刪除雲端資料，且無法復原。"
      closeDisabled={pending}
      onClose={onCancel}
      actions={(
        <>
          <button type="button" className="ghost-button" disabled={pending} onClick={onCancel}>取消</button>
          <button type="button" className="danger-button" disabled={pending} onClick={onConfirm}>
            <Trash2 size={16} strokeWidth={2} />
            {pending ? '正在刪除…' : '確認刪除'}
          </button>
        </>
      )}
    >
      <div className="strategy-dialog-message strategy-delete-message">
        <AlertTriangle size={22} strokeWidth={1.9} aria-hidden="true" />
        <div>
          <b>「{strategy.name}」</b>
          <p>刪除後，這筆策略將不再出現在你的私人策略清單中。</p>
        </div>
      </div>
      {error ? <p className="strategy-dialog-error strategy-delete-error" role="alert">{error}</p> : null}
    </DialogFrame>
  );
}

const formatUpdatedAt = (record: UserStrategyRecord) => {
  try {
    return new Intl.DateTimeFormat('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(record.updatedAt.toDate());
  } catch {
    return '時間資料無法顯示';
  }
};

export function LoadStrategyDialog({
  strategies,
  currentStrategyId,
  loading,
  pending,
  error,
  onClose,
  onSelect,
  onDelete,
}: {
  strategies: UserStrategyRecord[];
  currentStrategyId: string | null;
  loading: boolean;
  pending: boolean;
  error: string;
  onClose: () => void;
  onSelect: (strategy: UserStrategyRecord) => void;
  onDelete: (strategy: UserStrategyRecord) => void;
}) {
  return (
    <DialogFrame
      title="載入策略"
      description="選擇儲存在目前 Google 帳號下的私人策略。"
      closeDisabled={pending}
      onClose={onClose}
      actions={<button type="button" className="ghost-button" disabled={pending} onClick={onClose}>關閉</button>}
    >
      <div className="strategy-load-content">
        {loading ? <p className="strategy-dialog-state">正在載入策略…</p> : null}
        {!loading && error ? <p className="strategy-dialog-error" role="alert">{error}</p> : null}
        {!loading && !error && strategies.length === 0 ? (
          <div className="strategy-empty-state">
            <FolderOpen size={28} strokeWidth={1.7} aria-hidden="true" />
            <b>尚未儲存任何策略</b>
            <p>回到分析器設定部位後，使用「儲存策略」建立第一筆資料。</p>
          </div>
        ) : null}
        {!loading && !error && strategies.length > 0 ? (
          <div className="strategy-load-list" role="list">
            {strategies.map((strategy) => {
              const isCurrent = strategy.id === currentStrategyId;
              return (
                <div
                  key={strategy.id}
                  role="listitem"
                  className={`strategy-load-row${isCurrent ? ' current' : ''}`}
                >
                  <button
                    type="button"
                    className="strategy-load-option"
                    disabled={pending}
                    aria-label={`載入策略「${strategy.name}」`}
                    onClick={() => onSelect(strategy)}
                  >
                    <FolderOpen size={18} strokeWidth={1.9} aria-hidden="true" />
                    <span>
                      <b>{strategy.name}</b>
                      <small><Clock3 size={12} strokeWidth={2} />{formatUpdatedAt(strategy)}</small>
                    </span>
                    {isCurrent ? <em>目前使用</em> : null}
                  </button>
                  <button
                    type="button"
                    className="strategy-delete-button"
                    disabled={pending}
                    aria-label={`刪除策略「${strategy.name}」`}
                    title={`刪除「${strategy.name}」`}
                    onClick={() => onDelete(strategy)}
                  >
                    <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </DialogFrame>
  );
}
