# VM Agent 與持續執行型 App

第 10 批為 `continuous-worker`／`vm-docker` 提供不需日常 SSH 的部署通道。它不把 DeriStrat、券商憑證或交易策略放進母版，也不表示任何客戶 VM 已建立。

## 信任與 bootstrap

首次建立 VM 或擴張 IAM 必須由業主輸入精確的 `BOOTSTRAP VM <installation> <instance>` 確認。bootstrap plan 固定採用：

- GCP IAP TCP forwarding 與 OS Login；不建立、交換或上傳 SSH 私鑰。
- VM attached service account；不允許 service-account JSON key。
- Deployment Agent 到 VM Agent 使用 TLS 1.3 mutual TLS；server／client certificate 以版本化 Secret Manager resource 管理。
- VM Agent 只信任 `vm-agent-trust.json` 中狀態為 `trusted` 的 Ed25519 desired-state public key。
- 撤銷順序為停用 client certificate version、將 desired-state key 標為 `revoked`、必要時停用 VM service account。已撤銷 key 不可用本機 override 繞過。

`createVmBootstrapPlan` 只產生宣告式 plan；實際建立 VM、IAM 或憑證仍屬有費用／安全影響的外部寫入，必須在當次取得業主確認並留下 evidence。

## App／installation 契約

`continuous-worker` Service 必須在自己的 Service fragment 宣告：

```json
{
  "workloadClass": "continuous-worker",
  "recommendedTarget": "vm-docker",
  "stateful": true,
  "continuous": true,
  "vmDocker": {
    "agentTransport": "mtls",
    "desiredStateSignature": "Ed25519",
    "immutableImage": true,
    "hostLocalAccountLock": true,
    "persistentData": true,
    "preflight": {
      "accountUniqueness": true,
      "ordersAndPositions": true,
      "sqliteSchema": true,
      "backup": true,
      "diskSpace": true,
      "reconciliation": true
    },
    "rollback": { "previousImmutableImage": true, "preserveData": true }
  }
}
```

客戶 installation 的 `servicePlacements[].targetConfig` 另提供客戶／帳戶特定值：`hostRef`、private `agentUrl`、`persistentDataPath`、`accountScope`、`allowedSqliteSchemaVersions`、`expectedOpenOrders`、`expectedPositionFingerprint`、`minimumFreeBytes`、`backupMaxAgeSeconds` 與非 root `runAsUser`。它們會納入 plan fingerprint；狀態改變後必須重新 plan／approve，不能沿用舊確認。

## Desired state 與 host runtime

Deployment Agent 只送出有效 15 分鐘內、generation 單調遞增的簽章 desired state。內容只有已知欄位與 immutable OCI digest，不接受 `shell`、`command`、`args`、`entrypoint`、script 或 hook。

VM Agent 在任何 Docker 寫入前驗證：

1. VM bootstrap identity、mTLS 與 Agent lease。
2. 一個 account scope 最多一個 Worker，host-local `account.lock` 不屬於其他帳戶。
3. 委託數與部位 fingerprint 等於已審查快照，沒有外部曝險或 UNKNOWN write，對帳一致。
4. SQLite schema 在 allowlist、磁碟空間足夠，且有時效內的驗證備份。
5. 策略為 `disabled`／`stopped`。

通過後只以固定 `docker` argv 拉取與啟動 digest image：非 root、read-only root filesystem、drop all capabilities、no-new-privileges、私有 `runtime.env`、有界本機日誌，以及固定覆寫 `STRATEXEC_TRADING_MODE=disabled`、`STRATEXEC_STRATEGY_AUTOSTART=false`。不會執行套件提供的 shell。

回滾也是新的簽章 desired state，只能指向部署 evidence 已保存的前一個 immutable image；資料 volume 不回退、不刪除。若 Agent 斷線、lease 過期、操作結果不明、外部曝險或對帳矛盾，工作進入 `unknown`／`blocked`，只能先 reconcile，不能盲目重送或清除 SQLite／鎖／部位。

## 四層狀態與交易界線

管理介面分開顯示：

- VM：主機與 persistent volume。
- Agent：mTLS、lease 與 desired-state generation。
- Worker：容器、健康、SQLite／鎖及帳戶對帳。
- 策略：`disabled`、`stopped` 或獨立交易 runtime 狀態。

App source installed、Worker image deployed、runtime verified、App enabled 與 PAPER／LIVE trading authorization 是五件不同的事。第 10 批只完成前三者與網頁狀態／回滾通道；App 啟用仍走 Identity verified activation，交易仍需獨立 PAPER／LIVE 授權與驗收。
