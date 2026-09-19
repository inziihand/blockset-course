# App 內功能權限驗收

日期：2026-09-19。工作區：`stratexec-platform` repository。

## 目的

在既有整體 App 存取政策之下加入最小的 App-local 功能權限，支援「App 可開啟，但課程模板、Greeks 或其他付費功能需另外授權」；不增加平行角色系統、Firestore collection 或獨立權限服務。

## 資料與契約

- App manifest 可選擇宣告 `access.entitlements[]`，每項包含穩定 key、顯示名稱與說明。
- `appPolicies/{appKey}` 保存 manifest 同步的功能權限目錄。
- `members/{uid}/appGrants/{appKey}` 沿用同一文件保存 `enabled`、App-local `roles[]` 與 `entitlements[]`。
- Identity API 的有效 `appAccess` 同時回傳整體 `allowed` 與有效 `entitlements[]`；不存在於目前 manifest 目錄的舊 grant key 不會被回傳。
- `adminAllowed` 為 true 的 active admin 自動取得 App 目前宣告的全部功能權限。

## 實作

- 「會員與權限」App 在會員明細中顯示每個 App 宣告的功能勾選項；整體 App grant 與功能 entitlement 可分開管理。
- Deployment impact plan、批准 fingerprint、Deployment Agent verified activation 與 bootstrap installer 都攜帶 entitlement 目錄。
- App 升級同步 `allowedModes` 與 entitlement 目錄，但保留業主既有 `accessMode`／`adminAllowed`；若新版不再支援既有模式則 fail closed。
- 前端提供 `hasAppEntitlement` 作介面顯示；付費或敏感 API 仍必須以伺服器端 Identity 結果執行授權。

## 本機驗證

```text
npm run check:backend passed
npm run test:backend 28 passed
npm test passed: installer 35, Console 199, Package Agent 11, Deployment Agent 45, VM Agent 7
npm run build passed: manifest/install/service checks, TypeScript, Vite production build and Node syntax checks
git diff --check passed
```

## 邊界

- 母版沒有加入業務 App 或假付費方案；無 entitlement 的既有 App 保持原行為。
- 前端鎖頭、模糊畫面與按鈕停用不是安全邊界；實際 App 後端必須檢查 `allowed` 與指定 entitlement。
- 本次未修改或部署任何客戶的 Cloud Run、Hosting、IAM、Firestore 或 Firebase Auth 資源。
