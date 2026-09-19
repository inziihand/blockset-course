import { readFile, writeFile } from 'node:fs/promises';
import { loadMergedServiceRegistry, renderServiceRegistry } from './lib/service-catalog.mjs';

const root = new URL('../', import.meta.url);
const target = new URL('infrastructure/services.json', root);
const expected = renderServiceRegistry(await loadMergedServiceRegistry(root));

if (process.argv.includes('--check')) {
  const current = await readFile(target, 'utf8').catch(() => '');
  if (current.replaceAll('\r\n', '\n') !== expected) {
    throw new Error('Service registry drift: run npm run services:merge.');
  }
  console.log('Generated service registry matches owned service fragments.');
} else {
  await writeFile(target, expected, 'utf8');
  console.log('Generated infrastructure/services.json from owned service fragments.');
}
