# Platform App Contract：前端 App 接入契約

範圍：單一 React 平台、manifest-generated Registry。這是 App 開發、平台承載及驗收的共同規格；使用現有 `ShellAppDefinition`／`ShellAppProps` 型別，不再建立一套平行介面。

## 四項契約

| 項目 | App 責任 | 平台責任 |
| --- | --- | --- |
| 註冊 | 唯一 key／path、標題、圖示、狀態、displayMode、loader | 驗證定義、首頁與選單、網址導覽 |
| 顯示 | 選擇 compact／responsive；安排內容與必要資訊 | 套用整個 App 視窗的寬度、置中及內容具名容器 |
| 共用能力 | 使用主題、UI、通知、API 與偏好；處理業務語意 | 提供一致介面與錯誤格式 |
| 生命週期 | 清理 timer／訂閱，傳遞 signal，處理非同步失敗 | lazy 載入、錯誤隔離、離開取消 |

平台已有可選的 Firebase Auth Google 登入與 ID Token 取得介面；後端身分驗證、帳戶授權及 Worker 快照仍屬 F7／F8。目前契約不提供假的帳戶能力，能登入也不代表能管理或交易。App 與平台位於同一 React 程序，不是第三方程式沙箱。

需要專屬後端的 App 另遵循 [Backend-aware App：服務歸屬與 API 契約](BACKEND_APP_CONTRACT.md)：服務放在 `services/`、契約放在 `contracts/`，並登記 App-local Service fragment。App 只呼叫同源 API，不直接依賴第三方供應商回應格式。

## 加入 App

使用者只提出「新增 App」時，先依 [標準 App 鷹架規格](APP_SCAFFOLDING.md) 建立空白 App、App-local `DEPLOYMENT.md`、manifest 與基本測試；這個指令本身不授權新增後端或部署雲端。

1. 元件放 `apps/console/src/apps/<app-key>/`，預設匯出元件，接收 `ShellAppProps`。
2. 同目錄建立 `DEPLOYMENT.md`，並以 `infrastructure/apps/<app-key>.json` 指向來源、路由與服務依賴。
3. 在 `infrastructure/apps/<app-key>.json` 宣告 `frontend` metadata，再執行 `npm run apps:registry`；`generatedAppRegistry.ts` 不可手改。不要另建 React root、Shell、登入或帳戶狀態。
4. `key`、`path` 不重複，路徑限定 `/apps/<slug>`；每個 App 都必須明確選擇 `displayMode`。`enabled`／`preview` 必須提供 `load`，`planned` 不可開啟。
5. 使用平台主題 tokens、共用 UI 及 API transport。新增 App 仍須當次工作授權，本例不是實際註冊指令。

### App 內功能權限

- 整體 App 存取由 `access.defaultMode`／`allowedModes` 控制；App 內的課程、即時資料或進階分析等功能才使用 `access.entitlements[]`。
- entitlement key 由 App manifest 定義，平台只驗證、保存與回傳，不解讀業務語意。管理員在「會員與權限」App 對會員勾選功能；active admin 在 `adminAllowed` 下取得該 App 宣告的全部功能權限。
- 前端可用 `hasAppEntitlement(member, appKey, key)` 決定鎖頭、說明與導流，但這只改善介面。付費內容、下載或計算 API 必須向 Identity API 取得伺服器解析的 `allowed` 與 `entitlements[]` 後再執行。
- 不用平台 `role` 或 App-local `roles[]` 模擬每個付費功能，也不為 entitlement 增加第二套 collection／服務。

```json
"access": {
  "defaultMode": "all_members",
  "allowedModes": ["all_members", "grant_required", "admins_only", "disabled"],
  "entitlements": [
    { "key": "course", "displayName": "課程學員功能", "description": "解鎖課程模板與進階分析" }
  ],
  "adminAllowed": true,
  "protected": false
}
```

```tsx
{
  key: 'example',
  path: '/apps/example',
  title: '範例', subtitle: '功能簡述', description: '功能界線',
  icon: ExampleIcon,
  status: 'preview',
  displayMode: 'compact',
  load: () => import('../apps/example/ExampleApp'),
}
```

`preview` 只表示 UI 可開啟，不代表已登入、已連線或可交易。網址是目前頁面的唯一來源；App 不另存一份 activeApp。實際部署時，靜態主機需將 `/apps/*` 等前端路徑 rewrite 到 `index.html`，但不能覆蓋 `/api/*`。

### 標題列密度與 App 操作

- Registry 可選 `headerLayout: 'merged'`，由 Host 將平台品牌與 App 標題合併為一列；省略或設為 `standard` 則顯示 App 標題與副標。兩者都由 Host 擁有標題列，不由 App 重建。
- 這是標題排列方式，與 `displayMode` 的視窗寬度規則相互獨立；不以 App key 寫特例，也不讓 App CSS 隱藏或覆寫平台標題。
- 平台首頁導覽統一由桌面側欄或 Drawer 提供；App 不在標題列或本文重複建立「返回平台首頁」。未知路由、載入失敗或明確工作流程仍可提供返回動作。
- App 若有作用於整個工作區的「檔案／模板／工具」等操作，使用 `AppHeaderActions` 掛入 Host 提供的標題列操作區；不要用 absolute positioning、負 margin 或 App CSS 越界定位到 `.topbar`。
- 標題列操作會隨目前 App 掛載與卸載，不可在切換 App 後殘留。按鈕必須有可及名稱與至少 44×44 CSS px 的操作面積；窄版可改用圖示或換行，但不可造成整頁水平溢出。
- App 內部可收合次要說明，但帳戶、環境、可交易狀態與異常警告不可一起藏起來。

```tsx
import { AppHeaderActions } from '../../shared/ui/AppHeaderActions';

export default function ExampleApp() {
  return <>
    <AppHeaderActions>
      <button type="button" aria-label="開啟檔案選單">檔案</button>
    </AppHeaderActions>
    <main>App 內容</main>
  </>;
}
```

## 顯示模式與裝置適配

| 模式 | 手機 | 平板／PC |
| --- | --- | --- |
| `compact` | 整個 App 視窗依可用寬度縮小 | 整個 App 視窗最大 420 CSS px，水平置中 |
| `responsive` | 依內容容器排列為單欄 | 維持原有寬版 App 視窗，內容依可用空間展開 |

- 規格套用於 `main.app-shell` 整個 App 視窗，包含 StratExec 頂列、App 標題列、內容與頁尾；不是只縮窄 App 本文。外部平台側欄及 Drawer 保持原有行為，不調整瀏覽器視窗的大小。兩種模式都必須支援鍵盤與觸控。
- 420 px 是包含邊框與內距的最大寬度（border-box），不是強制寬度；內容可用寬度會再扣除視窗內距。App 視窗與內容容器的高度依內容延伸，不用 `100vh`／`100dvh`、固定高度或只為與鄰欄齊高而製造大片留白；同一 grid row 內的卡片可以互相 stretch。預設沿用頁面垂直捲動，並由頁面頂端排列；內容高度或頁籤切換不得觸發整窗垂直重新置中。
- 尺寸與共用斷點集中在 `src/styles/app-layout.css`。App 不覆寫 `.app-shell`、`.platform-app-frame` 或 `--app-compact-max-width`。
- `npm run check:boundaries` 會拒絕 App CSS 選取 `html`／`body`／`#root`、平台 Shell 或共用 UI 內部 class；App 只能在自己的根節點安排版面，或設定平台明確公開的 CSS 變數。
- `.platform-app-frame` 保留為具名 `app-content` inline-size 容器，不另限制為 420 px；App 依實際內容容器寬度調整排列，不能用「PC 的 viewport 很寬」推斷自己也很寬。[Container Queries 官方說明](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries)。
- 共用 `.platform-grid`：容器小於 600 px 一欄、600–1023 px 兩欄、1024 px 起三欄；加 `.platform-grid--two` 最多兩欄。這些是內容寬度分級，不是裝置偵測。App 決定哪些區塊放入 grid。
- `responsive` 不會自動將表格變成卡片。寬表格需在自身區塊捲動或改排；頁面不可整體水平溢出。圖片、圖表、長字串需容納在容器內。
- 共用按鈕至少 44×44 CSS px；觸控操作不依賴 hover，必要資訊也不能只靠顏色表達。確認視窗使用原生 dialog，跟隨 viewport 保持可操作。
- App 可從唯讀 props `displayMode` 得知註冊模式；變更視窗寬度不改模式或建立新 App instance。不同路由入口的切換仍依既有解除掛載／取消規則。
- `workspace`／`dashboard`／`focus` 僅作版面設計範例，沒有另加 Registry 欄位。

```tsx
export default function ExampleApp() {
  // The host has already applied this App's displayMode.
  return <div className="platform-grid platform-grid--two">
    <section>主要內容</section>
    <section>輔助內容</section>
  </div>;
}
```

上例只示意版面；需要讀取資料時，接收 `ShellAppProps` 並把 `signal` 傳給請求。後續交易 App 在所有尺寸都要保留帳戶／環境、商品、方向、數量、單位與命令狀態；桌面、平板、手機共用資料與業務判斷。

## App 接入驗收

- 註冊定義、網址直開／重新整理／前進後退正常；新 App 不需增加 Shell 的業務分支。
- 標題列操作位於 Host 的 `.topbar`、鍵盤可達，切換 App／返回首頁後不殘留；App 沒有操作時不保留空白操作區。
- 以 320／390／768／1440 px viewport 檢查兩種模式；compact 的整個 App 視窗在寬畫面維持 420 px 並於可用區域置中，頂列、標題、內容與頁尾均在窄版範圍內；responsive 維持寬版，內容不被裁切。
- 鍵盤可操作、觸控按鈕可點、dialog 可取消與返回焦點；主題切換後文字仍可讀。
- 離開 App 會清理工作，晚到回應不更新新畫面；載入／渲染／資料錯誤有共用提示。
- 實體裝置、瀏覽器引擎與離線／真實服務驗收分別留證據。改尺寸、切 App、關網頁不產生交易命令。

## 生命週期

- App 安裝生命週期由 Identity API 的 `appInstallations` 管理，與 React 元件掛載生命週期及 App 權限政策分開。
- 非核心 App 可經管理介面 `install`、`disable`、`enable`、`uninstall`；`access-control` 與平台核心不可停用或移除。
- 邏輯移除立即影響首頁、導覽、直接網址及伺服器端 `appAccess`，但不刪除 bundle、業務資料或相依服務。這使新手可安全重裝，也避免單一 App 誤刪共用服務。
- Props 提供唯讀 `displayMode`、`onOpenAppMenu`、`onOpenHome`、本次掛載的 `signal`。一般首頁導覽由平台側欄／Drawer 處理；`onOpenHome` 保留給錯誤復原或明確工作流程，不用來重建固定標題列按鈕。
- App 必須清理 timer、事件監聽、訂閱；請求傳入 `signal`。離開 App、故障解除掛載或關網頁，不是停止策略命令。
- 平台隔離 lazy 載入／React 渲染錯誤；事件處理與 Promise 錯誤由 App 處理。故障頁可返回首頁或重新載入前端，不重送命令。
- 每個 App 沒有獨立權限沙箱；不要載入不受信任的程式碼。

## 共用介面與偏好

- `shared/ui/controls.tsx`：Button、Field、ConfirmDialog、LoadingState、EmptyState、ErrorState。
- `shared/ui/patterns.tsx`：FolderTabs、SegmentedControl、StatusBanner、MenuPopover、DatePicker；完整所有權、提升條件與 App 使用規則見 [Platform UI 元件所有權規格](FRONTEND_UI_COMPONENTS.md)。
- `shared/ui/Notifications.tsx`：`useNotifications().notify(message, tone)`／`dismiss(id)`；訊息由使用者關閉。
- 確認視窗由呼叫端管理 `open`／`pending`；確認僅是介面互動，不提供後端冪等保障。不得在 effect／掛載時自動送交易命令。
- `readPreference`／`writePreference` 支援 `platform` 或 `{app:'example'}` 分區；只存介面偏好，不存 Token、憑證、權限、帳戶執行狀態。
- 既有主題使用 `stratexec:theme`，保留淺色／深色／暖紙／系統，不另建主題管理器。

## 共用 API 與讀取

```tsx
const api = createApiClient({ baseUrl: '/api/', timeoutMs: 10_000 });
// client 參照需穩定；不要每次 render 重建。
function ExampleApp({ signal }: ShellAppProps) {
  const read = useApiRead<unknown>({
    client: api, path: 'example/status', scopeKey: 'example-scope', signal,
  });
  return <p>{read.status}</p>;
}
```

- Base 限同源，路徑相對於 base；開發或正式部署採同源後端／反向代理，不自行允許任意外部 API。
- `useApiRead` 僅 GET；`path:null` 停止讀取。範圍／路徑／client 改變會立即隱藏舊資料、取消等待、丟棄晚到結果。
- `scopeKey` 不會設定請求帳戶或提供授權。正確帳戶／環境必須依正式契約傳入端點，後端逐請求授權。
- Hook 不處理交易命令、自動重試、快取、業務 schema 驗證或資料過期判定；這些不可用前端推測代替。
- Transport 的 `request(path, options)` 預設整體逾時 10 秒，包含 JSON 本文與重試等待，可調 1–60,000 ms。
- 只有 GET／HEAD 明確指定 `safeReadRetry:true`，才對網路或 429／502／503／504 至多重試一次；寫入永不自動重送。
- `ApiError` 提供 `kind`、`status`、`requestId`、`outcomeUnknown`。顯示清理過的訊息，不展示原始服務內容。
- 任何已送出寫入的失敗先當作結果不明；取消只是停止前端等待，不代表撤單。後續按業務契約查詢對帳，不直接重送。
- 請求 ID 是追蹤碼，不是交易冪等鍵。202／成功 HTTP 不是 Worker 已完成；結果仍須依後端契約解讀。
- 泛型 `T` 不是執行期驗證。正式模型與 Client 待後端 OpenAPI 產生，不先手抄交易 enum。

## 測試與交付

### 可操作的 Demo

- 一般首頁／選單可開啟 `/apps/demo`（通用）及 `/apps/demo-compact`（窄版）。兩筆註冊共用 `src/apps/demo/DemoApp.tsx`；模式按鈕是正常平台路由導覽，不另存一份顯示模式。
- 展示共用欄位、確認視窗、通知與本機偏好；兩個入口刻意共用 `{app:'demo'}` 的 `display-name`。調整視窗不丟草稿；切換 App 會解除掛載，只有已套用並成功儲存的名稱保留。
- 三筆範例清單、空資料及錯誤由注入的 `demoFetch` 在本機延遲 400 ms 回傳，沒有真正網路請求；使用共用 transport／`useApiRead` 驗證離開取消，不冒充後端能力。
- 示範入口可包含在一般 build；會拋出 React 錯誤的測試 fixtures 仍只存在獨立測試宿主。

### 驗收命令

從根目錄執行：

```powershell
npm ci
npm run check:boundaries
npm test
npm run build
npm exec --workspace=@stratexec/console -- playwright install chromium webkit
npm run test:e2e
```

- `npm run dev`：5175，一般平台及 Demo 的兩種模式入口。
- `npm run dev:test`：5176，兩個離線測試 App；只供開發驗收。
- E2E 同時啟動 5176 測試宿主及 5177 一般平台，分別驗證故障 fixtures 與真正的 Demo Registry。埠已占用會拒絕，不接手不明服務。
- 測試宿主由同一入口在 `DEV && MODE==='platform-test'` 載入；production build 會移除。建置自動檢查沒有 fixture marker／路徑／宿主文案。
- E2E 設定包括 Chromium 桌面／手機及 WebKit 手機；實際執行結果見驗收紀錄，不能以手機 viewport 代替實體裝置驗收。
- 若下載 Chromium 受限，可明確設定 `PLAYWRIGHT_CHROMIUM_CHANNEL=chrome` 使用已安裝 Chrome；CI 預設使用 Playwright 版本，不套用此本機例外。
- `.github/workflows/console.yml` 提供安裝、單元測試、建置、瀏覽器測試及失敗附件。尚未推送，因此沒有雲端 CI 成功紀錄。
- 頁尾顯示前端版本與 CI commit 短碼；本機顯示 `local`，不冒充已發版 commit 或後端健康資訊。

後續仍需完成 F7 後端 ID Token 驗證／權限管理與 F8 帳戶／Worker 快照整合；前端 Firebase 登入與 UI 基礎通過不等於交易平台已可下單。
