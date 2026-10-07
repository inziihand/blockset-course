# StratExec Platform

React 控制台與 Python 交易執行核心的 Monorepo。首個市場為 **台指期（TAIFEX）**，首個券商介接為 **永豐金 Shioaji**。

## 快速開始

先安裝 Git、Node.js 22.15 以上的 22 LTS（或相容的更新版本）與 Google Cloud CLI，接著在終端機執行：

```bash
git clone https://github.com/inziihand/stratexec-platform.git
cd stratexec-platform
npm run setup
```

安裝精靈會檢查其餘相依項目，並以編號及 Y/N 引導本機設定；不必另外執行 `npm ci` 或輸入腳本路徑。完整帳號、project 與費用界線請先閱讀[安裝前置作業](docs/INSTALLATION_PREREQUISITES.md)。

建立日期：2026-09-16。狀態：**P0 規劃完成，P1 的 React 平台已具備 App 承載、共用前端服務、Firebase Google 登入、登入後 Identity session、平台 Identity API、會員／App 權限與 App 安裝生命週期管理。分階段安裝／部署腳本批次 1～5、App 套件批次 1～3，以及 Deployment Agent 第 4～10 批的可信簽章、部署契約、唯讀影響計畫、安全控制平面、設定／秘密輸入、Cloud Run target driver、網頁驗收與 VM Agent／VM Docker target driver已實作；target driver、Secret Manager 與 VM host runtime 預設停用，尚未對客戶雲端 apply。母版不預載業務後端 App；交易後端與券商尚未接入，不能下單。**

## 本機啟動

前端平台支援 App 明確宣告的受控 Keep-alive：保留已開啟工作區，切走時暫停本地工作；不預載所有 App，也不替代保存功能。接入方式與限制見 [App 接入契約](docs/FRONTEND_APP_GUIDE.md#受控-keep-alive)。

一般使用者在 repository 根目錄執行跨平台安裝精靈即可。精靈只依賴 Node.js 內建模組啟動，會準備 npm 與 Python 相依套件、Firebase／Firestore 本地測試設定、Application Default Credentials，並啟動 Identity API 與前端：

```bash
npm run setup
```

安裝完成會顯示實際本機網址。Console 依序使用第一個可用的 `5175～5180`；Identity API 使用 `8180、8181、8184～8189`；Package Agent 優先使用 `8182`、Deployment Agent 優先使用 `8183`，多份 checkout 同時啟動時會各自改用 `8190～8201` 的備援埠。`npm run setup` 與 `npm run start:local` 會一起啟動並驗證四個服務，讓已驗證管理員登入後可直接預檢並安裝 App；本機 source install 可在精確確認後接受未簽章開發套件，但 runtime deployment 仍只接受 `trusted-signed`。`npm run stop:local` 只停止此 checkout 建立並記錄的程序。Windows 使用者仍可沿用 `.\scripts\install.ps1`、`.\scripts\start-local.ps1` 與 `.\scripts\stop-local.ps1`。`npm run dev:app-packages` 與 `npm run dev:deployments` 保留給需要單獨除錯 Agent 的開發者。

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
- `npm run dev:app-packages`：單獨啟動只綁定 `127.0.0.1:8182` 的管理員 App ZIP quarantine／安裝工作代理；直接執行此開發命令時未簽章 apply 預設關閉，完整本機 setup 則會為已驗證管理員開啟受確認的 source install。
- `npm run dev:deployments`：啟動 `127.0.0.1:8183` 的獨立 Deployment Agent。母版預設 `STRATEXEC_DEPLOYMENT_TARGET_MODE=disabled` 與 `STRATEXEC_SECRET_MANAGER_MODE=disabled`，因此不會寫入 GCP／Firebase；可選 `gcp-cloud-run` driver 使用 staged revision／promotion，可選 `gcp-vm-docker` driver 使用外部 Ed25519 desired-state signer 與 mTLS VM Agent。正式 adapter 只接受 keyless ADC，回應永不含秘密明文；VM 部署固定不授予 PAPER／LIVE。
- `npm run plan:deployment -- <installation.json>`：列出推薦目標、客戶 planned placement、readiness 與阻塞原因，不執行發布；必須明確提供本機 installation overlay。
- `npm run test:firestore-rules`：以 Emulator 驗證會員、授權及未知 App 資料預設拒絕瀏覽器存取；Firebase CLI 15 的 Emulator 需要 JDK 21 以上，基本安裝與 production runtime 不需要 Java。
- `npm run test:backend`／`npm run check:backend`：驗證 Identity domain、Python lint 與 OpenAPI 漂移。
- `npm run check:boundaries`：檢查 App CSS 未覆寫文件根節點、平台 Shell 或共用 UI 內部樣式。
- `npm run build`：TypeScript 檢查並建置至 `apps/console/dist`。
- `npm run preview`：在 <http://127.0.0.1:4175/> 預覽建置結果（先執行 build）。
- `npm run dev:test`：5176 埠的純離線測試宿主，只有兩個測試 App，不連接券商。
- `npm run test:e2e`：路由、故障與桌面／手機瀏覽器驗收；安裝方式見 [App 接入簡表](docs/FRONTEND_APP_GUIDE.md)。

客戶安裝預設使用只需選項操作的互動式精靈。一般模式會確認或開啟 gcloud 登入、列出可存取的 GCP projects，讓使用者以編號選擇 project；顯示名稱取自 project 名稱，安裝代號取自 project ID，region 預設為 `asia-east1`，support email 與本機首位管理員預設為目前 gcloud Google 帳號。精靈會依需要以 Y/N 執行 `npm ci`、設定 Firebase Auth／Firestore、完成 ADC 授權、安裝 Python 3.11 與建立 `.venv`，最後啟動並驗證本機 Identity API、Package Agent、Deployment Agent 與 Console：

```bash
npm run setup
```

再次執行時可沿用既有 `.local.json`，並安全重建／重啟本地 runtime。第一次安裝不詢問也不執行 Cloud Run／Hosting 正式部署。正式部署目前仍使用 Windows `.\scripts\deploy.ps1`；該入口才會檢查 billing，並在動作前分別確認可能計費資源及公開 ingress。完整流程見 [客戶安裝與後端模組化](docs/INSTALLATION_ARCHITECTURE.md)。

目前保留原 React 專案的 Shell／Drawer／App Registry 模式、桌面與手機導覽、淺色／深色／暖紙／跟隨系統主題，並新增 URL 導覽、lazy App 容器、錯誤隔離、共用 UI／API transport，以及管理員限定的「會員與權限」App。管理員可在平台介面安裝、停用、重新啟用或邏輯移除非核心 App，並動態選擇整體 App 為未登入可用、所有登入會員或需要個別授權；App manifest 只提供首次安裝預設與可接受範圍。App 可另外宣告少量能力型 entitlement，供管理員解鎖會員功能；移除會立即關閉導覽與路由，但保留資料與相依 runtime 供審查後處理。母版不綁定單一 Firebase 專案；每個客戶／環境使用自己的本機 installation overlay、GCP/Firebase project 與 `.env.local`。平台 Identity API 驗證 Firebase ID Token，會員與 App 授權由 Firestore 的伺服器端資料管理；瀏覽器規則預設全拒絕。課程版目前只預載核心「會員與權限」App；其他 App 待管理員透過 ZIP 安裝。沒有搬入源版會員資料、舊憑證、DeriStrat 或交易連線。詳見 [登入與權限規格](docs/AUTHENTICATION_AUTHORIZATION.md)、[安裝與資料分層](docs/INSTALLATION_ARCHITECTURE.md)、[Console 說明](apps/console/README.md)、[Backend-aware App 規格](docs/BACKEND_APP_CONTRACT.md) 及 [App 契約](docs/FRONTEND_APP_GUIDE.md)。

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
├─ apps/console/               # React 平台外殼與會員權限
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
