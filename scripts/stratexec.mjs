#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runSetup } from './cli/setup.mjs';
import { startLocal, stopLocal } from './cli/runtime.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const command = process.argv[2] ?? 'help';

try {
  if (command === 'setup' || command === 'install') {
    await runSetup(repoRoot);
  } else if (command === 'start') {
    await startLocal(repoRoot);
  } else if (command === 'stop') {
    await stopLocal(repoRoot);
  } else {
    console.log('StratExec cross-platform CLI');
    console.log('  node scripts/stratexec.mjs setup   設定、安裝並啟動本地環境');
    console.log('  node scripts/stratexec.mjs start   啟動已設定的本地環境');
    console.log('  node scripts/stratexec.mjs stop    停止此 checkout 管理的本地環境');
    if (command !== 'help' && command !== '--help' && command !== '-h') process.exitCode = 1;
  }
} catch (error) {
  console.error(`\nStratExec CLI 失敗：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
