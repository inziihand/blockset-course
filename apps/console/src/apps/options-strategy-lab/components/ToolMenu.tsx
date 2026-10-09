import { useRef, useState } from 'react';
import { useAppEffect as useEffect } from '../../../shared/lifecycle/AppActivity';
import { Calculator, Wrench } from 'lucide-react';

function ToolMenu({ onOpenIvCalculator }: { onOpenIvCalculator: () => void }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

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
    <div className="tool-menu" ref={menuRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Wrench size={15} strokeWidth={2} aria-hidden="true" />工具 ▾
      </button>
      {open ? (
        <div className="tool-menu-panel" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenIvCalculator();
            }}
          >
            <Calculator size={15} strokeWidth={2} />IV 反推計算器
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default ToolMenu;
