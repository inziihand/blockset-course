# Platform App Contract 與 Demo 驗收

日期：2026-09-16。範圍：`stratexec-platform` 的 React 平台；先完成 F9 契約並驗證，再新增 F10 Demo。未修改舊 DeriStrat／React 專案、VM、部署、API Key 或交易服務。

## 實作

- 延伸既有 `ShellAppDefinition`：每個 App 必填 `displayMode`，只接受 compact／responsive；缺值及不合法值均拒絕。沒有另外建立平行 Registry／介面或業務分支。
- `AppHost` 依註冊規格套用 `.platform-app-frame`，並傳唯讀 mode。compact 內容最大 420 CSS px 並置中；responsive 使用可用內容寬度。標題、導覽仍屬平台。
- `src/styles/app-layout.css` 集中最大寬度、具名 `app-content` 容器及共用 grid，按內容寬度 600／1024 px 分級；不靠裝置名稱決定版面。
- 共用按鈕觸控尺寸至少 44×44 px、dialog actions 可換行；原有 Drawer、帳戶尚未設定及主題視覺保留。
- [接入契約](../FRONTEND_APP_GUIDE.md) 統一註冊、顯示、共用服務、生命週期及驗收責任。

## Demo 入口與內容

| 入口 | 註冊模式 | 元件 |
| --- | --- | --- |
| `/apps/demo` | responsive | `src/apps/demo/DemoApp.tsx` |
| `/apps/demo-compact` | compact | 同一份元件 |

兩個入口在正常首頁及選單可見，皆為 preview／離線示範。模式按鈕只切換正常平台路由；App 不改寫平台寬度。兩種模式共用已儲存的展示名稱，未確認的草稿在 resize 時保留、離開 App 時不保證保留。

示範包含欄位、確認／取消、通知、偏好保存、正常／載入／空資料／錯誤／恢復。共用 `createApiClient`／`useApiRead`，但注入本機 `demoFetch`，400 ms 延遲後產生虛構清單，沒有呼叫瀏覽器 fetch 或外部 API。取消會移除延遲計時器；偏好儲存失敗有明確提示。

## 本機測試結果

- 契約完成後先驗證：51 個 focused 單元測試通過；兩個瀏覽器 display-mode 案例通過，涵蓋 320／390／768／1440 px；TypeScript／production build 通過。之後才加入 Demo。
- 最終 `npm test`：8 個測試檔，**153／153 通過**。涵蓋註冊、host、生命週期、共用服務及 Demo transport；五個 transport 案例確認正常、空、503、預先取消、延遲中取消，均無真正 fetch。
- `npm run build`：**通過**，Vite 1760 modules，Demo lazy chunk 正常；production fixture 排除檢查通過。
- Chrome 桌面／手機 E2E：**24／24 通過**，使用本機已安裝 Chrome（`PLAYWRIGHT_CHROMIUM_CHANNEL=chrome`）。5176 驗證隔離故障 fixtures，5177 驗證一般 Demo Registry。
- Demo 在 320／390／768／1024／1440 px 檢查可用寬度、1／2／3 欄、未確認草稿及不水平溢出；PC 窄版為 420 px、置中且平台標題全寬。
- Demo E2E 驗證模式路由／重新整理、確認取消／套用／偏好重載、資料狀態與恢復，攔截並確認沒有真正 API 請求。
- 本機 5175 人工查看通用及窄版（暖紙主題）：平台導覽維持原位，通用多欄、窄版 420 px 居中，內容寬度讀值正確。

Chrome E2E 重跑方式（PowerShell，工作目錄 `apps/console`）：

```powershell
$env:PLAYWRIGHT_CHROMIUM_CHANNEL='chrome'
node ../../node_modules/@playwright/test/cli.js test --project=chromium-desktop --project=chromium-mobile
```

## 未驗證與界線

- WebKit 套件下載受限，這次未實測；實體 iPhone／Android 亦未驗收，不能用 viewport 測試代替。F6 保持待完成。
- CI workflow 已有設定，但未推送／執行雲端 CI。
- Demo 不是券商模擬環境、交易 App 或 TAIFEX 帳戶快照；F7／F8、後端／登入／券商／P1 其餘工作仍待實作。
- 未部署、未下單，也沒有修改既有策略執行狀態。
