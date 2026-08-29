# Our Trip — 福岡 5天4夜

雙人共用旅遊 PWA，手機優先。第一趟預設旅程為 2026/10/04–2026/10/08 福岡。

## 已實作

- 雙帳號登入／註冊，代稱：🎀 鈴、🐍 綺
- 旅程邀請碼與雙人共用空間
- 每趟旅行 membership 權限檢查（所有 API、照片、WebSocket 都必須是成員）
- Day 1–Day 5 每日行程、分類與圖示分離、Google Maps 連結、備註
- 每筆行程最多 3 個提醒：準時／10 分鐘／30 分鐘／1 小時／1 天／自訂日期時間
- 行程照片：手機相簿上傳、瀏覽器端壓縮、R2 儲存、雙人同步
- 共用購物清單與完成進度／篩選
- 旅費記帳、付款人、共同支出與 50/50 結算
- 航班、住宿、旅行地點清單、地址複製
- 旅遊日記、共用備忘、出發前待辦
- WebSocket 即時同步（Durable Object）
- Web Push：對方新增／修改／刪除資料，以及行程提醒
- JSON 手動備份匯出
- PWA manifest、Service Worker、加入主畫面
- Service Worker：HTML 採 network-first、靜態檔版本化，避免舊版長期卡住

## Cloudflare 架構

- Workers：API、Auth、排程提醒、靜態資源
- D1：帳號、旅程、行程、購物、預算、航班、住宿、提醒、訂閱等結構化資料
- R2：旅遊照片
- Durable Objects：同一趟旅行的 WebSocket 廣播
- Cron Trigger：每分鐘掃描到期提醒

## 初次部署

需求：Node.js 20+、Cloudflare 帳號、Wrangler 已登入。

```bash
npm install
npx wrangler d1 create our-trip-db
npx wrangler r2 bucket create our-trip-photos
```

把 `wrangler d1 create` 回傳的 `database_id` 填入 `wrangler.jsonc` 的 `REPLACE_WITH_D1_DATABASE_ID`。

套用資料庫 migration：

```bash
npm run db:migrate:remote
```

建立 Web Push VAPID keys：

```bash
npx web-push generate-vapid-keys
```

再設定 Worker secrets：

```bash
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
```

`VAPID_SUBJECT` 建議格式：`mailto:你的Email`。

部署：

```bash
npm run deploy
```

## 雙人第一次使用

1. 第一位使用者註冊並選擇自己的代稱。
2. 點「建立『福岡 5天4夜』」，畫面會得到 6 碼邀請碼。
3. 第二位使用者註冊另一個帳號，輸入邀請碼加入。
4. 兩邊都進入同一 trip_id 後，所有共用資料會同步。
5. 各自在自己的手機「更多 → 備份與通知」開啟 Web Push。

## iPhone PWA

Safari 打開正式 HTTPS 網址 → 分享 →「加入主畫面」。通知請從加入主畫面後的 PWA 內按「開啟此裝置 Web Push」。

## 資料安全

此專案不是只靠前端隱藏資料。後端每次存取 trip data 前都查詢 `trip_members`，照片下載與 WebSocket upgrade 也一樣先驗證 membership。密碼以 PBKDF2-SHA256 加鹽雜湊，Session 使用 Secure + HttpOnly + SameSite=Lax cookie。

## 未來擴充預留

資料模型以 `trip_id` 為核心，未綁死單趟福岡，可擴充多趟旅行、多人同行；地圖、天氣、匯率、航班狀態、Google Calendar 與 AI 行程推薦可再接 provider/API，不需要重寫核心資料表。

## 尚需正式環境設定才會啟用

Cloudflare D1 database id、R2 bucket、VAPID secrets 必須在你的 Cloudflare 帳號建立後才能真正啟用登入、雲端同步、照片與 Push。程式碼本身已接好對應 binding。
