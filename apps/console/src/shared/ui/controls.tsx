import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { useAppActive } from '../lifecycle/AppActivity';

export function Button({ className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} type={type} className={`platform-button ${className}`} />;
}

export function Field({ label, hint, error, id, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy = [props['aria-describedby'], hint && `${inputId}-hint`, error && `${inputId}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="platform-field">
      <label htmlFor={inputId}>{label}</label>
      <input {...props} id={inputId} aria-describedby={describedBy} aria-invalid={Boolean(error) || props['aria-invalid']} />
      {hint && <small id={`${inputId}-hint`}>{hint}</small>}
      {error && <small id={`${inputId}-error`} className="field-error" role="alert">{error}</small>}
    </div>
  );
}

export function LoadingState({ message = '正在載入…' }: { message?: string }) {
  return <div className="platform-state" role="status">{message}</div>;
}
export function EmptyState({ title = '目前沒有資料', children }: { title?: string; children?: ReactNode }) {
  return <section className="platform-state"><h3>{title}</h3>{children}</section>;
}
export function ErrorState({ title = '暫時無法取得資料', children }: { title?: string; children?: ReactNode }) {
  return <section className="platform-state" role="alert"><h3>{title}</h3>{children}</section>;
}

export function ConfirmDialog({ open, title, children, onConfirm, onClose, pending = false, confirmDisabled = false, confirmLabel = '確認' }: {
  open: boolean; title: string; children: ReactNode; onConfirm: () => void; onClose: () => void; pending?: boolean; confirmDisabled?: boolean; confirmLabel?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useAppActive();
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    if (active && open && !dialog.current?.open) dialog.current?.showModal();
    if ((!active || !open) && dialog.current?.open) dialog.current.close();
  }, [active, open]);
  return (
    <dialog ref={dialog} className="platform-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); if (!pending) onClose(); }}>
      <h2 id={titleId}>{title}</h2>
      <div id={descriptionId}>{children}</div>
      <div className="dialog-actions">
        <Button autoFocus disabled={pending} onClick={onClose}>取消</Button>
        <Button disabled={pending || confirmDisabled} onClick={onConfirm}>{pending ? '處理中…' : confirmLabel}</Button>
      </div>
    </dialog>
  );
}
