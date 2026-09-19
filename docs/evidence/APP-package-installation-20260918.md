# App 套件第二批驗收

日期：2026-09-18

## 本批完成

- App manifest 新增 `package.installable`／`ownerApp` 與前端 `order`；核心 App 與共用來源別名不可由 ZIP 取代。
- Console Registry 改由 App manifests 產生，安裝新 App 後不必手改 Shell registry。
- `app:install` 預設 dry-run，輸出 add／update／delete／unchanged 差異與 blocker。
- Apply 需精確 `app-key@version`；既有未管理 App 需 `adopt-existing`，降版需 `allow-downgrade`，相同版本禁止改內容。
- 套用限制在 App-owned canonical roots，使用隔離 staging、交易備份、衍生檔重建、安裝後驗證與失敗自動回復。第三批再將驗證收斂為母版已知 validator、Console build 與 Node `--check`，不執行 App-owned workspace scripts。
- `app-packages.lock.json` 保存成功安裝的 package／file hashes，後續更新遇到本機漂移會 fail closed。
- npm workspace 改為 `services/*`，讓新增 App-owned Node service 可被 workspace build／test 發現。

## 安全界線

- 套件仍為 `unsigned-development`，不代表可信 publisher。
- 不執行套件腳本、資料 migration、`npm install` 或雲端部署。
- 當時尚未提供管理介面 upload、server-side quarantine／build、artifact 留存、長期 rollback 與 Service apply；第三批已補本機 loopback 管理介面／quarantine／artifact／job，遠端受限 build、長期 rollback 與 Service apply 仍未完成。
- 本批沒有對任何 GCP/Firebase project 建立／修改資源。

## 自動驗證

第二批新增測試涵蓋 dry-run、新安裝、精確確認、核心 App 拒絕、lock 寫入、重跑 no-op、本機漂移阻擋，以及 post-install 驗證失敗時完整回復。

- `npm test`：通過，共 234 項（安裝／部署契約 24、Console 192、market-data BFF 18）。
- `npm run build`：通過，包含 manifests／service registry／package／installer 契約檢查與 Console production build。
- `npm run test:backend`：通過，19 項。
- `npm run check:backend`：通過，包含 Ruff 與 OpenAPI drift check。
- `stock-price-demo` 實際打包後執行 `app:install` dry-run：`no-op`、無 blocker，未寫入專案。
