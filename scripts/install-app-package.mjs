import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installAppPackage } from './lib/app-installer.mjs';
import { validateInstalledApp } from './lib/app-validation.mjs';

const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const optionValueIndexes = new Set(['--package', '--confirm', '--report']
  .map((name) => args.indexOf(name))
  .filter((index) => index >= 0)
  .map((index) => index + 1));
const positional = args.filter((argument, index) => !argument.startsWith('--') && !optionValueIndexes.has(index));
const zipPath = value('--package') ?? positional[0];
if (!zipPath) {
  throw new Error('Usage: npm run app:install -- <package.zip> [apply <app-key>@<version>] [adopt-existing] [allow-downgrade]');
}
const apply = args.includes('--apply') || positional.includes('apply');
const applyIndex = positional.indexOf('apply');
const confirmation = value('--confirm') ?? (applyIndex >= 0 ? positional[applyIndex + 1] : undefined);
const adoptExisting = args.includes('--adopt-existing') || positional.includes('adopt-existing');
const allowDowngrade = args.includes('--allow-downgrade') || positional.includes('allow-downgrade');
const reportPath = value('--report');

const result = await installAppPackage({
  zipPath: resolve(zipPath),
  rootPath: fileURLToPath(new URL('../', import.meta.url)),
  apply,
  confirmation,
  adoptExisting,
  allowDowngrade,
  postApply: apply ? ({ rootPath, plan }) => validateInstalledApp({ rootPath, appKey: plan.appKey }) : undefined,
});

if (reportPath) {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  await mkdir(dirname(resolve(reportPath)), { recursive: true });
  await writeFile(resolve(reportPath), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify(result, null, 2));
if (!apply) console.log('Dry run only. Re-run with apply and the exact app@version confirmation to change source files.');
