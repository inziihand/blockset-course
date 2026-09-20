# 部署目標決策規格

本文件供開發者與 AI 在移植至不同客戶／GCP project 時選擇部署目標。它定義建議與限制，不代表已建立雲端資源。公開母版只追蹤 installation example；實際選擇寫在被 Git 忽略的 `*.local.json` 或 repository 外的私人 installation overlay。真正發布完成還必須另有 revision、image digest 與線上驗收紀錄。

## 預設安裝對象：不依賴 AI 的分階段精靈

母版預設使用者可能不熟悉 Firebase、GCP、Docker、IAM 或命令列，也可能沒有 AI Agent。跨平台 `npm run setup`、Windows 相容 `install.ps1` 與正式 `deploy.ps1` 必須自行完成可安全自動化的工作，不得要求使用者拼湊指令；AI Agent 只作可選的診斷與協作工具。

分階段安裝／部署的契約如下：

1. 腳本先執行唯讀 preflight，確認 CLI 登入身分、project、billing、API、region、Firebase、Docker／Cloud Build 與既有資源，不因資源已存在就重複建立。
2. 腳本從 installation manifest 取得非機密設定；缺少管理員信箱、正式網域或部署授權時，只詢問完成安裝所需的最少資料。
3. `STRATEXEC_BOOTSTRAP_ADMIN_EMAILS` 由使用者在安裝當次選定，禁止寫進 `.env.example`、installation manifest、Git、前端 `VITE_*` 或命令輸出。腳本必須把它設定到 Identity API 的 server-only runtime；只寫入本機 `.env.local` 不算完成正式部署。
4. 部署腳本依 Service fragments 產生的 `services.json > deployment` 選擇與建置服務，處理必要 API、Artifact Registry、service account、IAM、Hosting rewrite、Firestore Rules／indexes 與 runtime environment；不得跳過 readiness blocker。
5. 帳務連結／啟用、OAuth consent、公開 ingress、IAM 放寬及其他有費用或安全影響的動作，仍須在動作前取得使用者明確確認；「一鍵」不表示 AI 可代替使用者授權。
6. 中斷於人工確認後，腳本應保存不含秘密的進度並從該步繼續，不要求使用者重做已通過項目。
7. 部署完成必須自動驗證 Hosting、API health、Firebase Google 登入、Identity session、首位管理員 Firestore 角色、授權拒絕、App route 與部署 revision，產生 evidence 後才可標記 `deployed`。
8. 若任何服務為 `blocked`、管理員尚未建立或驗收失敗，腳本必須回報「部分完成／未部署」，不可宣稱部署成功。

目標使用者指令可以只有：

```text
請把 stratexec-platform 安裝到這個 GCP/Firebase project，
以 user@example.com 作為首位管理員。
```

部署腳本應自行讀取本規格及 installation manifest，先列出即將產生費用或改變安全邊界的項目，再在取得必要確認後完成部署與驗收。

## 四種狀態不得混用

| 狀態 | 來源 | 意義 |
| --- | --- | --- |
| 可支援目標 | `services.json > deployment.allowedTargets` | 程式與安全模型允許的位置 |
| 推薦目標 | `recommendedTarget` | 母版依 workload 特性提出的預設建議 |
| 客戶選定目標 | 私人 installation overlay 的 `servicePlacements` | 該安裝預計使用的位置；仍不等於已發布 |
| 已部署證據 | 環境 Runbook／evidence | 實際 project、digest、revision、route 與驗收結果 |

`runtime.production: "unassigned"` 維持母版不綁客戶資源；它可以與 `recommendedTarget` 同時存在。AI 不得把 `planned`、`candidate` 或 `recommendedTarget` 描述成已部署。

## 工作負載決策矩陣

| workloadClass | 預設目標 | 可替代 | 判斷條件 |
| --- | --- | --- | --- |
| `static-web` | Firebase Hosting | 其他靜態 Hosting | 編譯後只有靜態資產 |
| `request-http` | Cloud Run Service | VM Docker | 收到 HTTP 才工作、無本機權威狀態、可重啟／水平擴充 |
| `event-handler` | Firebase Functions 2nd gen | Cloud Run + Eventarc | Firebase／Google Cloud 事件驅動、短任務、可冪等重試 |
| `batch-job` | Cloud Run Job | VM 排程 | 執行後結束，沒有 HTTP endpoint |
| `continuous-worker` | VM Docker | 經專案驗證的 Worker Pool | 常駐 session、單例帳戶責任、本機 journal／鎖或固定硬體 |

語言不是部署條件。Node.js 與 Python 的無狀態 HTTP API 都可使用 Cloud Run；同一 OCI image 也可在 VM Docker 執行。

## AI 選擇規則

1. 先讀 `workloadClass`、`stateful`、`continuous`、授權、秘密與故障語意，再考慮成本或維運便利。
2. `request-http` 必須監聽 `0.0.0.0:$PORT`，提供 health path，且本機 cache 只能是可丟棄的最佳化。
3. `continuous-worker` 若持有 Shioaji／交易所 session、SQLite journal、主機鎖或 execution authority，不可改成會任意水平擴充的 Cloud Run Service。
4. `productionReadiness: blocked` 時只能建置／測試，不得建立 production route 或把 installation 標成 `deployed`。
5. `intendedExposure: authenticated` 但 `authorization: none` 時必須維持 blocked。
6. Firebase Functions 2nd gen 適合 Firebase 事件或小型 handler；需要同一 container 同時支援 Cloud Run 與 VM 時，以 OCI／Cloud Run Service 為可攜預設。
7. 客戶 project、region、service name、網域及帳務寫在 installation／Runbook，不得寫死在 App 或 Dockerfile。
8. Secret 只保存 resource reference；不得進 image、Git、瀏覽器 bundle、安裝描述或 command output。
9. 雲端發布、帳務啟用、IAM 放寬及公開 ingress 必須取得當次明確授權；程式完成或 build 成功不等於允許發布。
10. 建置 OCI image 時必須使用 `deployment.artifact.context` 作 build context、`dockerfile` 作 Dockerfile；不得自行改用 repo 根目錄擴大輸入範圍。
11. 不得把「請使用者到 Console 手動完成所有設定」當作預設流程；若官方 API／CLI 可安全完成，應由腳本執行並驗證。只有無法代理或需要本人同意的步驟才交還使用者。

## Backend-aware App

母版不預載 request-driven 業務 BFF。App 套件若宣告 `request-http`，必須提供 OCI build context、`0.0.0.0:$PORT`、liveness／readiness、Firebase 身分與必要的 Identity entitlement 驗證，再由 installation 選擇 Cloud Run Service 或 VM Docker。第三方資料來源必須在 App 自己的 OpenAPI 後正規化，不能成為平台隱含相依。

## Identity API 與 Account Worker

- Identity API：無狀態 HTTP，Cloud Run Service 為推薦，VM Docker 可替代；Firestore／Auth 透過執行服務帳號 ADC 存取。
- Account Worker：未來固定為 `continuous-worker`；一個 execution account 一個 Worker，首選 VM Docker。不得因 API 已在 Cloud Run 就把 Worker 一併放入同一 service。

## 操作入口

先驗證契約，再查看不含秘密的部署計畫：

```powershell
npm run check:services
npm run check:apps
npm run check:installations
npm run plan:deployment -- infrastructure/environments/customer.local.json
```

只有 `selectedTarget` 非 `unassigned`、`productionReadiness=ready`、帳務／IAM／API 已驗證，且取得發布授權後，才能執行部署命令。`scripts/deploy.ps1` 是正式部署入口，Deployment Agent 另提供 Cloud Run 與 VM Docker executor；IAM、環境相依、secret reference 與驗收由 Service fragment／App deployment manifest 宣告，不再由安裝器辨識特定服務名稱。公開母版本身不代表任何客戶環境已 apply 或已建立雲端資源。

App 與 target 的解析分成三層：`infrastructure/apps/*.json` 決定啟用 App 需要哪些服務，平台／App-local Service fragments 定義服務相依與可部署能力並產生 `services.json`，environment placement 選擇客戶目標。`scripts/deployment/drivers/` 執行 target-specific 驗證並提供 executor；Cloud Run Service 與 VM Docker 皆有通用 executor。VM Docker 另要求已 bootstrap 的 mTLS VM Agent、簽章 desired state、帳戶狀態／SQLite／備份／磁碟 preflight 及 immutable rollback；首次 VM／IAM 寫入仍需業主明確確認。見 [VM Agent 規格](VM_AGENT.md)。

批次 1～5 操作介面：

```powershell
# 第一次只完成跨平台本地安裝與測試，不部署 Cloud Run／Hosting
npm run setup

# 沿用本地安裝設定；以 Y/N 分別確認帳務資源與公開 ingress
.\scripts\deploy.ps1

# 管理員完成 Google 登入後，驗證 Firestore 並移除 bootstrap runtime secret
.\scripts\deploy.ps1 -FinalizeAdmin

# 部署後可重跑唯讀驗收
.\scripts\verify-installation.ps1 -ConfigPath .\infrastructure\environments\customer.local.json

# 預設只列出 revision；流量切換需另帶 -Revision、-Apply、-ConfirmTrafficChange
.\scripts\rollback-installation.ps1 -ConfigPath .\infrastructure\environments\customer.local.json -ServiceKey <service-key>
```

官方參考：

- [Cloud Run container contract](https://cloud.google.com/run/docs/container-contract)
- [Cloud Run resource model](https://cloud.google.com/run/docs/resource-model)
- [Firebase Hosting rewrite to Cloud Run](https://firebase.google.com/docs/hosting/cloud-run)
- [Firebase ID Token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Cloud Run maximum instances](https://cloud.google.com/run/docs/configuring/max-instances)
- [Cloud Functions 2nd gen](https://firebase.google.com/docs/functions/version-comparison)
