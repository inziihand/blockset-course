# AI Agent 安裝器批次 4～5 驗收

日期：2026-09-17。範圍：`stratexec-platform` 登入限定股票行情 Demo、雙服務安裝、部署後驗收與回滾入口。沒有執行雲端 apply、沒有券商連線或交易寫入。

## 批次 4：Market Data 部署契約

- Market Data BFF 以 Firebase Secure Token 公開憑證驗證 RS256 簽章，並驗證 project／issuer、`sub`、`exp`、`iat`、`auth_time`、email verified 與 `google.com` provider。
- API 缺少或無效 Bearer Token 時回 401；驗證憑證暫時不可用時 fail closed 回 503。
- 每個 Firebase UID 為 60 次／60 秒；15 秒記憶體快取最多 100 筆。Cloud Run 固定 `maxInstances=1`，驗收腳本也檢查實際 max scale。
- Console 只在 Google 登入及 Identity member 同步完成後請求行情，並為每個請求帶 ID Token；401／403 不自動重試。
- OpenAPI、服務清冊及 Hosting renderer 已加入 Firebase Bearer security 與 Market Data route。Yahoo Finance 在 UI 與文件中明示為無 SLA 的 Demo 資料。

## 批次 5：安裝、驗收與回滾

- `scripts/install.ps1` 以各自 build context 建置 Identity 與 Market Data image，建立各自 runtime service account，部署兩個 Cloud Run Service，並由同一 Hosting release 路由兩組 API。
- 安裝 checkpoint 現在保留兩個 image、URL 與 revision；服務建置／部署完成後可續跑，不把秘密寫入 state。
- finalize 驗證 Firestore active admin 後移除 bootstrap secret，建立新 Identity revision，再部署一次 Hosting，避免 `pinTag` 留在含 bootstrap secret 的舊 revision。
- `scripts/verify-installation.ps1` 驗證兩個 direct health、Cloud Run revision／image digest、Market Data 單一執行個體設定，以及兩條 Hosting API 在無 Token 時均回 401；`-RecordEvidence` 可寫入本機 state。
- `scripts/rollback-installation.ps1` 預設只列出 revision。只有指定已列出的 revision，並同時提供 `-Apply -ConfirmTrafficChange` 才執行 Cloud Run 100% 流量回退。

## 本機驗證

- Console tests：188/188；Market Data Node tests：15/15；Installer／Hosting／rollback contract tests：10/10。
- Python Identity tests：8/8；Ruff 與 Identity OpenAPI drift check 通過；Firestore Rules Emulator tests：4/4（另有 firebase-tools 將於 v15 要求 JDK 21 的預告警告）。
- `npm run build` 通過：服務語法、設定／清冊／安裝器契約、TypeScript、Vite production build 與 server-only 值排除檢查均成功。
- 本機 runtime smoke：`GET /health/live` 回 200；未帶 Token 的行情搜尋回 401 與 `WWW-Authenticate: Bearer`。
- Playwright 本機 Chrome：2/2；驗證未登入版面在 320／390／768／1440 px 不溢出，且登入及 Identity 同步前不發送 Market Data 請求。真實登入後流程仍待雲端 apply 後驗收。
- 私人參考環境 dry-run：Identity 與 Market Data 均為 ready；正確回報 billing disabled，且 Artifact Registry、Cloud Build、Cloud Run、Secret Manager API 未啟用；沒有雲端或本機 mutation。
- apply safety smoke：提供測試用管理員信箱但未提供 `-ConfirmBillableResources` 時，在第一個雲端 mutation 前停止。

## 尚未執行

- 私人參考環境的 Cloud Billing 仍停用；未啟用付費 API、未建 image、未建立 Cloud Run revision、未部署 Hosting，也未切換任何雲端流量。
- 尚未完成真實 Google 登入、Firestore admin finalize 與登入後 Yahoo 圖表瀏覽器驗收；這些需要日後取得帳務與公開 ingress 的當次授權。
- Yahoo Finance 不是正式市場資料 SLA；若改為多執行個體或正式行情，必須先改用共享限流／快取及正式資料供應商契約。
