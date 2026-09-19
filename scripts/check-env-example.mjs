import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
const entries = new Map(source.split(/\r?\n/).flatMap((line) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return [];
  const separator = trimmed.indexOf('=');
  return [[trimmed.slice(0, separator), trimmed.slice(separator + 1)]];
}));

const required = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_MEASUREMENT_ID',
  'VITE_STRATEXEC_INSTALLATION_KEY',
  'STRATEXEC_BOOTSTRAP_ADMIN_EMAILS',
  'STRATEXEC_IDENTITY_BASE_URL',
  'STRATEXEC_APP_PACKAGE_AGENT_HOST',
  'STRATEXEC_APP_PACKAGE_AGENT_PORT',
  'STRATEXEC_ALLOW_UNSIGNED_APP_PACKAGES',
  'STRATEXEC_DEPLOYMENT_AGENT_HOST',
  'STRATEXEC_DEPLOYMENT_AGENT_PORT',
  'STRATEXEC_SECRET_MANAGER_MODE',
  'STRATEXEC_DEPLOYMENT_TARGET_MODE',
  'STRATEXEC_VM_DESIRED_STATE_KEY_ID',
  'STRATEXEC_VM_DESIRED_STATE_PRIVATE_KEY_PATH',
  'STRATEXEC_VM_AGENT_CLIENT_CERT_PATH',
  'STRATEXEC_VM_AGENT_CLIENT_KEY_PATH',
  'STRATEXEC_VM_AGENT_CA_PATH',
];
for (const key of required) {
  if (!entries.has(key)) throw new Error(`.env.example is missing ${key}.`);
}
for (const key of entries.keys()) {
  if (key.startsWith('VITE_') && key.includes('ADMIN')) {
    throw new Error(`Administrator policy must never be browser-visible: ${key}`);
  }
}
const placeholderKeys = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
];
for (const key of placeholderKeys) {
  if (!/your[_-]|your-project-id/i.test(entries.get(key) ?? '')) {
    throw new Error(`Mother-template .env.example must keep ${key} installation-neutral.`);
  }
}
if ((entries.get('STRATEXEC_BOOTSTRAP_ADMIN_EMAILS') ?? '').trim()) {
  throw new Error('Mother-template .env.example must not choose a bootstrap administrator.');
}
if (entries.get('STRATEXEC_APP_PACKAGE_AGENT_HOST') !== '127.0.0.1'
  || entries.get('STRATEXEC_ALLOW_UNSIGNED_APP_PACKAGES') !== 'false'
  || entries.get('STRATEXEC_DEPLOYMENT_AGENT_HOST') !== '127.0.0.1'
  || entries.get('STRATEXEC_SECRET_MANAGER_MODE') !== 'disabled') {
  throw new Error('Mother-template local agents must stay loopback-only, with unsigned apply and Secret Manager writes disabled.');
}
console.log('Environment example separates public Firebase config from server-only administrator policy.');
