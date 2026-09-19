# 會員與權限 App 部署規格

狀態：母版管理 App；前端已接入，依賴 Platform Identity API。公開母版不宣稱已部署至任何客戶環境。

## 前端

- App key：`access-control`
- 路由：`/apps/access-control`
- 原始碼：`apps/console/src/apps/access-control/`
- 顯示模式：`responsive`
- 可見範圍：active platform admin；此 App 為系統保護項目，不接受個別會員 grant。

## 所需服務

- `identity-api`：Cloud Run Service（推薦），同源 `/api/identity/v1/**`。
- Firebase Authentication：Google 身分登入。
- Firestore：`members`、`members/*/appGrants`、`appPolicies`、`adminAuditLogs`、`platformMeta/schema`。

本機開發另可啟動 `tools/app-package-agent`，由 `[App 管理]` 上傳並預檢 App ZIP。此代理會寫入目前 repository，固定 loopback 且不屬於 Hosting／Cloud Run runtime；production 尚未提供遠端套件安裝。

## 權限語意

Google 登入只建立平台會員身分。App policy 決定 public／所有會員／需個別授權／僅管理員／停用；`grant_required` App 再由會員的有效 grant 決定。未知或 installation 未啟用的 App 預設拒絕。

後端禁止停用或降級最後一位 active admin；`access-control` 固定為管理員可用且不能改為一般會員開放。所有管理寫入均需 Firebase ID Token、伺服器端 admin 驗證及稽核紀錄。

## 驗收與回滾

- 非管理員不得呼叫管理 API，也不能直接開啟此 App。
- `[會員]` 可管理角色、狀態與 `grant_required` App 的個別授權。
- `[App 權限]` 可管理非保護 App 的存取模式與管理員預設。
- `[App 管理]` 在 Package Agent 可用時可上傳 ZIP、檢視逐檔差異與 blocker；未簽章 apply 預設關閉。
- Firestore Browser Rules 對會員、policy、grant 與 audit 仍維持拒絕。
- 前端隨 Hosting release 回滾；Identity API 依 Cloud Run revision 回滾，資料異動另依 audit 人工反向操作，不以程式回滾覆寫會員權限。
