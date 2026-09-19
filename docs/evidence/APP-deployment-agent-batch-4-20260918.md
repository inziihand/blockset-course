# App Deployment Agent 第 4 批驗收證據

日期：2026-09-18
範圍：可信 App 套件、宣告式部署契約、跨 manifest 驗證與 source install plan fingerprint。
外部變更：未建立或修改 GCP、Firebase、Cloud Run、VM、IAM、DNS、公開 ingress 或正式流量。

## 已完成

- App package schema 升級至 v2；package report 記錄 publisher、key ID、Ed25519 signature、簽章格式版本、signed-content digest 與 ZIP artifact SHA-256。
- 新增 `infrastructure/app-publisher-trust.json` 與 schema。Publisher 支援 `active`／`disabled`；key 支援 `trusted`／`disabled`／`revoked`、有效期間與 rotation。
- 驗證狀態區分 `development-unsigned`、`signed-unverified`、`trusted-signed`；停用、撤銷、未知或偽造簽章均 fail closed。只有 `trusted-signed` 可標記為後續 runtime deployment 的合格輸入。
- 新增 `infrastructure/app-deployment.schema.json` 與每 App 的 `app-deployments/<app-key>.json`，宣告服務、允許目標、route、健康檢查、設定、秘密 reference、migration 及 rollback。
- ZIP 不得宣告 `command`、`script`、`shell`、`args`、`entrypoint` 或 hooks；第 4 批也不接受可執行資料 migration。
- 打包與驗證會交叉檢查 App manifest、Service fragment、deployment manifest 與 `DEPLOYMENT.md`。
- Source install fingerprint 綁定 ZIP digest、目前 App-owned files、平台契約、產生後 Service registry、package lock、installation settings、選項與 blockers。
- 測試涵蓋 traversal、重複 ZIP entry、symlink、單檔解壓上限、超量 entry、checksum 竄改、任意部署命令、偽造簽章、disabled publisher 與 revoked key。

## 驗證結果

```text
npm test
  installer / contract tests: 29 passed
  Console tests: 194 passed
  market-data-demo tests: 18 passed
  app-package-agent tests: 11 passed
  total: 252 passed

npm run build
  App / Service / installer checks passed
  TypeScript and CSS boundary checks passed
  Vite production build passed
  market-data-demo and app-package-agent syntax builds passed

npm run test:backend
  19 passed, 1 third-party deprecation warning

npm run check:backend
  Ruff passed
  Identity OpenAPI drift check passed

npm run app:pack -- stock-price-demo .stratexec/batch4-smoke
npm run app:verify -- <generated-zip> .stratexec/batch4-smoke/verified.json
  compatible: true
  signatureStatus: development-unsigned
  deployable: false

JSON parse check: all infrastructure JSON files passed
git diff --check: passed; only repository line-ending notices were emitted

Package Agent restart:
  GET http://127.0.0.1:8182/healthz -> 200
  signaturePolicy: trusted-signed-or-explicit-development-unsigned
  allowUnsignedApply: false
```

## 狀態界線

| 狀態 | 本批結果 |
| --- | --- |
| Source installed | 未套用新的外部 App；只完成 installer／Package Agent 能力與離線測試 |
| Deployment planned | 尚未完成；normalized runtime plan 屬第 5 批 |
| Runtime deployed | 否 |
| Runtime verified | 否 |
| App enabled | 無變更 |

第 4 批完成不代表 App 已部署。遠端唯讀盤點、費用／IAM 影響分析、正式 Deployment Agent、秘密輸入、Cloud Run 建置發布、驗收與啟用仍分別屬第 5～9 批；VM Agent 屬第 10 批。
