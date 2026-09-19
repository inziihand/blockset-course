import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHostingConfig } from './lib/hosting-config.mjs';
import { createDeploymentPlan, loadAppManifests } from './lib/deployment-plan.mjs';

const args = process.argv.slice(2);
if (!args[0]) {
  throw new Error('Usage: node scripts/render-hosting-config.mjs <installation.json> [output.json]');
}
const configPath = resolve(args[0]);
const outputPath = resolve(args[1] || '.stratexec/generated/firebase.json');
const installation = JSON.parse(await readFile(configPath, 'utf8'));
const registry = JSON.parse(await readFile(new URL('../infrastructure/services.json', import.meta.url), 'utf8'));
const appManifests = await loadAppManifests(new URL('../', import.meta.url));
const deployment = createDeploymentPlan({ installation, registry, appManifests });
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const publicDirectory = relative(dirname(outputPath), resolve(repositoryRoot, 'apps/console/dist')).replaceAll('\\', '/');
const output = `${JSON.stringify(createHostingConfig(installation, registry, {
  publicDirectory,
  selectedServiceKeys: deployment.requiredServiceKeys,
}), null, 2)}\n`;
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, output, 'utf8');
console.log(`Generated Firebase Hosting config: ${outputPath}`);
