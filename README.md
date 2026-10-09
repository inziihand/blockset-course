# BlockSet 課程站（stratexec-course）

這是 **BlockSet 的課程網站** repository。它與 [BlockSet 金融工具站](https://github.com/inziihand/stratexec-blockset) 分別安裝、分別使用 Firebase 專案；兩者都以 [StratExec 平台母版](https://github.com/inziihand/stratexec-platform) 的共用能力為基礎。課程站的 App 應依教學需要獨立打包、安裝與授權。

| 項目 | 此 repository |
| --- | --- |
| GitHub `origin` | [`inziihand/blockset-course`](https://github.com/inziihand/blockset-course) |
| 本機目錄 | `D:\Doc\stratexec\stratexec-course` |
| GCP/Firebase Project ID | `voltaic-genre-435508-h3` |
| 網站 | [`https://course.blockset.club/`](https://course.blockset.club/) |
| `upstream` | `inziihand/stratexec-platform`，用於比對共用平台；push 已停用 |

上述是 2026-10-09 的安裝對應。本機 `.env.local` 的 Firebase Project ID 為 `voltaic-genre-435508-h3`、Auth domain 為 `course.blockset.club`。它不應因另一個 repo 的本機設定而改指 `kernelmarket` 或舊的 `gen-lang-client-0768996943`。實際部署版本與 App 安裝狀態仍須在目標專案核對。

## 本機開始

新 clone 請使用**課程 repo** 的 URL，並指定本工作區使用的目錄名稱：

```powershell
git clone https://github.com/inziihand/blockset-course.git stratexec-course
Set-Location .\stratexec-course
npm run setup
```

後續在 repo 根目錄執行 `npm run start:local`，停止時執行 `npm run stop:local`。啟動器會顯示實際本機埠；本機 URL 與正式網站共用的 Firebase 專案由此 checkout 的 `.env.local` 決定，不能只看瀏覽器埠號判斷。

## 課程 App 的安裝界線

- 此站保留核心會員與權限 App。其他課程 App 即使原始碼或 ZIP 已在本機，也須分別確認 source install、Firestore 安裝紀錄、權限與必要後端；不能以「看得到檔案」推論「已安裝」。
- 課程站的 Firestore、會員授權與 App 清單屬於 `voltaic-genre-435508-h3`，不會因 [`blockset.club`](https://blockset.club/) 上的 App 已啟用而自動同步。
- 共用平台的安裝器／App 契約見 [App 套件文件](docs/APP_PACKAGES.md)、[安裝架構](docs/INSTALLATION_ARCHITECTURE.md) 與 [會員授權規格](docs/AUTHENTICATION_AUTHORIZATION.md)。這些文件描述功能與規則；目前雲端狀態以實際安裝、部署及驗證紀錄為準。

## Git 邊界

`origin` 是 `blockset-course`，不是母版或金融工具站。跨 repo 共用修正只挑選經確認的檔案，不整包同步 App、品牌、`.env.local` 或 GCP overlay。提交或部署前先在**此 repo** 執行 `git status --short --branch` 與 `git remote -v`，並核對目標 Project ID。
