# Platform UI 元件所有權規格

範圍：`apps/console` 的平台共用介面與各 App 自有介面。本規格回答元件應放在哪裡、可由誰修改，以及進入共用層前必須符合的條件；不改變 Shell、App Registry 或資料／交易契約。

## 分層與所有權

| 層級 | 位置 | 責任 | 可包含的內容 |
| --- | --- | --- | --- |
| Design tokens | `src/styles/tokens.css` | 平台 | 顏色、邊框、陰影、字級及共用視覺值 |
| 基礎控制項 | `src/shared/ui/controls.tsx` | 平台 | Button、Field、ConfirmDialog、Loading／Empty／Error State |
| 共用互動模式 | `src/shared/ui/patterns.tsx` | 平台 | FolderTabs、SegmentedControl、StatusBanner、MenuPopover、DatePicker |
| App 組合元件 | `src/apps/<app-key>/` | App | 業務欄位、資料表、儀表、表單流程及頁面組合 |

平台元件只管理通用呈現、鍵盤操作與無障礙語意；目前值、可選項目、動作及業務結果由 App 控制。App 不得把帳戶、商品、委託、Worker 或交易狀態寫進平台元件。

## 現有清單

| 元件 | 所有權 | 成熟度 | 備註 |
| --- | --- | --- | --- |
| Button、Field、ConfirmDialog | 平台 | stable | 通用表單與明確確認 |
| LoadingState、EmptyState、ErrorState | 平台 | stable | 通用讀取狀態 |
| NotificationProvider／useNotifications | 平台 | stable | 平台通知區與手動關閉 |
| AppHeaderActions | 平台 | preview | 將活動 App 的工作區操作掛入 Host 標題列；暫停／卸載時移除 Portal，啟用時重新掛入 |
| AppInfoBar | 平台 | preview | 活動 App 的資訊列 Portal；暫停時清理內容與 variant |
| FolderTabs | 平台 | stable | Demo 與 TAIFEX 控制台採用；窄版不得超出內容容器 |
| SegmentedControl | 平台 | preview | 受控單選檢視切換 |
| ChoiceGroup | 平台 | stable | TAIFEX 商品單選篩選；使用按鈕 pressed 語意 |
| StatusBanner | 平台 | preview | info／success／warning／error／neutral；動作由 App 提供 |
| MenuPopover | 平台 | preview | 受控單選選單；支援方向鍵與焦點返回 |
| DatePicker | 平台 | preview | ISO 日期值、min／max；不含時區與交易日規則 |
| DataTable、Gauge、DemoDataWorkspace | App | app-owned | 資料欄位與視覺判斷依 App 情境決定 |

`preview` 表示介面契約已測試，可供 App 採用，但在第二個實際 App 驗證前仍可調整 API；不是後端功能、帳戶連線或交易能力的狀態。

## 提升為平台元件的條件

符合下列各項才移至 `shared/ui`：

1. 至少兩個 App 需要相同互動模式，或已明確指定為平台一致規格。
2. Props 不帶特定券商、商品、帳戶或策略語意。
3. 外觀使用平台 tokens，App 不必複製 CSS 才能正常顯示。
4. 鍵盤、焦點、ARIA、disabled、錯誤及窄版行為有測試。
5. 元件採受控資料；不自行讀 API、localStorage、Registry 或帳戶狀態。

只有視覺相似但欄位、排序、狀態判定或流程不同時，保留在 App；不要為了減少幾行 CSS 抽成難以維護的萬用元件。

## App 使用規則

- 從 `src/shared/ui` 引用共用元件，不複製其 markup／互動程式碼。
- App 可以用外層版面安排寬度、間距與位置；不可覆寫元件內部角色、焦點、選取及 disabled 行為。
- `AppHeaderActions` 只放作用於整個 App 工作區的動作，例如檔案、模板與工具；區塊內的篩選、送出或編輯動作仍留在所屬卡片。App 不得直接選取 `.topbar`、操作 Portal host，或自行建立第二個平台標題列。
- Keep-alive App 的共用 Portal 與 `ConfirmDialog` 會依活動狀態暫停；自有 Portal／popover 需自行整合 `useAppActive`。完整生命週期責任見 [App 接入契約](FRONTEND_APP_GUIDE.md#受控-keep-alive)。
- 標題列按鈕須有可及名稱及至少 44×44 CSS px 的操作面積；窄版可收斂為圖示或換行，但不可隱藏必要狀態、造成水平溢出或讓選單被內容容器裁切。
- FolderTabs 必須提供穩定 `id`、`value`、`items` 與對應 `panelId`；tabpanel 以 `aria-labelledby` 指向目前頁籤。
- SegmentedControl 用於同一內容的觀察角度；真正的頁面或 App 導覽仍走 Registry／網址。
- StatusBanner 的 title、內容與 action 由 App 傳入；error 使用 alert，其餘 tone 使用 status。
- ChoiceGroup 用於同一份資料的單選篩選；真正內容頁籤使用 FolderTabs／SegmentedControl。
- MenuPopover、DatePicker 的值由 App 持有。DatePicker 只處理曆日選取；交易日、結算日、時區及市場規則屬 App／domain。
- compact 與窄內容容器須在 320／390 px 驗證無整頁水平溢出；頁籤文字過長時截斷，不把兩側推出容器。

## 變更與驗收

新增或修改平台 UI 時：

1. 在本文件登記名稱、所有權、成熟度及邊界。
2. 在 `tests/ui*.test.tsx` 驗證受控狀態、鍵盤與 ARIA；App 組合行為另放 App 測試。
3. 在 Demo App 提供離線範例，讓它作為視覺型錄；Demo 是使用者，不是共用元件來源。
4. 驗證 320／390／768／1440 px、compact／responsive、明暗主題及頁面無水平溢出。
5. 若 props 需要業務名詞或 App 特例，停止提升並留在 App 層。

`AppHeaderActions` 另須在平台 Host 測試掛載位置、App 切換／卸載後無殘留、沒有操作時不占空間，以及窄版不造成整頁水平溢出；其子選單的鍵盤與焦點行為仍由實際選單元件負責。

移除或破壞性變更需先搜尋所有引用，完成 App 遷移後再調整共用契約。平台元件成熟度由 `preview` 升為 `stable` 時，至少要有另一個實際 App 採用與跨尺寸驗收證據。
