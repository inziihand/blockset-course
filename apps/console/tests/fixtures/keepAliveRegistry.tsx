import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import type { ShellAppDefinition, ShellAppProps } from '../../src/shell/types';
import { useAppEffect } from '../../src/shared/lifecycle/AppActivity';
import { AppHeaderActions } from '../../src/shared/ui/AppHeaderActions';
import { AppInfoBar } from '../../src/shared/ui/AppInfoBar';
import { ConfirmDialog } from '../../src/shared/ui/controls';

/** Offline test consumers; no network, business Apps or persisted data. */
export function getKeepAliveTestApps(): readonly ShellAppDefinition[] {
  return ['alpha', 'beta'].map(key => {
    function Draft({ signal }: ShellAppProps) {
      const [draft, setDraft] = useState('');
      const [ticks, setTicks] = useState(0);
      const [dialog, setDialog] = useState(false);
      useAppEffect(() => {
        const timer = window.setInterval(() => setTicks(value => value + 1), 100);
        return () => window.clearInterval(timer);
      }, [signal]);
      return <section aria-label={`${key} workspace`}>
        <AppHeaderActions><button type="button" onClick={() => setDialog(true)}>{key} action</button></AppHeaderActions>
        <AppInfoBar>{key} information</AppInfoBar>
        <label>{key} draft<input aria-label={`${key} draft`} value={draft} onChange={event => setDraft(event.target.value)} /></label>
        <output aria-label={`${key} ticks`}>{ticks}</output>
        <ConfirmDialog open={dialog} title={`${key} dialog`} onClose={() => setDialog(false)} onConfirm={() => setDialog(false)}>Offline confirmation only</ConfirmDialog>
      </section>;
    }
    return {
      key: `keep-alive-${key}`, path: `/apps/keep-alive-${key}`, title: `Keep-alive ${key}`,
      subtitle: 'Offline lifecycle fixture', description: 'Only verifies mounted state and suspended effects.',
      icon: FlaskConical, status: 'preview', access: 'public', displayMode: 'responsive', keepAlive: true,
      load: async () => ({ default: Draft }),
    };
  });
}
