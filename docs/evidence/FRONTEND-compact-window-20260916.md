# 窄版修正：整個 App 視窗一起縮窄

日期：2026-09-16。依使用者對「窄版」的澄清，取代先前只縮窄 App 內容的解讀。既有 [App 契約與 Demo 紀錄](FRONTEND-app-contract-demo-20260916.md) 保留作歷史結果；目前以本文件及 [接入契約](../FRONTEND_APP_GUIDE.md) 為準。

## 修正內容

- `AppShell` 直接採用目前 Registry 定義的 `displayMode`，套用到整個 `main.app-shell`，不另外保存模式狀態。
- compact 最大 420 CSS px（含邊框及內距），整個視窗於可用空間置中；StratExec 頂列、App 標題、返回按鈕、內容及頁尾一起縮窄。小螢幕依可用寬度縮小。
- 外部平台側邊導覽與 Drawer 維持原有行為；不改瀏覽器視窗尺寸。
- `.platform-app-frame` 只作全寬內容容器，不再獨立限寬。共用 grid 仍依實際內容寬度排列。
- 窄版內距與頂列換行由平台處理，確認 dialog 不超過窄版最大寬度；通用版及首頁寬度規則不變。
- Demo 及文件文字同步修正。沒有新依賴、後端變更、部署或交易操作。

## 驗證

- `npm test`：8 個測試檔、154／154 通過。新增驗證主視窗模式跟隨目前 App，返回首頁或未知網址不殘留 compact。
- `npm run build`：通過；TypeScript、production build 與測試 fixture 排除檢查通過。
- 本機 5175 人工檢視：桌面整窗 420 px，包含頂列與 App 標題；內容實際可用寬度 372 px，外部側欄不變。
- Chrome 桌面／手機 E2E：24／24 通過（使用已安裝 Chrome），覆蓋 320／390／768／1440 px 的整窗寬度、置中、頂列／標題／內容／頁尾包含關係及無水平溢出；320 px 確認視窗可操作，表單草稿在 resize 後保留。
- compact→responsive→compact→首頁的導覽與重新整理正常；通用版和首頁恢復原有寬度、側邊導覽位置不變。通用 Demo 另覆蓋 1024 px 的內容排列。

WebKit／實體手機尚未驗證，F6 的既有待驗事項不變。本次修改僅在本機預覽，未部署。
