# Demo App 部署規格

狀態：母版內建、純前端離線 Demo。

`demo` 與 `demo-compact` 共用 `apps/console/src/apps/demo/`，分別驗證 responsive 與 compact 顯示契約。兩者沒有 App 專屬後端、外部資料源或秘密；隨 Platform Console 一起建置至 Firebase Hosting。

安裝 manifest：

- `infrastructure/apps/demo.json`
- `infrastructure/apps/demo-compact.json`
- `infrastructure/app-deployments/demo.json`（機器可讀部署契約）

完成條件：兩個路由都能直接載入及重新整理，窄版 App 視窗遵守 420 CSS px 上限，且 App CSS 邊界檢查、元件測試與 production build 通過。
