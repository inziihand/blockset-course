# 外觀快速選單：依移植來源對齊

日期：2026-09-16。使用者指出左下角齒輪選單與原版不同；本次只修正該選單，不改 App 或交易功能。

## 來源

- 參考 repository 的 `src/shell/OffCanvasDrawer.tsx`：主題選單標題、resolved theme 副標、直列圖示／名稱／勾號。
- 同專案 `src\styles\shell.css` 與 `src\styles\tokens.css`：190 px 寬、側欄右方 8 px、底部 58 px、內距 7 px、36 px 列高及主題邊框／背景。
- 參考版本 `b0ca6b9b8c85901746b4b01614ec17f3a8a7ae81`。來源工作樹在檢查前後均乾淨，未修改來源。

## 實作界線

- `ThemePicker` 新增 list 呈現，預設仍為 cards；兩者共用既有 ThemeProvider、選項及偏好儲存，不新增第二份主題狀態。
- 齒輪快速選單使用 list：標題「個人化」、實際外觀副標、分隔線、直列選項、唯一選取勾號；開啟時齒輪顯示選取底色。
- Drawer 仍為原有 2×2／48 px 卡片，不受 list CSS 影響。
- 保留新平台原生 Popover 與 radio 控制，不照搬來源的額外全域關閉監聽器或登入資訊。重選同一項也會收合。
- 補入來源選單所用的兩個主題 token，分別提供淺色／深色／暖紙值；不改其他 token。

## 驗證

- `npm test`：9 個測試檔，158／158 通過。
- `npm run build`：TypeScript、Vite 及 production fixture 排除檢查均通過。
- 相關 Chrome E2E：3 項通過，1 項按設計跳過（手機沒有桌面齒輪選單，改驗 Drawer）。涵蓋選單尺寸／定位／列高、主題切換與重選、偏好重載、鍵盤焦點與 Escape、點外部關閉、Drawer 四格樣式與共享主題。
- 本機 5175 實際檢視暖紙主題，直列外觀與參考截圖一致。
- 本次未執行完整其他 App E2E；WebKit／實體裝置仍未驗證。未部署。
