# Deployment Agent 第 7 批驗收證據

日期：2026-09-18

## 範圍與狀態

- 工作樹：`stratexec-platform`，以 `8124181` 為修改基線；本文件記錄尚未提交的第 7 批差異。
- 已完成 schema-driven 一般設定、秘密與高影響欄位，並在「會員與權限 → App 管理」提供非受保護 backend-aware App 的設定入口。
- 已完成獨立 settings store、受保護 Deployment Agent API、GCP Secret Manager adapter、既有 reference、新版本／rotation、停用、rollback reference 與刪除確認。
- 已以 app、installation、environment 與 service scope 產生命名與標籤；runtime binding 只包含 deployment manifest 已宣告的設定與具體 secret version reference。
- 設定／秘密 reference fingerprint 會納入 approval；異動後舊 approval 失效。
- 股票行情 Demo 提供三個可操作一般設定，其中每會員限流屬高影響設定，並實際接到 Market Data runtime。
- 平台 bootstrap／OAuth 摘要與 App 設定分離，不會要求後續 App 重填平台級資料。

## 安全界線

- 秘密值只存在於單次受保護請求與 Secret Manager create-version 呼叫；API 回應、本機 state、job、event 與 evidence 只含 resource／version metadata。
- GCP driver 不提供 access secret payload 的操作；刪除、停用與 rollback 均為獨立 API，其中刪除需精確確認。
- 母版預設 `STRATEXEC_SECRET_MANAGER_MODE=disabled`；測試 fake adapter 不保存秘密明文。
- 本批沒有啟用客戶 API、修改 IAM、建立 Secret Manager secret、部署 runtime 或切換流量；任何客戶環境均未被修改。
- 正式 keyless Agent 寫入、Cloud Run runtime secret 注入及客戶環境端到端驗收屬第 8 批。

## 驗證

- `npm test`：通過；安裝器 34、Console 196、Market Data 19、Package Agent 11、Deployment Agent 28，共 288 項測試。
- `npm run build`：通過；App／installation／Service／installer 檢查、Console TypeScript 與 Vite production build、Market Data／Package Agent／Deployment Agent 語法檢查均成功。
- `git diff --check`：通過；只有 Windows checkout 的 LF→CRLF 提示，沒有 whitespace error。
- production bundle 搜尋測試秘密字串、private-key header 與 OAuth code pattern：無命中。
- 新增失敗路徑測試，確認 Secret Manager 拒絕寫入時也會清零 caller buffer；該補強後另重跑 Deployment Agent 測試與 build。

上述均為本機程式與離線 fixture 驗證，不得描述為已部署。

## 未解項目

- 第 8 批：受限建置、immutable image、正式 Secret Manager 寫入與 runtime mount、Cloud Run staged revision、健康／授權驗收、Hosting route／流量切換及回滾。
- 第 9 批：完整管理介面生命週期與遠端工作狀態。
- 第 10 批：VM Docker／常駐 Worker target driver。
