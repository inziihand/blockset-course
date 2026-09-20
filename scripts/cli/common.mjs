import { spawn, spawnSync } from 'node:child_process';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export const isWindows = process.platform === 'win32';

export async function pathExists(candidate) {
  try {
    await access(candidate, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function commandForPlatform(command) {
  if (!isWindows) return command;
  if (command === 'gcloud') return 'gcloud.cmd';
  if (command === 'npm') return 'npm.cmd';
  return command;
}

export function run(command, args = [], options = {}) {
  const executable = commandForPlatform(command);
  const shell = isWindows && executable.toLowerCase().endsWith('.cmd');
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell,
    windowsHide: true,
  });
  const exitCode = result.status ?? (result.error ? 1 : 0);
  const response = {
    exitCode,
    stdout: String(result.stdout ?? '').trim(),
    stderr: String(result.stderr ?? '').trim(),
    error: result.error,
  };
  if (exitCode !== 0 && !options.allowFailure) {
    const details = response.stderr || response.stdout || result.error?.message || 'unknown error';
    throw new Error(`${command} ${args.join(' ')} failed (${exitCode}): ${details}`);
  }
  return response;
}

export function runNode(script, args = [], options = {}) {
  return run(process.execPath, [script, ...args], options);
}

export function runNpm(args, options = {}) {
  if (process.env.npm_execpath) {
    return runNode(process.env.npm_execpath, args, options);
  }
  return run('npm', args, options);
}

export function firebaseEnvironment() {
  const nodeOptions = process.env.NODE_OPTIONS ?? '';
  const tokens = nodeOptions.split(/\s+/).filter(Boolean);
  if (!tokens.includes('--use-system-ca')) tokens.push('--use-system-ca');
  return { ...process.env, NODE_OPTIONS: tokens.join(' ') };
}

export function runFirebase(repoRoot, args, options = {}) {
  const firebaseScript = path.join(repoRoot, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
  return runNode(firebaseScript, args, {
    ...options,
    env: options.env ?? firebaseEnvironment(),
  });
}

export async function askYesNo(label, defaultYes = true) {
  const suffix = defaultYes ? '[Y/n]' : '[y/N]';
  while (true) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const answer = (await rl.question(`${label} ${suffix}: `)).trim().toLowerCase();
    rl.close();
    if (!answer) return defaultYes;
    if (answer === 'y' || answer === 'yes') return true;
    if (answer === 'n' || answer === 'no') return false;
    console.warn('請輸入 Y 或 N。');
  }
}

export async function askMenu(label, minimum, maximum, defaultValue) {
  while (true) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const answer = (await rl.question(`${label} [${defaultValue}]: `)).trim();
    rl.close();
    if (!answer) return defaultValue;
    const number = Number.parseInt(answer, 10);
    if (String(number) === answer && number >= minimum && number <= maximum) return number;
    console.warn(`請輸入 ${minimum}～${maximum}。`);
  }
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, filePath);
}

export async function waitForHttp(url, attempts = 40) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return response;
    } catch {
      // The managed process may still be starting.
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

export function spawnDetached(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    detached: true,
    stdio: ['ignore', options.stdoutFd ?? 'ignore', options.stderrFd ?? 'ignore'],
    windowsHide: true,
  });
  child.unref();
  return child;
}

export function ensureGcloudSuccess(action, result) {
  if (result.exitCode === 0) return result.stdout;
  const details = result.stderr || result.stdout || result.error?.message || 'unknown error';
  if (/CERTIFICATE_VERIFY_FAILED|SSLCertVerificationError|unable to get local issuer certificate/i.test(details)) {
    throw new Error(
      `gcloud 執行「${action}」時無法驗證 Google TLS 憑證。請修復系統 CA 信任；` +
      `安裝器不會停用 TLS 驗證。原始訊息：${details}`,
    );
  }
  if (/gcloud auth login|invalid_grant|reauth|credentials/i.test(details)) {
    throw new Error(`gcloud 執行「${action}」時需要重新登入。原始訊息：${details}`);
  }
  throw new Error(`gcloud 無法${action}（exit code ${result.exitCode}）。原始訊息：${details}`);
}

export async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(15000) });
  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`${options.method ?? 'GET'} ${url} failed (${response.status}): ${body}`);
    error.status = response.status;
    throw error;
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

