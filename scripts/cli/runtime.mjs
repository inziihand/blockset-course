import { closeSync, openSync } from 'node:fs';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {
  askYesNo,
  isWindows,
  pathExists,
  readJson,
  run,
  spawnDetached,
  waitForHttp,
  writeJsonAtomic,
} from './common.mjs';

const IDENTITY_PORT = 8180;
const FRONTEND_PORTS = [5175, 3001];

function runtimePaths(repoRoot) {
  const directory = path.join(repoRoot, '.stratexec', 'local-runtime');
  return {
    directory,
    settings: path.join(directory, 'settings.json'),
    processes: path.join(directory, 'processes.json'),
  };
}

function venvPythonPath(repoRoot) {
  return isWindows
    ? path.join(repoRoot, '.venv', 'Scripts', 'python.exe')
    : path.join(repoRoot, '.venv', 'bin', 'python');
}

function compatiblePython(command, prefix = []) {
  const result = run(command, [
    ...prefix,
    '-c',
    'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)',
  ], { capture: true, allowFailure: true });
  return result.exitCode === 0 ? { command, prefix } : null;
}

async function findSystemPython({ guided = false } = {}) {
  const candidates = isWindows
    ? [['py', ['-3.11']], ['python', []], ['python3', []]]
    : [['python3', []], ['python', []]];
  for (const [command, prefix] of candidates) {
    const found = compatiblePython(command, prefix);
    if (found) return found;
  }

  if (guided && isWindows) {
    const winget = run('winget', ['--version'], { capture: true, allowFailure: true });
    if (winget.exitCode === 0 && await askYesNo('完整本地模式需要 Python 3.11。現在使用 winget 安裝嗎？')) {
      run('winget', [
        'install', '--id', 'Python.Python.3.11', '--exact',
        '--accept-package-agreements', '--accept-source-agreements',
      ]);
      for (const [command, prefix] of candidates) {
        const found = compatiblePython(command, prefix);
        if (found) return found;
      }
      throw new Error('Python 已安裝，但目前終端尚未找到。請重新開啟終端後執行 npm run setup。');
    }
  }

  if (guided && process.platform === 'darwin') {
    const brew = run('brew', ['--version'], { capture: true, allowFailure: true });
    if (brew.exitCode === 0 && await askYesNo('完整本地模式需要 Python 3.11。現在使用 Homebrew 安裝嗎？')) {
      run('brew', ['install', 'python@3.11']);
      for (const [command, prefix] of candidates) {
        const found = compatiblePython(command, prefix);
        if (found) return found;
      }
    }
  }

  throw new Error('需要 Python 3.11 以上。請安裝後重新執行 npm run setup。');
}

async function ensureVirtualEnvironment(repoRoot, guided) {
  const pythonPath = venvPythonPath(repoRoot);
  if (!await pathExists(pythonPath)) {
    const systemPython = await findSystemPython({ guided });
    console.log('正在建立本機 Python 環境…');
    run(systemPython.command, [...systemPython.prefix, '-m', 'venv', path.join(repoRoot, '.venv')]);
  }

  const imports = run(pythonPath, [
    '-c', 'import fastapi, firebase_admin, uvicorn, stratexec',
  ], { capture: true, allowFailure: true });
  if (imports.exitCode !== 0) {
    console.log('正在安裝 Identity API Python 相依套件…');
    run(pythonPath, [
      '-m', 'pip', 'install', '--disable-pip-version-check', '--use-feature=truststore',
      'setuptools>=75', 'wheel',
    ]);
    run(pythonPath, [
      '-m', 'pip', 'install', '--disable-pip-version-check', '--use-feature=truststore',
      '--no-build-isolation', '-e', path.join(repoRoot, 'backend'),
    ]);
    const verified = run(pythonPath, [
      '-c', 'import fastapi, firebase_admin, uvicorn, stratexec',
    ], { capture: true, allowFailure: true });
    if (verified.exitCode !== 0) throw new Error('Identity API Python 相依套件安裝失敗。');
  }
  return pythonPath;
}

async function portAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port }, () => {
      server.close(() => resolve(true));
    });
  });
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!processExists(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function stopManagedPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || !processExists(pid)) return;
  if (isWindows) {
    run('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { capture: true, allowFailure: true });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already stopped */ }
  }
}

export async function stopLocal(repoRoot, options = {}) {
  const paths = runtimePaths(repoRoot);
  if (!await pathExists(paths.processes)) {
    if (!options.quiet) console.log('沒有由 StratExec Node CLI 管理的執行中服務。');
    return;
  }
  const state = await readJson(paths.processes);
  if (path.resolve(state.repoRoot ?? '') !== path.resolve(repoRoot)) {
    throw new Error('拒絕停止服務：程序狀態不屬於目前 StratExec checkout。');
  }
  const pids = [state.frontend?.pid, state.identity?.pid]
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 0);
  for (const pid of pids) stopManagedPid(pid);
  for (const pid of pids) await waitForProcessExit(pid);
  await unlink(paths.processes).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!options.quiet) console.log(`已停止 StratExec 本地服務。PID：${pids.join(', ') || '無'}`);
}

export async function startLocal(repoRoot, options = {}) {
  const paths = runtimePaths(repoRoot);
  await mkdir(paths.directory, { recursive: true });
  let configPath = options.configPath;
  let bootstrapAdminEmail = options.bootstrapAdminEmail;
  if (!configPath) {
    if (!await pathExists(paths.settings)) {
      throw new Error('找不到本地安裝設定。請先執行 npm run setup。');
    }
    const settings = await readJson(paths.settings);
    configPath = settings.configPath;
    bootstrapAdminEmail ||= settings.bootstrapAdminEmail;
  }
  configPath = path.resolve(configPath);
  const installation = await readJson(configPath);
  const projectId = String(installation.gcpProjectId ?? '');
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) throw new Error('gcpProjectId 無效。');
  bootstrapAdminEmail ||= installation.auth?.supportEmail;
  if (!/^.+@.+\..+$/.test(bootstrapAdminEmail ?? '')) throw new Error('本機首位管理員 email 無效。');

  if (!await pathExists(path.join(repoRoot, '.env.local'))) {
    throw new Error('缺少根目錄 .env.local。請先執行 npm run setup。');
  }
  const adc = run('gcloud', ['auth', 'application-default', 'print-access-token'], {
    capture: true,
    allowFailure: true,
  });
  if (adc.exitCode !== 0) throw new Error('缺少 Application Default Credentials。請重新執行 npm run setup。');

  if (await pathExists(paths.processes)) await stopLocal(repoRoot, { quiet: true });
  if (!await portAvailable(IDENTITY_PORT)) {
    throw new Error(`連接埠 ${IDENTITY_PORT} 已被其他程式使用。`);
  }
  let frontendPort = null;
  for (const candidate of FRONTEND_PORTS) {
    if (await portAvailable(candidate)) {
      frontendPort = candidate;
      break;
    }
  }
  if (!frontendPort) throw new Error('連接埠 5175 與 3001 都已被其他程式使用。');

  const pythonPath = await ensureVirtualEnvironment(repoRoot, options.guided ?? false);
  const viteScript = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!await pathExists(viteScript)) throw new Error('找不到 Vite。請先執行 npm run setup。');

  const identityOut = openSync(path.join(paths.directory, 'identity.stdout.log'), 'a');
  const identityErr = openSync(path.join(paths.directory, 'identity.stderr.log'), 'a');
  const frontendOut = openSync(path.join(paths.directory, 'frontend.stdout.log'), 'a');
  const frontendErr = openSync(path.join(paths.directory, 'frontend.stderr.log'), 'a');
  let identityProcess;
  let frontendProcess;
  try {
    identityProcess = spawnDetached(pythonPath, [
      '-m', 'uvicorn', 'stratexec.api.main:app', '--app-dir', 'backend/src',
      '--host', '127.0.0.1', '--port', String(IDENTITY_PORT),
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        GOOGLE_CLOUD_PROJECT: projectId,
        STRATEXEC_BOOTSTRAP_ADMIN_EMAILS: bootstrapAdminEmail,
      },
      stdoutFd: identityOut,
      stderrFd: identityErr,
    });
    const identityHealth = await waitForHttp(`http://127.0.0.1:${IDENTITY_PORT}/healthz`);
    if (!identityHealth) throw new Error('Identity API 未通過健康檢查。請查看 .stratexec/local-runtime 日誌。');
    const apps = await waitForHttp(`http://127.0.0.1:${IDENTITY_PORT}/api/identity/v1/apps`, 10);
    if (!apps) throw new Error('Identity API 已啟動，但 Firestore App 清冊驗證失敗。');

    frontendProcess = spawnDetached(process.execPath, [
      viteScript, 'apps/console', '--host', '127.0.0.1',
      '--port', String(frontendPort), '--strictPort',
    ], {
      cwd: repoRoot,
      stdoutFd: frontendOut,
      stderrFd: frontendErr,
    });
    const frontendUrl = `http://127.0.0.1:${frontendPort}/`;
    const frontendHealth = await waitForHttp(frontendUrl);
    if (!frontendHealth || !((await frontendHealth.text()).includes('StratExec'))) {
      throw new Error('StratExec Console 未通過健康檢查。請查看 .stratexec/local-runtime 日誌。');
    }

    await writeJsonAtomic(paths.settings, {
      schemaVersion: 1,
      repoRoot,
      configPath,
      bootstrapAdminEmail,
    });
    await writeJsonAtomic(paths.processes, {
      schemaVersion: 1,
      repoRoot,
      configPath,
      projectId,
      identity: { pid: identityProcess.pid, url: `http://127.0.0.1:${IDENTITY_PORT}` },
      frontend: { pid: frontendProcess.pid, url: frontendUrl },
      startedAt: new Date().toISOString(),
    });

    console.log('\nStratExec 完整本地環境已啟動。');
    console.log(`Console:      ${frontendUrl}`);
    console.log(`Identity API: http://127.0.0.1:${IDENTITY_PORT}`);
    console.log(`本機日誌：   ${paths.directory}`);
    console.log('停止服務：   npm run stop:local');
    return { frontendUrl, identityUrl: `http://127.0.0.1:${IDENTITY_PORT}` };
  } catch (error) {
    if (frontendProcess?.pid) stopManagedPid(frontendProcess.pid);
    if (identityProcess?.pid) stopManagedPid(identityProcess.pid);
    throw error;
  } finally {
    closeSync(identityOut);
    closeSync(identityErr);
    closeSync(frontendOut);
    closeSync(frontendErr);
  }
}

export const runtimeInternals = { compatiblePython, venvPythonPath };
