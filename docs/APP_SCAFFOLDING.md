# 標準 App 鷹架規格

本規格定義 AI Agent 在此平台專案收到「新增 App」指令時的預設工作。目標是產生可立即開啟、可驗證、部署責任明確的空白 App，不把未提出的後端或雲端資源一併擴張。

## 觸發方式

下列指令及同義表達都視為執行標準 App 鷹架：

```text
新增 App：風險儀表板
新增一個風險儀表板 App
在平台建立 risk-dashboard App
```

若使用者沒有指定 `app-key`，AI Agent 依名稱產生小寫 kebab-case key，並在交付摘要中明示。顯示模式預設為 `responsive`；只有明確要求固定窄版時才使用 `compact`。

## 必須建立或更新

```text
apps/console/src/apps/<app-key>/
├─ <AppName>App.tsx
├─ <app-key>.css
└─ DEPLOYMENT.md

apps/console/tests/<app-key>.test.tsx
infrastructure/apps/<app-key>.json
infrastructure/app-deployments/<app-key>.json
# 只有 App 擁有後端服務時：
infrastructure/app-services/<app-key>.json
```

必要結果：

1. App 透過既有 Shell 與 lazy loader 開啟，不建立第二套 Shell、側欄或全域樣式。
2. Manifest 的 `frontend` 宣告唯一 key 對應的 `/apps/<app-key>` 路由、名稱、說明、icon、狀態、display mode 與 `order`；執行 `npm run apps:registry` 產生 Registry，不手改 generated file。
3. 空白畫面至少有 App 名稱、目前狀態及「尚未設定資料來源」之類的明確 empty state。
4. App CSS 只作用於 App-owned selector，不覆寫 `html`、`body`、Shell 或共用 UI 內部 class。
5. `DEPLOYMENT.md` 放在 App 原始碼目錄，依 `docs/templates/APP_DEPLOYMENT.md` 建立。
6. App manifest 的 `source` 指向 App 目錄、`deploymentDocument` 指向同目錄的 `DEPLOYMENT.md`、`deploymentManifest` 指向 `infrastructure/app-deployments/<app-key>.json`；空白純前端 App 的 `requiredServices` 與 deployment services 均為空陣列。
7. Manifest 必須宣告 `access.defaultMode`、`adminAllowed` 與 `protected`。未指定需求的空白 App 預設為 `admins_only`，避免尚未完成的畫面在登入後自動開放；若明確是公開示範才使用 `public`。只有 App 內確有分級功能時才加 `access.entitlements[]`，key 使用穩定 kebab-case，不為每個功能建立平台角色或新 collection。
8. Manifest 必須宣告 `lifecycle`。一般 App 預設為 `category: application`、`removable: true`、`defaultStatus: installed`；只有平台核心可使用 `core` 與 `removable: false`。
9. 至少驗證 Registry／路由可載入與基本 empty state。
10. Manifest 必須填 `version`、`platformCompatibility`、`package` 與 `frontend` metadata。一般獨立 App 使用 `package.installable: true`、`ownerApp: <app-key>`；平台核心或共用來源別名不可設為可安裝。

## 預設不執行

只有「新增 App」而沒有其他需求時，不得自行：

- 建立 `services/` 後端、OpenAPI、Firestore collection 或 Rules 開口。
- 呼叫第三方 API、搬移舊專案資料或複製 Firebase／券商憑證。
- 啟用 GCP API、建立 IAM、Cloud Run、VM 或執行 Firebase Hosting 發布。
- 將 planned／空白 App 描述成已完成產品或已部署服務。

若使用者同時要求後端能力，才依 [Backend-aware App 規格](BACKEND_APP_CONTRACT.md) 增加服務、契約、服務清冊與 environment placement。若工作負載為持續執行 Worker，必須依 [部署目標決策規格](DEPLOYMENT_TARGET_POLICY.md) 處理 VM、持久資料、秘密與單例責任。

需要交付移植套件時，再依 [App 套件與可移植安裝格式](APP_PACKAGES.md) 執行 `app:pack`／`app:verify`。開發產物預設未簽章；正式部署候選必須由受信任發布者簽章。無論信任狀態，都不得把驗證成功描述成已部署。

若整個 App 需要付費或指定會員開通，manifest 使用 `grant_required`；若 App 公開但部分功能付費，保留 `public`／`all_members`，並在 `access.entitlements[]` 宣告功能。管理介面只保存授權鍵，功能語意與畫面仍由 App 負責；App 的業務 API 必須在伺服器端查驗 Identity 回傳的 `allowed` 與 `entitlements[]`。只在 Registry 隱藏 App、鎖按鈕或模糊畫面不構成付費內容保護。

## 驗證

至少執行：

```powershell
npm run check:apps
npm run check:services
npm run check:boundaries
npm test
npm run build
```

若只建立空白 App，這些本機驗證不代表雲端已部署。實際部署另需 installation placement、動作前授權及 `docs/evidence/` 驗收紀錄。
