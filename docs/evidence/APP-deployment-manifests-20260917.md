# App 部署 manifest 與 target driver 驗收

日期：2026-09-17。範圍：母版本機程式與私人參考環境的唯讀 preflight；沒有雲端 apply、沒有建立資源、沒有發布 Hosting／Cloud Run／VM。

## 完成內容

- 新增 Platform、通用 Demo、窄版 Demo、股票行情 Demo 的機器可讀 App manifest 與 schema。
- 將已接入 App 的 `DEPLOYMENT.md` 放到各自來源目錄；新增 `docs/APP_SCAFFOLDING.md`、可複用模板及 `AGENTS.md` 強制觸發規則。
- 新增 App catalog 檢查，確保 Shell Registry、來源目錄、部署文件與服務 owner／依賴一致。
- 部署計畫改由 `platform + enabledApps` 解析服務聯集；服務清冊不再等同於「全部部署」。
- Hosting rewrite 只產生給已選 App 所需的 ready Cloud Run 服務。
- 新增 Cloud Run Service 與 VM Docker target driver；Cloud Run 為 implemented，VM Docker 在 host bootstrap、secret／volume、health、rollback executor 完成前保持 plan-only 並阻擋 apply。
- 安裝器可在未啟用股票行情 Demo 時跳過 Market Data；遇到無可用 driver 或尚無 execution hook 的服務會 fail closed。
- 回滾入口不再寫死兩個服務 key，但只允許 installation 目前啟用 App 所需的 Cloud Run 服務。
- 新增股票行情獨立部署文件與 DeriStrat 移植部署藍圖；後者明示尚未成為可安裝 App。

## 驗證

- `npm test`：通過。Installer／manifest 15 項、Market Data 15 項、Console 188 項。
- `npm run build`：通過。App／installation／service／installer 檢查、Market Data 語法、TypeScript、Vite production build 與 bundle 檢查均成功。
- PowerShell AST：`install.ps1`、`verify-installation.ps1`、`rollback-installation.ps1` 無語法錯誤。
- `git diff --check`：通過；只有工作區既有的 LF／CRLF 提示。
- `scripts/install.ps1` 對私人參考環境 dry-run：成功解析 `platform, demo, demo-compact, stock-price-demo`，選出 Identity 與 Market Data Cloud Run driver；billing 仍未啟用，缺少 Artifact Registry／Cloud Build／Cloud Run／Secret Manager API，無任何異動。

## 尚未完成

- VM Docker 目前只有規劃／阻擋 driver；尚未實作 GCE host bootstrap、Artifact Registry pull、秘密掛載、持久資料、supervisor、health 與 rollback。
- DeriStrat 尚未移植到母版，因此沒有 active App manifest、服務清冊項目或部署證據。
- 私人參考環境沒有執行 apply；現有狀態仍是 Firebase 基礎已存在、應用 runtime 與 Hosting release 未部署。
