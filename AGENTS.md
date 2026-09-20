# 專案工作規則

## 定位與進度

- 使用繁體中文，採臺灣交易用語。
- 先讀 `README.md`、`docs/IMPLEMENTATION_PLAN.md` 與本次工作涉及的規格。
- 第一優先是台指期，第一個券商為永豐金 Shioaji；不要以 Deribit 欄位作共用模型。
- 目前 P0 規劃完成，P1 已有 App 承載、顯示契約、共用前端服務、Identity API、會員與 App 權限管理及批次 1～5 安裝器；App 套件第一批已完成版本／Service fragment／ZIP 驗證／部署 executor，第二批已完成本機 source install transaction，第三批已完成管理介面上傳與 loopback Package Agent 的 quarantine／artifact／job／排他 apply，Deployment Agent 第四至第十批已完成發布者信任、normalized plan／inventory、安全控制面、設定／秘密 reference、Cloud Run executor、管理 UI，以及 VM bootstrap plan／mTLS VM Agent／簽章 desired-state／immutable Docker runtime／單帳戶安全預檢與回滾。target driver、Secret Manager 與 VM host runtime 仍預設停用；控制平面 API 或離線 fixture 存在不等於客戶 runtime 已部署。VM 部署固定保持策略與交易 disabled；PAPER／LIVE 需獨立授權與驗收。正式 runtime deployment 只接受 `trusted-signed`；未簽章套件只能預檢或在受信任本機 checkout 明確開啟 source apply。尚無套件商店。Registry 只預載離線 Demo 的通用／窄版入口與管理員限定的 `access-control`；股票行情 Demo 已抽離，將作為外部 ZIP 的可移植安裝驗收 App。Identity API ready 但尚未雲端 apply；交易後端與交易資料契約尚未實作。前端進度以 `docs/FRONTEND_PLATFORM_TASKS.md` 與其證據為準，App 自動化部署依 `docs/APP_DEPLOYMENT_AGENT_TASKS.md`；VM 規格見 `docs/VM_AGENT.md`，接入方式見 `docs/FRONTEND_APP_GUIDE.md`，套件格式見 `docs/APP_PACKAGES.md`，服務歸屬見 `docs/BACKEND_APP_CONTRACT.md`，部署選擇見 `docs/DEPLOYMENT_TARGET_POLICY.md`；規劃、推薦目標、planned placement、已部署證據、離線替身、第三方行情、券商模擬與正式交易必須分開描述。
- 本目錄是新專案。既有 DeriStrat、React 專案與 Obsidian 文件只作參考；跨專案改動依使用者當次範圍處理。

## 設計界線

- 前端、API、Worker 同庫管理；Python 核心先維持一個套件。
- 前端入口為 `apps/console/src/shell-main.tsx`，App 定義以 `infrastructure/apps/*.json > frontend` 為來源，執行 `npm run apps:registry` 產生 `src/shell/generatedAppRegistry.ts`；不得直接修改 generated file。每個 App 明確宣告 compact 或 responsive；compact 由平台將整個 App 視窗（`main.app-shell`，含頂列、標題、內容與頁尾）限制為最大 420 CSS px 並置中，不只縮內容。外部側欄／選單不受影響，不調整瀏覽器視窗；Firebase Auth 採根目錄可選環境設定，`STRATEXEC_BOOTSTRAP_ADMIN_EMAILS` 只供可信任後端使用，不得改為 `VITE_*` 或作前端授權。新增業務 App 需在當次工作範圍內，不搬入舊專案的 Firebase 設定或服務憑證。
- 使用者要求「新增 App」、「新增一個 `<名稱>` App」或同義指令時，視為執行平台標準 App 鷹架：建立可開啟的空白 App、Registry／路由、App-local `DEPLOYMENT.md`、`infrastructure/apps/<app-key>.json` 與基本測試；完整規格遵循 `docs/APP_SCAFFOLDING.md`。除非使用者同時明確要求，空白 App 不得自行新增後端服務、雲端資源、外部資料連線或部署。
- 每個 App manifest 必須宣告 access policy。付費／指定會員 App 使用 `grant_required` 時，App 專屬 API 必須在伺服器端查驗 Identity 有效權限；Shell 顯示條件不是授權邊界。
- 一個交易帳戶只允許一個執行 Worker，同時最多一個主動策略。
- 策略與 API 不直接呼叫券商交易寫入。Worker 的 ExecutionService 是唯一送單／改單／撤單入口。
- 同一 Worker 共用一個 ExecutionAuthority；不要在策略、API、Gateway 各自保存租約有效旗標。
- Firestore 是命令與監控通道，SQLite 是本機執行日誌；不要以前端在線或雲端 TTL 決定既有策略存亡。
- 寫入結果不明先對帳，不盲目重送。程序重啟不能自動清除未知委託、外部部位或策略歸屬。
- 券商 SDK 型別、代碼、原始回報只存在 Adapter；市場規則放 markets 模組。
- TAIFEX 價格是點、數量是整數口、金額帶 TWD；金額與交易數值採 Decimal／JSON 十進位字串。
- React 只消費共用契約，不自行推斷策略正在管理部位，也不以「已連線」代替「可交易」。

## 驗證與執行

- 離線驗證不需要券商帳戶。只有實作相應階段才安裝必需依賴。
- Shioaji 實際 API、Python／OS 支援與模擬能力，以鎖定版本官方文件與實測為準。
- 不要求使用者貼出 API Secret、憑證密碼或私鑰；使用主機秘密設定與只讀憑證掛載。
- 發布、登入券商、模擬交易與正式交易依當次授權執行，勿把規劃文件當成交易指令。
- 部署前先讀 Service fragments 產生的 `services.json > deployment` 與目標 installation 的 `servicePlacements`；不要直接手改 `services.json`。`recommendedTarget`／`planned` 不等於已部署，`productionReadiness=blocked` 不得建立 production route、公開 ingress 或標記 `deployed`。
- 預設安裝操作者可能是新手且沒有 AI Agent。跨平台本地安裝入口為 `npm run setup`，`install.ps1` 保留作 Windows 相容入口；正式部署目前由 `deploy.ps1` 負責。入口必須依 `docs/DEPLOYMENT_TARGET_POLICY.md` 完成唯讀 preflight、最少必要詢問、可重入建立及端到端驗收；可由 CLI／API 安全完成的工作不要推回使用者手動操作。AI 只作可選協助；帳務、OAuth consent、公開 ingress 與 IAM 放寬仍須在動作前取得明確確認。
- `STRATEXEC_BOOTSTRAP_ADMIN_EMAILS` 必須由安裝當次輸入並設定到 Identity API 的 server-only runtime；禁止寫入 installation manifest、Git 或前端。只有產生本機 `.env.local` 不算完成管理員部署，未驗證首位管理員角色不得宣稱一鍵安裝成功。
- 新增程式需跑相應測試；純文件修改檢查連結、內容一致性與差異即可。
- 前端命令從根目錄執行：`npm ci`、`npm test`、`npm run build`；`npm run dev` 為本機 5175 埠。建置成功不等於券商或交易驗收通過。
- 不自動修改既有雲端資源，也不建立正式帳戶的預設啟動策略。
