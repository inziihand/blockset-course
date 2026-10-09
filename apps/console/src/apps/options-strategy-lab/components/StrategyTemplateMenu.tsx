import { useRef, useState } from 'react';
import { useAppEffect as useEffect } from '../../../shared/lifecycle/AppActivity';
import { Layers, LayoutTemplate, LockKeyhole } from 'lucide-react';
import type { StrategyTemplateKey } from '../types';
import { strategyTemplates } from '../logic/strategyTemplates';

type TemplateMenuProps = {
  hasCourseAccess: boolean;
  onApplyTemplate: (template: StrategyTemplateKey) => void;
  onRequireCourseAccess: (feature: string) => void;
};

function TemplateMenu({ hasCourseAccess, onApplyTemplate, onRequireCourseAccess }: TemplateMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const locked = !hasCourseAccess;

  useEffect(() => {
    if (locked) setOpen(false);
  }, [locked]);

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
    <div className="tool-menu template-menu" ref={menuRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        className={locked ? 'course-feature-locked' : undefined}
        aria-label={`課程模板${locked ? '，課程學員功能' : ''}`}
        onClick={() => {
          if (locked) {
            setOpen(false);
            onRequireCourseAccess('課程模板');
            return;
          }
          setOpen((value) => !value);
        }}
      >
        {locked
          ? <LockKeyhole size={15} strokeWidth={2} aria-hidden="true" />
          : <LayoutTemplate size={15} strokeWidth={2} aria-hidden="true" />}
        課程模板 ▾
      </button>
      {open ? (
        <div className="tool-menu-panel" role="menu">
          {strategyTemplates.map((template) => (
            <button
              key={template.key}
              type="button"
              role="menuitem"
              aria-label={template.label}
              onClick={() => {
                setOpen(false);
                onApplyTemplate(template.key);
              }}
            >
              <Layers size={15} strokeWidth={2} />
              <span>{template.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export { TemplateMenu };
export default TemplateMenu;
