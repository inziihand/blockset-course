# Backend-aware App：服務歸屬與 API 契約

本規格補充 [Platform App Contract](FRONTEND_APP_GUIDE.md)。前端 App 仍由 `apps/console/src/apps/<app-key>/` 管理；需要後端能力時，不把所有 API 混進單一入口，而是以服務責任分區。

## 分層原則

| 層級 | 位置 | 責任 |
| --- | --- | --- |
| React App | `apps/console/src/apps/<app-key>/` | 顯示、互動、App 內業務狀態；不持有供應商密鑰 |
| 同源 API 契約 | `contracts/<domain>/openapi.json` | 前後端共同依據的正規化欄位與錯誤範圍 |
| App／領域服務 | `services/<service-key>/` | BFF、資料來源整合與 App 專屬查詢；可獨立執行／部署 |
| 平台／交易後端 | `backend/` | 平台 Identity API；未來 Account Worker、Broker Adapter、對帳與交易權威 |
| App-local 服務定義 | `infrastructure/app-services/<app-key>.json` | owner App、相依、路徑、能力、本機來源與部署契約 |
| 平台服務定義 | `infrastructure/services/*.json` | Identity 等平台共用服務契約 |
| 服務清冊索引 | `infrastructure/services.json` | 由 fragments 產生，供 plan、Hosting 與 installer 讀取；不得手改 |
| App 安裝 manifest | `infrastructure/apps/<app-key>.json` | App 路由、所需服務與獨立部署文件 |
| App deployment manifest | `infrastructure/app-deployments/<app-key>.json` | 允許目標、route、health、設定／秘密 reference、migration 與 rollback；禁止任意命令 |

前端與服務不是強制一對一。一個 App 可以使用多個服務；一個穩定的領域服務也可供多個 App 使用。`ownerApp` 表示目前負責驗收與生命週期的主要 App，不代表瀏覽器授權；正式 API 仍必須自行驗證身分與權限。

平台級能力使用 `ownerApp: "platform"`。目前 `identity-api` 屬於平台而非某個 App；它維護會員、平台角色、`appPolicies`、`appGrants` 與有效權限判斷。App 專屬資料服務仍各自位於 `services/`，因此新增 Yahoo Finance、DeriStrat 或其他服務不會混成同一個後端目錄。

## API 命名與責任

- App 只呼叫同源 `/api/<service-domain>/v1/**`，不在瀏覽器直接呼叫 Yahoo、券商或其他第三方。
- BFF 對外回傳母版契約，不把上游供應商的原始 JSON 形狀變成 App 契約。
- 每個路徑只能由一個服務擁有；新增／變更時更新所屬 fragment 與 OpenAPI，再執行 `npm run services:merge`，不得直接編輯產生出的 `infrastructure/services.json`。
- Service 可用 `dependsOn` 宣告平台或其他服務相依；部署計畫必須先部署 provider，再部署 consumer。
- 服務可以用最適合的 runtime 實作，但不能因此繞過同源 API、錯誤清理、逾時與測試。
- `runtime.production: "unassigned"` 表示母版沒有綁定已部署的客戶資源；`deployment.recommendedTarget` 是依工作負載提出的建議，不是發布事實。實際 placement 與 readiness 依 [部署目標決策規格](DEPLOYMENT_TARGET_POLICY.md) 判斷。
- App 的 loading／empty／error 是 UI 狀態；不能把 API 可回應等同於券商已連線、帳戶可交易或 Worker 正常。
- 需要付費／指定會員授權的 App 服務，接收 Firebase ID Token 後還要透過 Identity API 的 `/api/identity/v1/access/{appKey}` 或等價可信任伺服器整合確認 `allowed=true`；前端 Registry 狀態不得作為安全證明。
- App 可操作設定與秘密必須在 deployment manifest 宣告。一般設定使用 `operator-input` metadata 產生欄位；秘密不得寫入 ZIP、`.env.example` 的值或前端 bundle，只能由受保護 Deployment Agent API 建立／引用具體 Secret Manager version。

## 安全與部署界線

- 瀏覽器 bundle 不得包含 API Secret、券商憑證、Firebase 管理密鑰或伺服器 token。
- 本機 Demo 服務僅綁定 loopback；正式對外需驗證 Firebase ID Token。需要角色／App grant 的能力再由伺服器端授權，不可只依前端狀態。流量限制、快取、可觀測性與資料授權界線均須在服務清冊明示。
- 讀取市場資料與交易寫入分開。市場資料 BFF 不可成為下單、改單、撤單入口。
- `backend/` 的 Worker／ExecutionService 仍是未來交易寫入的唯一權威；不要因某個 App 已有 Node BFF 而把交易命令放進 App 服務。
- App 服務故障只影響該能力；Shell 導覽及其他 App 必須保持可用。
- Runtime 只能取得自身 App、installation、environment 與 service scope 已宣告的設定／秘密 reference；平台 bootstrap 與 OAuth 資料不作為 App 預設秘密共用。
- `continuous-worker` 必須選 `vm-docker` 並宣告 `deployment.vmDocker` 安全契約；客戶 installation 再提供 host、account scope、SQLite allowlist、委託／部位 fingerprint、備份與磁碟門檻。日常部署只經 mTLS VM Agent 的 Ed25519 desired state，不接受 SSH key 或任意 shell。完整規格見 [VM Agent](VM_AGENT.md)。
- Worker 的設定與秘密沿用 App deployment manifest：一般設定寫入簽章 desired state；秘密只傳遞同一 project 的具體 Secret Manager version reference，由 VM attached identity 在主機端解析。秘密值不得回傳 Deployment Agent、瀏覽器、job 或 evidence。

## 母版與驗證 App 的界線

母版不預載任何 backend-aware 業務 App，只保留平台 `identity-api`。股票行情 Demo 已抽離，後續在獨立開發 repo 依本規格建立、簽章打包，再安裝到另一個乾淨 repo，用來驗證 App-owned service、OpenAPI、Cloud Run deployment 與 entitlement 是否真正可移植。這個驗證 App 未安裝前，不得在母版 Registry、Service registry、installation 或本機 proxy 中留下占位依賴。

## 新增 backend-aware App 檢查表

1. 在 Registry 宣告 App，且 App 本身不建立第二套 Shell。
2. 在 App 來源目錄建立 `DEPLOYMENT.md`，並建立 `infrastructure/apps/<app-key>.json` 與 `infrastructure/app-deployments/<app-key>.json`；以 `requiredServices` 宣告依賴。
3. 在 `services/` 建立單一責任服務；在 `infrastructure/app-services/<app-key>.json` 填 owner、dependsOn、route、capability、runtime 與 deployment，再重建清冊。
4. 先定義正規化 OpenAPI，再讓 App 消費；禁止直接暴露上游回應。
5. 只讀重試與交易寫入重試分開；交易未知結果必須對帳，不能套用一般 BFF 的簡單重試。
6. 驗證服務單元測試、App 元件測試、跨寬度瀏覽器測試、`check:apps`、`check:services` 與 production bundle。
7. 正式部署位置、身分驗證與服務等級由實際產品需求決定並留下證據；母版維持 `unassigned`。
8. 需要跨專案移植時，以 `app:pack` 建立包含 App-owned service 的 ZIP，再以 `app:verify` 驗證；正式部署候選必須由 trust store 中的 Ed25519 publisher key 簽章，且 deployment manifest 不得含任意 shell／script。
