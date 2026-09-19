# StratExec Deployment Agent

第 6～10 批的獨立安全控制平面。它不接收 shell 字串，也不沿用 loopback Package Agent 的 source apply 權限。

本批提供：

- Firebase ID Token 驗證，以及 Identity API 對 active verified admin 與目標 App access 的伺服器端複驗。
- `inspect`、`plan`、`approve`、`apply`、`verify`、`rollback`、`reconcile` job API。
- 不可變 approval：綁定 package digest、版本、plan fingerprint、完整風險確認與期限。
- installation 排他 lease、心跳、固定 idempotency key、UNKNOWN reconciliation 與啟動復原。
- 安裝環境專屬 deployer service-account 規劃；只允許 attached service account／Workload Identity，不接受 JSON key。
- allowlist target、IAM role、操作與容量／timeout 邊界，以及不含 token／秘密／環境變數的 evidence。

母版預設 executor 模式為 `disabled-until-target-driver`，不會對 GCP／Firebase 寫入。明確設定 `gcp-cloud-run` 時使用第 8 批 staged revision／promotion；設定 `gcp-vm-docker` 時使用第 10 批外部 Ed25519 signer 與 mTLS VM Agent client。VM target 只接受單一 `continuous-worker`，交易模式固定 disabled。

本機啟動：

```powershell
npm run dev:deployments
```

本機控制面固定只綁定 `127.0.0.1:8183`，並拒絕 generic `PORT`。真實客戶 target 還必須具備外部 durable store、受管身分、入口保護與當次部署授權；測試 fixture 不代表雲端已建立。
