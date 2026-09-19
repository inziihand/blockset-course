# StratExec Platform

React 控制台與 Python 交易執行核心的 Monorepo。首個市場為 **台指期（TAIFEX）**，首個券商介接為 **永豐金 Shioaji**。

建立日期：2026-09-16。狀態：**P0 規劃完成，P1 的 React 平台已具備 App 承載、共用前端服務、Firebase Google 登入、登入後 Identity session、平台 Identity API、會員／App 權限與 App 安裝生命週期管理。AI Agent 安裝器批次 1～5、App 套件批次 1～3，以及 Deployment Agent 第 4～10 批的可信簽章、部署契約、唯讀影響計畫、安全控制平面、設定／秘密輸入、Cloud Run target driver、網頁驗收與 VM Agent／VM Docker target driver已實作；target driver、Secret Manager 與 VM host runtime 預設停用，尚未對客戶雲端 apply。母版不預載業務後端 App；交易後端與券商尚未接入，不能下單。**

第一次從 GitHub 安裝前，先閱讀[安裝前置作業](docs/INSTALLATION_PREREQUISITES.md)。文件區分離線 Demo、唯讀 dry-run 與可能產生費用的正式雲端安裝，並列出必要及不必安裝的工具。

## 本機啟動

在本專案根目錄使用 Node.js 22.12 以上的 22 LTS（本次驗證為 22.17.0）及 npm：

```powershell
# 先切換到 clone 後的 stratexec-platform 根目錄
npm ci
Copy-Item .env.example .env.local
# 或由本機 installation overlay 產生客戶專屬 .env.local
python -m venv .venv
.venv\Scripts\python -m pip install -e "backend[dev]"
npm run dev:app-packages
# 另開一個終端機（第 6～10 批控制平面；Cloud／VM target 與 Secret Manager 預設停用）
npm run dev:deployments
# 再另開一個終端機
npm run dev
```

開啟 <http://127.0.0.1:5175/>。Package Agent 與 Deployment Agent 只綁定本機，埠號占用時會報錯，不會自動切換。

- `npm test`：驗證 App／服務清冊，並執行平台、Agent 與前端測試。
- `npm run check:config`：確認 Firebase 公開設定與伺服器端管理員名單沒有混用。
- `npm run check:apps`：確認每個 Registry App 都有安裝 manifest、部署文件與有效服務依賴。
- `npm run check:installations`：確認可移植安裝描述檔完整且不含管理員名單。
- `npm run check:services`：檢查服務歸屬、路徑、契約、容器與部署建議，避免把推薦目標誤當已發布 runtime。
- `npm run services:merge`：由平台與 App-local Service fragments 重建 `infrastructure/services.json`。
- `npm run app:pack -- <app-key> [output-directory]`：建立 App ZIP、SHA-256 與套件報告；省略簽章參數時為 `development-unsigned`。
- `npm run app:verify -- <package.zip> [report.json]`：在不安裝的前提下驗證路徑、容量、相容性、服務歸屬與 checksum。
- `npm run app:install -- <package.zip>`：唯讀預覽 source install 差異；套用需再提供 `apply <app-key>@<version>`，失敗會自動回復。
- `npm run inventory:deployment -- <environment.json>`：只以 GCP／Firebase 讀取命令產生被 Git 忽略的 normalized inventory；不啟用 API、不修改 IAM 或資源。
- `npm run dev:app-packages`：啟動只綁定 `127.0.0.1:8182` 的管理員 App ZIP quarantine／安裝工作代理；未簽章 apply 預設關閉。
- `npm run dev:deployments`：啟動 `127.0.0.1:8183` 的獨立 Deployment Agent。母版預設 `STRATEXEC_DEPLOYMENT_TARGET_MODE=disabled` 與 `STRATEXEC_SECRET_MANAGER_MODE=disabled`，因此不會寫入 GCP／Firebase；可選 `gcp-cloud-run` driver 使用 staged revision／promotion，可選 `gcp-vm-docker` driver 使用外部 Ed25519 desired-state signer 與 mTLS VM Agent。正式 adapter 只接受 keyless ADC，回應永不含秘密明文；VM 部署固定不授予 PAPER／LIVE。
- `npm run plan:deployment -- <installation.json>`：列出推薦目標、客戶 planned placement、readiness 與阻塞原因，不執行發布；必須明確提供本機 installation overlay。
- `npm run test:firestore-rules`：以 Emulator 驗證會員、授權及未知 App 資料預設拒絕瀏覽器存取；Firebase CLI 15 的 Emulator 需要 JDK 21 以上，基本安裝與 production runtime 不需要 Java。
- `npm run test:backend`／`npm run check:backend`：驗證 Identity domain、Python lint 與 OpenAPI 漂移。
- `npm run check:boundaries`：檢查 App CSS 未覆寫文件根節點、平台 Shell 或共用 UI 內部樣式。
- `npm run build`：TypeScript 檢查並建置至 `apps/console/dist`。
- `npm run preview`：在 <http://127.0.0.1:4175/> 預覽建置結果（先執行 build）。
- `npm run dev:test`：5176 埠的純離線測試宿主，只有兩個測試 App，不連接券商。
- `npm run test:e2e`：路由、故障與桌面／手機瀏覽器驗收；安裝方式見 [App 接入簡表](docs/FRONTEND_APP_GUIDE.md)。

客戶安裝預設使用只需選項操作的互動式精靈。一般模式會確認或開啟 gcloud 登入、列出可存取的 GCP projects，讓使用者以編號選擇 project；顯示名稱取自 project 名稱，安裝代號取自 project ID，region 預設為 `asia-east1`，support email 與首位管理員預設為目前 gcloud Google 帳號。缺少 repository npm 相依套件時可用 Y/N 選擇執行 `npm ci`。使用者確認摘要後，精靈會建立被 Git 忽略的 `*.local.json` 並執行唯讀 preflight；若 Firebase／Google Provider／Web App 已存在，會直接產生 `.env.local`，缺少時則以預設為 No 的 Y/N 詢問是否設定。最後再詢問是否進入正式部署：

```powershell
.\scripts\install.ps1
```

再次執行時，精靈會詢問是否沿用偵測到的單一完整 `.local.json`；有多份時以編號選擇，仍含公開範例值或 `unassigned` placement 的副本會被略過。設定檔衝突、首位管理員、可能計費資源與公開 ingress 都使用 Y/N，不要求輸入名稱、project ID、email、路徑或確認字串。自動化或進階操作者仍可用 `-ConfigPath <path>` 明確指定 repository 內或外的私人 overlay；`-PrepareOnly` 不執行 discovery，因此必須搭配既有私人 `-ConfigPath`。preflight 不會修改雲端；正式部署的計費與公開 ingress 仍需在動作前分別明確確認。完整流程見 [客戶安裝與後端模組化](docs/INSTALLATION_ARCHITECTURE.md)。

目前保留原 React 專案的 Shell／Drawer／App Registry 模式、桌面與手機導覽、淺色／深色／暖紙／跟隨系統主題，並新增 URL 導覽、lazy App 容器、錯誤隔離、共用 UI／API transport，以及管理員限定的「會員與權限」App。管理員可在平台介面安裝、停用、重新啟用或邏輯移除非核心 App，並分別管理整體 App grant 與 manifest 宣告的 App-local 功能權限；移除會立即關閉導覽與路由，但保留資料與相依 runtime 供審查後處理。母版不綁定單一 Firebase 專案；每個客戶／環境使用自己的本機 installation overlay、GCP/Firebase project 與 `.env.local`。平台 Identity API 驗證 Firebase ID Token，會員與 App 授權由 Firestore 的伺服器端資料管理；瀏覽器規則預設全拒絕。母版只預載共用內容的通用／窄版純前端 Demo；股票行情 Demo 已從母版抽離，後續以外部 ZIP 驗證 backend-aware App 的可移植安裝。沒有搬入源版會員資料、舊憑證、DeriStrat 或交易連線。詳見 [登入與權限規格](docs/AUTHENTICATION_AUTHORIZATION.md)、[安裝與資料分層](docs/INSTALLATION_ARCHITECTURE.md)、[Console 說明](apps/console/README.md)、[Backend-aware App 規格](docs/BACKEND_APP_CONTRACT.md) 及 [App 契約](docs/FRONTEND_APP_GUIDE.md)。

## 產品目標

先完成一個帳戶、一個策略的可靠交易閉環：行情 → 判斷 → 委託 → 成交 → 部位 → 對帳與復原。再加入台指選擇權、組合單與其他交易中心。

通用的是帳戶執行、交易資料、風險檢查、命令與監控契約；契約規則與券商差異由市場模組及 Adapter 處理。不同市場的策略仍需各自驗證。

## 已選定方向

- 前端：React + TypeScript；後端：Python + FastAPI。
- 一個 Python 套件，API、Account Worker 為不同程序入口；前端、API、Worker 可獨立部署。
- 第一個 Adapter：Shioaji Python SDK。先驗證 SDK 版本、憑證及執行環境，再決定 Worker 映像。
- 第一批商品：TX、MTX、TMF 的月契約；介面用「口、點、新臺幣」呈現。
- 一個真實期貨帳戶由一個 Worker 管理，同時最多一個主動策略。沒有子帳戶就不建立假的子帳戶。
- Worker 使用本機 SQLite 日誌與主機共享帳戶鎖。已接受的策略不依賴控制台在線或雲端心跳續租。
- Firestore 只作持久化命令通道與監控投影；交易寫入一律經 Worker。
- 先用離線 Fake Broker／回放，再用 Shioaji 模擬環境；正式交易另有上線驗收。

## 文件入口

| 文件 | 用途 |
| --- | --- |
| [安裝前置作業](docs/INSTALLATION_PREREQUISITES.md) | GitHub 下載後的工具、帳號、project、費用與安全準備 |
| [架構規劃](docs/ARCHITECTURE.md) | 責任、狀態權威、部署及故障處理 |
| [共用資料與 API 契約](docs/CONTRACTS.md) | 帳戶、商品、委託、成交及前端狀態 |
| [台指期與 Shioaji 規格](docs/TAIFEX_SHIOAJI.md) | 乘數、交易日、回報、平倉與券商驗證 |
| [分階段實施清單](docs/IMPLEMENTATION_PLAN.md) | P0～P9、依賴、驗收及完成證據 |
| [前端平台 Codex 任務清單](docs/FRONTEND_PLATFORM_TASKS.md) | 無 App Shell 後續四批工作 |
| [Platform App Contract](docs/FRONTEND_APP_GUIDE.md) | Registry、顯示模式、生命週期、API、測試及安全界線 |
| [標準 App 鷹架](docs/APP_SCAFFOLDING.md) | AI Agent 收到「新增 App」時必須建立的檔案、預設界線與驗收 |
| [App 套件與可移植安裝格式](docs/APP_PACKAGES.md) | ZIP 打包／驗證、本機安裝交易、Service fragment 與未完成的遠端安裝界線 |
| [App 自動化安裝 Codex 工作清單](docs/APP_DEPLOYMENT_AGENT_TASKS.md) | 上傳 ZIP、部署計畫、Deployment Agent、Cloud Run／VM 及網頁驗收批次 |
| [Backend-aware App 規格](docs/BACKEND_APP_CONTRACT.md) | App／服務歸屬、API 命名、runtime 與安全界線 |
| [部署目標決策規格](docs/DEPLOYMENT_TARGET_POLICY.md) | Cloud Run／Functions／VM 選擇、容器契約、readiness 與 AI 操作界線 |
| [Firebase 登入與權限](docs/AUTHENTICATION_AUTHORIZATION.md) | Google 登入、環境設定及伺服器端管理員界線 |
| [Platform UI 元件所有權規格](docs/FRONTEND_UI_COMPONENTS.md) | 平台／App 元件分層、共用條件、成熟度及跨尺寸驗收 |
| [現有系統遷移](docs/MIGRATION.md) | DeriStrat 與 React 控制台可重用的部分 |
| [決策與待確認項目](docs/DECISIONS.md) | 已選方向、待實測事項、暫緩範圍 |
| [官方資料來源](docs/SOURCES.md) | 查核日期與對應規格 |

## 目錄

```text
stratexec-platform/
├─ apps/console/               # React 平台外殼、會員權限與離線元件 Demo
├─ backend/                    # 單一 Python 專案；Identity API 與未來交易核心
├─ tools/app-package-agent/    # loopback-only App ZIP 管理工作代理
├─ tools/deployment-agent/     # 部署 approval／lease／job／稽核安全控制平面
├─ tools/vm-agent/             # 私有 mTLS desired-state Agent 與固定 Docker runtime
├─ contracts/                  # Identity、部署 Agent 與未來 App API 契約
├─ infrastructure/             # App manifest、Service fragments、安裝描述、Firestore 規則與部署規劃
├─ tests/                      # Firestore 規則等跨元件驗收
└─ docs/                       # 規格、決策、實施清單與來源
```

下一步仍是 **P1 剩餘的交易核心離線基礎與資料契約**：Python 套件、API／Worker 入口、共用交易模型、Fake Broker、產生式 TS Client、離線快照介面及後端／契約 CI。App 安裝控制面與離線 fixture 不代表交易後端項目已完成。

既有 DeriStrat 與 React Shell 專案只作遷移參考來源；本專案尚未搬移其部署、帳戶、憑證或執行中部位。
