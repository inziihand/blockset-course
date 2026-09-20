# React Console

狀態：**App 承載、顯示契約、共用前端服務及 Firebase Auth／會員權限基礎已實作，附離線元件 Demo 與管理員限定的會員與權限 App**。母版不預載業務後端 App；Firebase 設定由每個客戶／環境自己的 `.env.local` 提供，真實 installation overlay 不進入公開原始碼。沒有搬入源版會員資料、舊憑證、DeriStrat 或交易功能。

## 執行

從 clone 後的 `stratexec-platform` 根目錄執行：

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
npm test
npm run build
```

開發網址：<http://127.0.0.1:5175/>；輸出：`apps/console/dist`。已用 Node 22.17.0／npm 10.9.2 驗證。

## 已完成

- 桌面左側導覽列、可收合選單、手機選單與平台首頁。
- Host 擁有 App 標題列與首頁導覽；App 可透過 `AppHeaderActions` 提供目前工作區的檔案、模板或工具操作，不重建第二個頂列。
- 單一 App Registry；首頁與選單一致提供元件 Demo 的通用／窄版入口，業務 App 由套件安裝加入。
- compact 的整個 App 視窗（頂列、標題、內容與頁尾）最大 420 CSS px 並置中，小螢幕依可用寬度縮小；responsive 維持可用寬度。外部側欄／選單不縮窄，也不調整瀏覽器視窗；App 內容仍依容器調整排列。
- 離線 Demo：共用確認視窗、通知、偏好保存、讀取載入／空資料／錯誤復原。
- 淺色、深色、暖紙與跟隨系統；使用獨立的 `stratexec:theme` 瀏覽器儲存鍵。
- 原生 dialog 選單、Escape 關閉與焦點返回；原生 popover 外觀選單。
- URL 導覽、延遲載入、App 錯誤隔離及離開清理。
- 共用 UI、偏好分區、API transport 與讀取生命週期。
- 可選 Firebase Authentication：填入根目錄 `.env.local` 後提供 Google 登入、登出與 ID Token；未設定時安全降級，離線元件 Demo 仍可啟動。
- 會員與權限 App：以資料夾頁籤分為「會員」與「App 權限」，可管理平台角色／狀態、個別 App grant、App manifest 宣告的功能權限與全域開放模式；受保護 App 與最後一位 active admin 由後端鎖定。
- 單元／整合測試、獨立離線宿主與瀏覽器回歸測試；結果見 [逐批驗收](../../docs/evidence/FRONTEND-platform-20260916.md)。
- TypeScript／Vite 建置與 fixture 排除檢查、前端版本標記、CI workflow。

## 尚未接入

Firebase Auth、登入後同源 Identity session 與會員權限管理畫面已接入；平台後端另有 Identity API、Firestore 會員／App policy／App grant schema 與預設拒絕 Rules，但正式 runtime 尚未實際發布。Console 開發 proxy 支援本機 Identity、Package Agent 與 Deployment Agent；母版不預載業務 App BFF。未填 Firebase 設定時帳戶區明示未設定，不使用模擬登入或假的管理員狀態。前端 Registry 的顯示／可開啟條件不是後端授權機制；付費 App 的專屬 API 必須再查驗 Identity 有效權限。

需要支援原生 dialog 與 Popover API 的現代瀏覽器；桌面／手機及 WebKit 的實際結果分列於驗收紀錄。手機 viewport 測試不是實體 iOS／Android 驗收。

## 擴充入口

```text
src/shell-main.tsx                  # 唯一 React 入口
src/shell/AppShell.tsx              # 平台外殼／首頁與 App 切換
src/shell/appRegistry.ts            # 唯一 App 定義來源，Demo 的兩種模式入口
src/shell/types.ts                  # App 介面與接入 Props
src/apps/demo/DemoApp.tsx           # 同一份離線示範內容
src/apps/access-control/             # 管理員會員與 App 權限管理
src/styles/app-layout.css           # App 視窗寬度與內容 container grid
src/shared/theme/ThemeProvider.tsx  # 平台主題與偏好保存
src/styles/                        # 平台 tokens 與版面
tests/                             # Shell 與主題回歸測試
```

後續 App 放在 `src/apps/<app-name>/`，由 registry 註冊唯一 key／path、lazy load／icon／標題及必填 displayMode。不要直接 import 舊專案業務元件或另建入口。`enabled`／`preview` 缺少 loader 會被拒絕；`planned` 不可開啟，`preview` 不代表連線或交易能力。完整用法見 [Platform App Contract](../../docs/FRONTEND_APP_GUIDE.md)。

使用者要求「新增 App」時，AI Agent 必須依 [標準 App 鷹架](../../docs/APP_SCAFFOLDING.md) 建立可開啟的空白 App、基本測試、manifest 與 App-local `DEPLOYMENT.md`。只新增空白 App 不代表允許建立後端或部署雲端。

Demo 入口：[通用](http://127.0.0.1:5175/apps/demo)、[窄版](http://127.0.0.1:5175/apps/demo-compact)。兩者採本機替身資料；需要後端的 App 由標準套件安裝流程加入，完整服務界線見 [Backend-aware App 規格](../../docs/BACKEND_APP_CONTRACT.md)。

## 後續交易控制台界線（尚未實作）

P1 剩餘工作包括離線快照介面；P5 才完整連接管理 API。預計畫面包括帳戶、期貨行情、委託／成交、部位／資金、策略與系統。

- 台指期價格用點、數量用口、金額用新臺幣；同時顯示券商、環境、盤別與到期契約。
- 只透過 FastAPI 讀取及提交命令；不含 SDK、券商 API Key、CA 或私有 Firestore 存取。
- 共用 TypeScript Client 由後端 OpenAPI 產生，不自行抄寫後端 enum。
- 一個 RuntimeSnapshot selector 同時產生策略燈號、標題、階段與按鈕原因。
- 手機／桌面共用元件，帳戶切換與舊回應取消必須驗收。

規格：[資料與狀態契約](../../docs/CONTRACTS.md)、[實施清單](../../docs/IMPLEMENTATION_PLAN.md)。
