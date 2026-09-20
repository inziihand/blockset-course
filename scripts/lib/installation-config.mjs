import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Local setup intentionally writes an ignored `<installation-key>.local.json` file.
 * Formal environments may provide the tracked/non-local form instead. Prefer the
 * local overlay when both exist and fail closed if the selected file is malformed.
 */
export async function readInstallationConfig(repositoryRoot, installationKey) {
  const directory = join(repositoryRoot, 'infrastructure', 'environments');
  for (const name of [`${installationKey}.local.json`, `${installationKey}.json`]) {
    try {
      return JSON.parse(await readFile(join(directory, name), 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
  }
  return null;
}
