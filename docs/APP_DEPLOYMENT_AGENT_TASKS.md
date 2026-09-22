# App 自動化安裝與 Deployment Agent Codex 工作清單

更新：2026-09-22。

## 目標

在已完成平台初次安裝的前提下，讓管理員只透過平台網頁完成：

`上傳 app.zip → 預檢 → 查看部署計畫與影響 → 補齊設定／秘密 → 明確確認 → 部署 → 驗收 → 啟用／回滾`

一般安裝不得要求業主使用 SSH、`gcloud`、Firebase CLI、Docker 或將私鑰交給技術人員。遇到平台尚未允許的資源、IAM、帳務或公開入口時必須停止並要求當次確認，不得自行放寬。

## 現況基線

- [x] App 套件第 1 批：manifest、Service fragment、ZIP 打包／驗證及部署 executor 契約。
- [x] App 套件第 2 批：本機 source install transaction、排他鎖、驗證及失敗回復。
- [x] App 套件第 3 批：管理介面、loopback Package Agent、quarantine、artifact、job 及管理員驗證。
- [x] 發布者 Ed25519 簽章、平台 trust store、撤銷規則及宣告式部署契約已完成。
- [x] 第 6 批 Deployment Agent 安全控制平面已完成；正式 target executor 與遠端受限建置仍待第 8 批。
- [x] 第 7 批 schema-driven 設定與 Secret Manager 受保護寫入通道已完成；正式 Secret Manager 與 runtime 注入仍須由第 8 批 target driver 在客戶環境驗收。
- [ ] 目前的 Package Agent 只管理本機來源碼，不得描述為已部署客戶 runtime。
- [x] 已驗證上傳 App 可產生唯讀 normalized runtime impact plan。
- [ ] 現有平台安裝器可處理已知平台服務，但尚未串接任意上傳 App 的端到端部署。

## 共通完成判準

以下條件全部成立，才可稱為「含後端 App 的完整自動化安裝」：

- [ ] 已初始化的平台可由管理員全程透過網頁完成一般 App 安裝。
- [ ] ZIP 不可藉安裝流程在控制平面執行任意主機腳本。
- [ ] 每次 apply 綁定套件 digest、部署計畫 fingerprint、目標 installation 與精確版本。
- [ ] 部署使用平台管理的最小權限身分，不使用長效服務帳號 JSON 或業主 SSH 私鑰。
- [ ] 帳務、公開 ingress、IAM 放寬、資料破壞與正式流量切換均有動作前確認。
- [ ] 秘密只保存於 Secret Manager 或等效秘密儲存；ZIP、Git、瀏覽器回應及稽核記錄均不得含明文。
- [ ] 部署具冪等、排他、可恢復及 rollback；重試不重複建立資源。
- [ ] 健康、授權、route 及 revision 驗收通過前，App 不得標為可啟用。
- [ ] UI 可看見等待設定、等待確認、部署中、驗收中、可啟用、失敗與已回滾狀態。
- [ ] 稽核保留操作者、時間、套件 digest、計畫 fingerprint、artifact digest、revision 與結果，但不保存秘密。

## 第 4 批：可信套件與部署契約

依賴：既有 App 套件第 1～3 批。

- [x] 為 package report 增加 publisher、key ID、signature、artifact digest 與簽章格式版本。
- [x] 建立平台 publisher trust store、停用／撤銷規則與 key rotation 規格。
- [x] 明確區分 `development-unsigned`、`trusted-signed`、`revoked`；正式部署只接受受信任簽章。
- [x] 定義 package deployment manifest schema，列出服務、目標能力、route、健康檢查、設定、秘密 reference、migration 與 rollback 能力。
- [x] 禁止 package 自訂任意 deploy shell；只能選擇平台允許的 target driver 與宣告式參數。
- [x] 將 Service fragment、App manifest、部署文件及 package report 做交叉一致性檢查。
- [x] 建立 plan fingerprint，綁定 ZIP digest、目前 repository／installation 狀態、服務清冊及輸入設定；任一內容變更必須重新預檢。
- [x] 增加惡意路徑、zip bomb、symlink、超量檔案、重複 entry、偽造簽章及撤銷 key 測試。

驗收：受信任套件可產生不可變部署輸入；未簽章、簽章失敗、已撤銷或要求任意命令的套件 fail closed。

## 第 5 批：部署計畫與影響分析

依賴：第 4 批。

- [x] 由已驗證 package 建立 normalized deployment plan，不直接依賴 ZIP 內的說明文字。
- [x] 列出將新增、更新、保留及移除的 App 檔案、服務、route、秘密 reference 與雲端資源。
- [x] 顯示部署目標、region、CPU／記憶體、min／max instances、公開 ingress、預估費用級距及可能停機影響。
- [x] 將現有 GCP／Firebase 資源的唯讀盤點納入 drift 檢查；`planned`、`ready`、`deployed`、`verified` 不得混用。
- [x] 列出目前 Deployment Agent 身分缺少的 IAM／API 能力，但不得在 plan 階段修改權限或啟用服務。
- [x] 解析必要設定與秘密，只回傳欄位名稱、用途、驗證規則及是否已存在，不回傳秘密值。
- [x] 對 migration 標出可回復性、備份要求、維護窗口及阻擋條件。
- [x] 提供純唯讀 plan API、OpenAPI 契約及固定 fixture 測試。

驗收：管理員在任何雲端寫入前，可看見完整差異、費用／停機級距、權限需求與阻擋原因；相同輸入產生相同 fingerprint。

## 第 6 批：Deployment Agent 安全控制平面

依賴：第 4～5 批。

- [x] 建立獨立 Deployment Agent；不得擴張 loopback Package Agent 成為公開、任意命令執行器。
- [x] 使用 Firebase ID Token 驗證 active admin，並於伺服器端再次查驗 App 與 deployment 權限。
- [x] 為每個 installation 產生專屬 deployer service account／Workload Identity 計畫，權限由 allowlist 組成且不產生 JSON key；實際雲端建立仍須授權後的安裝批次。
- [x] 定義 inspect／plan／approve／apply／verify／rollback job API 與 OpenAPI。
- [x] approval 必須綁定 plan fingerprint、精確版本、風險確認及有效期限；變更後舊 approval 失效。
- [x] 建立 durable local job store、狀態機、事件序號、租約／排他鎖、心跳及 crash recovery；正式受管理 runtime 改用外部持久 store 前不得水平擴展。
- [x] 每個雲端寫入具 idempotency key；UNKNOWN 結果先查詢實際狀態，不盲目重送。
- [x] 建立操作 allowlist、參數邊界、timeout、輸出遮罩、容量限制及資源命名規則。
- [x] 實作 audit event 與 evidence bundle，不記錄 token、秘密、完整環境變數或原始憑證。

驗收：非管理員、過期／變更 plan、重複 apply、並行 apply、程序重啟及雲端逾時均 fail closed；不需技術人員個人憑證。

實作界線：離線 fixture 已驗證上述控制面；正式 executor 為 `disabled-until-target-driver`，沒有建立 service account、修改 IAM、部署 runtime 或切換流量。Cloud Run target driver 與外部 durable store 的實際環境驗收屬第 8 批。

## 第 7 批：設定與秘密輸入

依賴：第 5～6 批。

- [x] 在管理介面依 deployment schema 產生設定欄位，區分一般設定、秘密與高影響選項。
- [x] 秘密由瀏覽器經受保護 API 直接寫入 Secret Manager；寫入後只顯示版本 metadata，不得讀回明文。
- [x] 支援既有 secret reference、建立新版本、rotation、停用及 rollback；刪除秘密需獨立確認。
- [x] App runtime 只取得自己宣告的秘密；不同 App、installation 及環境不得共用預設秘密。
- [x] 將管理員 bootstrap、OAuth 設定等平台級資料與 App 專屬秘密分開，後續 App 不重問平台既有資料。
- [x] 驗證前端 bundle、job、log、error、evidence 及測試輸出均不含秘密。

驗收：業主不需把秘密傳給技術人員或放入 ZIP；Deployment Agent 只能引用必要 secret version。

實作界線：本批已完成 UI、受保護 API、App／installation／environment 隔離命名、既有 reference／版本輪替／停用／回復 reference／刪除流程，以及只輸出 metadata 的 GCP Secret Manager adapter。母版預設 `STRATEXEC_SECRET_MANAGER_MODE=disabled`，離線測試使用不保存明文的 fake adapter；本批未在任何客戶 project 建立、修改或刪除秘密。正式 Agent 以 keyless 身分寫入 Secret Manager、把精確版本 reference 掛載到 Cloud Run runtime，並完成客戶環境驗收，屬第 8 批。

## 第 8 批：Cloud Run App 端到端自動部署

依賴：第 4～7 批。第一個黃金樣本：由獨立開發 repo 打包的 `stock-price-demo`；母版不得預載其來源或服務。

- [x] 在隔離的 Cloud Build／等效 builder 建置 App 服務，不讓套件取得控制平面憑證。
- [x] 推送 Artifact Registry 並以 immutable image digest 部署，不以可變 tag 作驗收證據。
- [x] 建立或沿用每個服務自己的 runtime service account、環境設定、秘密 reference、資源限制與 ingress。
- [x] 依相依圖部署服務；依賴尚未 verified 時不得部署下游或切換流量。
- [x] 新 revision 先不接 Hosting 正式 route；升級時保留既有 Cloud Run traffic，並執行 liveness、readiness、未授權拒絕、已登入會員／管理員及 API 契約驗收。全新 Cloud Run service 因平台限制會先讓 candidate revision 接收 service URL 流量，但 Hosting route 尚未建立，且應用層授權仍 fail closed。
- [x] 驗收後才建立／更新 Hosting same-origin rewrite，並以明確 `PROMOTE app@version fingerprint-prefix` 確認進行流量切換。
- [ ] 失敗時保留前一個健康 revision；支援從 UI 回滾並再次驗收。
- [x] 將實際 service URL、image digest、revision、route、驗收時間與結果寫入 evidence。
- [ ] 以股票行情 Demo 完成「全新 installation、升級、失敗回復、重試、回滾、停用後重啟」測試。

驗收：已初始化平台上，管理員只用網頁即可安裝並部署股票行情 Demo；無需 SSH／CLI，且公開 API 未授權請求回傳 JSON 401／403，不是 Hosting HTML 404。

實作界線：第 8 批已完成可選的 `gcp-cloud-run` target driver、隔離來源封裝、Cloud Build／Artifact Registry immutable digest、App 專屬 runtime identity、精確 secret version 掛載、staged checks、獨立 promotion、Hosting clone/release、rollback 與不含秘密的 evidence。母版仍預設 `STRATEXEC_DEPLOYMENT_TARGET_MODE=disabled`；本批只以 fake control plane 驗證全新／升級／失敗／重試／回滾，沒有對任何 project 執行 build、IAM、Cloud Run、Hosting 或流量異動。UI 工作流程、停用後重啟與客戶雲端端到端驗收仍未完成，分別留在第 9 批與需當次授權的環境驗收，因此本批不宣稱股票行情 Demo 已部署。

## 第 9 批：管理介面生命週期

依賴：第 6～8 批。

- [x] App 管理頁顯示 source install、runtime deployment、驗收與邏輯啟用四種獨立狀態。
- [x] 上傳後以步驟式 UI 顯示套件信任、部署計畫、設定／秘密、確認、進度、驗收及啟用。
- [x] 以 polling 顯示 job event，重新整理頁面後可接續，不因瀏覽器關閉而中斷伺服器 job。
- [x] `啟用 App` 僅在所有 required services verified 後開放；啟用本身只更新平台生命週期與權限，不執行 SSH 或重新部署。
- [x] 支援取消尚未寫入的 job；已開始的部署只允許 reconcile／reviewed rollback，不假裝立即取消。
- [x] 提供驗證／promotion／rollback 重試、停用、已驗證重新啟用及邏輯移除；實體刪除 runtime／資料仍須獨立影響分析。
- [x] 對管理員顯示可下載的不含秘密 evidence、部署 revision 與事件記錄。
- [x] 完成響應式窄版、原生鍵盤／焦點語意、錯誤復原及長字串不溢出版面；元件測試涵蓋四態與 verified activation。

驗收：業主能從網頁辨識「原始碼已安裝」與「後端已部署」；未驗收 runtime 不會誤顯為可用 App。

實作界線：第 9 批完成本機管理 UI、durable job polling、pre-write cancel、evidence download 與 Identity verified-activation 契約。具有 `requiredServices` 的 App 若缺少 `deploymentJobId`、`runtimeRevision` 或 `runtimeVerifiedAt`，Identity 存取判定會回傳 `app_runtime_unverified`；一般 lifecycle API 也拒絕直接 install／enable。母版 target driver 仍預設停用，本批沒有對任何 GCP／Firebase project 建立、部署、切換流量或啟用 App。

## 第 10 批：VM Agent 與持續執行型 App

依賴：第 6～9 批。適用於 DeriStrat／Account Worker 類長連線服務。

- [x] 定義一次性 VM bootstrap：IAP／OS Login、VM identity、Agent 安裝、mTLS／工作負載身分與撤銷流程；不交換 SSH 私鑰。
- [x] VM Agent 只接受簽章 desired-state deployment，不接受任意 shell 字串。
- [x] 支援 immutable image、host-local data volume、單帳戶鎖、健康／readiness、日誌與版本回退。
- [x] 部署前驗證帳戶唯一 Worker、既有部位／委託、SQLite schema、備份與磁碟空間。
- [x] Agent 斷線、租約失效、UNKNOWN、外部曝險或對帳矛盾時 fail closed，不自動清除狀態或重送交易。
- [x] UI 顯示 VM／Agent／Worker／策略四層狀態；部署成功不得等同可交易。
- [x] 首次 VM 建立或 IAM 擴張仍需業主明確確認；日常版本部署與回滾不需 SSH。

驗收：已完成 bootstrap 的 VM 可由平台網頁部署／回滾 Worker；交易啟用仍遵守獨立的 PAPER／LIVE 授權與驗收，不因 App 安裝自動開啟。

實作界線：第 10 批完成通用 `vm-docker` plan／executor、外部 Ed25519 desired-state signer、Deployment Agent→VM Agent mTLS client、VM Agent、固定 Docker argv、具體 Secret Manager version 掛載、持久 volume／備份／SQLite／單帳戶安全預檢、UNKNOWN reconciliation、immutable rollback 與四層 UI。母版預設兩端 runtime driver 仍為 `disabled`；本批只以離線 adapter／fixture 驗收，沒有建立 VM、IAM、憑證、券商連線、Worker 或 PAPER／LIVE 權限。首次 bootstrap 的實際 GCP 寫入仍須業主當次精確確認；證據見 [第 10 批驗收](evidence/APP-deployment-agent-batch-10-20260919.md)。

## 第 11 批：本機 App source install 進度與效能

依賴：既有 App 套件第 1～3 批。此批只改善 loopback Package Agent 的來源套用流程，不擴張到 Cloud Run／VM runtime deployment。

現況問題：Package Agent 的 apply 請求會同步等待完整交易結束；管理介面只顯示「套用中」，job 只有建立／更新時間，無法辨識驗證、備份、寫入、建置或平台登錄何者耗時。同一 artifact 在預檢後，apply 內部仍會重建 source plan，transaction 入口又再重建一次，保守但有重複解析／雜湊。

### 工作清單

- [ ] 定義 source install phase：`queued`、`revalidating`、`staging`、`backing-up`、`applying`、`regenerating`、`validating`、`registering`、`rolling-back`、`completed`、`failed`、`recovery-required`；不得用單一百分比掩蓋未知耗時。
- [ ] Job 持久保存 `startedAt`、`completedAt`、目前 phase、各 phase 起訖／耗時及單調遞增事件序號；事件不得含 token、套件內容、秘密或 repository 絕對路徑。
- [ ] `POST apply` 改為只完成授權、確認值、排他鎖與工作建立後回傳 accepted job；實際 transaction 由 Agent 工作程序執行，瀏覽器中斷或重新整理不得中止工作。
- [ ] 提供單一 job 狀態／事件查詢 API；管理介面以 AJAX polling 接續工作，不重新載入整個 App 管理頁，並以 `aria-live` 顯示目前階段與已耗時間。
- [ ] 寫入來源前允許取消 queued job；開始 staging／backup 後不得假裝立即取消，只能完成安全回復或進入 `recovery-required`。
- [ ] 保留 apply 前一次完整 revalidation，核對 artifact digest、plan fingerprint、目前 repository hashes、平台契約、service registry 與 package lock；將同一份不可變 prepared plan 傳入 transaction，移除 transaction 內第二次重複規劃。
- [ ] Prepared plan 僅存在受控 Agent 程序內；不得信任瀏覽器回傳的 plan、路徑、差異或 hash，也不得以快取繞過 repository drift 檢查。
- [ ] 保留 staging、transaction backup、排他 apply、衍生檔重建、母版 validator、Console production build、lock 最後寫入及失敗自動回復；效能改善不得刪除這些安全界線。
- [ ] 為 inspect、revalidation、檔案 staging／backup、derived regeneration、validator／build、Identity source registration 分別記錄結構化耗時，讓慢點能以 evidence 判定，不以使用者體感猜測。
- [ ] Agent 啟動時檢查未完成 job、`apply.lock` 與 transaction 目錄；無法證明安全完成或安全回復時標為 `recovery-required`，不得自動重做、刪 lock 或宣稱成功。
- [ ] 更新 OpenAPI、前端型別、管理介面文案與 Package Agent README，清楚區分 `source installed`、`source registered` 與 runtime deployment。

### 測試與驗收

- [ ] 單元測試證明每次 apply 只執行一次完整 revalidation，且 prepared plan fingerprint／artifact digest／repository hash 任一漂移都 fail closed。
- [ ] 覆蓋成功、validator 失敗、build 失敗、Identity registration pending、rollback 成功、rollback 不完整、Agent 中止／重啟、重複 apply 與並行 apply。
- [ ] 驗證瀏覽器重新整理、關閉與重新開啟後可接續顯示同一 job；過程不整頁 reload，也不會重送 apply。
- [ ] 以至少一個 50 檔以上純前端 App 及一個含 Service fragment 的 App 記錄逐階段 baseline；不設定脫離硬體與套件大小的武斷總秒數門檻。
- [ ] 驗證桌面與窄版手機可辨識目前階段、耗時、失敗原因與可採取動作；鍵盤操作、焦點及讀屏訊息通過元件測試。
- [ ] 確認成功安裝結果、lock hashes 與既有同步流程完全一致；production build、transaction rollback 與安全限制沒有因去重或背景化而降級。

驗收：管理員按下套用後能持續看見真實階段，重新整理頁面可接續且不重送；Agent evidence 能指出實際慢點。同一 artifact 在 apply 階段只做一次完整 revalidation，但任何 drift、失敗或程序中斷仍維持 fail closed 與可稽核回復。

實作界線：本節是待辦計畫，尚未修改 Package Agent、API 或管理介面；也不代表既有 App 需要重新安裝。正式 runtime deployment 仍由第 6～10 批的 Deployment Agent 流程處理。

## Codex 執行規則

- 每次只實作一批，開始前讀本文件及其依賴規格，先確認工作樹與現有雲端狀態。
- 預設先完成離線 fixture、模擬雲端 adapter 與 dry-run；使用者未明確授權時，不建立或修改雲端資源。
- 不因有 `DEPLOYMENT.md`、Dockerfile、planned placement 或建置成功，就宣稱已部署／已驗收。
- 不要求使用者貼出 token、API secret、券商憑證、服務帳號 key 或 SSH 私鑰。
- 不將帳務、公開 ingress、IAM 放寬、DNS／流量切換或不可逆 migration 包在一般確認內。
- 修改後至少執行相關單元測試、契約漂移檢查、`npm test`、`npm run build`；Python 變更另執行 `npm run test:backend` 與 `npm run check:backend`。
- 每批建立 `docs/evidence/APP-deployment-agent-batch-<N>-YYYYMMDD.md`，記錄命令、結果、未執行的外部驗收與未解項目，不放秘密。
- 完成回報必須分開列出：source installed、deployment planned、runtime deployed、runtime verified、App enabled。

## 建議執行順序

1. 「實作 App Deployment Agent 第 4 批」
2. 「實作 App Deployment Agent 第 5 批」
3. 「實作 App Deployment Agent 第 6 批」
4. 「實作 App Deployment Agent 第 7 批」
5. 「實作 App Deployment Agent 第 8 批」
6. 「實作 App Deployment Agent 第 9 批」
7. 「實作 App Deployment Agent 第 10 批」
8. 「實作 App Deployment Agent 第 11 批」

Cloud Run 網頁安裝以第 4～9 批全部完成為準；免 SSH 的 VM／持續執行型 App 另需完成第 10 批。第 11 批改善本機 source install 的可觀測性與效能，不改變前述 runtime deployment 完成條件。
