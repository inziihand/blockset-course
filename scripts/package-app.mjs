import { packApp } from './lib/app-package.mjs';
import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const optionValueIndexes = new Set(['--app', '--output', '--publisher', '--key-id', '--signing-key']
  .map((name) => args.indexOf(name))
  .filter((index) => index >= 0)
  .map((index) => index + 1));
const positional = args.filter((argument, index) => !argument.startsWith('--') && !optionValueIndexes.has(index));
const appKey = value('--app') ?? positional[0];
const outputDirectory = value('--output') ?? positional[1] ?? 'dist/app-packages';
const publisherId = value('--publisher');
const keyId = value('--key-id');
const signingKeyPath = value('--signing-key');
const signingValues = [publisherId, keyId, signingKeyPath].filter(Boolean);
if (signingValues.length > 0 && signingValues.length !== 3) {
  throw new Error('Signed packaging requires --publisher, --key-id, and --signing-key together.');
}
const signing = signingKeyPath ? {
  publisherId,
  keyId,
  privateKeyPem: await readFile(signingKeyPath, 'utf8'),
} : null;
const result = await packApp({ appKey, outputDirectory, signing });
console.log(`Packed ${result.report.appKey}@${result.report.version}`);
console.log(`ZIP: ${result.zipPath}`);
console.log(`SHA-256: ${result.report.sha256}`);
console.log(`Report: ${result.reportPath}`);
console.log(`Signature: ${result.report.signatureStatus}`);
