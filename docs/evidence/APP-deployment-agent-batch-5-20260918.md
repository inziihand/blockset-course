# App Deployment Agent 第 5 批驗收證據

日期：2026-09-18
範圍：上傳 App 的唯讀 runtime impact plan、GCP／Firebase inventory、drift 與部署影響分析。
外部變更：未啟用 API、未修改 IAM、未建立／更新／刪除 GCP 或 Firebase 資源，未部署 runtime，未切換流量。

## 已完成

- 從已驗證 ZIP 的機器契約建立 normalized runtime impact plan，不把 `DEPLOYMENT.md` 當可執行輸入。
- Plan 分別列出 App files、Services、Hosting routes、secret references 與 cloud resources 的 `add`／`update`／`retain`／`remove`／`unknown`。
- 每個 Service 顯示 target、region、CPU、memory、min／max instances、ingress、公開入口、cost tier 與 downtime impact。
- `planned`、contract `ready`、inventory `deployed` 與 post-deployment `verified` 分成獨立欄位；唯讀 plan 不推論部署或驗收成功。
- 新增 GCP／Firebase read-only collector 與 normalized inventory schema。Collector 固定使用 list、describe、get-iam-policy 與 Hosting GET，不含 mutation 動詞。
- Drift 包含 missing resource、configuration drift 與 unexpected App-owned resource；inventory partial／unavailable 時 fail closed。
- 列出 required APIs、Deployment Agent IAM roles、runtime service-account roles；plan 不啟用 API 或授權。
- 設定／秘密只回傳名稱、用途、驗證、reference 與存在狀態，不回傳值。
- Deployment manifest migration 增加 reversible、backupRequired 與 maintenanceWindow，並在 plan 顯示 rollback 與 blocker。
- 新增管理員驗證的唯讀 API：`GET /api/app-packages/v1/jobs/{jobId}/deployment-plan?installationKey=<key>`；呼叫不寫入 job 或雲端。
- Plan fingerprint 綁定 source plan、deployment contract、installation 與完整 inventory snapshot。

## 驗證結果

```text
npm test
  installer / contract tests: 32 passed
  Console tests: 194 passed
  market-data-demo tests: 18 passed
  app-package-agent tests: 11 passed
  total: 255 passed

npm run build
  App / Service / installer checks passed
  TypeScript and CSS boundary checks passed
  Vite production build passed
  market-data-demo and app-package-agent syntax builds passed

Fixed fixture coverage
  deterministic fingerprint: passed
  GCP/Firebase inventory normalization: passed
  read-only command allowlist: passed
  drift / API / IAM gaps: passed
  authenticated plan API and OpenAPI route: passed

Local Package Agent
  restarted on 127.0.0.1:8182
  GET /healthz: 200 JSON
  unauthenticated deployment-plan request: 401 JSON
```

## 私人參考環境唯讀盤點

執行：

```text
npm run inventory:deployment -- <installation.json>
```

結果為 `partial`：成功讀到部分 project metadata、39 個 enabled API、目前 principal 的一個 project role 與三個 normalized resources；Artifact Registry、Cloud Run、Firebase Hosting sites、Firebase project 與 Secret Manager inventory 目前不可讀。Snapshot 位於被 Git 忽略的 `.stratexec/deployment-inventory/<installation-key>.json`，不含 access token、secret value 或服務帳號 key。

股票行情 Demo 的實際 unsigned ZIP smoke plan 結果：

```text
decision: blocked
signatureStatus: development-unsigned
inventoryStatus: partial
market-data-demo:
  planState: planned
  contractReadiness: ready
  observedDeployment: unknown
  verificationState: unverified
  selectedTarget: cloud-run-service
  costTier: low-variable
```

此結果符合 fail-closed：第 5 批能列出影響，但不會把部分 inventory、靜態 ready 或 planned placement 誤報成 deployed／verified。

## 狀態界線

| 狀態 | 本批結果 |
| --- | --- |
| Source installed | 未套用新的外部 App；平台程式加入 plan／inventory 能力 |
| Deployment planned | 已完成唯讀 normalized plan 能力；私人參考環境 smoke plan 因 unsigned package 與 partial inventory 而 blocked |
| Runtime deployed | 否 |
| Runtime verified | 否 |
| App enabled | 無變更 |

下一階段是第 6 批正式 Deployment Agent 安全控制平面。第 5 批沒有 approval、apply、雲端寫入、健康驗收或啟用能力。
