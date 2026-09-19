import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function array(value) {
  return Array.isArray(value) ? value : [];
}

function commandError(label) {
  return `${label} inventory is unavailable.`;
}

function valueAt(object, paths) {
  for (const path of paths) {
    let current = object;
    for (const segment of path.split('.')) current = current?.[segment];
    if (current !== undefined && current !== null && current !== '') return current;
  }
  return null;
}

function cloudRunSpec(item, publicIngress) {
  const annotations = {
    ...(item.metadata?.annotations ?? {}),
    ...(item.spec?.template?.metadata?.annotations ?? {}),
  };
  const limits = item.spec?.template?.spec?.containers?.[0]?.resources?.limits ?? {};
  return {
    target: 'cloud-run-service',
    cpu: limits.cpu ?? null,
    memory: limits.memory ?? null,
    minInstances: Number.isFinite(Number(annotations['autoscaling.knative.dev/minScale']))
      ? Number(annotations['autoscaling.knative.dev/minScale']) : null,
    maxInstances: Number.isFinite(Number(annotations['autoscaling.knative.dev/maxScale']))
      ? Number(annotations['autoscaling.knative.dev/maxScale']) : null,
    ingress: annotations['run.googleapis.com/ingress'] ?? null,
    publicIngress,
  };
}

function runtimeAccountId(serviceName) {
  const initial = `${serviceName}-runtime`;
  return initial.length > 30 ? initial.slice(0, 30).replace(/-+$/, '') : initial;
}

export async function executeJsonCommand(command, args) {
  try {
    const executable = process.platform === 'win32' && !command.toLowerCase().endsWith('.cmd')
      ? `${command}.cmd` : command;
    const { stdout } = await execFileAsync(executable, args, {
      shell: process.platform === 'win32',
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 60_000,
    });
    return { ok: true, data: stdout.trim() ? JSON.parse(stdout) : null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Command failed.' };
  }
}

export async function collectDeploymentInventory({
  installation,
  runJson = executeJsonCommand,
  fetchJson = async (url, token) => {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  },
  now = () => new Date(),
}) {
  const projectId = installation.gcpProjectId;
  const region = installation.region;
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId ?? '')
    || !/^[a-z]+-[a-z]+[0-9]$/.test(region ?? '')
    || !/^[a-z][a-z0-9-]{1,38}[a-z0-9]$/.test(installation.installationKey ?? '')) {
    throw new Error('Deployment inventory requires a validated installation key, project ID, and region.');
  }
  const errors = [];
  const vmPlacements = installation.servicePlacements.filter((item) => item.selectedTarget === 'vm-docker');
  const query = async (label, command, args) => {
    const result = await runJson(command, args);
    if (!result.ok) errors.push(commandError(label));
    return result.ok ? result.data : null;
  };
  const [accounts, project, services, policy, runServices, secrets, repositories, serviceAccounts, databases, firebaseProjects, hostingSites, vmInstances, vmDisks] = await Promise.all([
    query('Active principal', 'gcloud', ['auth', 'list', '--filter=status:ACTIVE', '--format=json']),
    query('GCP project', 'gcloud', ['projects', 'describe', projectId, '--format=json']),
    query('Enabled APIs', 'gcloud', ['services', 'list', '--enabled', '--project', projectId, '--format=json']),
    query('Project IAM', 'gcloud', ['projects', 'get-iam-policy', projectId, '--format=json']),
    query('Cloud Run', 'gcloud', ['run', 'services', 'list', '--platform=managed', '--project', projectId, '--region', region, '--format=json']),
    query('Secret Manager', 'gcloud', ['secrets', 'list', '--project', projectId, '--format=json']),
    query('Artifact Registry', 'gcloud', ['artifacts', 'repositories', 'list', '--project', projectId, '--location', region, '--format=json']),
    query('Service accounts', 'gcloud', ['iam', 'service-accounts', 'list', '--project', projectId, '--format=json']),
    query('Firestore', 'gcloud', ['firestore', 'databases', 'list', '--project', projectId, '--format=json']),
    query('Firebase project', 'firebase', ['projects:list', '--json']),
    query('Firebase Hosting sites', 'firebase', ['hosting:sites:list', '--project', projectId, '--json']),
    vmPlacements.length > 0
      ? query('GCE instances', 'gcloud', ['compute', 'instances', 'list', '--project', projectId, '--format=json'])
      : Promise.resolve([]),
    vmPlacements.length > 0
      ? query('GCE disks', 'gcloud', ['compute', 'disks', 'list', '--project', projectId, '--format=json'])
      : Promise.resolve([]),
  ]);
  const principal = array(accounts)[0]?.account ?? null;
  const member = principal?.includes('gserviceaccount.com') ? `serviceAccount:${principal}` : principal ? `user:${principal}` : null;
  const grantedIamRoles = array(policy?.bindings)
    .filter((binding) => member && array(binding.members).includes(member))
    .map((binding) => binding.role)
    .filter(Boolean);
  const enabledApis = array(services)
    .map((service) => service.config?.name ?? service.name)
    .filter(Boolean);
  const placements = new Map(installation.servicePlacements.map((item) => [item.serviceName, item]));
  const resources = [];
  if (project) resources.push({
    resourceKey: `gcp-project:${projectId}`,
    type: 'gcp-project', name: projectId, region: null, serviceKey: null, ownerApp: null, state: 'deployed', spec: {},
  });
  const firebaseList = array(firebaseProjects?.result ?? firebaseProjects);
  if (firebaseList.some((item) => (item.projectId ?? item.project?.projectId) === projectId)) resources.push({
    resourceKey: `firebase-project:${projectId}`,
    type: 'firebase-project', name: projectId, region: null, serviceKey: null, ownerApp: null, state: 'deployed', spec: {},
  });
  for (const database of array(databases)) {
    const name = valueAt(database, ['name']) ?? '(default)';
    resources.push({
      resourceKey: `firestore-database:${projectId}:${name}`,
      type: 'firestore-database', name, region: valueAt(database, ['locationId', 'location']) ?? null,
      serviceKey: null, ownerApp: null, state: 'deployed', spec: {},
    });
  }
  const sites = array(hostingSites?.result?.sites ?? hostingSites?.sites ?? hostingSites?.result ?? hostingSites);
  for (const site of sites) {
    const name = valueAt(site, ['name', 'site', 'defaultUrl']) ?? projectId;
    resources.push({
      resourceKey: `firebase-hosting-site:${projectId}:${name}`,
      type: 'firebase-hosting-site', name, region: null, serviceKey: null, ownerApp: null, state: 'deployed', spec: {},
    });
  }
  for (const repository of array(repositories)) {
    const name = String(valueAt(repository, ['name']) ?? '').split('/').pop();
    if (!name) continue;
    resources.push({
      resourceKey: `artifact-registry-repository:${projectId}:${region}:${name}`,
      type: 'artifact-registry-repository', name, region, serviceKey: null, ownerApp: null, state: 'deployed', spec: {},
    });
  }
  for (const account of array(serviceAccounts)) {
    const email = account.email ?? String(account.name ?? '').split('/').pop();
    if (!email) continue;
    const placement = [...placements.values()].find((item) => email.split('@')[0] === runtimeAccountId(item.serviceName));
    resources.push({
      resourceKey: `service-account:${projectId}:${email.split('@')[0]}`,
      type: 'service-account', name: email, region: null, serviceKey: placement?.serviceKey ?? null,
      ownerApp: null, state: 'deployed', spec: {},
    });
  }
  for (const item of array(runServices)) {
    const name = valueAt(item, ['metadata.name', 'name']);
    if (!name) continue;
    const placement = placements.get(name);
    let publicIngress = null;
    const iam = await query(`Cloud Run IAM ${name}`, 'gcloud', [
      'run', 'services', 'get-iam-policy', name, '--project', projectId, '--region', region, '--format=json',
    ]);
    if (iam) publicIngress = array(iam.bindings).some((binding) => (
      binding.role === 'roles/run.invoker' && array(binding.members).includes('allUsers')
    ));
    resources.push({
      resourceKey: `cloud-run-service:${projectId}:${region}:${name}`,
      type: 'cloud-run-service', name, region, serviceKey: placement?.serviceKey ?? null,
      ownerApp: null, state: 'deployed', spec: cloudRunSpec(item, publicIngress),
    });
  }
  for (const placement of vmPlacements) {
    const match = /^gce:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(placement.targetConfig?.hostRef ?? '');
    if (!match) continue;
    const [, , zone, instanceName] = match;
    const instance = array(vmInstances).find((item) => item.name === instanceName
      && String(valueAt(item, ['zone']) ?? '').split('/').pop() === zone);
    if (!instance) continue;
    resources.push({
      resourceKey: placement.targetConfig.hostRef,
      type: 'gce-instance',
      name: instanceName,
      region: zone,
      serviceKey: placement.serviceKey,
      ownerApp: null,
      state: 'deployed',
      spec: {
        target: 'vm-docker',
        hostRef: placement.targetConfig.hostRef,
        persistentDataPath: placement.targetConfig.persistentDataPath,
        accountScope: placement.targetConfig.accountScope,
        minimumFreeBytes: placement.targetConfig.minimumFreeBytes,
        backupMaxAgeSeconds: placement.targetConfig.backupMaxAgeSeconds,
      },
    });
    const attached = array(instance.disks).find((item) => item.boot !== true);
    const diskName = String(attached?.source ?? '').split('/').pop();
    const disk = array(vmDisks).find((item) => item.name === diskName);
    if (diskName && disk) resources.push({
      resourceKey: `${placement.targetConfig.hostRef}:persistent-data`,
      type: 'persistent-disk', name: diskName, region: zone, serviceKey: null, ownerApp: null, state: 'deployed',
      spec: {},
    });
  }
  const secretRecords = array(secrets).map((secret) => {
    const secretName = String(valueAt(secret, ['name']) ?? '').split('/').pop();
    return { secretName, exists: true, ownerApp: null };
  }).filter((item) => item.secretName);

  const hostingRoutes = [];
  if (sites.length > 0) {
    const tokenResult = await runJson('gcloud', ['auth', 'print-access-token', '--format=json']);
    const token = tokenResult.ok
      ? typeof tokenResult.data === 'string' ? tokenResult.data : tokenResult.data?.token
      : null;
    if (!token) {
      errors.push(commandError('Firebase Hosting rewrites'));
    } else {
      for (const site of sites) {
        const siteId = String(valueAt(site, ['name', 'site']) ?? '').split('/').pop();
        if (!siteId) continue;
        try {
          const releases = await fetchJson(`https://firebasehosting.googleapis.com/v1beta1/sites/${siteId}/releases?pageSize=1`, token);
          const versionName = releases.releases?.[0]?.version?.name;
          if (!versionName) continue;
          const version = await fetchJson(`https://firebasehosting.googleapis.com/v1beta1/${versionName}`, token);
          for (const rewrite of array(version.config?.rewrites)) {
            if (!rewrite.glob || !rewrite.run?.serviceId) continue;
            const placement = placements.get(rewrite.run.serviceId);
            hostingRoutes.push({
              route: rewrite.glob,
              serviceName: rewrite.run.serviceId,
              region: rewrite.run.region ?? region,
              ownerApp: null,
            });
          }
        } catch {
          errors.push(commandError(`Firebase Hosting rewrites ${siteId}`));
        }
      }
    }
  }
  return {
    schemaVersion: 1,
    installationKey: installation.installationKey,
    projectId,
    observedAt: now().toISOString(),
    collectionStatus: errors.length === 0 ? 'complete' : resources.length > 0 ? 'partial' : 'unavailable',
    collector: { mode: 'gcloud-read-only', principal },
    enabledApis: [...new Set(enabledApis)].sort(),
    grantedIamRoles: [...new Set(grantedIamRoles)].sort(),
    resources: resources.sort((left, right) => left.resourceKey.localeCompare(right.resourceKey)),
    hostingRoutes: hostingRoutes.sort((left, right) => left.route.localeCompare(right.route)),
    secrets: secretRecords.sort((left, right) => left.secretName.localeCompare(right.secretName)),
    errors: [...new Set(errors)].sort(),
  };
}
