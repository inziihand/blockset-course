# App Package Agent

這是第三批 App 套件功能的本機 control agent。它替管理介面執行 ZIP quarantine、完整性／相容性預檢、不可變 artifact 留存、工作紀錄與既有 source install transaction。對可信簽章的純前端 App，管理員可在本機使用「安裝並發布」，由 Agent 建置 Console、驗證 Firebase Hosting 預覽版、切換正式版，再啟用 Identity。它不是客戶 runtime API，也不應部署到 Cloud Run 或開放公網。

## 啟動

先啟動本機 Identity API，確保登入帳號是 active、email verified 的平台管理員，再另開終端機：

```powershell
npm run dev:app-packages
```

代理只允許綁定 `127.0.0.1`；單獨開發啟動預設使用 `8182`，`npm run setup`／`npm run start:local` 則會管理其生命週期，並在多份 checkout 衝突時選擇備援埠。Vite 將 `/api/app-packages/**` 同源代理到本次實際端點。狀態及 artifact 保存在 Git 忽略的 `.stratexec/app-package-agent/`。

原始母版與單獨 Agent 預設 `STRATEXEC_ALLOW_UNSIGNED_APP_PACKAGES=false`；完整 `npm run setup` 會在 Git 忽略的本機 `.env.local` 設為 `true`，讓 active verified admin 經精確版本確認後套用 `development-unsigned` 開發套件。通過 `infrastructure/app-publisher-trust.json` 的 Ed25519 簽章套件會標為 `trusted-signed`，可進行 source apply 並作為後續正式部署的必要輸入。未簽章例外不得用於 runtime deployment。

## 安全契約

- 所有 jobs／inspect／apply 都轉送 Firebase ID Token 到 Identity `/me`，只接受 active verified admin。
- 上傳上限 256 MiB；檔名、ZIP 路徑、內容 hash、平台相容性、App／Service ownership 由現有 verifier 驗證。
- quarantine 驗證成功後以 package SHA-256 留存 artifact；API 永不回傳磁碟路徑。
- apply 必須輸入 inspect 回傳的精確 `app-key@version`，並以排他 lock 防止同時寫入。
- inspect fingerprint 會綁定 ZIP digest、平台契約、產生後服務清冊、安裝鎖、目前 App-owned 檔案 hashes 與 installation 設定；任一輸入變化都會使工作失效並要求重新預檢。
- `GET /api/app-packages/v1/jobs/{jobId}/deployment-plan?installationKey=<key>` 只讀取已驗證 artifact、installation 與 `.stratexec/deployment-inventory/<key>.json`，回傳 deterministic runtime impact plan；不寫入 job 或雲端。
- ZIP 只能攜帶符合 `app-deployment.schema.json` 的宣告式部署資料；任意 command、shell、script、entrypoint 或 hook 一律拒絕。
- install validation 失敗沿用第二批 transaction 自動回復；工作紀錄保存失敗原因。
- 一般預檢與來源套用只執行母版已知 validator、Console build 及 App-owned Node 檔案的 `node --check`；來源套用不會提前登錄 Identity，也不執行套件 workspace／lifecycle scripts、`npm install`、資料 migration 或 Service deployment。
- `POST /api/app-packages/v1/jobs/{jobId}/frontend-release` 是明確確認後的額外操作，只接受 `trusted-signed`、無獨立後端服務的 App。它核對本機 `.env.local` 與目標 installation 的 Firebase project/auth domain，記錄前一個 Hosting 版本，驗證預覽 HTML 與主程式資產，發布後才呼叫 Identity。Identity 啟用失敗會嘗試回復 Hosting；結果不明時保留 `release.lock`，必須先人工核對。
- 正式站沒有遠端 Package Agent；若要從正式網址直接上傳 ZIP，仍需獨立的受控建置／發布服務。此本機流程不代表遠端安裝已啟用。

若程序被強制終止並遺留 `apply.lock`，先確認沒有 Agent／build 程序仍在執行、檢查 Git 與工作紀錄，再由維護者移除 lock；不得自動把逾時視為安全。

API 契約見 `contracts/app-packages/openapi.json`。

以固定讀取命令更新 inventory snapshot：

```powershell
npm run inventory:deployment -- <installation.json>
```

該命令只使用 `describe`、`list`、`get-iam-policy` 與 Firebase Hosting GET；不執行 enable、IAM binding、deploy 或資源建立。Snapshot 只保存資源 metadata、API／IAM 名稱及 secret 是否存在，不保存 access token、secret value 或服務帳號 key。Inventory 不完整時 plan 必須保持 blocked。
