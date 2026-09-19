# 通用 Shell 視覺細節回母版

日期：2026-09-17。依使用者要求，先在 `stratexec-platform` 母版處理從 `options-lab-suite-shell-demo` 辨識出的通用 Shell 差異；本次不直接修改產品專案 `stratexec-taifex`。

## 參考與範圍

- 參考來源：既有 options-lab-suite-shell-demo repository，commit `b0ca6b9b8c85901746b4b01614ec17f3a8a7ae81`；檢查時來源工作樹乾淨，未修改來源。
- 淺色、深色與暖紙主題的通用控制面色票對回參考值；暖紙次要文字同步對齊。
- 三個主題新增頂列陰影與外框內緣高光 token；Shell 使用 inset highlight，頂列使用 16 px backdrop blur 與主題陰影。
- 新增 Chrome E2E 斷言，鎖定淺色控制面／Shell 陰影、外框 inset、頂列 blur／陰影及暖紙控制面／次要文字。

## 保留界線

- 不改 Shell 自然高度、responsive／compact 顯示契約、URL 導覽、Drawer 結構或 App Registry。
- 不搬入 Firebase 登入、會員頭像或來源專案的業務／圖表 token。
- 不調整產品 App 的 44 px 操作尺寸、帳戶卡片密度或台灣市場漲跌色。
- 沒有後端、券商連線、憑證、部署或交易操作。

## 驗證

- `npm test`：9 個測試檔，158／158 通過。
- `npm run build`：TypeScript、Vite production build 與 fixture 排除檢查通過。
- 系統 Chrome 桌面／手機 E2E：25 項通過，1 項按設計跳過（手機沒有桌面快速外觀選單）。覆蓋主題、Drawer、路由、compact／responsive 尺寸與手機溢出。
- 新增的 Shell 視覺契約斷言以系統 Chrome 單獨重跑：1／1 通過。
- 預設 Playwright managed Chromium／WebKit 未安裝，因此其首次執行沒有啟動測試；改用既有系統 Chrome 完成驗收，未下載瀏覽器套件。WebKit／實體裝置仍未驗證。
