# 會員與 App 權限 App 驗收

日期：2026-09-17

## 範圍

- 新增 `access-control` App manifest、App-local `DEPLOYMENT.md` 與 Registry lazy route。
- 新增「會員」及「App 權限」資料夾頁籤。
- Identity API 保存 `appPolicies` 與個別 `appGrants`，並解析每位會員的 `appAccess`。
- `grant_required` 支援來源、產品代碼、起訖時間；目前管理畫面提供人工授權／撤銷，購買系統整合保留給個別 App。
- 保護最後一位 active admin 及 `access-control` App；未知 App、停用會員與無效授權皆 fail closed。
- Firestore 更新會員角色／狀態時以 transaction 再檢查最後一位 active admin，避免多個管理請求競速造成零管理員。
- 安裝器首次建立 manifest 預設 policy，但不覆蓋已存在的管理設定。
- App manifest 宣告 `allowedModes`；股票行情 BFF 已在每次讀取前向 Identity API 查驗有效權限。

## 本機驗證

- `npm run test:backend`：16 passed。
- `npm run test --workspace=@stratexec/console`：15 files、190 tests passed。
- `npm test`：App／installation／service 檢查、16 項 installer、18 項 Market Data 與 190 項 Console 測試全部通過。
- `npm run build`：manifest／installation／service／installer 檢查、CSS ownership、TypeScript、Vite production build 全部通過。
- `npm run check:backend`：Ruff 與 Identity OpenAPI drift check 通過。
- `npm run test:firestore-rules`：Firestore Emulator 4/4，包含 `appPolicies` 不可由瀏覽器直接讀取。
- Playwright：Chromium 桌面／手機與 WebKit 手機共 47 passed、2 skipped；兩項 WebKit 30 秒時序失敗逐項重跑皆通過。

## 安全界線與未解項目

- Console 的隱藏／導覽拒絕不是安全邊界；付費或敏感 App 的業務 API 必須查驗 Identity API 的有效權限結果。
- 股票行情 Demo 預設 `all_members`，並已讓 BFF 查驗 Identity App entitlement；可作 `grant_required` 的後端範例，但 Yahoo Finance 仍只是無 SLA 的 Demo 資料源。
- 未建立、修改或部署任何客戶雲端資源。
