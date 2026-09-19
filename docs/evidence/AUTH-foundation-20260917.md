# Firebase Authentication 母版基礎驗收

日期：2026-09-17。工作區：`stratexec-platform` repository。狀態：未提交工作樹；私人參考 project 已加入 Firebase，並建立 `stratexec-platform` Web App、Google Authentication Provider 與 Firestore Native `(default)`。實際 project ID 與 support email 不保存在公開母版。沒有建立或搬移使用者、會員文件、custom claims、Functions 或 Hosting release。

## 完成內容

- Console 固定安裝 `firebase@12.18.0`，採 modular Web SDK。
- Firebase Auth 依賴以 lazy chunk 載入；未設定時不初始化 SDK、不發出 Firebase 網路請求，也不阻止 Shell 與 Demo 啟動。
- 根目錄 `.env.example` 只提供中性的 placeholder 與 `STRATEXEC_BOOTSTRAP_ADMIN_EMAILS` 空值；沒有客戶 project ID 或管理員信箱。
- 母版沒有 `.firebaserc`；每個雲端操作都從 `infrastructure/environments/<key>.json` 取得並明確傳入 `--project`。
- `scripts/bootstrap-installation.ps1` 可 dry-run／重複套用，建立或沿用 Firebase Web App、Firestore、Rules／indexes、Authorized domains，並產生被 Git 忽略的 `.env.local`。
- 管理員名單刻意為伺服器變數，production bundle 檢查會拒絕它進入瀏覽器；沒有用前端信箱比對授予權限。
- Drawer 提供未設定、初始化、Google 登入、已登入、登出與錯誤狀態；共用 Auth context 提供 ID Token 取得介面。
- Python Identity API 已實作 ID Token 驗證、第一次登入會員同步、server-only bootstrap admin、角色／停權／方案、App grant、custom claim 同步與管理異動稽核。
- Firestore Rules 對 `members`、`appGrants`、`apps`、`adminAuditLogs` 與交易 runtime collection 預設拒絕瀏覽器讀寫；只由可信任後端存取。
- `contracts/identity/openapi.json` 由 FastAPI 匯出並有漂移檢查；服務清冊登記 `ownerApp: platform` 與 `firebase-id-token`。

## 驗證

- `npm run check:config`：公開 Firebase 設定與伺服器端管理員政策分離。
- `npm run check:installations`：通用 example 與私人參考安裝描述均通過。
- `npm run test:backend`：Identity domain／HTTP API 8/8；`npm run check:backend`：Ruff 與 OpenAPI 漂移檢查通過（測試套件有一則 Starlette 對 AnyIO alias 的相依套件棄用警告）。
- `npm run test:firestore-rules`：Firestore Emulator 4/4；會員、App grant、管理稽核及未知 App 路徑皆無瀏覽器旁路。
- `npm test`：Market Data service 4/4、Console 182/182。
- `npm run build`：TypeScript、Vite、App CSS 邊界、服務清冊與 production bundle 檢查通過。
- production 輸出產生獨立 `firebaseAuth` lazy chunk；主程式未包含 `STRATEXEC_BOOTSTRAP_ADMIN_EMAILS`。
- Firebase／GCP CLI 驗證：Firebase 專案與 Web App 為 ACTIVE；Google Provider 已啟用；Authorized domains 包含 Firebase 預設網域、`localhost` 與 `127.0.0.1`。
- Firestore：`asia-east1`、`FIRESTORE_NATIVE`、Standard edition、delete protection enabled；Rules／空 indexes 已發布。資料庫只有 bootstrap 建立的 `platformMeta/schema` 安裝版本，沒有會員或源版業務 collection。
- Chrome 本機 smoke：`http://127.0.0.1:5179/apps/demo` 的 Drawer 顯示可操作的「以 Google 帳號登入」，沒有「Firebase Auth 尚未設定」提示或頁面錯誤。

## 待正式接線與部署

- 後續批次 1～3 已將 Console 登入後流程接到同源 Identity session；管理頁仍未實作。
- 後續批次 1～3 已為 Identity API 選定 Cloud Run、加入專用執行服務帳號、同源 Hosting rewrite 與安裝器；App Check 與正式監控仍待實作。
- 正式網域需加入 Auth authorized domains 並完成 OAuth consent 驗收。
- Hosting、Identity API、交易 API 與 Worker 仍未實際部署；Identity 的部署程式已在後續批次 1～3 完成，但私人參考環境的 billing 停用，尚未 apply。
