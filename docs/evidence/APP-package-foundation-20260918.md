# App 套件第一批驗收

日期：2026-09-18

## 本批完成

- 建立 `platform-contract.json`、App manifest 版本／相容性欄位與 App package schema。
- 將平台服務與 `stock-price-demo` 服務拆成 owner-local fragments，`services.json` 改為可重建索引。
- 部署計畫會遞迴展開 Service dependencies，並以 provider → consumer 排序。
- 建立 `app:pack`／`app:verify`，輸出 ZIP、SHA-256 與 report；驗證路徑、容量、checksum、相容版本、App identity 與 Service ownership。
- Cloud Run Service 改由 driver executor 執行；安裝器與安裝驗收不再依 `identity-api`／`market-data-demo` key 分支。

## 驗證

```text
npm run check:apps           PASS
npm run check:installations  PASS
npm run check:services       PASS
npm run check:installer      PASS (21 tests)
app:pack stock-price-demo    PASS
app:verify generated ZIP     PASS
PowerShell parser            PASS (install, verify, Cloud Run executor)
npm test                     PASS (21 installer + 18 BFF + 192 Console tests)
npm run build                PASS
npm run test:backend         PASS (19 tests; 1 dependency deprecation warning)
npm run check:backend        PASS
```

## 明確未完成／未執行

- ZIP 為 `unsigned-development`，沒有 publisher 簽章或信任鏈。
- 尚無管理介面上傳、staging、原子安裝、migration、版本切換或實體卸載。
- VM Docker executor 仍為 plan-only；DeriStrat／Shioaji Worker 未納入可一鍵安裝範圍。
- 沒有對任何 GCP/Firebase project 執行 apply、部署或資源異動。
