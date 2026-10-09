# 選擇權策略分析 App 部署規格

前端生命週期：已 opt-in 平台受控 Keep-alive。切換 App 保留目前部位、模型參數、曲線與草稿名稱；隱藏時清理 UI timers／observer／全域監聽並移除 portal。舊啟用期的讀取／匯入回應不套用；已送出儲存／刪除仍須等結果，跨啟用期完成要求重新載入確認，不自動重送或續行新建／匯入流程。關閉、登出、換 UID 或確認失去權限會釋放。只保存在本頁記憶體，不增加離線同步、歷史或後端服務。

狀態：可獨立安裝的純前端 App。0.8.0 為開發驗證版本，整體 App 預設僅允許平台管理員進入；功能涵蓋部位矩陣、模型參數、策略模板、Black–Scholes Greeks、到期／目前損益與 Greeks 多曲線、現貨價拖曳、刻度模式、IV 反推、建倉成本、會員雲端策略檔及單一 JSON 匯入／匯出。

權限邊界：manifest 的 `defaultMode` 為 `admins_only`，`allowedModes` 保留 `public`、`all_members`、`grant_required` 並新增 `admins_only`；管理員可依 App 發布階段調整，新增管理員模式不會刪除原有選項。App 內仍保留原本三層功能邊界：基本版可手動建立組合、檢視損益曲線、到期價值並切換自動／原始值／標準化刻度；active 登入會員可使用以 UID 隔離的私人策略檔；App-local `course` entitlement 解鎖課程模板、Greeks 曲線與多曲線比較。Google 登入只建立會員身分，不等於取得管理員角色或 `course`；App 只採用 Identity API 回傳的有效權限。不複製來源專案的 Firebase Auth 外殼、規則或管理員名單。

目前 App 為純前端，因此鎖定提供產品介面與會員功能分級，不是保護瀏覽器內演算法或原始碼的安全邊界。未來若加入付費資料、下載或伺服器運算，其 API 必須逐請求查驗 Identity 回傳的 App access 與 `course` entitlement。

資料邊界：登入會員的私人策略存於 installation 自有 Firestore 的 `apps/options-strategy-lab/members/{uid}/strategies/{strategyId}`，瀏覽器只能以 Firebase Auth UID 讀寫自己的路徑，Rules 同時查驗 server-owned member 為 active 並限制文件欄位與 schema。策略資料不可作為授權依據；會員與 App 權限仍由 Identity API 管理。既有 `localStorage` 策略不搬移。匯入／匯出只處理單一版本化 JSON，匯入內容一律視為不可信資料並在寫入前驗證 schema。

部署與復原：

- App manifest：`infrastructure/apps/options-strategy-lab.json`
- 機器部署契約：`infrastructure/app-deployments/options-strategy-lab.json`
- App 沒有專屬 Service、秘密、資料遷移或外部行情來源；使用 installation 既有 Firebase Auth 與 Firestore。
- Firestore Rules：`infrastructure/firebase/firestore.rules`，部署前以 Emulator 驗證本人 CRUD、跨 UID 拒絕、inactive 拒絕與無效 schema 拒絕。
- 隨 Platform Console 建置至 Firebase Hosting；移除或復原使用安裝交易備份。

完成條件：manifest、App Registry、CSS 邊界、元件／運算測試與 production build 全部通過；預設開發政策下僅 active 平台管理員可開啟 App，且管理介面仍可選擇 manifest 宣告的其他發布模式。
