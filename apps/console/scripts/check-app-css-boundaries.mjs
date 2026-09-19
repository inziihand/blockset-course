import { readdir, readFile } from 'node:fs/promises';

const appsRoot = new URL('../src/apps/', import.meta.url);
const forbiddenSelectors = [
  {
    label: 'document root',
    pattern: /(^|[\s>+~(:,])(?:html|body|#root)(?=$|[\s>+~.#:[),])/,
  },
  {
    label: 'platform shell',
    pattern: /\.(?:app-shell|launcher-shell|topbar|shell-footer|platform-app-frame)(?=$|[\s>+~.#:[),])/,
  },
  {
    label: 'shared UI internals',
    pattern: /\.(?:platform-folder-tabs|platform-segmented|platform-choice-group|platform-status-banner(?:-[a-z-]+)?|platform-menu-(?:label|trigger|panel|option-icon|check)|platform-date-(?:label|trigger)|platform-calendar-[a-z-]+|platform-button|platform-field|platform-dialog|platform-notifications|platform-notice|platform-state)(?=$|[\s>+~.#:[),])/,
  },
];

async function cssFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, directory);
    if (entry.isDirectory()) files.push(...await cssFiles(child));
    else if (entry.name.endsWith('.css')) files.push(child);
  }
  return files;
}

function selectors(source) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  for (const match of withoutComments.matchAll(/([^{}]+)\{/g)) {
    const prelude = match[1].trim();
    if (!prelude || prelude.startsWith('@') || /^(?:from|to|\d+(?:\.\d+)?%)$/.test(prelude)) continue;
    found.push(...prelude.split(',').map(selector => selector.trim()).filter(Boolean));
  }
  return found;
}

const violations = [];
for (const file of await cssFiles(appsRoot)) {
  const source = await readFile(file, 'utf8');
  for (const selector of selectors(source)) {
    for (const rule of forbiddenSelectors) {
      if (rule.pattern.test(selector)) {
        violations.push(`${file.pathname.split('/src/apps/')[1]}: ${selector} (${rule.label})`);
      }
    }
  }
}

if (violations.length) {
  throw new Error(`App CSS crosses platform ownership boundaries:\n${violations.map(item => `- ${item}`).join('\n')}`);
}

console.log('App CSS stays within App-owned selectors.');
