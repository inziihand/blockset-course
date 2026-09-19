import { spawn } from 'node:child_process';
import { access, lstat, readFile, readdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function defaultRun(command, args, cwd) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: false });
    child.on('error', rejectPromise);
    child.on('exit', (code) => code === 0
      ? resolvePromise()
      : rejectPromise(new Error(`${command} ${args.join(' ')} exited with code ${code}.`)));
  });
}

function withinRoot(rootPath, relativePath) {
  const absolute = resolve(rootPath, relativePath);
  const prefix = `${resolve(rootPath)}${sep}`;
  if (!absolute.startsWith(prefix)) throw new Error(`Validation path escapes the repository: ${relativePath}`);
  return absolute;
}

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) throw new Error(`Installed service contains a symbolic link: ${path}`);
    if (stats.isDirectory()) {
      if (!['node_modules', 'dist', 'build', 'coverage'].includes(entry.name)) files.push(...await collectFiles(path));
    } else if (stats.isFile()) files.push(path);
  }
  return files;
}

export async function validateInstalledApp({ rootPath, appKey, runCommand = defaultRun }) {
  if (!/^[a-z][a-z0-9-]*$/.test(appKey ?? '')) throw new Error('Installed App validation requires a valid App key.');
  const root = resolve(rootPath);
  const fragmentPath = withinRoot(root, `infrastructure/app-services/${appKey}.json`);
  const fragment = await exists(fragmentPath) ? JSON.parse(await readFile(fragmentPath, 'utf8')) : null;
  if (fragment && (fragment.ownerApp !== appKey || !Array.isArray(fragment.services))) {
    throw new Error(`Installed App service fragment has invalid ownership: ${appKey}`);
  }
  const checkedFiles = [];
  for (const service of fragment?.services ?? []) {
    if (service.ownerApp !== appKey) throw new Error(`Installed App cannot validate a foreign service: ${service.key}`);
    const serviceRoot = withinRoot(root, service.source);
    for (const path of await collectFiles(serviceRoot)) {
      if (path.endsWith('.json')) JSON.parse(await readFile(path, 'utf8'));
      if (/\.(?:cjs|mjs|js)$/.test(path)) {
        await runCommand(process.execPath, ['--check', path], root);
        checkedFiles.push(path);
      }
    }
  }
  await runCommand(process.execPath, ['scripts/check-app-manifests.mjs'], root);
  await runCommand(process.execPath, ['scripts/check-service-registry.mjs'], root);
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error('Installed App validation must be launched through npm so the trusted npm CLI path is explicit.');
  }
  await runCommand(process.execPath, [
    npmCli, 'run', 'build', '--workspace=@stratexec/console',
  ], root);
  return { appKey, checkedServiceJavaScriptFiles: checkedFiles.length };
}
