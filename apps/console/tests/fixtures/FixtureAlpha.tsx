import { useEffect, useMemo, useRef, useState } from 'react';
import type { ShellAppProps } from '../../src/shell/types';
import { createApiClient } from '../../src/shared/api';
import { useApiRead } from '../../src/shared/useApiRead';
import { Button, ConfirmDialog, EmptyState, ErrorState, Field, LoadingState } from '../../src/shared/ui/controls';
import { useNotifications } from '../../src/shared/ui/Notifications';
import { offlineFetch, type FixtureReadMode, type FixtureResult, type FixtureScope } from './offlineTransport';

export default function FixtureAlpha({ signal }: ShellAppProps) {
  const client = useMemo(() => createApiClient({ baseUrl: '/offline-fixtures/', fetch: offlineFetch, timeoutMs: 5_000 }), []);
  const [scope, setScope] = useState<FixtureScope>('alpha');
  const [request, setRequest] = useState<{ mode: FixtureReadMode; revision: number }>({ mode: 'normal', revision: 0 });
  const [name, setName] = useState('Alpha');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const confirmationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { notify } = useNotifications();
  const read = useApiRead<FixtureResult>({
    client,
    path: `fixture-status?scope=${scope}&mode=${request.mode}&revision=${request.revision}`,
    scopeKey: scope,
    signal,
  });

  useEffect(() => () => clearTimeout(confirmationTimer.current), []);
  const selectRead = (mode: FixtureReadMode) => setRequest((previous) => ({ mode, revision: previous.revision + 1 }));
  const confirm = () => {
    if (pending || signal.aborted) return;
    setPending(true);
    confirmationTimer.current = setTimeout(() => {
      if (signal.aborted) return;
      setPending(false);
      setDialogOpen(false);
      notify('離線確認完成', 'success');
    }, 500);
  };

  return (
    <section aria-label="Alpha 離線測試內容">
      <p data-fixture="STRATEXEC_OFFLINE_FIXTURE">離線測試，不連接券商</p>
      <Field label="測試顯示名稱" hint="僅存在目前測試元件，不會儲存至服務。" value={name} onChange={(event) => setName(event.currentTarget.value)} />
      <fieldset>
        <legend>資料範圍</legend>
        <Button aria-pressed={scope === 'alpha'} onClick={() => setScope('alpha')}>範圍 Alpha</Button>{' '}
        <Button aria-pressed={scope === 'beta'} onClick={() => setScope('beta')}>範圍 Beta</Button>
      </fieldset>
      <div aria-label="離線讀取操作">
        <Button onClick={() => selectRead('normal')}>讀取正常資料</Button>{' '}
        <Button onClick={() => selectRead('delayed')}>讀取延遲資料</Button>{' '}
        <Button onClick={() => selectRead('error')}>讀取失敗資料</Button>{' '}
        <Button onClick={() => selectRead('empty')}>讀取空資料</Button>
      </div>
      <section aria-label="離線讀取結果">
        {read.status === 'loading' && <LoadingState message="正在讀取離線資料…" />}
        {read.status === 'idle' && <EmptyState title="讀取已取消" />}
        {read.status === 'error' && <ErrorState title="離線讀取失敗"><p>{read.error?.message}</p><p>請求識別：{read.requestId}</p></ErrorState>}
        {read.status === 'ready' && (read.data?.items.length ? (
          <div><p>資料範圍：{read.data.scope}</p><p>{read.data.items[0]}</p><p>請求識別：{read.requestId}</p></div>
        ) : <EmptyState title="離線結果沒有資料" />)}
      </section>
      <Button onClick={() => setDialogOpen(true)}>開啟測試確認</Button>{' '}
      <Button onClick={() => notify('Alpha 測試通知')}>發送測試通知</Button>
      <ConfirmDialog open={dialogOpen} pending={pending} title="離線操作確認" confirmLabel="確認離線操作" onConfirm={confirm} onClose={() => setDialogOpen(false)}>
        這個確認只測試平台介面；不會送出 API 命令或交易。
      </ConfirmDialog>
    </section>
  );
}
