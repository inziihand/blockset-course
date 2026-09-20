import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readInstallationConfig } from '../lib/installation-config.mjs';

test('prefers an ignored local installation config and falls back to the formal config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stratexec-installation-config-'));
  const directory = join(root, 'infrastructure', 'environments');
  const localPath = join(directory, 'customer-a.local.json');
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'customer-a.json'), '{"source":"formal"}\n');
    await writeFile(localPath, '{"source":"local"}\n');
    assert.equal((await readInstallationConfig(root, 'customer-a')).source, 'local');
    await unlink(localPath);
    assert.equal((await readInstallationConfig(root, 'customer-a')).source, 'formal');
    assert.equal(await readInstallationConfig(root, 'missing'), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('does not hide malformed local installation configuration behind a formal fallback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stratexec-installation-config-invalid-'));
  const directory = join(root, 'infrastructure', 'environments');
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'customer-a.json'), '{"source":"formal"}\n');
    await writeFile(join(directory, 'customer-a.local.json'), '{invalid');
    await assert.rejects(() => readInstallationConfig(root, 'customer-a'), SyntaxError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
