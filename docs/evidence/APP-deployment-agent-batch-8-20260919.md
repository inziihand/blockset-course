# Deployment Agent 第 8 批證據

日期：2026-09-19

## 完成範圍

- 新增預設停用、需明確選用的 `gcp-cloud-run` target driver。
- 只封裝 Service fragment 宣告的 build context；排除 Git、state、dependencies、輸出目錄、symlink、`.env` 與金鑰檔。
- 使用每個服務獨立、只具 artifact write／source read／log write 的 Cloud Build service account 建置；Artifact Registry 儲存並以 `image@sha256:<digest>` 部署，不沿用控制平面身分。
- 依服務相依圖部署；每個服務有獨立 runtime service account、資源、ingress、一般設定及精確 Secret Manager version reference。
- 升級 revision 以 0% production traffic candidate 暫存；全新 service 尚無既有 revision 時只有 Cloud Run candidate service URL，Hosting route 仍不發布。
- 分開執行 liveness、readiness、未授權 JSON 401／403 與宣告式 authenticated API checks。
- `verify` 成功只進入 `staged-verified`；必須輸入精確 `PROMOTE app@version fingerprint-prefix` 才切 Cloud Run traffic 並 clone／release Firebase Hosting route。
- 保存 service URL、candidate URL、build id、image digest、revision、前一 revision／traffic、checks、Hosting release 與時間；錯誤訊息遮蔽 token／secret。
- 回滾使用 evidence 中的前一 traffic／revision，再執行健康檢查。

## 驗證命令與結果

```text
npm run services:merge
npm test
npm run build
```

結果：

- installer／契約測試 34 passed。
- Console 測試 196 passed。
- Market Data Demo 測試 19 passed。
- App Package Agent 測試 11 passed。
- Deployment Agent 測試 36 passed。
- `npm run build` 通過；Console production bundle、三個 Node service syntax checks 全部通過。
- Deployment Agent fixture 涵蓋 staged apply、authenticated verification、explicit promotion、Hosting 後發布、驗證失敗保留舊流量、rollback、UNKNOWN／重試及相同不可變輸入重跑。

## 未執行與未完成

- 未啟用任何客戶 project 的 API，未修改 IAM、Artifact Registry、Cloud Build、Cloud Run、Secret Manager、Firebase Hosting、帳務或正式流量。
- 未取得真實 Cloud Run URL／revision／digest；本文件的通過結果是離線 fake control plane，不是雲端部署證明。
- 第 8 批的 UI rollback、股票行情 Demo 全新／升級／停用後重啟真實環境驗收尚未完成；完整網頁工作流程屬第 9 批。
- 母版預設 `STRATEXEC_DEPLOYMENT_TARGET_MODE=disabled` 與 `STRATEXEC_SECRET_MANAGER_MODE=disabled`，不會因啟動本機服務就進行雲端寫入。
