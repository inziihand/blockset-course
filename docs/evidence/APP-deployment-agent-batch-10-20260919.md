# App Deployment Agent 第 10 批驗收

日期：2026-09-19

## 完成內容

- 新增獨立 `tools/vm-agent` workspace：TLS 1.3 mTLS server、Ed25519 desired-state trust、generation／expiry 驗證、持久 state／event、固定 Docker runtime 與 read-only reconciliation。
- desired state 使用嚴格欄位 allowlist，遞迴拒絕 `shell`、`command`、`args`、`entrypoint`、script 與 hook；映像必須是完整 `@sha256:` URI。
- 定義一次性 VM bootstrap plan：IAP、OS Login、attached VM identity、無 SSH／service-account key、mTLS certificate rotation 與撤銷順序；首次 VM／IAM 寫入要求業主精確確認。
- 新增 Deployment Agent `gcp-vm-docker` target：外部 Ed25519 signer、mTLS client、Cloud Build immutable image、簽章 desired state、runtime verify、UNKNOWN reconcile 與前一 digest rollback。
- VM Agent 在寫入前核對 mTLS／lease、單帳戶 Worker／host lock、委託數、部位 fingerprint、外部曝險、UNKNOWN、SQLite schema、驗證備份、磁碟與策略停止狀態；不一致即 fail closed。
- VM host 只以固定 Docker argv 執行非 root、read-only root filesystem、drop all capabilities、no-new-privileges、有界日誌與 persistent volume；固定覆寫交易與策略自動啟動為 disabled。
- 一般設定進入簽章 desired state；秘密只傳遞同 project 的具體 Secret Manager version reference，由 VM attached identity 讀取並寫入 root-only `runtime.env`，記憶體 buffer 隨即覆寫。
- 唯讀 GCP inventory 新增 GCE instance／persistent disk；normalized plan 綁定 host、account scope、SQLite／委託／部位、備份與磁碟安全輸入。
- 管理 UI 顯示 VM／Agent／Worker／策略四層狀態與「交易未授權」，並加入 VM bootstrap、帳戶／備份、交易仍停用三項風險確認。
- 新增 VM Agent OpenAPI、trust schema、Service／installation 契約及操作文件。

## 驗證命令與結果

```text
npm test
  scripts / installer: 35 passed
  Console: 199 passed
  market-data-demo: 19 passed
  app-package-agent: 11 passed
  deployment-agent: 45 passed
  vm-agent: 7 passed
  total: 316 passed

npm run build
  configuration / App / installation / Service / installer checks: passed
  Console TypeScript + Vite production build: passed
  market-data-demo syntax build: passed
  app-package-agent syntax build: passed
  deployment-agent syntax build: passed
  vm-agent syntax build: passed
```

主要新增測試涵蓋：簽章篡改／撤銷、禁止交易與 shell、外部曝險／UNKNOWN／lease fail-closed、immutable Docker argv、設定／秘密 reference、buffer wipe、VM inventory、bootstrap plan、deploy／verify／rollback executor，以及響應式四層 UI。

## 五段狀態

| 狀態 | 本批結果 |
| --- | --- |
| source installed | 母版 source 已新增第 10 批模組；沒有安裝任何客戶 App ZIP |
| deployment planned | `vm-docker` 契約、唯讀 inventory、bootstrap plan 與 executor 已完成離線驗證 |
| runtime deployed | 未部署；沒有建立或修改任何客戶 VM／IAM／certificate／container |
| runtime verified | 僅 fixture／fake adapter 驗證；沒有客戶 VM evidence |
| App enabled | 未啟用任何 App |
| PAPER／LIVE trading | 未授權、未登入券商、未送出交易；VM desired state 強制 disabled |

## 未執行的外部驗收

- 沒有對任何 GCP project 啟用 API、建立 VM、persistent disk、service account、IAM、Secret Manager version 或 mTLS certificate。
- 母版目前沒有 active 的 Account Worker／DeriStrat App manifest；第 10 批只提供通用安裝契約與執行器。
- `STRATEXEC_DEPLOYMENT_TARGET_MODE`、Secret Manager mode 與 VM Agent runtime 預設保持 `disabled`。
- 真實驗收需由某一客戶 installation 與已簽章 Worker App 提供：業主 bootstrap 確認、GCP 建置證據、Agent mTLS、Worker safety snapshot、備份還原、版本部署／回滾及 PAPER／LIVE 之外的獨立交易授權證據。
