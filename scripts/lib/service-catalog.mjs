import { access, readdir, readFile } from 'node:fs/promises';

const normalize = (value) => `${JSON.stringify(value, null, 2)}\n`;

export async function loadServiceFragments(root = new URL('../../', import.meta.url)) {
  const locations = [
    new URL('infrastructure/services/', root),
    new URL('infrastructure/app-services/', root),
  ];
  const fragments = [];
  for (const directory of locations) {
    try { await access(directory); } catch { continue; }
    const files = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
    for (const name of files) {
      const relative = `${directory.pathname.includes('/app-services/') ? 'infrastructure/app-services' : 'infrastructure/services'}/${name}`;
      const value = JSON.parse(await readFile(new URL(name, directory), 'utf8'));
      fragments.push({ relative, value });
    }
  }
  return fragments.sort((left, right) => left.relative.localeCompare(right.relative));
}

export function mergeServiceFragments(fragments) {
  const services = [];
  const keys = new Set();
  for (const { relative, value } of fragments) {
    if (value.schemaVersion !== 3 || !/^[a-z][a-z0-9-]*$/.test(value.ownerApp)
      || !Array.isArray(value.services)) {
      throw new Error(`Invalid service fragment: ${relative}`);
    }
    const appLocalMatch = /^infrastructure\/app-services\/([a-z][a-z0-9-]*)\.json$/.exec(relative);
    if ((appLocalMatch && appLocalMatch[1] !== value.ownerApp)
      || (!appLocalMatch && value.ownerApp !== 'platform')) {
      throw new Error(`Service fragment path does not match owner ${value.ownerApp}: ${relative}`);
    }
    for (const service of value.services) {
      if (service.ownerApp !== value.ownerApp) {
        throw new Error(`Service fragment owner mismatch for ${service.key ?? 'unknown'}: ${relative}`);
      }
      if (keys.has(service.key)) throw new Error(`Duplicate service key across fragments: ${service.key}`);
      keys.add(service.key);
      services.push(service);
    }
  }
  services.sort((left, right) => left.key.localeCompare(right.key));
  return {
    schemaVersion: 3,
    generatedFrom: fragments.map((fragment) => fragment.relative),
    services,
  };
}

export const renderServiceRegistry = (registry) => normalize(registry);

export async function loadMergedServiceRegistry(root = new URL('../../', import.meta.url)) {
  return mergeServiceFragments(await loadServiceFragments(root));
}
