# DeriStrat 移植部署藍圖

狀態：規劃文件；尚未成為母版 App manifest，也沒有可部署的母版服務。此文件不能當作已移植、已安裝或已連線交易所的證據。

## 建議拆分

| 單元 | workloadClass | 建議目標 | 原因 |
| --- | --- | --- | --- |
| React 控制台 | `static-web` | Firebase Hosting | 靜態 UI，沿用 Platform Shell |
| Control API | `request-http` | Cloud Run Service | 無狀態 HTTP、Firebase ID Token／角色授權 |
| 狀態／命令通道 | managed state | Firestore | 控制命令與 runtime 投影，不作交易日誌權威 |
| Account Worker | `continuous-worker` | VM Docker | 長連線、單帳戶單例、SQLite journal、主機鎖與 execution authority |

需要 VM 的理由不是「有 WebSocket」本身，而是 Worker 必須持續持有交易所 session、帳戶單一執行責任、本機持久日誌與鎖，且不能被任意水平擴充或 request-driven runtime 回收。

## 建立可安裝 manifest 前的必要工作

1. 將前端接入 `apps/console/src/apps/<app-key>/` 與 Shell Registry。
2. 將 Control API 與 Account Worker 分成服務清冊項目；不可把 Worker 包進 Cloud Run API。
3. 為 API 建立 `/api/<domain>/v1/**` OpenAPI，為 Worker 建立 OCI image、health、持久 volume、秘密只讀掛載及單例驗收。
4. 完成 VM driver 的 host bootstrap、Artifact Registry pull、Docker lifecycle、持久資料備份、health、journal 保全與回滾 executor。
5. 服務仍為 blocked 時，App manifest 不得加入 production installation；離線／Testnet／正式唯讀／正式交易證據分開。

完成以上項目後，才新增 `infrastructure/apps/<app-key>.json`，以 `requiredServices` 連結 Control API 與 Account Worker，再由 installation 的 `servicePlacements` 決定各客戶部署到 Cloud Run 或指定 VM。
