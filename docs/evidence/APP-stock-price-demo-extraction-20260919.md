# 股票行情 Demo 抽離母版驗收

日期：2026-09-19。工作區：`stratexec-platform` repository。

## 目的

保留抽離前的完整母版版本，並從母版移除股票行情 Demo 的前端、後端、契約、部署描述及專屬測試。後續由獨立開發 repo 重新建立、打包，再以 App ZIP 安裝到另一份乾淨開發版，驗證平台的可移植安裝流程。

## 版本保留

- 抽離前 commit：`d604564bf074df7a6a4abb7bf01e48ba267605f7`
- 本機 annotated tag：`pre-stock-price-demo-extraction-20260919`
- 抽離 commit：`1c79ac7109f19e7703f9c2e0988524c22adcdf73`，已同步至 `origin/main`。
- tag 尚未 push；它保留 Git 已追蹤的完整前端、Market Data BFF、契約、manifest 與測試。tag 指向的 commit 仍在遠端 `main` 歷史中。

## 已移除

- `apps/console/src/apps/stock-price-demo/`
- `services/market-data-demo/`
- `contracts/market-data/openapi.json`
- `infrastructure/apps/stock-price-demo.json`
- `infrastructure/app-services/stock-price-demo.json`
- `infrastructure/app-deployments/stock-price-demo.json`
- 股票行情專屬 Console unit／E2E 測試、Vite proxy、環境變數、啟動命令與 workspace lock 記錄
- installation 中的 `stock-price-demo` 啟用項與 `market-data-demo` placement

Registry 重新產生後只保留 `demo`、`demo-compact`、`access-control` 三個前端 App；Service registry 只保留平台核心 `identity-api`。

## 保留的通用能力

- App ZIP 預檢、簽章、安裝 transaction、Package Agent 與 Deployment Agent。
- frontend-only、Cloud Run 與 VM Docker 的通用 manifest／executor 契約。
- Identity、會員與 App 權限、App 安裝／停用／移除管理流程。
- 測試需要 backend-aware fixture 時使用中性 sample App／service，不依賴股票行情實作。

## 驗證

```text
npm run check:config       passed
npm run check:apps         passed (3 frontend Apps plus platform)
npm run check:installations passed (2 installation environments)
npm run check:services     passed (1 service: identity-api)
npm run check:backend      passed
npm run test:backend       23 passed
npm test                   294 passed
npm run build              passed
```

## 邊界

- 本次只有 Git 程式碼層變更；沒有 Cloud Build、runtime deploy、Hosting release、IAM、Cloud Run、VM 或 Firestore 寫入。
- 沒有刪除任何客戶雲端既有的 App installation／job／會員資料。
- `.stratexec` 內的舊批次 smoke/package 證據是 ignored 本機歷史產物；active `app-package-agent`、`deployment-agent` 與 `deployment-inventory` state 沒有股票行情或 market-data 記錄。歷史產物未刪除，不會進入 Git clone 或新安裝。
- 抽離前 Git tag 不包含 ignored 本機歷史產物。
