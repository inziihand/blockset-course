# 共用資料與 API 契約草案

版本：設計 v0，2026-09-16。P1 才建立可驗證模型及 OpenAPI；本文件不是已上線 API。

## 1. 共用原則

- 所有私有 API、Command、Snapshot 都帶不透明 `account_key` 與環境，後端再驗證使用者對該帳戶的權限。
- 十進位價格、數量、金額在 JSON 用字串傳遞，Python 用 Decimal。TAIFEX quantity 必須為正整數口，部位則明確區分多空。
- 時間存 UTC／ISO 8601；顯示時區可設定，台指期預設 `Asia/Taipei`。`trading_date`、`session_id` 與日曆日期分開。
- `null` 表示未知或未提供，不能當成 0。所有報價與帳戶資料都帶來源、觀測時間及完整性。
- Adapter 私有擴充不滲入策略；新增欄位優先採可選擴充，不把各券商 raw JSON 丟給前端判斷。

## 2. 資料模型

| 模型 | 必要欄位／語意 |
| --- | --- |
| AccountScope | `broker_id`、`environment`、`broker_account_ref`、`account_type`、可選 `partition_ref`；原始帳號只留服務端 |
| Environment | `REPLAY`、`PAPER`、`LIVE`；另存 `provider_environment`，例如 Shioaji simulation、Deribit testnet |
| InstrumentSpec | `instrument_id`、`venue`、`asset_class`、`product_code`、`underlying_id`、`expiry_at`、數量與價格單位、tick、乘數、幣別、calendar、估值模型 |
| BrokerInstrumentBinding | instrument 對應的 SDK code、full code、delivery date、解析時間與版本；委託保存當次確定的綁定 |
| Quote | bid／ask、last、各自數量、事件／接收時間、session、`quality`；不能用 last 或 mark 冒充可成交價格 |
| OrderRequest | `intent_id`、scope、run／操作者、instrument、BUY/SELL、正數 quantity、price type、limit、TIF、position effect、策略設定版本 |
| OrderRecord | 內部 ID、券商 ID 綁定、原始及有效數量、累積成交／取消／剩餘、狀態、獨立改撤單請求、更新時間 |
| Fill | 帳戶、委託、券商成交去重鍵、instrument、方向、成交數量／價格、費用／稅與幣別、交易日、事件／接收時間 |
| Position | instrument、多／空 side 與正 quantity、可平數量、均價／結算基準、ownership、觀測時間；多空並存時不只存淨額 |
| AccountSnapshot | 部位、未結委託、資金、保證金、資料涵蓋區間、完整性／各項觀測時間；缺頁或查詢失敗不得視為空帳戶 |
| StrategyRun | strategy ID、run ID、帳戶、已接受設定版本、生命週期、checkpoint、已歸屬的 intents／fills |
| RuntimeSnapshot | 下節的狀態、原因、能力、階段、版本與時間；Worker 是唯一產生者 |

`environment` 必須和實際端點一致。正式帳戶的唯讀登入仍是 `LIVE`，不能因禁止送單就標為 PAPER；Fake Broker 標為 REPLAY，不能宣稱完成券商模擬驗收。

InstrumentSpec 對 option 的 strike／right／exercise style 為條件欄位；估值模型明示線性或反向。V1 只實作 TAIFEX 線性期貨，其餘類別保留介面，不宣稱全部通用。

## 3. 委託語意

`price_type`：`LIMIT`、`MARKET`、`MARKET_WITH_PROTECTION`。`time_in_force`：`SESSION`、`IOC`、`FOK`，後續按能力擴充。

`position_effect`：`OPEN`、`CLOSE`、`AUTO`。`reduce_only_required` 是額外的結果約束，不以 CLOSE 或 AUTO 冒充交易所原生 Reduce-only。台指期平倉優先使用經實測的平倉指示；詳見 [台指期規格](TAIFEX_SHIOAJI.md)。當沖是獨立政策／能力，V1 不啟用。

多腿以獨立 `MultiLegOrder` 擴充，包含各腿方向、ratio、淨價與 native／synthetic 路徑。V1 不把兩個單腿偽裝成具原子成交保證的 Combo；台指期 MVP 不以 Combo 完成為依賴。

委託狀態至少包含：

```text
INTENT_RECORDED → SUBMITTING → ACKNOWLEDGED → PARTIALLY_FILLED → FILLED
                      │              └→ CANCELLED / EXPIRED
                      ├→ REJECTED
                      └→ UNKNOWN → RECONCILING → 券商證據確認的狀態
```

- 部分成交後取消，狀態可為 CANCELLED，但已成交數量與部位必須保留。
- 改價／減量／撤單本身另有 request ID、pending／succeeded／rejected／unknown 結果；撤單拒絕不代表原委託拒絕或消失。
- 取消等待期間仍可能成交；計算剩餘量要先納入新增成交，不以取消呼叫成功當作零掛單。
- 晚到成交可補全已結束委託的成交證據，不能用單純 enum 大小判定能否接受事件。
- 對「查不到」必須保留查詢涵蓋期間與券商證據；沒有結果不一定證明從未送單。
- 內部 `intent_id` 提供平台去重；券商是否支援送單冪等是另一個能力。不得承諾端到端 exactly-once。

## 4. BrokerCapabilities

每項能力記錄 `SUPPORTED`／`UNSUPPORTED`／`UNVERIFIED` 及 SDK 版本、環境、適用商品、實測證據。未驗證視為不可使用。

必要項目：supported asset classes、simulation、session calendar、order price/TIF 合法組合、open/close 指示、native reduce-only、client ID 回查與冪等、修改／取消、歷史查詢範圍、回報重播、native multi-leg、margin estimate、原生條件單。

能力按具體組合判斷，例如「期貨有 IOC」不表示所有價型、盤別及模擬／正式環境都可用。平台政策再從已驗證能力選擇允許集合。

## 5. Adapter 邊界

| Port | 責任 |
| --- | --- |
| BrokerSession | 登入、驗證指定帳戶、憑證狀態、訂閱、重新連線與關閉 |
| InstrumentCatalog | 真實契約清單、單位及 SDK 綁定 |
| MarketData | 報價、事件時間、資料新鮮度與訂閱生命週期 |
| Trading | submit／amend／cancel，回傳已確認或結果不明，無策略判斷 |
| AccountReader | 資金、所有方向部位、委託與成交完整查詢，明示涵蓋範圍 |
| CalendarProvider | 交易日、盤別、下個交易時段、到期與休市例外 |

交易 callback 先正規化，再進入帳戶事件佇列。帳戶身份不符、未知 enum／單位、無法歸屬回報都是顯式問題，不默默忽略。

## 6. Runtime 與燈號

Worker 保存 `desired_state`、`run_state`、`phase`、`phase_status`、`health`、`session_state`、`reconciliation_state`，一次產生一致的畫面投影。這些欄位表達不同維度，不各自從不同 API 組合。

投影必須包含 `account_key`、`environment`、`strategy_id`、`run_id`、`worker_epoch`、持久遞增 `snapshot_seq`、`applied_revision`、`observed_at`、`last_strategy_evaluation_at`、帳戶／行情資料時間、原因碼及可執行動作。

| 實際狀況 | 列表燈號與說明 | 管理部位階段顯示 |
| --- | --- | --- |
| 正常運作且資料有效 | 綠：運作中 | 管理部位 |
| 策略啟用但正常休市 | 藍：等待開盤 | 等待交易時段 |
| 可恢復行情／連線異常 | 黃：恢復中 | 管理部位暫停，顯示原因 |
| 對帳不符／未知委託 | 紅：需要處理 | 管理部位受阻 |
| 策略已停止 | 灰：已停止；若有曝險另顯示警告 | 停止自動管理／仍有部位 |
| 快照過期或未知版本 | 灰：狀態未知，顯示最後回報時間 | 最後階段只作歷史，不宣稱持續管理 |

Execution capabilities 分為 `can_open`、`can_close`、`can_cancel`；每項有拒絕原因。V1 對帳不明時自動交易全部關閉，人工處理需可驗證的明確目標及命令，不以「緊急」跳過未知曝險。

UI 的 phase、燈號與標題共用一個 selector。切帳戶清除舊帳戶資料並中止舊請求；回應的 scope 不符就丟棄。同帳戶丟棄較舊 snapshot_seq；新 Worker 的 epoch 由 API／持久序號校驗，不能靠到達時間覆蓋。

## 7. API 草案

| 路徑 | 行為 |
| --- | --- |
| `GET /api/v1/accounts` | 已授權的帳戶、券商、環境與能力 |
| `GET /api/v1/accounts/{key}/snapshot` | Worker 權威投影與 freshness |
| `GET /api/v1/accounts/{key}/orders` | 正規化委託、成交、改撤單結果 |
| `GET /api/v1/accounts/{key}/strategies` | 可用策略與相容能力 |
| `POST /api/v1/accounts/{key}/commands` | 建立冪等 Command；202 只代表收件 |
| `GET /api/v1/accounts/{key}/commands/{id}` | 命令接受、套用及最終結果 |

Command kinds：`START_STRATEGY`、`STOP_STRATEGY`、`FLATTEN_AND_STOP`、`RECONCILE`、`SUBMIT_MANUAL_ORDER`、`CANCEL_ORDER`。最後兩者與策略互斥／協調政策由 Worker 執行，API 不建立 SDK session。

V1 用有條件的輪詢，不另建推播服務。FastAPI 模型是 API schema 唯一來源；OpenAPI 匯出至 `contracts`，TypeScript Client 由工具產生。穩定原因碼與 capability 模型包含在 schema，文字翻譯留在 UI。
