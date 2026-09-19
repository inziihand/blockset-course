# 現有系統重用與遷移

日期：2026-09-16。已移植無 App 前端 Shell；後端與交易功能仍為規劃，部署未切換。

## 來源

- Python／執行核心：既有 DeriStrat repository。
- React 控制台：既有 options-lab-suite-shell-demo repository。
- 舊策略待辦主檔：DeriStrat 的 `docs/POST_BASELINE_TEST_TODO.md`；原 Obsidian 同步規則繼續保留。

舊 TODO 仍追蹤 Hedged Strangle；新平台進度由 [實施清單](IMPLEMENTATION_PLAN.md) 追蹤，不先複製全部核取項目造成兩份完成狀態。

## 重用方式

| 來源功能 | 新專案位置 | 處理方式 |
| --- | --- | --- |
| Account Worker、journal、單主機執行權與復原案例 | backend runtime／persistence | 重用已驗證的行為與測試，清除 Deribit／Testnet 預設後才引入 |
| ExecutionAccountScope | domain | 保留憑證無關身份，改為券商與環境帳戶範圍，子帳戶可選 |
| application/ports.py | application ports | 將 label、currency、Deribit raw dict 改為正規化委託／快照 |
| execution_reconciliation.py | application + adapter | 共用對帳算法，raw order／position parsing 下移 Adapter |
| hedged_strangle_factory 與 phase runtimes | 後續 strategies／adapters/deribit | 不作台指期 Worker 的建構入口；P9 才評估完整遷移 |
| React Shell／Drawer／App Registry 與主題 | apps/console | 已移植為無 App 平台；主題偏好改用獨立儲存鍵，不含 Firebase／業務功能 |
| React 業務表格、卡片與狀態 selector | apps/console | 尚未移植；後續替換契約與單位，新增台指期盤別 |
| React 的其他金融 Apps 與 Public Demo | 不屬首批範圍 | 不將無關應用、demo 固定資料或原 Firebase 全域設定整包搬入 |
| Firebase／Cloud Run／VM 工具 | infrastructure | 改為新環境具名設定，先本地驗證，再指定部署目標 |

目前已檢視舊 `account-worker-architecture.md`、`application/ports.py`、`domain/execution_accounts.py`、前端 package 設定及 TODO。舊架構文件混有標為 legacy 的模式；新專案採 local-worker 原則，不照抄雲端 TTL 續租或 API 直接交易寫入。

## 已完成：無 App 平台外殼

本次 React 參考版本為 `b0ca6b9b8c85901746b4b01614ec17f3a8a7ae81`，來源工作樹於移植前後皆乾淨，未修改來源。選擇性移植導覽與主題模式，不搬入舊專案完整依賴及路由；App Registry 保持空白。Drawer 改用原生 dialog，桌面外觀選單使用原生 popover；暖紙主題內部名稱由 `u060` 改為 `paper`，儲存鍵為 `stratexec:theme`。

本次查看的來源範圍未找到根目錄 LICENSE／NOTICE；不另宣稱授權或增加授權。未來若對外散布或開放原始碼，需另確認自有程式權利與第三方依賴授權。

完整範圍、測試與未解項目見 [P1 Shell 驗收紀錄](evidence/P1-shell-20260916.md)。

後續追加：依使用者授權，已建立本專案自己的 App 接入契約與離線 Demo，提供通用／窄版兩個入口。這不是移植舊交易 Demo 或變更原專案；目前內容見 [App 契約與 Demo 驗收](evidence/FRONTEND-app-contract-demo-20260916.md)。

## 遷移原則

1. 新目錄獨立開發；不以更改舊專案檔名充當通用化。
2. 每搬一個模組就補輸入／輸出契約與必要回歸案例；先檢查來源授權、第三方依賴與既有未提交修改。
3. 不複製 `.env`、服務帳戶 JSON、API Key、CA、journal、production firebase 設定或當下 runtime 投影。
4. 前端型別從新 OpenAPI 產生，API 與 UI 狀態調整在同一 PR 審查，但獨立發布時仍須維持版本相容。
5. Deribit 特有設定留在 Adapter／策略設定，不用假子帳戶或 `testnet=true` 強迫表示 Shioaji simulation。

## 帶倉遷移門檻（未實作）

如果未來要把同一帳戶從舊 Worker 移到新 Worker：記錄已接受命令、run、設定、所有未結 intent／order／fill 與部位歸屬；確認舊程序已退出且不會被 supervisor 拉起；備份 journal；轉換器離線校驗；新 Worker 先唯讀對帳，證明一致後才取得交易能力。

不能把舊 SQLite 直接掛入新程式，不能只看「部位數相同」就認定歸屬成功。無法證明時保留舊系統作為管理者或採另外約定的切換窗口，不自動清倉、不讓兩端同時送單。

## 部署隔離

Firebase Authentication 必須使用每個 installation 自己的 GCP/Firebase project 與獨立 Web App，不沿用其他產品環境。真實 project ID、support email、Hosting、Cloud Run、Firestore、secret、Worker host、帳戶綁定與正式網域均屬私人 deployment overlay 與部署證據，不寫入公開母版。

同 Monorepo 可只部署 Console；更改 Python 共用核心時則必須驗證 API／Worker 依賴。每個部署單元記錄自己的 commit、映像／資產及契約版本。
