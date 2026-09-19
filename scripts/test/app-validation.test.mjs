import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validateInstalledApp } from '../lib/app-validation.mjs';

test('validates App-owned service source without executing package scripts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stratexec-app-validation-'));
  try {
    await mkdir(join(directory, 'infrastructure', 'app-services'), { recursive: true });
    await mkdir(join(directory, 'services', 'course-api', 'src'), { recursive: true });
    await writeFile(join(directory, 'infrastructure', 'app-services', 'course-app.json'), JSON.stringify({
      schemaVersion: 3,
      ownerApp: 'course-app',
      services: [{ key: 'course-api', ownerApp: 'course-app', source: 'services/course-api' }],
    }));
    await writeFile(join(directory, 'services', 'course-api', 'src', 'server.mjs'), 'export const ready = true;\n');
    await writeFile(join(directory, 'services', 'course-api', 'package.json'), JSON.stringify({
      name: 'untrusted-service',
      scripts: { build: 'node should-never-run.mjs', postinstall: 'node should-never-run.mjs' },
    }));
    const commands = [];
    const result = await validateInstalledApp({
      rootPath: directory,
      appKey: 'course-app',
      runCommand: async (command, args) => { commands.push([command, args]); },
    });
    assert.equal(result.checkedServiceJavaScriptFiles, 1);
    assert.ok(commands.some(([, args]) => args[0] === '--check' && args[1].endsWith('server.mjs')));
    assert.ok(commands.some(([command, args]) => command === process.execPath
      && args[0] === process.env.npm_execpath && args.includes('--workspace=@stratexec/console')));
    assert.equal(commands.some(([, args]) => args.includes('should-never-run.mjs')), false);
    assert.equal(JSON.parse(await readFile(join(directory, 'services', 'course-api', 'package.json'))).name, 'untrusted-service');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
