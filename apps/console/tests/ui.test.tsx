import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button, ConfirmDialog, EmptyState, ErrorState, Field, LoadingState } from '../src/shared/ui/controls';
import { NotificationProvider, useNotifications } from '../src/shared/ui/Notifications';

describe('Shared controls', () => {
  it('defaults buttons to non-submitting and respects disabled', async () => {
    const click = vi.fn();
    render(<Button disabled onClick={click}>測試按鈕</Button>);
    const button = screen.getByRole('button');
    expect(button.getAttribute('type')).toBe('button');
    await userEvent.click(button);
    expect(click).not.toHaveBeenCalled();
  });
  it('links field label, hint and validation error accessibly', () => {
    render(<Field label="顯示名稱" hint="僅用於本機測試" error="請輸入名稱" />);
    const input = screen.getByLabelText('顯示名稱');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    for (const id of input.getAttribute('aria-describedby')!.split(' ')) expect(document.getElementById(id)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('請輸入名稱');
  });
  it('separates empty, pending and failure states', () => {
    render(<><EmptyState /><LoadingState /><ErrorState /></>);
    expect(screen.getByText('目前沒有資料')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('正在載入…');
    expect(screen.getByRole('alert').textContent).toBe('暫時無法取得資料');
  });
  it('confirms explicitly and blocks duplicate confirmation while pending', async () => {
    const confirm = vi.fn(); const close = vi.fn();
    const view = render(<ConfirmDialog open title="測試確認" onConfirm={confirm} onClose={close}>不會送出交易</ConfirmDialog>);
    expect((screen.getByRole('dialog') as HTMLDialogElement).open).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: '確認' }));
    expect(confirm).toHaveBeenCalledOnce();
    view.rerender(<ConfirmDialog open pending title="測試確認" onConfirm={confirm} onClose={close}>不會送出交易</ConfirmDialog>);
    await userEvent.click(screen.getByRole('button', { name: '處理中…' }));
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(confirm).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
    view.rerender(<ConfirmDialog open title="測試確認" onConfirm={confirm} onClose={close}>不會送出交易</ConfirmDialog>);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(close).toHaveBeenCalledOnce();
  });
  it('keeps notifications until explicitly dismissed', async () => {
    function Demo() { const { notify } = useNotifications(); return <Button onClick={() => notify('離線測試完成', 'success')}>通知</Button>; }
    render(<NotificationProvider><Demo /></NotificationProvider>);
    await userEvent.click(screen.getByRole('button', { name: '通知' }));
    const notices = screen.getByRole('complementary', { name: '平台通知' });
    expect(within(notices).getByRole('status').textContent).toBe('離線測試完成');
    await userEvent.click(within(notices).getByRole('button', { name: '關閉通知：離線測試完成' }));
    expect(screen.queryByRole('complementary', { name: '平台通知' })).toBeNull();
  });
});
