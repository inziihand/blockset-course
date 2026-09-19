import { useId } from 'react';
import { BookOpen, Check, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePreference } from '../shared/theme/ThemeProvider';

const options = [
  { key: 'system', label: '跟隨系統', Icon: Monitor },
  { key: 'light', label: '淺色', Icon: Sun },
  { key: 'dark', label: '深色', Icon: Moon },
  { key: 'paper', label: '暖紙', Icon: BookOpen },
] satisfies { key: ThemePreference; label: string; Icon: typeof Monitor }[];

export default function ThemePicker({ onSelect, variant = 'cards' }: { onSelect?: () => void; variant?: 'cards' | 'list' }) {
  const { preference, resolvedTheme, setPreference } = useTheme();
  const groupId = useId();
  const isList = variant === 'list';
  const resolvedLabel = options.find((option) => option.key === resolvedTheme)?.label;
  return (
    <>
    {isList && <div className="theme-menu-header"><span>個人化</span><small>目前為 {resolvedLabel} 外觀</small></div>}
    <fieldset className={`theme-picker${isList ? ' theme-picker--list' : ''}`}>
      <legend>外觀</legend>
      <div className="theme-options">
        {options.map(({ key, label, Icon }) => (
          <label key={key} className={preference === key ? 'selected' : undefined}>
            <input
              type="radio" name={groupId} value={key} checked={preference === key}
              autoFocus={isList && preference === key}
              onChange={() => { setPreference(key); if (!isList) onSelect?.(); }}
              onClick={isList ? onSelect : undefined}
            />
            <Icon size={isList ? 16 : 17} strokeWidth={isList ? 2 : 1.8} aria-hidden="true" />
            <span>{label}</span>
            {isList && <i aria-hidden="true">{preference === key && <Check size={15} strokeWidth={2.4} aria-hidden="true" />}</i>}
          </label>
        ))}
      </div>
    </fieldset>
    </>
  );
}
