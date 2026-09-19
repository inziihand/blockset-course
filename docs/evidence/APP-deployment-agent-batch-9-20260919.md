# App Deployment Agent 第 9 批證據（2026-09-19）

## 完成範圍

- App 管理頁新增來源、runtime、驗證、邏輯啟用四態矩陣與七步驟工作區。
- Deployment Agent job 在伺服器持久化；UI 重新載入清單並對 transient job／events 每 2 秒 polling。
- 新增 pre-write cancel、verified activation、promotion／rollback retry、UNKNOWN reconcile 與 evidence JSON 下載。
- Identity 一般 lifecycle 拒絕有後端 App 直接 install／enable；verified activation 寫入 job、revision、verified time。
- 缺少 runtime evidence 的後端 App 回傳 `app_runtime_unverified`，不列為可用 App。
- 響應式矩陣與步驟列使用局部水平捲動，不擠出 App 容器；互動採原生 button、select、input、fieldset 與 label。

## 本機驗證

- `npm run test:backend`：23 passed。
- `npm test`：302 passed（scripts 34、Console 198、market-data 19、Package Agent 11、Deployment Agent 40）。
- `npm run build`：契約、manifest、service registry、TypeScript、production bundle 與 Node syntax 檢查通過。
- Deployment Agent 單元測試涵蓋：未部署不可啟用、精確 ENABLE 確認、pre-write cancel、事件／證據不保存 Firebase token。
- Console 元件測試涵蓋：來源已套用／runtime 已部署／已驗證／尚未登錄四態與 verified activation。

## 未執行的外部驗收

- 沒有部署至任何 GCP／Firebase project。
- 沒有執行 Cloud Build、Cloud Run revision、Hosting release、IAM、Secret Manager 或流量切換。
- `STRATEXEC_DEPLOYMENT_TARGET_MODE` 與 `STRATEXEC_SECRET_MANAGER_MODE` 仍預設 `disabled`。
- 真實客戶 project 的端到端部署、停用後重新啟用與 rollback，仍需當次明確授權及費用／公開 ingress 確認。
