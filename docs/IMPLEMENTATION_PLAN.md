# 分階段實施清單

更新：2026-09-16。第一市場：TAIFEX；第一券商：永豐金 Shioaji。

**P0 已完成；P1 部分完成（React App 承載、顯示契約、共用前端基礎及離線 Demo），P2～P9 尚未實作。** 本文件中的驗收條件是未來完成標準，不是測試結果。新平台使用 P 編號，避免與舊 DeriStrat 第 1～12 階段混淆。

前端平台的細部工作另見 [前端平台 Codex 任務清單](FRONTEND_PLATFORM_TASKS.md)，分四批追蹤，不重複維護核取狀態，也不取代本文件的後端／交易驗收。

App ZIP 上傳後的自動化後端部署另見 [App 自動化安裝與 Deployment Agent Codex 工作清單](APP_DEPLOYMENT_AGENT_TASKS.md)。該清單延續既有 App 套件第 1～3 批；Deployment Agent 第 4～10 批的 Cloud Run／VM 離線控制平面、網頁生命週期與 host adapter 已完成。這不是客戶雲端部署證據，亦不代表交易核心 P1～P4 已實作。

## 完成判準

- 每階段需附變更摘要、測試結果與未解問題，才能勾選完成。
- 離線、券商模擬、正式唯讀、正式交易分別留下證據，不能互相替代。
- 所有驗證策略明示「測試用途」，不代表已有可正式交易的進出場規則。
- 沒有券商帳戶／憑證時，繼續完成離線工作，將實際連線驗收保持待辦。

## P0：規劃與骨架（已完成）

- [x] 確認台指期優先及永豐金 Shioaji。
- [x] 建立 Monorepo 目錄與責任說明。
- [x] 定義帳戶單一執行者、資料來源、交易寫入與復原界線。
- [x] 記錄台指期單位、日夜盤、到期與委託回報需求及官方來源。
- [x] 建立共用資料／API 草案、階段驗收及舊系統遷移清單。

交付：本目錄規劃文件；尚無 SDK 登入、服務、交易或部署。

## P1：離線專案基礎與資料契約

依賴：P0。工作區：`backend`、`apps/console`、`contracts`。

- [x] 建立 React／TypeScript npm 工作區、依賴鎖檔、啟動／建置命令及前端測試。
- [x] 參考現有 React 專案移植無 App 平台：Shell／Drawer／Registry、四種主題、手機版面；不接入舊登入或交易 API。
- [ ] 建立單一 Python 套件與 API／Worker 入口、後端依賴鎖檔與基本 CI；SDK 相容驗證後才固定其 Python／OS 版本。
- [ ] 實作 AccountScope、InstrumentSpec、Decimal 單位、委託／成交／部位模型及 BrokerCapabilities。
- [ ] 建立離線 Fake Broker、確定性時鐘與 TAIFEX TX／MTX／TMF 月契約 fixtures。
- [ ] 定義 API 模型、匯出 OpenAPI、產生 TS Client，CI 驗證產生檔無漂移。
- [ ] 建立最小控制台，使用明示為離線範例的快照，驗證環境、帳戶、單位與狀態呈現。

驗收：三種契約的每點風險計算正確；非整數口、錯幣別、缺乘數及未知能力被拒絕；新／舊快照不混用；不需要任何交易憑證即可測試。

已完成部分的證據：[P1 無 App Shell 初驗](evidence/P1-shell-20260916.md)、[前端平台逐批驗收](evidence/FRONTEND-platform-20260916.md)、[App 契約與 Demo](evidence/FRONTEND-app-contract-demo-20260916.md)、[App 部署 manifest 與 target driver](evidence/APP-deployment-manifests-20260917.md)、[會員與 App 權限](evidence/ACCESS-control-app-20260917.md)、[App 內功能權限](evidence/ACCESS-feature-entitlements-20260919.md)、[App 套件第一批](evidence/APP-package-foundation-20260918.md)、[App 套件第二批](evidence/APP-package-installation-20260918.md)、[App 套件第三批](evidence/APP-package-agent-20260918.md)、[Deployment Agent 第四批](evidence/APP-deployment-agent-batch-4-20260918.md)、[Deployment Agent 第五批](evidence/APP-deployment-agent-batch-5-20260918.md)、[Deployment Agent 第六批](evidence/APP-deployment-agent-batch-6-20260918.md)、[Deployment Agent 第七批](evidence/APP-deployment-agent-batch-7-20260918.md)、[Deployment Agent 第八批](evidence/APP-deployment-agent-batch-8-20260919.md)、[Deployment Agent 第九批](evidence/APP-deployment-agent-batch-9-20260919.md)、[Deployment Agent 第十批](evidence/APP-deployment-agent-batch-10-20260919.md)、[股票行情 Demo 抽離母版](evidence/APP-stock-price-demo-extraction-20260919.md)、[公開母版清理](evidence/PUBLIC-template-cleanup-20260919.md)。股票行情 Demo 曾用來驗證 App 專屬唯讀 BFF、服務歸屬與同源 API，現已抽離母版，後續以外部 ZIP 重新驗證可移植安裝；第 8～10 批的 Cloud Run／VM 路徑目前是離線控制平面與 host adapter 驗證，不代表已發布到客戶 project。它不是 TAIFEX 帳戶／交易快照，也不代表 Python 交易 API／Worker 或產生式交易契約已完成。前端已有獨立 CI workflow，但 Python／API／Worker、交易資料契約及主清單所列的基本 CI 尚未完成，不勾選整個 P1。

## P2：Shioaji 唯讀介接與台指期行情

依賴：P1。工作區：`backend/src/stratexec/adapters/shioaji`、`markets/taifex`。

- [ ] 鎖定 SDK，驗證 Python／OS／CPU、登入、帳戶權限、CA 生命週期與模擬能力；將結果記入能力矩陣。
- [ ] 使用明確選定的期貨帳戶，解析契約清單、SDK code、到期日與基本資料；不憑 alias 字串組出可交易契約。
- [ ] 正規化 tick／bid-ask、資料時間、報價品質及連線事件，建立交易日／日夜盤行事曆。
- [ ] 查詢帳戶資金、所有方向部位、委託及成交，記錄查詢涵蓋期間、額度與完整性。
- [ ] 處理斷線重新登入、補訂閱與唯讀對帳；敏感資料遮罩。

驗收：帳戶／環境明確、每筆行情可追到真實契約；假日／跨午夜／週末交易日正確；休市與行情失效分開；真實唯讀檢查無交易寫入。

## P3：委託閉環與持久化日誌

依賴：P1、P2。工作區：`application`、`persistence`、`adapters/shioaji`。

- [ ] SQLite intent、order、fill、command、checkpoint 的交易寫入與 schema 版本；本機共享排他鎖。
- [ ] ExecutionService 單一入口；限價、TIF、開平、風險、可用數量與能力檢查。
- [ ] 整合下單／改單／撤單 callback 與查詢，處理回報早到、亂序、重複、部分成交、撤單後成交。
- [ ] 寫入結果不明保存 UNKNOWN；重啟重建券商 ID／Trade 物件映射，不重複下單。
- [ ] 離線故障案例通過後，以明確指定的 Shioaji 模擬帳戶、契約及數量完成委託→成交→平倉→對帳。

驗收：每筆成交只計一次；部分成交取消後部位正確；減量不倒算成負量；寫入逾時不重送；有 journal 的部位可復原；平倉超量不反向開倉的能力有證據，否則功能保持停用。

## P4：Account Worker、驗證策略與復原

依賴：P3。工作區：`runtime`、`strategies`、`persistence`。

- [ ] 一帳戶一 Worker、同時最多一主動策略，初次啟動沒有預設策略。
- [ ] 實作 `health_probe` 不下單驗證策略與 `futures_execution_canary` 單次模擬執行策略；未通過測試不得用正式帳戶啟動。
- [ ] 持久命令 revision、冪等回覆、已接受設定快照及策略切換；在途委託／曝險存在時禁止直接切換。
- [ ] Firestore 通道中斷時繼續已接受策略，本機命令 CLI 共用相同處理器，重連後有序同步。
- [ ] 開始、正常停止、平倉並停止、重新對帳的狀態及可恢復／需人工錯誤分類。
- [ ] 輕量 liveness、readiness、策略健康分開；程序死亡、日誌損毀與 SDK 阻塞有可查原因。

驗收：關瀏覽器或模擬控制通道中斷不停止策略；雙 Worker 只能一個取鎖；重啟不重下；未知部位不接管；正常停止有留倉時顯示未管理風險。

## P5：整合 React 控制台

依賴：P4，P1 時可先做純 UI。

- [ ] 帳戶切換、券商／環境、日夜盤、委託、成交、部位、資金、策略與系統頁。
- [ ] 用 Worker 同一 RuntimeSnapshot 顯示燈號、流程、阻塞原因與允許動作。
- [ ] 明確顯示命令已送出、Worker 已接受、執行中及完成；逾時顯示待查，不重送交易命令。
- [ ] 手機／桌面同帳戶同快照驗收；切帳戶丟棄舊回應、過期快照降級、未知狀態不顯示正常。
- [ ] FastAPI 帳戶授權、管理員命令、稽核；Firestore 私有集合不直接開放瀏覽器存取。

驗收：同帳戶不同裝置一致；恢復中不誤顯「管理部位正常」；休市不亮故障紅燈；不可平倉時列明原因；單純 UI 改動不要求 Worker 重啟。

## P6：台指期模擬穩定性驗收

依賴：P5。環境：離線故障注入＋經授權的券商模擬。

- [ ] 真實模擬觀察建議至少 5 個交易日，覆蓋一般盤、夜盤、休市與重新開盤；這是本專案初定驗收標準，可依實測調整。
- [ ] 用回放補齊週末／連假／特殊休市／到期日與主連換月；報告區分回放和實際觀測。
- [ ] 注入斷線、回報遺漏／重複、SDK 延遲、寫入逾時、程序重啟、日誌不可寫、雲端通道中斷及外部異動。
- [ ] Soak 記錄 active-session 時間、成功處理、恢復次數／耗時、未解 UNKNOWN、快照延遲與程序重啟原因。
- [ ] 建立 runbook、秘密管理、SQLite 備份還原、單主機切換與版本回退演練。

驗收：無重複送單／重複計入成交／錯帳戶交易；每個未知寫入均有對帳或明確人工處理結果；每次復原有證據；綠燈與實際管理一致。只讓畫面放 24 小時不足以勾選本階段。

## P7：正式策略規格與模擬交易

依賴：P6；進出場規則尚待策略負責人定義。

- [ ] 選定第一個台指期策略，寫清訊號、頻率、方向、部位大小、交易時段、是否留倉、停損／停利及到期退出。
- [ ] 帳戶硬風險獨立於策略：單筆／總曝險、最大未結單、滑價與價格偏離、每日損失及資金門檻；未設定不允許正式交易。
- [ ] 明確定義觸價資料源、時效及斷線時處理；軟體停損不宣稱券商原生保證。
- [ ] 以回放與券商模擬比對決策、委託、成交、成本和損益，涵蓋無成交／部分成交／異常退出。

驗收：文字規格、設定、程式判斷與報表一致；驗證策略不再被當成正式策略。此階段不預設把 Hedged Strangle 改名當台指期策略。

## P8：正式唯讀與有限量上線

依賴：P7；每項外部操作依當次明確授權。

- [ ] 正式唯讀確認指定帳戶、權限、憑證、行情、保證金、委託與部位；記錄模擬／正式差異。
- [ ] 採已驗證 SDK、不可變映像、設定與 schema 版本，固定帳戶單主機，確認舊端不會同時送單。
- [ ] 確定實際商品／到期月、最大口數、損失額度、交易時段、持倉政策與緊急處理人。
- [ ] 另行授權後完成最小量委託、成交、平倉及帳務核對，再評估是否擴大。

驗收：完整券商證據、成本、資金／部位對帳、停止與故障處理可操作。模擬通過不自動打開 LIVE。

## P9：通用性驗證與其他市場（後續分支）

依賴：P6 之後即可開始，不阻塞台指期 P7／P8。

- [ ] 增加 Deribit Adapter 與幣本位／線性商品單位測試，使用相同委託／狀態契約驗證抽象不足之處。
- [ ] TXO 與原生組合單：每腿乘數、淨價、比例、成交原子性、保證金試算、腿替換及平倉。
- [ ] 台指期跨月價差／自動換月與合約選擇，分開 native Combo 與逐腿補償驗收。
- [ ] 美股／期權：待券商選定再加入市場日曆、交割／公司行動、行權指派、融券與權限，不能只換 symbol。
- [ ] 依 [遷移規劃](MIGRATION.md) 逐項搬移，舊 runtime journal 與新模型不直接混用。

## 證據格式

每階段完成後新增 `docs/evidence/Pn-YYYYMMDD.md`，至少記錄 commit／未提交差異、環境、SDK／映像／schema 版本、測試命令與結果、券商驗收有無執行、未解項目。不得放帳號、API Secret 或憑證。

下一個可執行指令：**「執行 P1 剩餘項目」**。P1 的全部工作可以在本機離線完成。
