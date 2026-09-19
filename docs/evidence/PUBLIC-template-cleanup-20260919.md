# 公開母版清理證據（2026-09-19）

## 範圍

- 分支：`codex/public-template-cleanup`
- 保留可公開的通用安裝範例：`infrastructure/environments/installation.example.json`
- 移除原始碼內受版本控制的私人安裝環境；運作中的測試環境改由版本庫外的 `%LOCALAPPDATA%\StratExec\installations\<installation-key>\installation.json` 明確傳入
- 移除文件、測試 fixture 與輔助腳本中的開發者專案、信箱、私人環境名稱及本機絕對路徑
- 部署規劃、盤點與 Hosting 設定產生器不再猜測預設客戶環境，必須明確傳入私人安裝設定路徑
- `npm test` 與 `npm run build` 會先執行公開原始碼檢查

## 驗證

- `npm run check:public-source`：通過
- `npm run check:config`：通過
- `npm run check:apps`：通過，3 個前端 App 與 1 個平台 manifest
- `npm run check:installations`：通過，僅 1 份通用安裝範例
- `npm run check:services`：通過，1 份 service schema v3
- `npm run check:installer`：36/36 通過
- `npm test`：通過；Console 199、App Package Agent 11、Deployment Agent 45、VM Agent 7
- `npm run test:backend`：28/28 通過；僅有第三方 Starlette deprecation warning
- `npm run check:backend`：Ruff 與 Identity OpenAPI 漂移檢查通過
- `npm run build`：通過；production bundle 檢查未發現測試 fixture 或伺服器端管理員政策
- `firebase-tools`：由 14.21.0 更新至 15.30.2；production dependency audit 為 0，完整開發樹剩 8 個 Firebase CLI 間接相依的 moderate 項目
- Firestore Rules：既有 4/4 證據仍有效；Firebase CLI 15 改需 JDK 21，本機 JDK 17 未重跑，CI 已固定 Temurin 21 並納入規則測試
- 版本庫外私人設定的安裝器 dry-run：通過；未寫入雲端或本機安裝狀態

## 邊界與未解項目

- 未執行部署、帳單連結、IAM 變更、雲端資源寫入或交易操作
- 未推送遠端，也未改寫既有 Git 歷史；已發布的舊 commit 若含私人資料，仍須另案決定是否進行破壞性的歷史清理
- 本批只處理「公開母版乾淨且私人環境可外掛」；從 `.env` 匯入部署設定或互動式安裝精靈屬下一階段
- 工作樹原先已有功能開發差異；本次未將它們回復、覆寫或混成單一 commit
