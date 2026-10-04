import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AppShell from './shell/AppShell';
import { initializeTheme, ThemeProvider } from './shared/theme/ThemeProvider';
import { AuthProvider } from './shared/auth';
import './styles/tokens.css';
import './styles/shell.css';
import './styles/app-layout.css';

initializeTheme();

// This branch is eliminated from production builds, including the fixture chunks.
async function bootstrap() {
  const fixtureMode = import.meta.env.DEV && import.meta.env.MODE === 'platform-test';
  const apps = fixtureMode
    ? (await import('../tests/fixtures/registry')).getTestApps({
      failBetaLoad: new URLSearchParams(window.location.search).get('fixtureLoadFailure') === '1',
      keepAliveTest: new URLSearchParams(window.location.search).get('keepAliveFixture') === '1',
    })
    : undefined;
  createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        {fixtureMode && <aside className="test-host-banner">離線測試宿主 · 不連接券商 · 非正式 App</aside>}
        <AppShell apps={apps} />
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
  );
}
void bootstrap();
