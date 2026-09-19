import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDeploymentPlan, loadAppManifests } from './lib/deployment-plan.mjs';

const args = process.argv.slice(2);
const installationFlag = args.indexOf('--installation');
const positionalPath = args.find((argument) => !argument.startsWith('--'));
const selectedPath = installationFlag >= 0 && args[installationFlag + 1]
  ? args[installationFlag + 1]
  : positionalPath;
if (!selectedPath) {
  throw new Error('Usage: npm run plan:deployment -- <installation.json>');
}
const configPath = resolve(selectedPath);
const asJson = args.includes('--json');

const registry = JSON.parse(await readFile(new URL('../infrastructure/services.json', import.meta.url), 'utf8'));
const installation = JSON.parse(await readFile(configPath, 'utf8'));
const appManifests = await loadAppManifests(new URL('../', import.meta.url));
const deployment = createDeploymentPlan({ installation, registry, appManifests });

if (asJson) {
  console.log(JSON.stringify(deployment, null, 2));
} else {
  console.log(`Installation: ${installation.installationKey} (${installation.gcpProjectId})`);
  console.log(`Apps: ${deployment.selectedApps.join(', ')}`);
  for (const entry of deployment.plan) {
    console.log(`- ${entry.serviceKey}: ${entry.selectedTarget} / ${entry.status} / ${entry.productionReadiness} / deployable=${entry.deployable ? 'yes' : 'no'}`);
    console.log(`  requiredByApps=${entry.requiredByApps.join(',') || 'none'} requiredByServices=${entry.requiredByServices.join(',') || 'none'} driver=${entry.deploymentDriver ?? 'none'} (${entry.driverApplySupport})`);
    console.log(`  recommended=${entry.recommendedTarget} region=${entry.region} service=${entry.serviceName}`);
    for (const blocker of entry.blockers) console.log(`  BLOCKER: ${blocker}`);
  }
}
