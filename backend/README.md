# Platform backend

這裡只放平台級後端能力；各 App 的市場資料或交易服務仍由
`infrastructure/services.json` 登錄並保有自己的來源目錄。

目前第一個平台服務是 Identity API：

- 驗證 Firebase ID token 與已驗證的 Google 身分。
- 以 Firestore `members/{uid}` 保存平台會員狀態。
- 以 `appPolicies/{appKey}` 保存 App 全域開放模式。
- 以 `appInstallations/{appKey}` 保存可逆的 App 安裝、停用與邏輯移除狀態。
- 以 `platformMeta/schema.appOrder` 保存管理員調整的全平台 App 顯示順序，供管理頁、首頁與左側導覽共用。
- 以 `members/{uid}/appGrants/{appKey}` 保存整體 App grant、App-local roles 與功能 `entitlements[]`，不另建平行權限服務。
- 解析會員的有效 `appAccess`，並提供 App 後端可查驗 `allowed` 與 `entitlements[]` 的 `/api/identity/v1/access/{appKey}`。
- 管理異動寫入 `adminAuditLogs`。
- `STRATEXEC_BOOTSTRAP_ADMIN_EMAILS` 只在伺服器啟動環境提供；不進前端 bundle 或客戶安裝描述檔。

本地執行：

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -e "backend[dev]"
gcloud auth application-default login
$env:GOOGLE_CLOUD_PROJECT = "your-project-id"
$env:STRATEXEC_BOOTSTRAP_ADMIN_EMAILS = "admin@example.com"
.venv\Scripts\python -m uvicorn stratexec.api.main:app --app-dir backend/src --host 127.0.0.1 --port 8180
```

正式環境使用執行服務帳號的 Application Default Credentials；不要下載或提交服務帳號金鑰。
Windows 本機若位於 TLS inspection 環境，後端會讓 HTTP 與 Firestore gRPC 使用作業系統
信任庫；匯出的暫存 CA bundle 只存在程序生命週期，不會寫入儲存庫。
若只做離線開發，可同時設定 `FIREBASE_AUTH_EMULATOR_HOST` 與
`FIRESTORE_EMULATOR_HOST`；此模式使用匿名 Emulator credential，不會接觸正式專案。
