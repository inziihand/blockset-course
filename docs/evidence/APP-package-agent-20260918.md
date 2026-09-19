# App 套件第三批驗收

日期：2026-09-18

## 本批完成

- 「會員與權限 → App 管理」新增 ZIP 上傳、接管／降版預檢選項、差異與 blocker 顯示、精確版本確認及工作結果。
- 新增 `tools/app-package-agent`，固定 loopback，所有 package API 均由 Identity `/me` 驗證 active verified admin。
- 上傳先進 quarantine；通過第二批 verifier 後依 package SHA-256 留存 immutable artifact，工作紀錄不暴露本機路徑。
- apply 使用排他 lock，重新驗證 artifact 與目前 repository，並沿用 source transaction／平台已知 validator／失敗回復。
- 預檢保存 plan fingerprint；repository 在確認前改變時 fail closed，必須重新檢視差異。
- 安裝後檢查不再執行 App-owned workspace scripts；Console build 與 Node `--check` 由母版直接呼叫。
- `.env.example` 預設 `STRATEXEC_ALLOW_UNSIGNED_APP_PACKAGES=false`；未簽章開發套件只能預檢。
- 新增 `contracts/app-packages/openapi.json` 與 Package Agent 操作規格。

## 安全與部署界線

- Package Agent 會修改目前 repository，拒絕 `0.0.0.0` 與 Cloud Run `PORT`；不得放到公開 ingress。
- 本批未執行套件腳本、`npm install`、migration、Service deployment 或 GCP/Firebase mutation。
- UI 顯示「來源套件套用成功」不等於 Hosting／API／Worker 已部署；正式環境仍需獨立可稽核部署工作。
- publisher 簽章、遠端受限 build、跨版本長期 rollback 與實體卸載仍未完成。

## 自動驗證

- `npm test`：通過，共 247 項（安裝／部署契約 25、Console 194、market-data BFF 18、Package Agent 10）。
- `npm run build`：通過，包含 Console production bundle、market-data 與 Package Agent 語法檢查。
- `npm run test:backend`：通過，19 項；`npm run check:backend` 的 Ruff 與 Identity OpenAPI drift check 通過。
- `npm run app:validate -- stock-price-demo`：通過，驗證 manifests／service registry／Console build，並以 `node --check` 檢查 12 個 App-owned JavaScript 檔案。
- Package Agent 實際啟動於 `127.0.0.1:8182`，`/healthz` 回報 `loopback-only`、`allowUnsignedApply=false` 與 256 MiB 上限。
