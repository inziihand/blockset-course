# 部署規劃

狀態：已有 Firebase/Firestore 可移植安裝描述、App manifest、App-local Service fragment、開發用 App ZIP 打包／驗證、服務部署分類、OCI Dockerfile、批次 1～5 安裝器，以及第 6～8 批 Deployment Agent 控制平面、設定／秘密輸入與可選 Cloud Run driver，但沒有執行任何 Cloud Run／VM 正式發布。`apps/*.json` 決定 installation 啟用 App 所需的服務；`services/*.json` 與 `app-services/*.json` 登記服務能力，再產生 `services.json`；母版 runtime 仍保持 `unassigned`，客戶 planned placement 另行記錄。

預設操作模式是由 AI Agent 協助新手完成端到端安裝。使用者提供目標 project 與首位管理員，AI Agent 負責 preflight、可重入建立、雙服務部署、驗收及回滾資訊；涉及帳務或安全邊界的步驟仍需當次確認。單一入口為 `scripts/install.ps1`，詳細完成條件見 [部署目標決策規格](../docs/DEPLOYMENT_TARGET_POLICY.md)。

| 單元 | 預定方式 | 實作前提 |
| --- | --- | --- |
| Console | 靜態 Hosting | 前端 build 與 API 契約驗證 |
| Identity API | Cloud Run Service；VM Docker 可替代 | 已為 ready；安裝器建立服務帳號、短期 bootstrap secret、同源 Hosting route 與 admin 驗收 |
| 交易 API | Cloud Run 或獨立 API 程序 | 命令通道與交易契約 |
| Worker | 固定主機上的程序／Docker | Shioaji／CA／OS 相容性與持久 volume 驗證 |
| 本機開發 | React、API、Worker、Fake Broker／Emulator | 無正式憑證、可離線重現 |

Worker 的 SQLite、帳戶鎖與版本化設定須保存在持久空間，容器替換不能刪除。憑證檔只讀掛載，秘密走服務端設定。API 不掛載 Worker 日誌，也不安裝成第二個送單者。

每帳戶 V1 只有一台執行主機，禁止水平擴展出重複 Worker。主機遷移與回退需確認舊程序、supervisor、持久資料及送單能力都已處理。

Console／API／Worker 可以獨立發布。每個客戶／環境使用獨立 GCP/Firebase project；安裝值放在 `environments/<key>.json`，不以全域 `.firebaserc` 或原始碼常數選擇客戶。完整流程見 [安裝與資料分層](../docs/INSTALLATION_ARCHITECTURE.md)。

`services.json` 是產生出的 App／服務與部署能力索引，不是發布證據，也不得直接手改。平台服務寫入 `services/*.json`，App-owned 服務寫入 `app-services/<app-key>.json`，再執行 `npm run services:merge`。新增服務時必須指定 owner App、相依服務、同源 route、能力、授權模式、原始碼、契約、workload class、推薦／允許目標及 readiness；母版不寫入客戶實際資源。會寫外部狀態的 HTTP 服務必須使用 Firebase ID Token 授權。完整決策見 [部署目標決策規格](../docs/DEPLOYMENT_TARGET_POLICY.md)。

`apps/<app-key>.json` 是安裝依賴來源。`platform.json` 永遠納入；installation 的 `enabledApps` 再加入各 App 的 `requiredServices`，並遞迴展開 Service `dependsOn`。安裝器與 Hosting rewrite 只處理這個聯集，不因服務清冊中存在其他服務就自動發布。`scripts/deployment/drivers/` 負責 target-specific preflight 與 executor 分派：Cloud Run Service 與 VM Docker 已有通用 executor；VM 仍須先以業主確認完成 IAP／OS Login／identity／mTLS bootstrap，實際客戶部署證據不能由 fixture 取代。

App ZIP 與本機 source install 安全界線見 [App 套件與可移植安裝格式](../docs/APP_PACKAGES.md)。第二批已可在 dry-run 後以精確版本確認寫入開發工作樹，並以 staging／backup／母版 validator 自動回復失敗交易；第三批提供管理介面與 loopback Package Agent；第四批加入 Ed25519 發布者信任、撤銷規則、宣告式 deployment manifest 及完整 plan fingerprint；第五批加入 normalized runtime impact plan 與唯讀 GCP／Firebase inventory drift；第六批新增 `deployment-agent.policy.json` 的 keyless identity、IAM／target／operation allowlist，以及獨立 Deployment Agent 的 approval／lease／job／audit 控制面；第七批新增 deployment schema 的 `operator-input` metadata、隔離 settings store、受保護 Secret Manager API 與設定 fingerprint；第八批新增 source-only archive、Cloud Build／Artifact Registry、App 專屬 runtime identity、精確 secret version、staged revision、liveness／readiness／authorization 驗收、獨立 promotion、Hosting release 與 rollback。`deployment-agent.policy.json` 控制建置上限、秘密大小、scope label 與允許操作；母版預設 target 與 Secret Manager driver 皆為 `disabled`。未簽章套件預設只能預檢；`trusted-signed`、`reviewable` plan、完整設定與 `approved` job 仍不等於客戶 runtime 已部署或驗收。

每個已接入 App 的操作文件放在自己的來源目錄 `apps/console/src/apps/<app-key>/DEPLOYMENT.md`，由 manifest 指向它。母版不預載業務 App；尚未移植成 App 的持續執行型服務仍以 [DeriStrat 移植部署藍圖](../docs/apps/deristrat/DEPLOYMENT.md) 保存，不偽裝成 active manifest。

規格：[架構](../docs/ARCHITECTURE.md)、[Backend-aware App](../docs/BACKEND_APP_CONTRACT.md)、[VM Agent](../docs/VM_AGENT.md)、[遷移](../docs/MIGRATION.md)。
