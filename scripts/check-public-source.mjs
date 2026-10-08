import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const excludedDirectories = new Set([
  '.git',
  '.firebase',
  '.pytest_cache',
  '.ruff_cache',
  '.stratexec',
  '.venv',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
]);
const textExtensions = new Set([
  '', '.css', '.example', '.html', '.js', '.json', '.md', '.mjs', '.ps1', '.py',
  '.svg', '.toml', '.ts', '.tsx', '.txt', '.yaml', '.yml',
]);
const forbiddenProjectId = ['voltaic', 'genre', '435508', 'h3'].join('-');
const forbiddenPersonalEmail = ['inhand.zhang', 'gmail.com'].join('@');
const forbiddenDeveloperInstallation = ['block', 'set'].join('');
const forbiddenPatterns = [
  { label: 'developer GCP project ID', pattern: new RegExp(forbiddenProjectId, 'i') },
  { label: 'developer personal email', pattern: new RegExp(forbiddenPersonalEmail.replace('.', '\\.'), 'i') },
  { label: 'developer installation name', pattern: new RegExp(`\\b${forbiddenDeveloperInstallation}\\b`, 'i') },
  { label: 'developer machine absolute path', pattern: /[A-Za-z]:\\(?:Doc|Users)\\/i },
];

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) files.push(...await collectFiles(join(directory, entry.name)));
      continue;
    }
    if (!entry.isFile() || !textExtensions.has(extname(entry.name))) continue;
    if (entry.name.endsWith('.local.json')) continue;
    files.push(join(directory, entry.name));
  }
  return files;
}

const environmentDirectory = join(root, 'infrastructure', 'environments');
const publicEnvironmentFiles = (await readdir(environmentDirectory))
  .filter((name) => name.endsWith('.json') && !name.endsWith('.local.json'));
if (publicEnvironmentFiles.length !== 1 || publicEnvironmentFiles[0] !== 'installation.example.json') {
  throw new Error('Public source may only track infrastructure/environments/installation.example.json.');
}

const violations = [];
for (const file of await collectFiles(root)) {
  const source = await readFile(file, 'utf8');
  const relativePath = relative(root, file).replaceAll('\\', '/');
  for (const rule of forbiddenPatterns) {
    // This course checkout intentionally uses its product name in the public wordmark.
    if (rule.label === 'developer installation name'
      && ['apps/console/src/shell/Brand.tsx', 'apps/console/index.html'].includes(relativePath)) continue;
    if (rule.pattern.test(source)) violations.push(`${relative(root, file)}: ${rule.label}`);
  }
}
if (violations.length) {
  throw new Error(`Public-source portability check failed:\n${violations.join('\n')}`);
}
console.log('Public source contains only the generic installation example and no known developer-specific identifiers.');
