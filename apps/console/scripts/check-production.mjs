import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../dist/', import.meta.url);
const forbidden = [
  'STRATEXEC_OFFLINE_FIXTURE', 'fixture-alpha', 'fixture-beta', 'fixtureLoadFailure', '離線測試宿主',
  // Server-side authorization policy must never enter a Vite browser bundle.
  'STRATEXEC_BOOTSTRAP_ADMIN_EMAILS',
];
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = typeof directory === 'string' ? join(directory, entry.name) : new URL(entry.name, directory);
    if (entry.isDirectory()) {
      await check(typeof path === 'string' ? path : new URL(`${entry.name}/`, directory));
    } else if (/\.(js|html)$/.test(entry.name)) {
      const source = await readFile(path, 'utf8');
      for (const marker of forbidden) {
        if (source.includes(marker)) throw new Error(`Test fixture leaked into production: ${entry.name}: ${marker}`);
      }
    }
  }
}
await check(root);
console.log('Production bundle contains no test fixtures or server-only administrator policy.');
