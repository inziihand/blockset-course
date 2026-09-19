import { readFile, writeFile } from 'node:fs/promises';
import { generateAppRegistrySource } from './lib/app-registry.mjs';
import { loadAppManifests } from './lib/deployment-plan.mjs';

const root = new URL('../', import.meta.url);
const target = new URL('apps/console/src/shell/generatedAppRegistry.ts', root);
const expected = generateAppRegistrySource(await loadAppManifests(root));

if (process.argv.includes('--check')) {
  const current = await readFile(target, 'utf8').catch(() => '');
  if (current.replaceAll('\r\n', '\n') !== expected) {
    throw new Error('Generated App Registry drift: run npm run apps:registry.');
  }
  console.log('Generated App Registry matches App manifests.');
} else {
  await writeFile(target, expected, 'utf8');
  console.log('Generated apps/console/src/shell/generatedAppRegistry.ts from App manifests.');
}
