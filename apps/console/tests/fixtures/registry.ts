import { FlaskConical } from 'lucide-react';
import type { ShellAppDefinition } from '../../src/shell/types';

export function getTestApps({ failBetaLoad = false }: { failBetaLoad?: boolean } = {}): readonly ShellAppDefinition[] {
  return [
    {
      key: 'fixture-alpha',
      path: '/apps/fixture-alpha',
      title: '測試 Alpha',
      subtitle: '離線讀取與共用介面',
      description: '僅驗證平台承載，不是交易 App。',
      icon: FlaskConical,
      status: 'preview',
      access: 'public',
      displayMode: 'compact',
      load: () => import('./FixtureAlpha'),
    },
    {
      key: 'fixture-beta',
      path: '/apps/fixture-beta',
      title: '測試 Beta',
      subtitle: '離線故障與導覽驗收',
      description: '僅驗證平台承載，不是交易 App。',
      icon: FlaskConical,
      status: 'preview',
      access: 'public',
      displayMode: 'responsive',
      load: async () => {
        if (failBetaLoad) throw new Error('STRATEXEC_OFFLINE_FIXTURE: intentional module failure');
        return import('./FixtureBeta');
      },
    },
  ];
}

export const testApps = getTestApps();
