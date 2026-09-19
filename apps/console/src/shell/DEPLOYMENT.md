# Platform Shell 部署規格

狀態：母版必備、可安裝。這份文件描述 Console Shell 與平台 Identity 的部署關係，不是任何客戶已部署的證據。

## 組成

| 單元 | 來源 | 目標 |
| --- | --- | --- |
| React Console | `apps/console/` | Firebase Hosting 靜態資產 |
| Identity API | `backend/` | Cloud Run Service（推薦）；VM Docker（允許） |
| 登入與會員 | Firebase Authentication／Firestore | 每個 installation 自有 project |

`infrastructure/apps/platform.json` 永遠由部署計畫納入，不需出現在 installation 的 `enabledApps`。它要求 `identity-api`，以確保 Google 登入、會員狀態、管理員與 App grant 有可信任後端。

## 安裝與驗收

安裝器先建立 Firebase／Firestore 基礎，再部署 Identity API、建置 Console，最後產生 Hosting rewrite。`STRATEXEC_BOOTSTRAP_ADMIN_EMAILS` 只在安裝當次進入 server-only runtime；首位管理員登入並由 Firestore 驗證後，必須移除 bootstrap secret、重新 pin Hosting 並記錄 revision／digest。

完成條件：Hosting 可載入、Identity health 正常、未帶 Firebase ID Token 的 session 請求回 401、首位管理員為 active admin，且安裝 state 有實際 revision 與 image digest。`planned` 或本機 build 不算完成。
