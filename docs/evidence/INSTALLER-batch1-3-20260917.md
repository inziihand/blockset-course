# AI Agent 安裝器批次 1～3 驗收

日期：2026-09-17。範圍：`stratexec-platform` Identity 安裝閉環；不含 Market Data、交易 API、Account Worker 或任何交易連線。

## 已完成

- `scripts/install.ps1` 提供預設 dry-run、`-Apply` 與 `-FinalizeAdmin` 三階段入口。
- dry-run 唯讀確認 CLI 登入、project、billing、API、installation placement 與服務 readiness。
- apply 需要分開提供 `-ConfirmBillableResources` 與 `-ConfirmPublicIngress`，缺少任一旗標即 fail closed。
- Cloud Build 使用 `backend` build context 建置 Identity image，Artifact Registry 保存 image，Cloud Run 使用專用 runtime service account。
- bootstrap 管理員透過短期 Secret Manager version 注入 server-only runtime；不寫入 installation manifest、Git、前端 bundle、安裝 state 或一般輸出。
- Firebase Hosting 設定由 installation 與 service registry 產生；只包含 `productionReadiness=ready` 的 Identity route，blocked Market Data 不會取得 route。
- Google 登入後，Console 自動以 ID Token 呼叫同源 Identity session，建立／同步 Firestore member。
- finalize 由 Firestore server-side query 驗證 active admin 後，移除 Cloud Run secret、停用 secret version、清空本機 bootstrap 值並保存不含秘密的 evidence。
- `.stratexec/installations/<key>/state.json` 保存可續跑 checkpoint；image build 或 Identity deploy 完成後可從最近階段繼續。

## 本機驗證

- PowerShell parser：`scripts/install.ps1` 無語法錯誤。
- 私人參考環境 dry-run：正確回報 billing disabled，缺少 Artifact Registry、Cloud Build、Cloud Run、Secret Manager API；沒有修改雲端或本機檔案。
- apply safety smoke：缺少 `-ConfirmBillableResources` 時在第一個 mutation 之前停止。
- Installer contract tests：5/5。
- Hosting renderer：Identity rewrite 在 SPA fallback 前，blocked Market Data route 不會輸出。
- Console production build 通過；登入後 session client 的 token、拒絕與格式測試已加入。

## 尚未執行

- 私人參考環境的 Cloud Billing 仍停用，因此未啟用付費 API、未觸發 Cloud Build、未建立 Artifact Registry／service account／secret／Cloud Run revision，也未部署 Hosting。
- 尚未執行真實 Google 登入、Firestore admin 驗證與 finalize；這些只能在帳務與公開 ingress 取得當次明確授權後進行。
- Market Data 保持 blocked，不在批次 1～3部署範圍。
