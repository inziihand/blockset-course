import { useState } from 'react';
import type { ShellAppProps } from '../../src/shell/types';
import { Button } from '../../src/shared/ui/controls';

export default function FixtureBeta({ onOpenHome, onOpenAppMenu }: ShellAppProps) {
  const [failed, setFailed] = useState(false);
  if (failed) throw new Error('STRATEXEC_OFFLINE_FIXTURE: intentional render failure');
  return (
    <section aria-label="Beta 離線測試內容">
      <p data-fixture="STRATEXEC_OFFLINE_FIXTURE">離線測試，不連接券商</p>
      <p>Beta 正常內容</p>
      <Button onClick={() => setFailed(true)}>觸發渲染錯誤</Button>{' '}
      <Button onClick={onOpenAppMenu}>由 Beta 開啟平台選單</Button>{' '}
      <Button onClick={onOpenHome}>由 Beta 返回首頁</Button>
    </section>
  );
}
