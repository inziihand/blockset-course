# App Deployment Agent 第 6 批驗收證據

日期：2026-09-18
範圍：獨立 Deployment Agent 安全控制平面、部署授權、不可變 approval、持久 job／event、lease、冪等、UNKNOWN reconciliation 與 evidence。
外部變更：未建立 service account、未修改 IAM、未啟用 API、未建立／更新／刪除 GCP 或 Firebase 資源，未建置映像、未部署 runtime、未切換流量。

## 已完成

- 建立獨立 `tools/deployment-agent` workspace；不擴張 loopback Package Agent，也不接受 shell、Docker 或 `gcloud` 字串。
- Firebase ID Token 先向 Identity `/me` 驗證 active verified admin，再由 `/api/identity/v1/admin/deployment-access/{appKey}` 複驗 App 安裝管理權。新 App 可明確回傳 `appState=new`，受保護核心 App fail closed。
- 建立 installation-scoped deployer identity plan，固定 attached service account／Workload Identity、IAM role allowlist 與 `keyFilesAllowed=false`；service-account private-key JSON 會被拒絕。
- 提供 `inspect`、`plan`、`approve`、`apply`、`verify`、`rollback`、`reconcile`、events 與 evidence API，契約位於 `contracts/deployments/openapi.json`。
- Approval 綁定 plan fingerprint、package SHA-256、精確版本、完整風險確認、操作者與期限。Plan 或 package identity 改變、核准逾期後必須重新檢視與核准。
- Job snapshot 與單調 audit events 以同一份原子檔持久保存；Windows replace 使用 backup／restore，程序中斷可從 transient state 進行 read-only reconciliation。
- Apply／verify／rollback 使用 installation 排他 lease、心跳與固定 idempotency key。逾時或外部結果不明進入 `unknown`，並持有不確定租約；只有原 job 的 reconcile 能解除，其他 job 不會因短租約逾時而取得 installation。
- Policy 固定 target、IAM role、operation、request size、timeout、approval TTL、job 與 event 容量；executor 僅收到 allowlisted normalized fields，不含 Firebase token、秘密值、完整環境變數或原始憑證。
- Evidence 只保留操作者、時間、package／artifact digest、plan fingerprint、revision、operation id 與結果；敏感欄位、Bearer token 與常見秘密輸出會被拒絕或遮罩。

## Fail-closed 測試

- member、disabled／unverified admin、Identity unavailable、App deployment access denied。
- `development-unsigned`／blocked plan、target 或 IAM role 不在 allowlist、正式 target driver 不存在。
- approval 欄位不一致、風險確認不完整、approval 逾期、plan fingerprint 改變。
- 重複 apply、同 installation 並行 apply、程序中斷、executor timeout 與 UNKNOWN。
- UNKNOWN 後先 reconcile；沒有判定 `absent` 前不會重新 apply，其他 job 也無法跨過不確定租約。
- plan 試圖夾帶 `secretValue`，以及 service-account private-key JSON。

## 驗證結果

```text
npm test
  installer / contract tests: 34 passed
  Console tests: 194 passed
  market-data-demo tests: 18 passed
  app-package-agent tests: 11 passed
  deployment-agent tests: 19 passed
  total: 276 passed

npm run test:backend
  Identity / backend tests: 22 passed

npm run check:backend
  Ruff and Identity OpenAPI drift: passed

npm run build
  App / Service / installer checks: passed
  Console production build: passed
  Node service syntax builds: passed

Local Deployment Agent
  http://127.0.0.1:8183/healthz: 200 JSON
  unauthenticated job request: 401 JSON
  executorMode: disabled-until-target-driver
```

## 狀態界線

| 狀態 | 本批結果 |
| --- | --- |
| Source installed | 平台 repository 已加入第 6 批控制平面來源碼 |
| Deployment planned | 可建立受限 deployment job；實際 target driver 不存在時 job blocked |
| Runtime deployed | 否 |
| Runtime verified | 否 |
| App enabled | 無變更 |

第 6 批只證明安全控制面與離線 adapter 狀態機。實際 service account／IAM 建立、外部 durable store、Cloud Build、Artifact Registry、Cloud Run revision、Hosting route 與健康驗收仍屬後續批次；不可把本證據描述成任何客戶環境已部署。
