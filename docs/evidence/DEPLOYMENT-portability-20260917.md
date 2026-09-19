# 母版部署可攜性基礎驗收

> 時點註記：本文件保留初版與批次 1～3 的 readiness 證據；Market Data 的 blocked 狀態已由後續 [批次 4～5 驗收](INSTALLER-batch4-5-20260917.md) 取代，目前 Registry 為 ready，但仍未實際雲端部署。

日期：2026-09-17。工作區：`stratexec-platform` repository。本紀錄區分程式可部署能力、客戶 planned placement 與實際雲端發布；三者不可互相代替。

## 完成內容

- `infrastructure/services.json` 升為 schema v2；每個服務宣告 workload class、OCI build context／Dockerfile、推薦／允許目標、狀態性、常駐性、監聽契約、預期 exposure、readiness 與 blockers。
- `infrastructure/environments/*.json` 以 `servicePlacements` 保存客戶選定目標、region、service name 與 `planned|deployed`，不保存 secret 或 revision。
- `market-data-demo` 建議 Cloud Run Service、允許 VM Docker；參考 installation placement 為 `cloud-run-service / planned / blocked`。
- `identity-api` 建議 Cloud Run Service、允許 VM Docker；後續批次 1～3 已將參考 installation 設為 `cloud-run-service / planned / ready`，但尚未實際發布。
- Node 行情 BFF 在未提供 `PORT` 時保持 `127.0.0.1:8177`；Cloud Run `PORT` 模式使用 `0.0.0.0:$PORT`；VM Docker 可明確選擇 bind address。
- Market Data 與 Identity API 都有非 root、窄 COPY 的 Dockerfile；檢查器拒絕廣泛 `COPY .`／`ADD .`。
- `scripts/plan-deployment.mjs` 只輸出不含秘密的 deployment plan，不建立資源。

## 驗證

- `npm run check:services`：2 個服務通過 deployment schema v2。
- `npm run check:installations`：通用 example 與私人參考 installation 通過 placement 檢查。
- 初次驗收以私人 installation overlay 執行 `npm run plan:deployment -- <installation.json>`，回報行情 blocked 與 Identity unassigned；後續批次 1～3 已改為行情 blocked、Identity `cloud-run-service / planned / ready / deployable=yes`。
- Market Data Node tests 8/8；語法 build 通過。
- 以 `PORT=8188` 實際啟動後，log 顯示 `host=0.0.0.0`，`GET /health/live` 回 JSON 200。
- 本機未安裝 Docker CLI，因此未執行 image build；Dockerfile 只有靜態契約驗證。

## 雲端現況與阻塞

- GCP project：私人參考安裝；實際 project ID 與顯示名稱不保存在公開母版。
- Billing：disabled。
- Cloud Run Admin API：disabled。
- Artifact Registry API：disabled。
- 未建立 Artifact Registry、Cloud Run service、revision、Hosting rewrite、公開 ingress 或 service IAM。

Cloud Run 發布會涉及帳務與公開服務面，且 Market Data 仍缺 Firebase ID Token、正式限流／共用快取及 Yahoo Finance 使用條款審查；因此本次只完成可攜式程式與規格，沒有將 blocked 服務發布。

## 一鍵安裝差距

母版現已將「新手透過 AI Agent 一鍵安裝」列為正式部署契約。後續批次 1～3 已實作 Identity Cloud Build／Cloud Run／Hosting、runtime bootstrap 管理員及 Firestore 驗證流程；私人參考環境的 billing 停用，尚未執行雲端 apply／finalize。Market Data 仍 blocked，因此不得將目前狀態描述為整個平台一鍵安裝完成。
