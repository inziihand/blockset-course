import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../install.ps1', import.meta.url), 'utf8');
const bootstrapSource = await readFile(new URL('../bootstrap-installation.ps1', import.meta.url), 'utf8');
const planSource = await readFile(new URL('../plan-deployment.mjs', import.meta.url), 'utf8');
const inventorySource = await readFile(new URL('../inspect-deployment-inventory.mjs', import.meta.url), 'utf8');
const hostingSource = await readFile(new URL('../render-hosting-config.mjs', import.meta.url), 'utf8');

test('installer defaults to a non-mutating dry run', () => {
  const dryRunExit = source.indexOf("if (-not $Apply -and -not $FinalizeAdmin)");
  const firstMutation = source.indexOf("'services', 'enable'");
  assert.ok(dryRunExit > 0);
  assert.ok(firstMutation > dryRunExit);
  assert.match(source, /Dry run complete\. No cloud resources were changed\./);
  assert.match(source, /The local installation config remains available for reuse\./);
  assert.doesNotMatch(source, /No cloud or local files were changed/);
});

test('installer starts an interactive local-config wizard when ConfigPath is omitted', () => {
  assert.doesNotMatch(source, /\[Parameter\(Mandatory = \$true\)\]\s*\[string\] \$ConfigPath/);
  assert.match(source, /if \(-not \$ConfigPath\)/);
  assert.match(source, /New-InteractiveInstallationConfig/);
  assert.match(source, /Read-Host/);
  assert.match(source, /\*\.local\.json/);
  assert.match(source, /Test-InstallationConfigReady/);
  assert.match(source, /略過尚未填完的安裝設定/);
  assert.match(source, /selectedTarget = 'cloud-run-service'/);
  assert.match(source, /UTF8Encoding\]::new\(\$false\)/);
});

test('interactive wizard discovers gcloud defaults and asks for confirmation', () => {
  assert.match(source, /Get-GcloudWizardContext/);
  assert.match(source, /'projects', 'list', '--format=json\(projectId,name\)'/);
  assert.match(source, /Select-GcloudProject/);
  assert.match(source, /\$installationKey = ConvertTo-InstallationKey \$projectId/);
  assert.match(source, /\$supportEmail = \[string\] \$gcloudContext\.Account/);
  assert.match(source, /安裝設定摘要/);
  assert.match(source, /使用以上自動偵測設定並建立本機設定嗎/);
  assert.doesNotMatch(source, /客戶／環境顯示名稱/);
  assert.doesNotMatch(source, /手動輸入 project ID/);
  assert.doesNotMatch(source, /請輸入 OVERWRITE/);
  assert.doesNotMatch(source, /請自訂要變更的值/);
});

test('guided installer uses choices for dependencies, deployment gates, and initial admin', () => {
  assert.equal(source.match(/Read-Host/g)?.length, 2);
  assert.match(source, /function Read-MenuSelection/);
  assert.match(source, /function Read-YesNo/);
  assert.match(source, /現在執行 npm ci 嗎/);
  assert.match(source, /要繼續正式部署至以上 Google Cloud project 嗎/);
  assert.match(source, /使用目前 gcloud Google 帳號作為首位管理員嗎/);
  assert.match(source, /建立可能產生費用的 Cloud Run 等資源/);
  assert.match(source, /建立可由瀏覽器存取、但仍需 App 驗證的公開入口/);
  assert.match(source, /-PrepareOnly does not run discovery/);
});

test('gcloud TLS and login failures are reported without weakening verification', () => {
  assert.match(source, /CERTIFICATE_VERIFY_FAILED\|SSLCertVerificationError/);
  assert.match(source, /安裝器不會停用 TLS 驗證/);
  assert.match(source, /gcloud auth login/);
  assert.doesNotMatch(source, /disable.*certificate|ssl.*verify.*false/i);
});

test('wizard-only preparation stops before cloud command checks and mutations', () => {
  const prepareOnlyExit = source.indexOf('if ($PrepareOnly) {');
  const commandChecks = source.indexOf("Assert-Command 'gcloud'");
  const firstMutation = source.indexOf("'services', 'enable'");
  assert.ok(prepareOnlyExit > 0 && commandChecks > prepareOnlyExit);
  assert.ok(firstMutation > commandChecks);
});

test('deployment helpers require an explicit private installation path', () => {
  for (const helperSource of [planSource, inventorySource, hostingSource]) {
    assert.match(helperSource, /Usage:/);
    assert.doesNotMatch(helperSource, /infrastructure\/environments\/[a-z0-9-]+\.json/i);
  }
});

test('billable and public ingress changes require separate explicit gates', () => {
  const billingGate = source.indexOf('if (-not $ConfirmBillableResources)');
  const ingressGate = source.indexOf('if (-not $ConfirmPublicIngress)');
  const firstMutation = source.indexOf("'services', 'enable'");
  assert.ok(billingGate > 0 && ingressGate > billingGate);
  assert.ok(firstMutation > ingressGate);
});

test('administrator bootstrap is finalized only after server-side Firestore verification', () => {
  const query = source.indexOf('documents:runQuery');
  const verifyRole = source.indexOf("fields.role.stringValue -ne 'admin'");
  const removeSecret = source.indexOf('--remove-secrets=$environmentNames');
  assert.ok(query > 0 && verifyRole > query && removeSecret > verifyRole);
  assert.doesNotMatch(source, /Write-Host[^\n]*\$admins/);
});

test('bootstrap seeds App access policies without overwriting administrator changes', () => {
  assert.match(bootstrapSource, /documents\/appPolicies\/\$appKey/);
  assert.match(bootstrapSource, /\$manifest\.access\.defaultMode/);
  const existenceCheck = bootstrapSource.indexOf('Invoke-RestMethod -Method Get -Uri $policyUri');
  const createCheck = bootstrapSource.indexOf('if (-not $policyExists)');
  const write = bootstrapSource.indexOf('Invoke-RestMethod -Method Patch -Uri $policyUri');
  assert.ok(existenceCheck > 0 && createCheck > existenceCheck && write > createCheck);
  assert.match(bootstrapSource, /updateMask\.fieldPaths=allowedAccessModes/);
  assert.match(bootstrapSource, /updateMask\.fieldPaths=entitlements/);
  assert.match(bootstrapSource, /\$manifest\.access\.entitlements/);
});

test('bootstrap seeds lifecycle metadata without restoring an administrator-uninstalled App', () => {
  assert.match(bootstrapSource, /documents\/appInstallations\/\$appKey/);
  assert.match(bootstrapSource, /\$manifest\.lifecycle\.category/);
  assert.match(bootstrapSource, /\$manifest\.requiredServices/);
  assert.match(bootstrapSource, /if \(-not \$installationExists\)/);
  assert.doesNotMatch(bootstrapSource, /updateMask\.fieldPaths=status/);
});

test('writes local dotenv configuration as UTF-8 without a BOM', () => {
  assert.match(bootstrapSource, /WriteAllLines\([\s\S]*UTF8Encoding\]::new\(\$false\)/);
  assert.match(source, /WriteAllLines\([\s\S]*UTF8Encoding\]::new\(\$false\)/);
  assert.doesNotMatch(bootstrapSource, /Set-Content[^\n]*\.env\.local/);
  assert.doesNotMatch(source, /Set-Content[^\n]*\$localEnvPath/);
});

test('dispatches all ready services through driver executors and declarative verification', () => {
  assert.match(source, /scripts\/plan-deployment\.mjs/);
  assert.match(source, /Join-Path \$repoRoot \(\[string\] \$entry\.executor\)/);
  assert.match(source, /deployment\.verification\.unauthenticatedRequests/);
  assert.match(source, /services = \$serviceStates/);
  assert.doesNotMatch(source, /market-data-demo|identity-api|api\/market-data|api\/identity/);
});

test('fails closed when an enabled App needs an unavailable target executor', () => {
  assert.match(source, /Selected App services are not deployable by the current target drivers/);
  assert.match(source, /Selected deployment drivers have no executable hook/);
});

test('finalization re-pins Hosting after bootstrap secret removal and records verification evidence', () => {
  const removeSecret = source.indexOf('--remove-secrets=$environmentNames');
  const deployAfterRemoval = source.indexOf("'deploy', '--only', 'hosting'", removeSecret);
  const verifyAfterRemoval = source.indexOf("'verify-installation.ps1'", removeSecret);
  assert.ok(removeSecret > 0 && deployAfterRemoval > removeSecret && verifyAfterRemoval > deployAfterRemoval);
  assert.match(source, /-RecordEvidence/);
});
