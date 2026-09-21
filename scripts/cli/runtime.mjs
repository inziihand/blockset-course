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
  writeJsonAtomic,
} from './common.mjs';

function portRange(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

const IDENTITY_PORTS = [8180, 8181, ...portRange(8184, 8189)];
const PACKAGE_AGENT_PORTS = [8182, ...portRange(8190, 8195)];
const DEPLOYMENT_AGENT_PORTS = [8183, ...portRange(8196, 8201)];
const FRONTEND_PORTS = portRange(5175, 5180);

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

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForManagedHttp(url, pid, options = {}) {
  const attempts = options.attempts ?? 40;
  const fetchImpl = options.fetchImpl ?? fetch;
  const processExistsImpl = options.processExistsImpl ?? processExists;
  const sleepImpl = options.sleepImpl ?? sleep;
  const validate = options.validate ?? (() => true);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (!processExistsImpl(pid)) return null;
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok && await validate(response)) {
        // A competing checkout may have claimed this port after our availability
        // probe. Its HTTP response is not proof that our child process survived.
        await sleepImpl(300);
        return processExistsImpl(pid) ? response : null;
      }
    } catch {
      // The managed process may still be starting.
    }
    if (attempt < attempts) await sleepImpl(500);
  }
  return null;
}

async function launchOnAvailablePort(candidates, options) {
  const portAvailableImpl = options.portAvailableImpl ?? portAvailable;
  const stopProcessImpl = options.stopProcessImpl ?? stopManagedPid;
  const waitForProcessExitImpl = options.waitForProcessExitImpl ?? waitForProcessExit;

  for (const port of candidates) {
    if (!await portAvailableImpl(port)) continue;
    const managedProcess = options.launch(port);
    let failure;
    try {
      if (await options.ready(managedProcess, port)) return { managedProcess, port };
    } catch (error) {
      failure = error;
    }

    if (managedProcess?.pid) {
      stopProcessImpl(managedProcess.pid);
      await waitForProcessExitImpl(managedProcess.pid);
    }

    // If the port is now occupied after our child exited, another checkout won
    // the race. Retry the next candidate. An available port means this service
    // failed for a reason unrelated to allocation, so preserve that failure.
    if (!await portAvailableImpl(port)) continue;
    if (failure) throw failure;
    throw new Error(`${options.label} 未通過健康檢查。請查看 .stratexec/local-runtime 日誌。`);
  }
  return null;
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
  const pids = [
    state.frontend?.pid,
    state.deploymentAgent?.pid,
    state.packageAgent?.pid,
    state.identity?.pid,
  ]
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
  const pythonPath = await ensureVirtualEnvironment(repoRoot, options.guided ?? false);
  const viteScript = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!await pathExists(viteScript)) throw new Error('找不到 Vite。請先執行 npm run setup。');
  const packageAgentScript = path.join(repoRoot, 'tools', 'app-package-agent', 'src', 'server.mjs');
  const deploymentAgentScript = path.join(repoRoot, 'tools', 'deployment-agent', 'src', 'server.mjs');
  if (!await pathExists(packageAgentScript) || !await pathExists(deploymentAgentScript)) {
    throw new Error('找不到 App 安裝管理服務。請重新取得完整母版後執行 npm run setup。');
  }

  const identityOut = openSync(path.join(paths.directory, 'identity.stdout.log'), 'a');
  const identityErr = openSync(path.join(paths.directory, 'identity.stderr.log'), 'a');
  const packageAgentOut = openSync(path.join(paths.directory, 'app-package-agent.stdout.log'), 'a');
  const packageAgentErr = openSync(path.join(paths.directory, 'app-package-agent.stderr.log'), 'a');
  const deploymentAgentOut = openSync(path.join(paths.directory, 'deployment-agent.stdout.log'), 'a');
  const deploymentAgentErr = openSync(path.join(paths.directory, 'deployment-agent.stderr.log'), 'a');
  const frontendOut = openSync(path.join(paths.directory, 'frontend.stdout.log'), 'a');
  const frontendErr = openSync(path.join(paths.directory, 'frontend.stderr.log'), 'a');
  let identityProcess;
  let packageAgentProcess;
  let deploymentAgentProcess;
  let frontendProcess;
  try {
    const identity = await launchOnAvailablePort(IDENTITY_PORTS, {
      label: 'Identity API',
      launch: (port) => spawnDetached(pythonPath, [
        '-m', 'uvicorn', 'stratexec.api.main:app', '--app-dir', 'backend/src',
        '--host', '127.0.0.1', '--port', String(port),
      ], {
        cwd: repoRoot,
        env: {
          ...process.env,
          GOOGLE_CLOUD_PROJECT: projectId,
          STRATEXEC_BOOTSTRAP_ADMIN_EMAILS: bootstrapAdminEmail,
        },
        stdoutFd: identityOut,
        stderrFd: identityErr,
      }),
      ready: async (managedProcess, port) => {
        const identityUrl = `http://127.0.0.1:${port}`;
        const health = await waitForManagedHttp(`${identityUrl}/healthz`, managedProcess.pid);
        if (!health) return false;
        return Boolean(await waitForManagedHttp(
          `${identityUrl}/api/identity/v1/apps`, managedProcess.pid, { attempts: 10 },
        ));
      },
    });
    if (!identity) {
      throw new Error('Identity API 連接埠 8180、8181、8184～8189 都已被其他程式使用。');
    }
    identityProcess = identity.managedProcess;
    const identityUrl = `http://127.0.0.1:${identity.port}`;

    const packageAgent = await launchOnAvailablePort(PACKAGE_AGENT_PORTS, {
      label: 'App Package Agent',
      launch: (port) => spawnDetached(process.execPath, [
        '--use-system-ca', '--env-file-if-exists=.env.local', packageAgentScript,
      ], {
        cwd: repoRoot,
        env: {
          ...process.env,
          PORT: '',
          STRATEXEC_REPOSITORY_ROOT: repoRoot,
          STRATEXEC_IDENTITY_BASE_URL: identityUrl,
          STRATEXEC_APP_PACKAGE_AGENT_HOST: '127.0.0.1',
          STRATEXEC_APP_PACKAGE_AGENT_PORT: String(port),
        },
        stdoutFd: packageAgentOut,
        stderrFd: packageAgentErr,
      }),
      ready: (managedProcess, port) => waitForManagedHttp(
        `http://127.0.0.1:${port}/healthz`, managedProcess.pid,
      ),
    });
    if (!packageAgent) {
      throw new Error('App Package Agent 連接埠 8182、8190～8195 都已被其他程式使用。');
    }
    packageAgentProcess = packageAgent.managedProcess;
    const packageAgentUrl = `http://127.0.0.1:${packageAgent.port}`;

    const deploymentAgent = await launchOnAvailablePort(DEPLOYMENT_AGENT_PORTS, {
      label: 'Deployment Agent',
      launch: (port) => spawnDetached(process.execPath, [
        '--use-system-ca', '--env-file-if-exists=.env.local', deploymentAgentScript,
      ], {
        cwd: repoRoot,
        env: {
          ...process.env,
          PORT: '',
          STRATEXEC_REPOSITORY_ROOT: repoRoot,
          STRATEXEC_IDENTITY_BASE_URL: identityUrl,
          STRATEXEC_APP_PACKAGE_AGENT_BASE_URL: packageAgentUrl,
          STRATEXEC_DEPLOYMENT_AGENT_HOST: '127.0.0.1',
          STRATEXEC_DEPLOYMENT_AGENT_PORT: String(port),
        },
        stdoutFd: deploymentAgentOut,
        stderrFd: deploymentAgentErr,
      }),
      ready: (managedProcess, port) => waitForManagedHttp(
        `http://127.0.0.1:${port}/healthz`, managedProcess.pid,
      ),
    });
    if (!deploymentAgent) {
      throw new Error('Deployment Agent 連接埠 8183、8196～8201 都已被其他程式使用。');
    }
    deploymentAgentProcess = deploymentAgent.managedProcess;
    const deploymentAgentUrl = `http://127.0.0.1:${deploymentAgent.port}`;

    const frontend = await launchOnAvailablePort(FRONTEND_PORTS, {
      label: 'StratExec Console',
      launch: (port) => spawnDetached(process.execPath, [
        viteScript, 'apps/console', '--host', '127.0.0.1',
        '--port', String(port), '--strictPort',
      ], {
        cwd: repoRoot,
        env: {
          ...process.env,
          STRATEXEC_IDENTITY_BASE_URL: identityUrl,
          STRATEXEC_APP_PACKAGE_AGENT_BASE_URL: packageAgentUrl,
          STRATEXEC_DEPLOYMENT_AGENT_BASE_URL: deploymentAgentUrl,
        },
        stdoutFd: frontendOut,
        stderrFd: frontendErr,
      }),
      ready: (managedProcess, port) => waitForManagedHttp(
        `http://127.0.0.1:${port}/`, managedProcess.pid,
        { validate: async (response) => (await response.text()).includes('StratExec') },
      ),
    });
    if (!frontend) {
      throw new Error('Console 連接埠 5175～5180 都已被其他程式使用。');
    }
    frontendProcess = frontend.managedProcess;
    const frontendUrl = `http://127.0.0.1:${frontend.port}/`;

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
      identity: { pid: identityProcess.pid, url: identityUrl },
      packageAgent: { pid: packageAgentProcess.pid, url: packageAgentUrl },
      deploymentAgent: { pid: deploymentAgentProcess.pid, url: deploymentAgentUrl },
      frontend: { pid: frontendProcess.pid, url: frontendUrl },
      startedAt: new Date().toISOString(),
    });

    console.log('\nStratExec 完整本地環境已啟動。');
    console.log(`Console:      ${frontendUrl}`);
    console.log(`Identity API: ${identityUrl}`);
    console.log(`Package Agent:    ${packageAgentUrl}`);
    console.log(`Deployment Agent: ${deploymentAgentUrl}`);
    console.log(`本機日誌：   ${paths.directory}`);
    console.log('停止服務：   npm run stop:local');
    return { frontendUrl, identityUrl };
  } catch (error) {
    if (frontendProcess?.pid) stopManagedPid(frontendProcess.pid);
    if (deploymentAgentProcess?.pid) stopManagedPid(deploymentAgentProcess.pid);
    if (packageAgentProcess?.pid) stopManagedPid(packageAgentProcess.pid);
    if (identityProcess?.pid) stopManagedPid(identityProcess.pid);
    throw error;
  } finally {
    closeSync(identityOut);
    closeSync(identityErr);
    closeSync(packageAgentOut);
    closeSync(packageAgentErr);
    closeSync(deploymentAgentOut);
    closeSync(deploymentAgentErr);
    closeSync(frontendOut);
    closeSync(frontendErr);
  }
}

export const runtimeInternals = {
  compatiblePython,
  venvPythonPath,
  portRange,
  packageAgentPorts: PACKAGE_AGENT_PORTS,
  deploymentAgentPorts: DEPLOYMENT_AGENT_PORTS,
  waitForManagedHttp,
  launchOnAvailablePort,
};
