import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BuildSourceError, createBuildSourceProvider } from '../src/build-source.mjs';

test('creates a deterministic isolated archive from only the declared build context', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stratexec-build-source-'));
  try {
    const context = join(root, 'services', 'quotes');
    await mkdir(join(context, 'src'), { recursive: true });
    await writeFile(join(context, 'Dockerfile'), 'FROM scratch\nCOPY src /src\n');
    await writeFile(join(context, 'src', 'app.mjs'), 'export const ok = true;\n');
    await writeFile(join(root, 'outside.txt'), 'not-in-archive');
    const provider = createBuildSourceProvider({ repositoryRoot: root, maximumBytes: 1_048_576 });
    const service = { artifact: { context: 'services/quotes', dockerfile: 'services/quotes/Dockerfile' } };
    const first = await provider.prepare(service);
    const second = await provider.prepare(service);
    assert.equal(first.archiveSha256, second.archiveSha256);
    assert.equal(first.fileCount, 2);
    assert.ok(first.archive.byteLength > 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects credential files and symbolic links before Cloud Build upload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stratexec-build-source-'));
  try {
    const context = join(root, 'services', 'quotes');
    await mkdir(context, { recursive: true });
    await writeFile(join(context, 'Dockerfile'), 'FROM scratch\n');
    await writeFile(join(context, '.env'), 'TOKEN=must-not-upload\n');
    const provider = createBuildSourceProvider({ repositoryRoot: root, maximumBytes: 1_048_576 });
    await assert.rejects(() => provider.prepare({ artifact: {
      context: 'services/quotes', dockerfile: 'services/quotes/Dockerfile',
    } }), BuildSourceError);
  } finally { await rm(root, { recursive: true, force: true }); }
});
