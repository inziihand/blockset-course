# App 安裝、停用與移除驗收

日期：2026-09-18

## 範圍

- `access-control` 新增「App 管理」資料夾頁籤，集中管理已安裝、已停用與已移除狀態。
- 非核心 App 支援安裝、停用、重新啟用與移除。
- `access-control` 為受保護核心 App，不允許停用或移除。
- 移除前必須輸入完整 App 顯示名稱確認，避免誤操作。
- 停用或移除後，Shell 立即從導覽、啟動器與直接路由移除 App；Identity API 同時拒絕該 App 的有效權限。
- 「移除」是可逆的邏輯移除：保留程式碼、設定、資料與後端服務，之後可由介面重新安裝。
- App manifest 新增 `lifecycle.category`、`lifecycle.removable` 及 `lifecycle.defaultStatus`，讓安裝器與 AI Agent 有明確的宣告式依據。
- Firestore 新增 `appInstallations` 狀態集合；產品前端不得直接讀寫，生命週期變更僅能經過管理員 API。

## 管理介面語意

- 停用：暂時關閉 App，保留安裝關係，可一鍵重新啟用。
- 移除：從當前平台載入目錄排除，但不刪除雲端資源或資料。
- 安裝：將 manifest 已登錄的 App 恢復到平台載入目錄。
- 會員與 App 權限只會列出目前已安裝的 App，避免對已移除 App 繼續授權。

## 本機驗證

- `npm test`：App、installation、service、installer、Market Data 與 Console 整包驗證通過；Console 為 16 個測試檔、192 項，Market Data 為 18 項。
- Backend 單元測試：19 項通過。
- Installer contract：18 項通過，含首次播種與重跑時不覆寫現有狀態。
- Console production build、Ruff、Identity OpenAPI drift check 與 App manifest check 通過。
- Firestore Emulator 規則測試 4 項通過，瀏覽器不能直接讀寫 `appInstallations`。
- `GET /api/identity/v1/apps` 本機實際回傳 `access-control`、`demo`、`demo-compact`、`stock-price-demo`。

## 私人參考環境狀態與邊界

- 已將四個 App 的 manifest 元資料同步到私人參考環境的 Firestore `appInstallations`，四者狀態均保持 `installed`；實際 project ID 不保存在公開母版。
- 此次未停用、移除或重新安裝任何 App。
- 此次未發佈 Firebase Hosting、Cloud Run 或 VM 服務；管理介面與 API 仍是母版本地版本。
