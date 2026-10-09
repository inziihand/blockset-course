# 客戶安裝與後端模組化

第一次執行前的電腦、CLI、Google 帳號、project 與費用條件見[安裝前置作業](INSTALLATION_PREREQUISITES.md)。

## 安裝體驗目標

本母版的安裝流程不得依賴 AI Agent。預設精靈只要求使用者操作編號選單或 Y/N：目標 project 從 gcloud 可存取清單選取；顯示名稱、安裝代號、region、support email 與首位管理員由 project metadata／目前 Google 帳號推導。名稱、project ID、email、路徑、`.env.local` 與覆寫確認字串都不應要求一般使用者手動輸入。AI Agent 可以協助診斷，但不是安裝或部署的必要元件；帳務與公開服務等高影響動作仍以預設為 No 的獨立 Y/N 在動作前確認。

`StratExec` 是共用平台與內部程式命名，不是客戶網站必須採用的品牌。網站標題、Logo、副標題由產品設定管理；installation 的 `displayName` 與 `auth.oauthBrandDisplayName` 是初始顯示設定，均不要求等於 `StratExec`。Firebase Web App 的 `firebaseWebAppDisplayName` 是 Firebase 控制台內的資源標籤，也不決定網站標題。Google 登入顯示的網域則取決於 Firebase Auth 網域設定，不能靠改網站標題替換。

「本地安裝完成」與「正式部署完成」是兩個結果契約。本地安裝只有在 Firebase Auth、Firestore、Identity API、管理員 bootstrap 設定及本機 Console 健康檢查通過後才能回報成功；正式部署則另須完成 Hosting、Cloud runtime、管理員角色、App route 與部署後驗收。跨平台 `npm run setup` 負責前者，`install.ps1` 是 Windows 相容入口，`deploy.ps1` 負責後者；程式存在或 dry-run 成功不表示任何客戶環境已正式部署。

## 固定原則

母版只有一份程式碼；每個客戶、正式／測試環境使用不同的 GCP/Firebase project。不要為每個客戶複製一份 platform 原始碼，也不要讓多個客戶共用同一個 Firestore database。

```text
stratexec-platform（共用母版）
├─ backend/                    平台 Identity 與未來交易核心
├─ services/<service-key>/     App／領域服務（Yahoo、報價等）
├─ apps/console/src/apps/      前端 App
├─ infrastructure/apps/       App manifest
├─ infrastructure/app-services/ App-owned Service fragment
├─ infrastructure/services/   平台 Service fragment
├─ infrastructure/environments/installation.example.json
└─ contracts/<domain>/         API 契約

本機或私人 deployment overlay（不進 Git）
└─ <installation>.json

customer-a project             customer-b project
├─ Firebase Auth               ├─ Firebase Auth
├─ Firestore                   ├─ Firestore
└─ 各自部署的 API／Worker       └─ 各自部署的 API／Worker
```

## 安裝描述

`infrastructure/apps/<app-key>.json` 描述 App 的安裝依賴；公開母版只追蹤 `infrastructure/environments/installation.example.json`。使用者將它複製成被 Git 忽略的 `*.local.json`，或保存於 repository 外的私人 deployment overlay。installation 只描述非機密且可審查的客戶值：project ID、region、Firebase Web App 名稱、登入提供者、啟用 App 與 planned service placement。安裝器先納入 `platform` manifest，再解析 `enabledApps` 所需的服務聯集。它不保存使用者、管理員名單、OAuth secret、服務帳號 key、券商憑證或部署 revision。`planned` 不等於已部署。

新設定以 installation key 作為 Firebase Web App 的預設資源標籤；現有 overlay 不會被改名。安裝時先依可選的 `firebaseWebAppId` 對應既有 App，再依 `firebaseWebAppDisplayName` 對應；若 project 只有一個 Web App，直接沿用，不因標籤不同另建。若有多個 App 且無法確定對應，互動式本機安裝會以編號讓操作者選擇，並把選定的 App ID 存入私人 overlay；非互動式 bootstrap 則停止並要求明確指定 ID。只有 project 尚無 Web App 時才建立新的 App。網站品牌文字不參與 Web App 的選擇或部署通過條件。

建立新客戶（一般使用者入口）：

1. 在 GCP 建立客戶專屬 project，確認資料位置與帳務。
2. 執行互動式安裝入口；一般模式會讀取目前 gcloud 帳號、列出可存取的 projects 並預選現行 project。使用者只需以編號選擇目標並用 Y/N 確認摘要；顯示名稱取自 project 名稱，安裝代號取自 project ID，region 使用 `asia-east1`，support email 使用目前 gcloud Google 帳號。確認後，精靈自動建立被 Git 忽略的 `<installation>.local.json`，再執行唯讀 dry-run：

   ```bash
   npm run setup
   ```

   再次執行時可沿用精靈偵測到的單一完整 local overlay；有多份時以編號選擇，仍含公開範例值或 `unassigned` placement 的副本會被略過。衝突覆寫不要求鍵入確認字串。唯讀 preflight 後，Node 安裝器會讀取 Firebase／Google Provider／Web App 狀態，準備 ADC、跨平台 Python `.venv`、Firestore／Rules／App 清冊，然後啟動並驗證 Identity API、loopback Package Agent、loopback Deployment Agent 與 Console。Package Agent／Deployment Agent 優先使用 `8182／8183`，多份 checkout 衝突時使用 `8190～8201` 備援埠；Console 會取得本次實際端點。必要的 managed service 初始化均在動作前以 Y/N 確認。第一次安裝到此結束，不詢問 Cloud Run／Hosting 正式部署。進階 Windows 操作者仍可使用 `install.ps1 -ConfigPath ...`；正式維運也可把私人 overlay 放在 repository 外。

3. 完成本地測試後，日後另行執行部署入口。它會沿用私人 overlay，並以 Y/N 分別取得 billing 資源及公開 ingress 的當次授權：

   ```powershell
   .\scripts\deploy.ps1
   ```

   部署入口沿用本地安裝已選定的 project、私人 overlay 與首位管理員；一般使用者不必再次輸入路徑或 email。計費資源及公開 ingress 仍會各自以預設為 No 的 Y/N 詢問。自動化或進階操作才需要使用 `-ConfigPath`、`-BootstrapAdminEmails`、`-ConfirmBillableResources` 與 `-ConfirmPublicIngress` 參數。

4. 若 Google Provider／OAuth consent 需要帳號本人處理，腳本在此停下並顯示最少必要操作；完成後從同一步重跑。
5. 安裝器依部署計畫逐一呼叫 target executor，為每個 Cloud Run Service 建立自己的 runtime service account，不提交服務帳號 key；Service 的 IAM、環境相依、短期 secret 與未授權驗證皆由 fragment 宣告。Market Data 的 fragment 依賴 Identity，因此會在 Identity 後部署並注入其 URL；V1 固定 `maxInstances=1`，以每 UID 60 次／分鐘與 15 秒有界記憶體快取控制 Demo 流量。
6. 首位管理員以已驗證的 Google 帳號登入；Console 自動呼叫 Identity session。再執行：

   ```powershell
   .\scripts\deploy.ps1 -FinalizeAdmin
   ```

   安裝器會由伺服器端查驗 `members/{uid}.role=admin`，移除 Cloud Run bootstrap secret、停用 Secret Manager version、重新發布 Hosting 使 `pinTag` 指向不含 bootstrap secret 的新 revision、清空本機 bootstrap 值，並保存不含秘密的 digest／revision evidence。既有 Firestore 管理員角色保持不變。

腳本以 `--project` 明確指定所有雲端操作，建立／沿用 Firebase Web App、Firestore Native `(default)`、Rules／indexes、Artifact Registry、所需服務的 runtime service account、Cloud Run service、Hosting rewrite 及 `platformMeta/schema`。Cloud Build 使用服務清冊指定的 build context，不依賴本機 Docker；進度寫在被 Git 忽略的 `.stratexec/`，失敗可安全重跑。它不搬移源版會員資料。

完成後可再次執行唯讀驗收；回滾預設也只列出 revision，只有明確指定 revision 並再次確認流量切換才會異動：

```powershell
.\scripts\verify-installation.ps1 -ConfigPath .\infrastructure\environments\<customer>.local.json
.\scripts\rollback-installation.ps1 -ConfigPath .\infrastructure\environments\<customer>.local.json -ServiceKey <service-key>
# 確認後才執行：加上 -Revision <revision> -Apply -ConfirmTrafficChange
```

## 資料所有權

| 類型 | 位置 | 權威／存取 |
| --- | --- | --- |
| 登入帳號 | Firebase Authentication | Firebase；前端只取得 ID Token |
| 會員／停權／方案 | `members/{uid}` | Identity API |
| App 全域政策 | `appPolicies/{appKey}` | Identity API；初次安裝由 App manifest 建立 |
| App 安裝狀態 | `appInstallations/{appKey}` | Identity API；manifest 提供分類、保護與服務相依 metadata |
| 個別 App 授權 | `members/{uid}/appGrants/{appKey}` | Identity API；同一文件保存整體 App grant、App-local roles 與功能 `entitlements[]` |
| App 業務資料 | `apps/{appKey}/...` 或 App 專屬外部服務 | 該 App 的 schema、API 與 Rules |
| 管理稽核 | `adminAuditLogs/{id}` | Identity API 寫入 |
| 交易日誌／帳戶鎖 | Worker 持久 volume／SQLite | Account Worker |
| 交易命令／監控投影 | Firestore server-only collections | API／Worker；瀏覽器不直寫 |

Custom claims 只保存 `admin` 這類粗粒度提示；細部 App grant 留在 Firestore，避免 token 膨脹與權限撤銷延遲。正式管理 API 每次仍讀取伺服器端會員狀態。

安裝器第一次建立 `appPolicies/{appKey}` 時套用 manifest 的 `access.defaultMode`、`allowedModes`、`adminAllowed`、`protected` 與 `entitlements`，並把平台保留的 `admins_only` 加入可選模式。重跑安裝或升級時，App 宣告的 `allowedModes`、平台保留模式與 `entitlements` 一律同步；目前 `accessMode` 若仍在新版白名單或平台保留模式內就保留，若已被移除則回到新版 `defaultMode`。既有 `adminAllowed` 原則上保留，但 `admins_only` 必須強制為 `true`。純前端 App 每次新增或升級後，都必須依套件工作的 `sourceRegistration` 狀態同步平台資料；不能只因同一 `appKey` 曾登錄過就略過，否則新版模式與 entitlement 目錄不會進入 Identity。`access-control` 是受保護 App，固定只允許 active admin。一般 App 可從 `public`、`all_members`、`grant_required`、`admins_only`、`disabled` 中宣告自己的 `allowedModes`；Identity API 會另外把 `admins_only` 提供為所有 App 都可使用的安全收斂模式，管理介面顯示兩者合併後的清單。`grant_required` 控制整個 App，功能 `entitlements[]` 控制 App 內的付費或課程功能；兩者都必須由該 App 後端查驗，不能只靠 Console 隱藏入口。

每個 frontend App manifest 另須宣告 `lifecycle.category`、`removable` 與初始狀態。安裝器會建立 `appInstallations` 並在重跑時只同步 metadata，不覆蓋管理員在平台介面選擇的狀態。`installed` 才出現在導覽並參與授權；`disabled` 保留註冊與資料但拒絕進入；`uninstalled` 從導覽及直接路由移除，但保留程式、政策、會員 grant 與相依服務，供日後重新安裝。雲端 runtime／資料庫的實體刪除不屬於此可逆操作，仍需獨立影響分析與動作前確認。

## 模組新增規則

- 新前端 App 放 `apps/console/src/apps/<app-key>/`。
- 同時新增 App-local `apps/console/src/apps/<app-key>/DEPLOYMENT.md` 與 `infrastructure/apps/<app-key>.json`；沒有 manifest 的 App 不得進 installation。
- App 專屬 BFF/API 放 `services/<service-key>/`，並登錄 `infrastructure/app-services/<app-key>.json`；平台共用服務放 `infrastructure/services/*.json`。`infrastructure/services.json` 由 `npm run services:merge` 產生，不直接編輯。
- 跨 App 的平台身分、授權及未來交易核心放 `backend/`。
- 每個 API 使用自己的 `/api/<domain>/v1/**` 與 `contracts/<domain>/openapi.json`。
- 新 App 若需瀏覽器直接讀 Firestore，必須另提明確 collection schema、Rules 與 Emulator 測試；沒有泛用 `apps/**` 開口。
- Firebase project 選擇屬部署資料，不可寫死在 App 程式碼。

App 原始碼移植使用 [App 套件與可移植安裝格式](APP_PACKAGES.md)。第二批已支援開發 ZIP 的本機差異預覽、受確認的 source install、manifest-generated Registry、檔案鎖與失敗自動回復；第三批已由管理介面串接 loopback Package Agent；第四批加入 Ed25519 publisher 信任與宣告式部署契約；第五批加入唯讀 GCP／Firebase inventory 與 normalized runtime impact plan；第六批另建 Deployment Agent 安全控制平面，具備權限複驗、不可變 approval、持久 job／event、installation lease、冪等、UNKNOWN reconciliation 與 evidence；第七批加入依 deployment schema 產生的設定欄位、App 隔離秘密 reference、版本輪替與只回 metadata 的 Secret Manager 通道；第八批加入可選 `gcp-cloud-run` driver，從隔離建置、immutable image、candidate revision、liveness／readiness／authorization 驗收到獨立 promotion、Hosting route 與 rollback。Deployment approval 綁定設定／秘密 reference fingerprint，rotation 後必須重新核准。target executor 與 Secret Manager 模式預設停用；尚未在客戶 project 執行的 build、雲端 apply、runtime secret 注入或 rollback 不得因 driver／API 已存在而標示完成，管理介面完整流程留在第九批。
