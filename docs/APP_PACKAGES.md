# App 套件與可移植安裝格式

本文件定義 App 可移植機制。第一批完成版本契約、App-local Service fragment、ZIP 打包、完整性驗證與部署 executor 分派；第二批增加受控的本機 source install transaction；第三批加入管理介面與 loopback Package Agent；第四批加入 Ed25519 發布者簽章、信任／撤銷政策、機器可讀 deployment manifest、跨契約驗證及 plan context fingerprint；第五批加入唯讀 GCP／Firebase inventory 與 normalized runtime impact plan；第六批加入獨立 Deployment Agent 安全控制平面；第七批加入 schema-driven 設定與受保護秘密通道；第八批加入可選 Cloud Run target driver、staged verification、獨立 promotion 與 rollback。資料 migration 執行、管理介面部署精靈及實體卸載仍未提供。

## 契約來源

- `infrastructure/platform-contract.json`：母版版本、App contract、套件 schema、Service registry 與最低 installer 版本。
- `infrastructure/apps/<app-key>.json`：App 版本、平台相容性、前端入口、存取政策、生命週期與所需服務。
- `infrastructure/app-services/<app-key>.json`：該 App 擁有的服務；平台共用服務放在 `infrastructure/services/*.json`。
- `infrastructure/services.json`：由上述 fragments 合併產生的唯讀索引。不得直接手改；使用 `npm run services:merge`。
- `infrastructure/app-package.schema.json`：ZIP 內 `package.json` 的格式。
- `infrastructure/app-deployment.schema.json`、`app-deployments/<app-key>.json`：宣告式服務部署、設定／秘密 reference、migration 與 rollback 能力；禁止任意 shell。
- `infrastructure/app-publisher-trust.json`：可提交的公開金鑰 trust store；不得包含 private key。
- `infrastructure/app-packages.lock.json`：成功 source install 後的版本、套件 hash 與檔案 hash；用來拒絕未確認的本機漂移。

App 套件會包含 App 原始碼、App manifest、App-owned Service fragment、該服務原始碼與 OpenAPI。平台共用或其他外部服務不複製進每個 App 套件，而會列入 `externalServiceDependencies`，供安裝前 fail-closed 相容性檢查。

## 開發打包與驗證

```powershell
npm run app:pack -- <app-key> .stratexec/app-packages
npm run app:verify -- .stratexec/app-packages/<app-key>-0.1.0.zip `
  .stratexec/app-packages/<app-key>-verify.json
```

開發套件預設為 `development-unsigned`。發布者可使用不進 Git 的 Ed25519 private key 簽章：

```powershell
npm run app:pack -- <app-key> .stratexec/app-packages `
  --publisher vendor.example --key-id release-2026-01 `
  --signing-key D:\secure\vendor-release-private.pem
```

對應 public key 必須由平台管理者先加入 `infrastructure/app-publisher-trust.json`，驗證後才會成為 `trusted-signed`。打包完成只標示 `signed-unverified`，因 publisher 不能自行宣稱受客戶平台信任。

打包會產生：

- `<app-key>-<version>.zip`
- 同名 `.sha256`
- 同名 `.package-report.json`

驗證會拒絕路徑穿越、絕對路徑、磁碟機路徑、反斜線、重複項目、符號連結、加密 ZIP、不支援的壓縮法、超額檔案／展開容量，以及 manifest、deployment contract、DEPLOYMENT.md、服務歸屬、簽章或 checksum 不一致。`.env` 與本機秘密不會打包；可提交的 `.env.example` 可以包含。

## 第二批：本機 source install

安裝預設只產生差異，不修改 source：

```powershell
npm run app:install -- .stratexec/app-packages/example-1.0.0.zip
```

確認差異、blocker 與版本後，必須以精確的 `app-key@version` 套用：

```powershell
npm run app:install -- .stratexec/app-packages/example-1.0.0.zip apply example@1.0.0
```

既有但尚未由 lock 管理的 App，升級時還要明確加入 `adopt-existing`；降版另需 `allow-downgrade`。相同版本內容不可改寫，必須先提升版本。

套用時會：

1. 驗證套件、平台版本與外部 Service dependencies。
2. 僅允許 App 自己的 canonical source、manifest、Service source／fragment 與 contract 路徑。
3. 在 Git 忽略的 `.stratexec/app-installations/` 隔離 staging，備份本次會替換的 roots。
4. 重新產生 `services.json` 與 `generatedAppRegistry.ts`，執行 App／Service 契約檢查、Console production build，以及 App-owned Node 原始碼的無副作用語法檢查。
5. 全部成功才更新 `app-packages.lock.json`；任一步失敗會把 source 與衍生檔回復到安裝前狀態。

受保護的核心 App、共用來源別名（例如窄版 Demo）及 `package.installable: false` 的 manifest 不可被 ZIP 取代。安裝器不執行 App-owned workspace 的 `build`／lifecycle scripts、不執行資料 migration、不自動執行 `npm install`，也不部署雲端；只呼叫母版已知的 validator 與 Console build。新增前端套件若需要母版尚未審查的第三方 dependency，會在 Console build 階段失敗並回復；應先獨立審查平台 dependency。

## 第四批：信任、部署契約與 plan fingerprint

信任狀態：

- `development-unsigned`：只有 checksum，不能證明作者；正式 runtime deployment 永遠拒絕。
- `signed-unverified`：打包側已有簽章，但尚未套用目標平台 trust store。
- `trusted-signed`：Ed25519 簽章有效、publisher／key 位於 trust store、有效期符合且未撤銷；只有此狀態可進入未來正式部署。
- `disabled`：publisher 或 key 暫停接受新驗證，可在問題排除後恢復；驗證期間 fail closed。
- `revoked`：key 已撤銷，驗證立即失敗，不允許以本機 unsigned override 繞過。

Publisher 的 `status` 使用 `active`／`disabled`，key 的 `status` 使用 `trusted`／`disabled`／`revoked`。Key rotation 採新增 key 後再簽新版本；舊 key 可保留 `trusted` 以驗證既有 artifact。暫停受理時使用 `disabled`；疑似洩漏時將該 key 改為 `revoked`，所有使用該 key 的新驗證立即 fail closed。private key 不得進 Git、ZIP、`.env`、job 或平台 trust store。

每個可安裝 App 必須有 `infrastructure/app-deployments/<app-key>.json`，且 App manifest、Service fragment、deployment contract 與 `DEPLOYMENT.md` 一致。deployment contract 只接受平台已知欄位與 driver，不接受 `command`、`script`、`shell`、`args`、`entrypoint` 或 hooks；第四批也明確不執行資料 migration。

Source install 的 `planFingerprint` 綁定 ZIP digest、目前 owned files、平台契約、Service registry、package lock、installation／setting context 及選項。任何一項變更後都必須重新預檢。

## 第五批：唯讀 runtime impact plan

先以 `npm run inventory:deployment -- <environment.json>` 建立 `.stratexec/deployment-inventory/<installation-key>.json`。Collector 僅執行 GCP／Firebase 讀取操作，snapshot 不保存 token、secret value 或服務帳號 key；任何讀取失敗會將 inventory 標為 `partial`／`unavailable`，plan 保持 blocked。

已驗證 package job 可經 `GET /api/app-packages/v1/jobs/{jobId}/deployment-plan?installationKey=<key>` 取得 normalized plan。Plan 來源為 ZIP 內機器契約、installation、目前 package lock／repository 狀態與 inventory，不解析 `DEPLOYMENT.md` 作部署指令。回應包含：

- App 檔案、Service、Hosting route、secret reference 及雲端資源的 add／update／retain／remove／unknown。
- target、region、CPU／記憶體、min／max instances、ingress、費用級距及停機影響。
- 缺少的 API 與 Deployment Agent IAM role；此 API 永遠不啟用或授權。
- 設定／秘密名稱、用途、驗證與存在狀態，不含值。
- migration 的可回復性、備份、維護窗口及 blocker。

狀態欄位刻意分開：`planState=planned` 只表示期望動作；`contractReadiness=ready` 只表示靜態規格；`observedDeployment=deployed` 必須來自 inventory；`verificationState=verified` 必須來自部署後證據，第五批永遠不推論。Plan fingerprint 綁定 source plan、deployment contract、installation 與完整 inventory snapshot；任一輸入變更都必須重新產生。

## 第三批：管理介面與本機 Package Agent

「會員與權限 → App 管理」可以上傳 ZIP 至 `tools/app-package-agent`。代理會先向 Identity `/me` 查驗 active verified admin，再完成 quarantine、預檢、差異報告及 artifact／job 留存。只有 job 無 blocker 且輸入精確 `app-key@version` 才會呼叫第二批 source transaction；同時間只允許一個 apply。

本機啟動：

```powershell
npm run dev:app-packages
```

Agent 永遠只綁定 loopback；單獨開發啟動預設為 `127.0.0.1:8182`，母版本機生命週期會在多份 checkout 衝突時選用備援埠並把實際端點交給 Console。狀態位於 `.stratexec/app-package-agent/`。`trusted-signed` 套件可進行 source apply；原始母版與單獨 Agent 預設 `STRATEXEC_ALLOW_UNSIGNED_APP_PACKAGES=false`，完整 `npm run setup` 產生的本機 overlay 則設為 `true`，讓 active verified admin 經精確版本確認後套用開發套件。這個例外只允許本機 source install；Deployment Agent 及正式 runtime deployment 永遠仍要求 `trusted-signed`。

這是 repository control agent，不是 runtime Service：不登錄客戶 service placement、不產生 Hosting rewrite，也禁止使用 Cloud Run 的 `PORT` 啟動。前端只送檔案與確認值，不能接觸 repository 路徑、Git、建置憑證或 artifact 磁碟位置。API 契約為 `contracts/app-packages/openapi.json`。

## 第六批：Deployment Agent 安全控制平面

`tools/deployment-agent` 與 loopback Package Agent 分開。它只接受機器產生的 normalized plan reference，不接收 shell、Docker 或 `gcloud` 字串；Identity API 會再次驗證 active verified admin，以及 `GET /api/identity/v1/admin/deployment-access/{appKey}` 回傳的 App 安裝管理權。

每個 job 持久保存 plan fingerprint、package digest、版本、installation、狀態與單調事件序號。Approval 必須逐項吻合這些輸入、完整風險確認及期限；plan 改變或核准逾期即失效。Apply／verify／rollback 使用 installation 排他 lease、心跳與固定 idempotency key；逾時或結果不明進入 `unknown`，下一步只能先 reconcile，不會盲目重送。

`infrastructure/deployment-agent.policy.json` 固定 keyless 身分、target／IAM role／operation allowlist、timeout 與容量。每個 installation 產生專屬 `stratexec-deployer-<installation>` service-account identity plan，禁止服務帳號 JSON key。Evidence 僅包含操作者、時間、digest、fingerprint、revision、artifact digest 與結果，不包含 Firebase token、secret value、完整環境變數或原始命令輸出。

母版預設 executor 模式仍為 `disabled-until-target-driver`。第八批已提供可明確啟用的 `gcp-cloud-run` driver，但 API 與離線 fixture 通過不代表 Cloud Run runtime、service account、IAM 或 Hosting route 已建立；只有客戶 project 的 evidence 才能標示實際部署。

## 第七批：設定與秘密輸入

Deployment manifest 的 `operator-input` metadata 是管理介面欄位的唯一來源，會標示一般設定、秘密、預設值、驗證規則及 `normal`／`high` 影響。高影響一般設定必須輸入精確確認值；秘密欄位永遠是 write-only，不會由 API、job 或畫面讀回。

一般設定只保存非機密值。秘密由瀏覽器送到 Deployment Agent 的受保護 endpoint，再由 Secret Manager driver 建立版本；本機 state、回應及 evidence 只保存 `projects/.../secrets/.../versions/<number>` 這類精確 reference 與 metadata。既有 reference 必須屬於同一 GCP project，且秘密資源標籤必須吻合 app、installation、environment 與 service scope；禁止不同客戶或 App 共用預設秘密。建立新版本、停用版本、切回既有版本及刪除 secret 都是不同操作，刪除另需精確確認。

Deployment job 的 approval fingerprint 同時綁定 package plan 與設定／秘密 reference fingerprint。一般設定改變或 secret rotation 後，舊 approval 立即失效；target executor 只能取得 App 在 deployment manifest 中明確宣告的設定與具體 secret version reference。OAuth 品牌、Firebase Web App 與 bootstrap admin 屬平台級設定，不混入後續 App 的秘密表單。

母版預設 `STRATEXEC_SECRET_MANAGER_MODE=disabled`。`gcp` driver 採 keyless ADC 且只實作 metadata／版本寫入操作，不提供 secret payload 讀取；第七批離線測試不代表客戶 Secret Manager 已啟用或 runtime 已掛載秘密，後者屬第八批。

## 尚未完成的信任與遠端安裝界線

目前仍需要遠端 upload quarantine、受限建置 Worker、跨版本長期 rollback、資料 migration／保留確認，以及將 Console build 與 Service deployment 分成可稽核的遠端 job。瀏覽器不能直接改寫 Hosting 上的靜態程式，也不能持有 Git、Cloud Build 或 runtime 管理權限。

## 四段生命週期與啟用證據

App 管理介面將狀態拆成四段，禁止互相推論：Package Agent 的 `succeeded/no-op` 只代表來源已套用；Deployment Agent 的 runtime revision 才代表服務部署；verification evidence 才代表健康與授權驗收；Identity 的 `installed` 才是平台邏輯啟用。具有 `requiredServices` 的 App 必須同時保存 `deploymentJobId`、`runtimeRevision`、`runtimeVerifiedAt`，否則一律視為 `app_runtime_unverified`，不出現在可用 App 清單。

部署前的 `blocked/awaiting-approval/approved` job 可取消；外部寫入開始後不可假裝立即取消，只能先 reconcile 外部狀態，再依已審查 revision rollback。停用與邏輯移除不刪除 runtime 或資料；實體清除必須另建影響計畫。重新啟用有後端的 App 需重用仍為 `verified` 的 deployment job 或完成新一輪部署驗證，不能直接呼叫一般 lifecycle `enable`。

## Service 與部署 executor

Service fragment 可以宣告其他服務相依；部署計畫會先展開相依並以 provider → consumer 排序。`install.ps1` 不依特定 service key 決定建置方式，而是依 target driver 提供的 executor 執行，並依每個 Service 的 `deployment.verification.unauthenticatedRequests` 驗收。

`cloud-run-service` 與 `vm-docker` executor 均已實作，但母版預設停用且尚無客戶雲端 apply。Cloud Run 路徑依服務相依順序進行隔離 Cloud Build，使用 Artifact Registry digest 部署 candidate，逐一驗證 liveness、readiness、未授權 JSON 錯誤與宣告式 authenticated request；通過後仍須獨立 `PROMOTE` 確認才切換 traffic 與發布 Hosting rewrite。

`vm-docker` 只接受 `continuous-worker` 的單一 Worker job。首次 VM／IAM bootstrap 採 IAP、OS Login、attached VM identity 與 mTLS，不交換 SSH 私鑰；日常部署由 Deployment Agent 送出 Ed25519 簽章 desired state，VM Agent 只用固定 Docker argv 處理 immutable digest、App／帳戶隔離設定、具體 Secret Manager version、持久 volume、單帳戶鎖與前一映像回復。任一 Agent lease、SQLite／備份／磁碟、委託／部位 fingerprint、UNKNOWN 或外部曝險不一致即 fail closed。完整規格見 [VM Agent 與持續執行型 App](VM_AGENT.md)。

以上只代表離線控制平面與 host adapter 已通過測試；未產生客戶 VM、mTLS certificate、Worker runtime 或券商連線。部署與健康驗證固定覆寫交易模式為 disabled，不是 PAPER／LIVE 授權。
