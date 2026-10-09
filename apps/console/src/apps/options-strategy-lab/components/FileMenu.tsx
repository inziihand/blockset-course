import { useRef, useState } from 'react';
import { useAppEffect as useEffect } from '../../../shared/lifecycle/AppActivity';
import { Download, FileText, FolderOpen, Plus, Save, Upload } from 'lucide-react';

type FileMenuProps = {
  pending?: boolean;
  currentName?: string;
  hasUnsavedChanges?: boolean;
  onNew: () => void;
  onLoad: () => void;
  onSave: () => void;
  onImport: (file: File) => void;
  onExport: () => void;
};

function FileMenu({
  pending = false,
  currentName = '',
  hasUnsavedChanges = false,
  onNew,
  onLoad,
  onSave,
  onImport,
  onExport,
}: FileMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="tool-menu file-menu" ref={menuRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`檔案${currentName ? `，目前策略 ${currentName}` : '，未命名策略'}${hasUnsavedChanges ? '，有未儲存變更' : ''}`}
        title={currentName ? `${currentName}${hasUnsavedChanges ? '（未儲存）' : ''}` : hasUnsavedChanges ? '未命名策略（未儲存）' : '未命名策略'}
        onClick={() => setOpen((value) => !value)}
      >
        <FileText size={15} strokeWidth={2} aria-hidden="true" />檔案 ▾
      </button>
      {open ? (
        <div className="tool-menu-panel" role="menu">
          <button type="button" role="menuitem" disabled={pending} onClick={() => { setOpen(false); onNew(); }}><Plus size={15} />新建策略</button>
          <button type="button" role="menuitem" disabled={pending} onClick={() => { setOpen(false); onLoad(); }}><FolderOpen size={15} />載入策略</button>
          <button type="button" role="menuitem" disabled={pending} onClick={() => { setOpen(false); onSave(); }}><Save size={15} />儲存策略</button>
          <button type="button" role="menuitem" disabled={pending} onClick={() => { setOpen(false); fileInputRef.current?.click(); }}><Upload size={15} />匯入 JSON</button>
          <button type="button" role="menuitem" disabled={pending} onClick={() => { setOpen(false); onExport(); }}><Download size={15} />匯出 JSON</button>
        </div>
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        hidden
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onImport(file);
        }}
      />
    </div>
  );
}

export default FileMenu;
