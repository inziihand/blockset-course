import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { collectDeploymentInventory } from './lib/deployment-inventory.mjs';

const args = process.argv.slice(2);
const positionalPath = args.find((value) => !value.startsWith('--'));
const valueAfter = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const selectedInstallation = valueAfter('--installation', positionalPath);
if (!selectedInstallation) {
  throw new Error('Usage: npm run inventory:deployment -- <installation.json>');
}
const installationPath = resolve(selectedInstallation);
const installation = JSON.parse(await readFile(installationPath, 'utf8'));
const outputPath = resolve(valueAfter(
  '--output',
  `.stratexec/deployment-inventory/${installation.installationKey}.json`,
));

const inventory = await collectDeploymentInventory({ installation });
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
console.log(`Read-only inventory: ${inventory.collectionStatus}`);
console.log(`Snapshot: ${outputPath}`);
for (const error of inventory.errors) console.log(`INCOMPLETE: ${error}`);
if (inventory.collectionStatus !== 'complete') process.exitCode = 2;
