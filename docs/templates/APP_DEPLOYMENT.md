# <App 名稱>部署規格

狀態：空白 App／尚未定義後端。此文件是部署規格，不是已部署證據。

## 前端

- App key：`<app-key>`
- 路由：`/apps/<app-key>`
- 原始碼：`apps/console/src/apps/<app-key>/`
- 機器部署契約：`infrastructure/app-deployments/<app-key>.json`
- 顯示模式：`responsive`

## 所需服務

目前無 App 專屬服務；隨 Platform Console 靜態資產發布。

若後續新增服務，須列出 service key、原始碼、OpenAPI、同源路徑、workload class、推薦／允許目標及 production readiness。

## 資料與權限

- 資料來源：尚未定義。
- 預設存取模式：`admins_only`；完成需求確認後才改為 `public`、`all_members` 或 `grant_required`。
- App 內功能權限：無；若新增，逐一列出 manifest `access.entitlements[]` 的 key、顯示名稱、付費／課程對應與後端查驗端點。
- 登入需求：沿用 Platform；若採 `grant_required`，列出 App API 的伺服器端查驗方式。
- 秘密：無。
- 外部狀態寫入：無。

## 部署目標

- 前端：Firebase Hosting，隨 Platform Console 發布。
- API／Worker：無。

## Health、驗收與回滾

- `/apps/<app-key>` 可直接開啟及重新整理。
- App empty state、Registry、邊界檢查、測試與 production build 通過。
- 純前端回滾隨 Firebase Hosting release；若後續新增服務，必須補充各服務 health、revision／digest 與獨立回滾方式。

## 待確認

- 是否需要 API、Worker 或第三方資料來源。
- 是否需要 Firestore schema／Rules。
- 是否需要整體 App grant、App-local role、功能 entitlement、付費產品對應或管理員權限。
- 是否有資料保留、備份、費用或正式 SLA。
