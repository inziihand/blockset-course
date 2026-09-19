# 股票行情 backend-aware Demo 驗收

日期：2026-09-17。工作區：`stratexec-platform` repository。狀態：未提交工作樹；沒有部署、已驗證會員存取、券商連線或交易寫入。

## 範圍

- 參考既有 options-lab-suite-shell-demo 的股票搜尋、時間區段、自訂日期與曲線流程。
- 母版 App 放在 `apps/console/src/apps/stock-price-demo/`，只由 `src/shell/appRegistry.ts` 註冊；沒有第二套 Shell 或 App root。
- 專屬 Node BFF 放在 `services/market-data-demo/`；本機預設只綁 `127.0.0.1:8177`，Cloud Run `PORT` 模式改綁 `0.0.0.0:$PORT`，經同源 `/api/market-data/v1/**` 使用。
- 服務清冊為 `infrastructure/services.json`；正規化契約為 `contracts/market-data/openapi.json`；已有非 root OCI Dockerfile，正式 runtime 仍維持 `unassigned`。
- 初版股票行情路徑未要求 Firebase Auth；後續批次 4 已改為必須具備 Google-provider Firebase ID Token，本次會員權限工作再加入 Identity App entitlement 查驗。仍未搬入 Firestore 收藏、DeriStrat、Shioaji、委託、部位或策略功能；登入基礎另見 `AUTH-foundation-20260917.md`。

## 驗證結果

- `npm test`：原 BFF Node tests 4/4；Console Vitest 182/182（含後續 Auth 基礎測試）。
- 後續部署契約加入 4 項 runtime binding 測試，因此 BFF 現為 8/8；本機未安裝 Docker，只有 Dockerfile 靜態契約檢查，沒有宣稱 image build 已通過。
- `npm run build`：服務語法、服務清冊、App CSS 邊界、TypeScript、Vite production build 與 fixture 排除檢查通過。
- Playwright 使用本機 Chrome：desktop/mobile 共 4/4；覆蓋 320、390、768、1440 px，無頁面或 App 水平溢出，搜尋與區段請求都留在正規化 BFF 路徑。
- WebKit 未執行：這台主機沒有 Playwright WebKit binary；不以 Chrome 結果宣稱 Safari 已驗收。
- 本機實際串接：`/health/live` 回 `ok`；透過 5179 同源 proxy 搜尋 SPY 成功，`1mo` 圖表回傳 22 筆且 source 為 `yahoo-finance`。

## 界線

- Yahoo Finance 為非官方穩定 API；本次只證明本機唯讀 Demo 流程可用，不代表正式市場資料 SLA。
- BFF 回應正常不代表券商、帳戶、Worker 或交易能力正常。
- 後續批次 4 已加入 Firebase Token 驗證、每 UID 限流、有界短期快取與單一執行個體部署契約，因此 Registry 為 ready；Yahoo Finance 仍只作 Demo，planned 仍不等於 deployed。
