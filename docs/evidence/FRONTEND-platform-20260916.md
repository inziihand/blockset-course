# 前端平台逐批實施紀錄

日期：2026-09-16。環境：Windows、Node 22.17.0、React 19.2.6、Vite 8.2.2。
新專案尚未初始化 Git；只改 `stratexec-platform` repository，未部署、未接券商或交易。

## 第一批 F1–F3

- URL 為頁面唯一來源；原生 History API 支援返回／前進，Registry 驗證 slug、路徑、重複及 loader。
- 固定平台容器；App 以 lazy／Suspense 按需載入，渲染或載入錯誤只影響 App 區。
- App props 提供本次掛載的 AbortSignal；離開或故障解除掛載時取消本機工作，不發停止策略命令。
- 第一批初驗 `npm test`：31／31 通過；`npm run build` 通過。測試涵蓋注入式 App、深連結、History、延遲模組、故障隔離及 signal 取消。
- 本機 Chromium 確認直接未知路徑、返回首頁及 Drawer 可操作，正式 Registry 仍空。
- React 行為參考：[lazy](https://react.dev/reference/react/lazy)、[Error Boundary](https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary)。錯誤邊界不是非同步 API 錯誤處理或第三方程式沙箱。

## 第二批 F4–F5

- 共用按鈕／欄位／原生確認視窗／通知／載入、空資料與錯誤提示；沿用既有主題。
- 偏好使用平台／App 分區，保留既有主題鍵；損毀或無法儲存時安全退回，不保存登入、權限或交易狀態。
- 同源 API transport：整體逾時、取消、請求 ID、清理錯誤；安全讀取才明確選用至多一次重試，寫入永不自動重送。任何已送出寫入的失敗先視為結果不明。
- GET hook 切換範圍立即隱藏舊資料，清理請求並忽略延遲結果；不代表帳戶授權或快照有效性已實作。
- 第二批初驗 `npm test`：134／134 通過；`npm run build` 通過。全部 API 測試使用離線替身，未連接服務。

## 第三批 F6（實作完成，跨瀏覽器驗收部分完成）

- 只有 `platform-test` 開發模式載入兩個離線測試 App：Alpha 驗證共用 UI／延遲、錯誤、空資料與範圍切換，Beta 驗證渲染／載入故障。共用同一個 Shell 入口；不連後端或券商。
- 正式 Registry 仍空，`npm run build` 含 fixture 路徑／標記／宿主文案排除檢查，通過。
- 已建立 `playwright.config.ts`、8 個瀏覽器情境及三個 projects；`.github/workflows/console.yml` 包含安裝、測試、建置與失敗附件保存。只有設定檔，未推送、未在 GitHub 跑 CI。
- 完成前端頁尾版本識別 `v0.1.0 · local`，CI 會帶入 commit 短碼；完成 [App 接入簡表](../FRONTEND_APP_GUIDE.md)。

### 最終本機結果

| 檢查 | 結果 |
| --- | --- |
| `npm test` | 7 個測試檔、140／140 通過；純離線 |
| `npm run build` | TypeScript、Vite、fixture 排除檢查通過 |
| Chrome 152.0.7977.83 桌面 1440×900 | 8／8 通過 |
| 同版本 Chrome 手機模擬 390×844 | 8／8 通過，含 320 px 寬度檢查 |
| Playwright WebKit 26.6（v2359） | 未能安裝：官方 CDN／Microsoft 備援下載均逾時，未實測 |
| 實體 iOS／Android | 未實測 |
| 雲端 CI／部署／券商 | 未執行 |

瀏覽器成功指令（`apps/console` 目錄）：

```powershell
$env:PLAYWRIGHT_CHROMIUM_CHANNEL='chrome'
node ../../node_modules/@playwright/test/cli.js test --project=chromium-desktop --project=chromium-mobile
```

此為明確的本機 Chrome 例外：Playwright 1.63.0 預設 Chromium v1243 下載逾時，未將本機 Chrome 結果冒充指定版 Chromium／WebKit。最後完整 Chrome 執行結果為 **16 passed (34.9s)**。

- 情境包括深連結、重新整理、History、未知網址、渲染／lazy 失敗後切其他 App、晚到回應隔離、確認視窗 pending／Escape／背景 inert、通知及三種主題保存。
- 第一輪發現測試過早凍結時間會卡住 React Suspense；改成初次 App 就緒後才凍結。原生 dialog 可將焦點移往瀏覽器工具列，測試改驗證背景頁面不能取得焦點，沒有放寬背景隔離要求。此兩項為測試修正，不是交易／後端恢復修正。參考 [W3C H102](https://www.w3.org/WAI/WCAG21/Techniques/html/H102)。
- Chrome 桌面與手機版面檢查均無水平溢出；已看過手機確認視窗截圖。一般 5175 首頁仍顯示 0 App，帳戶服務未設定。
- F6 暫不勾選：待網路可取得瀏覽器套件後重跑完整三個 projects；不把 WebKit 的環境失敗當成 UI 通過。

## 第四批前置條件（尚未滿足）

- `backend/` 與 `contracts/` 只有 README；沒有實際 API、Worker、OpenAPI／TS Client。
- `docs/DECISIONS.md` 的身分驗證供應者尚未選定。
- F7／F8 保持待辦；本次不另建後端、不沿用原站 Firebase、不用假的登入或快照宣稱整合完成。
