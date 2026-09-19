import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateInstalledApp } from './lib/app-validation.mjs';

const appKey = process.argv[2];
if (!appKey) throw new Error('Usage: npm run app:validate -- <app-key>');
const rootPath = fileURLToPath(new URL('../', import.meta.url));
const result = await validateInstalledApp({ rootPath, appKey });
console.log(JSON.stringify(result, null, 2));
