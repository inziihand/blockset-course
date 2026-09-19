import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from './controls';

type Notice = { id: number; message: string; tone: 'info' | 'success' | 'error' };
type NotificationActions = { notify: (message: string, tone?: Notice['tone']) => number; dismiss: (id: number) => void };
const Context = createContext<NotificationActions | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const nextId = useRef(0);
  const dismiss = useCallback((id: number) => setNotices((items) => items.filter((item) => item.id !== id)), []);
  const notify = useCallback((message: string, tone: Notice['tone'] = 'info') => {
    const id = ++nextId.current;
    setNotices((items) => [...items, { id, message, tone }]);
    return id;
  }, []);
  const value = useMemo(() => ({ notify, dismiss }), [notify, dismiss]);
  return (
    <Context.Provider value={value}>
      {children}
      {notices.length > 0 && <aside className="platform-notifications" aria-label="平台通知">
        {notices.map((notice) => <div className={`platform-notice ${notice.tone}`} key={notice.id}>
          <p role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.message}</p>
          <Button aria-label={`關閉通知：${notice.message}`} onClick={() => dismiss(notice.id)}>關閉</Button>
        </div>)}
      </aside>}
    </Context.Provider>
  );
}

export function useNotifications() {
  const actions = useContext(Context);
  if (!actions) throw new Error('NotificationProvider is required');
  return actions;
}
