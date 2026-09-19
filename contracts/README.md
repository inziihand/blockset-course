# API Contracts

狀態：Identity API 的 `identity/openapi.json` 由 Python FastAPI 匯出；Deployment Agent 與 VM Agent 有各自的控制面 OpenAPI；交易後端仍只有契約草案，尚未產生交易 OpenAPI 或 TypeScript Client。母版不預載任何業務 App API 契約。

未來交易契約來源為 `backend/src/stratexec/api` 的型別模型。P1 匯出交易用 `openapi.json`，再產生前端 Client；該流程不建立第二份手工維護的 Python／TypeScript schema。

每個 backend-aware App 必須隨 App 套件提供自己的正規化 OpenAPI，且不得把第三方供應商原始回應直接當成平台契約。

Identity 契約更新方式：

```powershell
.venv\Scripts\python backend/tools/export_identity_openapi.py
.venv\Scripts\python backend/tools/export_identity_openapi.py --check
```

契約包含單位、環境、命令結果、RuntimeSnapshot、錯誤原因與能力。CI 驗證產生檔與來源一致，API／UI／Worker 依賴變更需執行下游檢查。

規格：[共用資料與 API 契約](../docs/CONTRACTS.md)。
