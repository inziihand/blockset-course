import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldOmitAppSourceEntry } from '../lib/app-source-filter.mjs';

test('local Python environments, caches and account data stay out of App packages', () => {
  for (const directory of ['.venv', '.ruff_cache', '.mypy_cache', 'runtime-data', 'sample.egg-info']) {
    assert.equal(shouldOmitAppSourceEntry(directory, true), true, directory);
  }
  for (const file of ['.env.local', 'worker.sqlite3', 'worker.sqlite3-wal', 'orders.db-journal', 'broker.key']) {
    assert.equal(shouldOmitAppSourceEntry(file, false), true, file);
  }
  for (const file of ['.env.example', 'Dockerfile', 'requirements.lock', 'worker.py']) {
    assert.equal(shouldOmitAppSourceEntry(file, false), false, file);
  }
});
