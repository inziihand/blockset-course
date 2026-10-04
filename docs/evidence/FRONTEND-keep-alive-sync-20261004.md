# 受控 Keep-alive：平台模板同步驗收

日期：2026-10-04。模板基準：`dea9a35`；變更仍在工作目錄，未提交、推送或部署。

## 範圍

同步本次已驗證的平台共用 Keep-alive 實作，不複製產品專屬 App、品牌、編輯器／交易 runtime、依賴或部署設定。

- `ShellAppDefinition.keepAlive`／manifest `frontend.keepAlive`：選填 boolean，省略／false 維持解除掛載。
- `AppWorkspaceHost`：只保留已開啟且明確啟用的工作區，不預載、不自動淘汰；關閉確認後釋放。
- `AppActivity`：活動狀態、暫停效果、重新啟用時取得新的 AbortSignal；保留 React／DOM，不重建草稿。
- `AppHeaderActions`／`AppInfoBar`／`ConfirmDialog`：只讓活動 App 提供 Portal 或 native modal。
- 權限同步中暫停；確認失去權限、停用、移除或政策讀取失敗時釋放。登出／UID 切換清除工作區，不沿用其他 UID 的 member。
- 保留模板的品牌、原本 App 與 compact／responsive 規格；內建 Demo／Demo Compact／會員管理 App 未自動啟用 Keep-alive。

`AppHost`、`AppActivity`、兩個 Portal 元件、Registry generator 與共用 Keep-alive 測試，忽略換行格式後與同步來源一致。其他共用檔案只套用 Keep-alive 差異，不覆蓋模板原有差異。App manifest、generated Registry、套件鎖檔、後端、Agent 與 installation 設定均未修改。

## 驗證

- 根目錄 `npm test` 通過：公開來源、環境設定、App／服務／installation 清冊、61 項 installer／Registry 測試、Console 及各 Agent workspace 測試。
- Console 完整 Vitest：18 個檔案、219／219 通過，包含 9 項共用 Keep-alive 測試。另以 `--maxWorkers=1` 重跑通過。
- 根目錄 `npm run build` 通過：CSS 邊界、TypeScript、Vite、正式產物檢查與 Agent 語法檢查；測試 fixtures 未進入 production bundle。
- 最後的 TypeScript、公開來源檢查與 `git diff --check` 通過。

瀏覽器驗收從 `apps/console` 執行：

```powershell
node ../../node_modules/@playwright/test/cli.js test keep-alive.spec.ts platform.spec.ts --grep "retains draft DOM|confirms explicit close|deep links, reload|App display modes" --workers=1
```

Chromium desktop、Chromium mobile、WebKit mobile 共 12／12 通過：

1. 切換及 Back／Forward 保留原草稿 DOM；背景 timer 暫停，活動 Portal 不殘留，重新啟用後恢復。
2. 關閉需確認；取消不丟草稿，確認後 DOM 釋放，重新開啟為新工作區。
3. 深連結、重新整理及瀏覽器歷史仍採同一平台導覽。
4. compact／responsive 在 320、390、768、1440 px 維持整窗寬度、置中及無水平溢出。

初驗發現兩項測試問題，修正後完整重跑：舊幾何檢查仍要求基準 Shell 已不存在的 footer；時鐘在 App 建立 timer 後才安裝，使 WebKit 真實 timer 不受測試 clock 的 clearInterval 管理。測試改為事先安裝 clock，並在暫停時鐘前載入兩個 lazy App，避免凍結 React Suspense 的 reveal timer。未因此改變 runtime 的 timer 或導航行為。

## 界線

本次為模板共用能力及純離線 fixture 驗收，不是實際業務 App、實體手機、會員雲端服務或交易驗收。Keep-alive 仍佔用已開啟 App 的記憶體；Host 不會替 App 暫停未整合的普通 effect。重新整理／關頁仍可能遺失未保存草稿，保存契約由 App 負責。所有暫停、取消與關閉動作都不停止後端策略、不撤單，也不授予 PAPER／LIVE。
