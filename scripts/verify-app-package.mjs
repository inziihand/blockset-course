import { verifyAppPackage } from './lib/app-package.mjs';

const args = process.argv.slice(2);
const reportIndex = args.indexOf('--report');
const reportValueIndex = reportIndex >= 0 ? reportIndex + 1 : -1;
const positional = args.filter((argument, index) => !argument.startsWith('--') && index !== reportValueIndex);
const zipPath = positional[0];
const reportPath = reportIndex >= 0 ? args[reportIndex + 1] : positional[1];
if (!zipPath) throw new Error('Usage: npm run app:verify -- <package.zip> [--report <report.json>]');
const report = await verifyAppPackage({ zipPath, reportPath });
console.log(JSON.stringify(report, null, 2));
console.log(`Package verified. Trust: ${report.signatureStatus}. Deployable: ${report.deployable}.`);
