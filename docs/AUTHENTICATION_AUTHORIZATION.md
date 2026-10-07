# Firebase Authentication 與管理權限

平台預設安裝 Firebase JavaScript SDK，並提供 Google 登入的 Shell 基礎能力。沒有設定 Firebase 時，平台仍可啟動，Drawer 會明示「Firebase Auth 尚未設定」。

## 設定方式

1. 一般使用者在 Windows、macOS 或 Linux 執行 `npm run setup`；Node 精靈會從既有 Firebase Web App 產生根目錄 `.env.local`，或在 Y/N 明確確認後設定 Firebase Google Provider／Web App。接著準備 ADC、Firestore／App 清冊與 Python Identity API，並自動啟動本地前後端。`scripts/install.ps1` 保留作 Windows 相容入口；手動複製 `.env.example` 與直接執行 `bootstrap-installation.ps1` 只保留給開發及進階操作。
2. `.env.example` 只含通用 placeholder；母版不內建任何客戶 project ID、Web App ID 或管理員信箱。
3. 公開母版只提供 `infrastructure/environments/installation.example.json`；每個客戶複製為被 Git 忽略的 `*.local.json` 或 repository 外的私人 overlay，再填入自己的 GCP/Firebase project。
4. 在 Firebase Console 明確檢查 Google Provider、support email 與正式網域，再重新啟動 Vite。

安裝完成後可用 `npm run start:local` 一起重啟本地 Identity API、Package Agent、Deployment Agent 與 Console，使用 `npm run stop:local` 停止。首位已驗證管理員可直接使用 App 安裝管理；本機 source install 可接受經管理員精確確認的未簽章開發套件，但 runtime deployment 仍要求 `trusted-signed`，且正式雲端 target 維持停用。Cloud Run／Hosting 正式部署是日後獨立的 `.\scripts\deploy.ps1` 流程，不在第一次本地安裝中詢問或執行。

Firebase Web App 設定會進入瀏覽器 bundle。它負責識別 Firebase 專案，不是管理員憑證；資料安全仍須依靠後端 ID Token 驗證、Firebase Security Rules 與需要時的 App Check。

## 管理員帳號

伺服器執行環境提供：

```dotenv
STRATEXEC_BOOTSTRAP_ADMIN_EMAILS=
```

這是預留給未來可信任後端／一次性 bootstrap 工具的伺服器變數，可填逗號分隔的管理員信箱。它刻意沒有 `VITE_` 前綴，因此不會進入前端 bundle。

管理功能採以下流程：

1. 使用者透過 Firebase Auth 登入，前端取得 ID Token。
2. 後端以 Firebase Admin SDK 驗證 ID Token、email verified 與允許的登入提供者。
3. 只有可信任 Identity API 可讀取 `STRATEXEC_BOOTSTRAP_ADMIN_EMAILS`；僅在該帳號第一次建立會員文件時給予 admin，後續變更環境變數不會默默提升既有會員。
4. 伺服器端 `members/{uid}` 是角色與狀態權威；custom claim 只作粗粒度 UI／Rules 提示，不取代伺服器授權。
5. App 全域政策放在 `appPolicies/{appKey}`，安裝生命週期放在 `appInstallations/{appKey}`；個別授權放在 `members/{uid}/appGrants/{appKey}`，不把所有 App 權限塞入 custom claims。
6. Identity API 依安裝狀態、會員狀態、平台角色、App policy、個別 grant 與有效期限算出 `appAccess`；每筆結果同時包含整體 `allowed` 與該 App 自訂的 `entitlements[]`。未安裝、已停用與未知 App 預設拒絕。未登入 Shell 則透過公開 App catalog 取得已安裝 App 的目前 `accessMode`，只讓 `public` 入口通過；catalog 不公開會員 grant 或 entitlement。
7. 管理 API 每次都驗證 ID Token 與 Firestore 權限；異動寫入 `adminAuditLogs`。
8. 首位管理員完成 bootstrap 後，其他使用權限由受保護的「會員與權限」App 維護並留下稽核紀錄；最後一位 active admin 不可停用或降級。

禁止建立 `VITE_ADMIN_EMAILS`、在 React 內硬編碼管理員信箱，或僅以 `user.email === ...` 保護管理 API。瀏覽器端內容可被讀取或修改，不能作為授權邊界。

## Firestore 界線

- `members/{uid}`：平台會員、角色、狀態與方案。
- `members/{uid}/appGrants/{appKey}`：個別 App 的 `enabled`、App-local `roles[]` 與功能 `entitlements[]`；不另建第二份功能授權 collection。
- `appPolicies/{appKey}`：已安裝 App 的全域開放模式及 manifest 宣告的功能權限目錄；一般 App 的 `public`／`all_members`／`grant_required` 由平台管理員決定，升級會同步功能目錄但不覆蓋既有 `accessMode`／`adminAllowed`。
- `appInstallations/{appKey}`：App 的 `installed`／`disabled`／`uninstalled` 狀態、分類、可移除性與相依服務；管理員只透過 Identity API 異動。
- `platformMeta/schema.appOrder`：管理員在 App 管理頁調整的完整 App 順序；公開 App catalog、平台首頁與左側導覽共用同一順序，瀏覽器不可直接寫入。
- `apps/{appKey}/...`：App 自有資料；每個 App 必須另外提出 schema 與 Rules，母版不提供泛用開口。
- `adminAuditLogs/{id}`：管理異動稽核。
- 交易控制、命令、runtime、snapshot 與 lease collection 保持伺服器／Worker 專用。

目前瀏覽器對上述 collection 一律拒絕；Firebase Admin SDK 與受 IAM 保護的伺服器在驗證後讀寫。這刻意避免「登入即可直接修改會員或權限」。

## 目前完成與未完成

已完成：Firebase SDK、Google popup 登入、登入後 Identity session 同步、ID Token 介面、可移植安裝描述、Identity API、Firestore 會員／App grant／App policy／App installation adapter、整體 App 與 App-local 功能權限解析、custom claim 同步、管理 API、「會員與權限」App 的會員／權限／App 管理頁籤、預設拒絕 Rules、Rules 測試、OpenAPI 契約，以及批次 1～5 Cloud Run／Hosting／bootstrap admin 安裝器。`GET /api/identity/v1/access/{appKey}` 提供 App 後端查詢 `allowed` 與 `entitlements[]`；付費 API 必須查驗兩者，不能只靠前端鎖頭或模糊遮罩。`GET /api/identity/v1/admin/deployment-access/{appKey}` 則專供 Deployment Agent 複驗 active admin 的 App 安裝管理權，可識別尚未註冊的新 App，且拒絕受保護核心 App。第 7 批設定與秘密 API 也對每個 App 寫入操作重新呼叫此權限檢查；平台級 OAuth／bootstrap 摘要則只開放 active admin，且不回傳秘密。公開的 `GET /api/identity/v1/apps` 只回傳可用 installation 及目前 `accessMode`，讓 Shell 在登入前套用管理員設定；若 catalog 無法讀取，已設定 Firebase 的環境會 fail closed，不使用 manifest 預設值猜測。

尚未完成：App Check、正式自訂網域，以及公開母版的全新客戶雲端發布驗收。安裝器目前只有本機與唯讀 preflight 證據；未啟動 Identity API 時，前端 session 同步 fail closed，不會在瀏覽器自行授予管理權。Registry 隱藏與拒絕導覽只是使用者體驗；凡是付費或敏感 App，其專屬 API仍必須在伺服器端查驗 `appAccess`。母版目前不預載業務 App，後續以外部簽章 ZIP 驗證完整安裝流程。

官方參考：[Web Auth 初始化](https://firebase.google.com/docs/auth/web/start)、[Google 登入](https://firebase.google.com/docs/auth/web/google-signin)、[Custom claims 與 Security Rules](https://firebase.google.com/docs/auth/admin/custom-claims)、[Firebase Web API key 說明](https://firebase.google.com/docs/projects/api-keys)。
