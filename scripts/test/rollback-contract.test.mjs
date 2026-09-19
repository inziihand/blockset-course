import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../rollback-installation.ps1', import.meta.url), 'utf8');

test('rollback defaults to read-only revision discovery', () => {
  const dryRun = source.indexOf('if (-not $Apply)');
  const mutation = source.indexOf('run services update-traffic');
  assert.ok(dryRun > 0 && mutation > dryRun);
});

test('rollback requires an explicit traffic-change confirmation and a listed revision', () => {
  const gate = source.indexOf('if (-not $ConfirmTrafficChange)');
  const membership = source.indexOf('$revisions -notcontains $Revision');
  const mutation = source.indexOf('run services update-traffic');
  assert.ok(gate > 0 && membership > gate && mutation > membership);
});
