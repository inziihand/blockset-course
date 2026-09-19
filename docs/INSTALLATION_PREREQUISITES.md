# 安裝前置作業

本文件供第一次從 GitHub 取得 StratExec Platform 的 Windows 使用者使用。預設安裝精靈只要求選擇編號或 Y/N；下列內容用來確認電腦與 Google Cloud 帳號是否已具備可被精靈偵測的條件。

## 先選擇使用目的

| 目的 | 需要 Google Cloud | 可能產生費用 | 結果 |
| --- | --- | --- | --- |
| 完整本地安裝（預設） | 是 | Firebase／Firestore 依實際用量 | 本機前端與 Identity API，使用真實 Firebase 登入及資料 |
| 查看離線 Demo（進階） | 否 | 否 | 只啟動本機前端；Google 登入停用 |
| 日後正式部署 | 是 | 是 | 另行部署 Cloud Run／Firebase Hosting 等資源 |

安裝器會先做唯讀 preflight；只有在使用者對必要的 Firebase Auth／Firestore 初始化問題回答 Yes 後，才建立完整本地測試所需的 managed service 設定。Cloud Run／Hosting 正式部署不在第一次安裝中執行。

## 基本需求

### 1. PowerShell

本流程以 PowerShell 7 驗證。確認方式：

```powershell
$PSVersionTable.PSVersion
```

### 2. Git

使用 `git clone` 時需要 [Git for Windows](https://git-scm.com/download/win)。若直接從 GitHub 下載 ZIP，可以不安裝 Git，但之後無法用 `git pull` 更新。

```powershell
git --version
```

### 3. Node.js 與 npm

需要 Node.js `22.12.0` 以上的 22 LTS，安裝 Node.js 時會一併提供 npm。下載位置：[Node.js](https://nodejs.org/en/download)。

```powershell
node --version
npm --version
```

repository 的 npm 套件不必事前手動安裝；安裝精靈偵測到缺少套件時，會用 Y/N 詢問是否執行 `npm ci`。

### 4. Google Cloud CLI

執行安裝 dry-run 或正式雲端安裝需要 [Google Cloud CLI](https://cloud.google.com/sdk/docs/install-sdk)。單純查看離線 Demo 不需要。

```powershell
gcloud --version
```

不必預先輸入 `gcloud auth login`。若沒有啟用中的帳號，安裝精靈會先詢問是否開啟 Google 瀏覽器登入。帳號授權仍必須由本人完成。

### 5. 可存取的 Google Cloud project

安裝精靈只列出目前 Google 帳號可存取的既有 projects，並以編號讓使用者選擇。至少需要一個 project；若清單為空，先在 [Google Cloud Console](https://console.cloud.google.com/projectcreate) 建立 project 或取得既有 project 權限。

- dry-run 不要求啟用 Billing。
- 正式雲端安裝需要 Billing；安裝器不會在未授權時自行連結帳單帳戶。
- 建議每個客戶及每個正式／測試環境使用不同 project。

### 6. Python

完整本地模式需要 Python 3.11 以上來執行 Identity API。可先自行安裝；若 Windows 找不到相容版本且 `winget` 可用，安裝精靈會用 Y/N 詢問是否安裝 Python 3.11。

```powershell
python --version
```

## 不必事前安裝

- Firebase CLI：由 repository 的 npm 相依套件提供，不必全域安裝。
- Docker Desktop：基本安裝使用 Cloud Build，不依賴本機 Docker。
- Java：基本安裝不需要；只有執行 Firestore Emulator 規則測試時需要 JDK 21。
- 服務帳號 JSON key：不得建立或下載；安裝流程使用目前帳號與 keyless runtime identity。

## 最短安裝流程

```powershell
git clone https://github.com/inziihand/stratexec-platform.git
Set-Location .\stratexec-platform
.\scripts\install.ps1
```

精靈會依序檢查或處理：

1. gcloud 帳號與可存取 projects。
2. 以編號選擇 project。
3. 自動推導顯示名稱、安裝代號、region 與 support email。
4. 視需要用 Y/N 執行 `npm ci`。
5. 建立被 Git 忽略的 `*.local.json`。
6. 執行唯讀 preflight。
7. 已有 Firebase Auth／Web App 時自動產生 `.env.local`；缺少時以 Y/N 詢問是否設定。
8. 檢查或引導 Application Default Credentials。
9. 檢查 Python、建立 `.venv` 並安裝 Identity API。
10. 視需要以 Y/N 初始化 Firestore、Rules 與 App 清冊。
11. 啟動並驗證 Identity API 與 Console，顯示本地網址後結束。

第一次安裝不詢問正式部署。完成本地測試後，日後另行執行：

```powershell
.\scripts\deploy.ps1
```

部署入口才會確認可能計費資源與公開入口，兩項都預設為 No。

## 只啟動離線 Demo

不需要 Google Cloud 帳號：

```powershell
npm ci
npm run dev
```

預設網址為 <http://127.0.0.1:5175/>。未提供 Firebase Web 設定時，Google 登入會停用，但離線 Demo 仍可使用。

若 5175 已被其他程式占用，可直接選擇其他本機埠：

```powershell
.\node_modules\.bin\vite.cmd .\apps\console --host 127.0.0.1 --port 3001 --strictPort
```

## 本機與秘密資料

- `.env.local`、`infrastructure/environments/*.local.json` 與 `.stratexec/` 都不得提交 Git。
- `VITE_FIREBASE_*` 是 Firebase Web App 的公開識別設定，不是管理員憑證。
- 管理員 email、OAuth secret、服務帳號 key、券商憑證及其他秘密不得寫入 installation manifest。
- 不要將 `STRATEXEC_BOOTSTRAP_ADMIN_EMAILS` 改成 `VITE_*`；瀏覽器端 email 比對不能授予管理權。

## 常見阻塞

### gcloud 顯示憑證驗證失敗

若出現 `CERTIFICATE_VERIFY_FAILED`，應修復 Windows／Google Cloud CLI 的 CA 信任。不得以停用 TLS 驗證、忽略憑證或使用不安全參數繞過。

新建 Python `.venv` 安裝套件時，精靈會要求 pip 使用 Windows 系統憑證信任；不會加入 `trusted-host` 或停用 HTTPS 驗證。

### Billing disabled or unavailable

dry-run 仍可完成，但正式部署會停止。只有在理解帳務影響並明確授權後，才可將選定 project 連結到帳單帳戶。

### Firebase Auth 尚未設定

這表示本機前端已啟動，但根目錄 `.env.local` 尚未取得 Firebase Web App 設定。重新執行安裝精靈：若選定 project 已具備 Firebase Auth／Google Provider／Web App，精靈會唯讀取得公開 Web SDK 設定並產生 `.env.local`；缺少雲端設定時，只有在使用者對明確的 Y/N 問題回答 Yes 後才會建立。單純離線 Demo 可以忽略此訊息。Google 登入成功也不等於已有管理員權限，完整權限仍由 Identity API 驗證。
