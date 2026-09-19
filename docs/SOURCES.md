# 官方資料與查核範圍

查核日期：2026-09-16。資料用於規劃，未登入券商、未驗證帳戶或 SDK 實際行為。券商文件可能隨版本變動，實作必須保存所選 SDK 版本與實測證據。

| 官方來源 | 本次採用的資訊 |
| --- | --- |
| [TAIFEX 臺股期貨 TX](https://www.taifex.com.tw/cht/2/tX) | 乘數、tick、日夜盤、到期日特殊時段及現金交割 |
| [TAIFEX 小型臺指期貨 MTX](https://www.taifex.com.tw/cht/2/mTX) | 乘數、非月到期契約存在及實際到期日期需求 |
| [TAIFEX 微型臺指期貨 TMF](https://www.taifex.com.tw/cht/2/tMF) | 每點 10 元、tick 與月契約規格 |
| [TAIFEX 盤後交易介紹](https://www.taifex.com.tw/cht/4/aHIntroduction) | 日夜盤、交易日歸屬、ROD 當盤有效 |
| [TAIFEX 委託單種介紹](https://www.taifex.com.tw/cht/4/oamIntroduction) | 價型、TIF 及合法組合需分開檢查 |
| [TAIFEX 保證金一覽](https://www.taifex.com.tw/cht/5/indexMargingDetail) | 保證金為動態資料，不複製當天數字作永久設定 |
| [Shioaji 官方專案](https://github.com/Sinotrade/Shioaji) | Python／跨平台介接方向；正式支援矩陣仍待鎖定版本確認 |
| [Shioaji Login](https://sinotrade.github.io/tutor/login/) | API 登入、帳戶及訂閱生命週期 |
| [Shioaji API Signing and Test](https://sinotrade.github.io/tutor/prepare/terms/) | API 簽署與模擬測試流程 |
| [Shioaji Futures and Option](https://sinotrade.github.io/tutor/order/FutureOption/) | 整數 quantity、LMT/MKT/MKP、ROD/IOC/FOK、開平類型、改撤單與 PendingSubmit |
| [Shioaji Futures Order/Deal Event](https://sinotrade.github.io/tutor/order/order_deal_event/futures/) | 委託／成交分開回報、ID 關係、盤別、數量及事件資訊 |

文件中的排他鎖、SQLite、狀態投影、能力驗證及驗收天數是 **StratExec 工程設計**，不是上述來源宣稱的券商保證。

搜尋結果可能指向舊 PDF；規格以現行官方商品頁及最新公告為優先。尤其 MTX 到期序列不依過去文件硬編月份與週別。

尚未確認：使用者帳戶的商品與模擬權限、CA 狀態、SDK 確切版本、委託回查完整性、session／查詢額度、Cover 的所有邊界行為、模擬與正式環境差異。這些列於 P2／P3，不能只憑文件勾選通過。
