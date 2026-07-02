# 部署到 GKE

1. 建 LINE Login channel,callback = https://<網域>/api/auth/callback/line
2. 產生 AUTH_SECRET:`npx auth secret`
3. 建立 secret:`kubectl apply -f k8s/secret.example.yaml`(先填好值)
4. 遷移 DB:初始 migration(`prisma/migrations/0001_init/`)已隨程式碼提交,一次性 Job 或本機連線執行 `pnpm exec prisma migrate deploy` 即可套用、建立所有資料表(User、Account、Session、VerificationToken、Stock、WatchlistItem、DailyQuote、UserColumnPref)。之後 schema 若有異動,本機用 `pnpm exec prisma migrate dev --name <變更說明>` 產生新的 migration 目錄並一併提交,再由 `migrate deploy` 套用到正式環境。
5. Build & push:`docker build -t REGISTRY/taidex:latest . && docker push REGISTRY/taidex:latest`
6. 部署:`kubectl apply -f k8s/deployment.yaml -f k8s/cronjob.yaml`
7. 首次灌資料:手動觸發一次 `kubectl create job --from=cronjob/taidex-ingest-daily first-run`
8. 對外:用你叢集既有的 Ingress / LoadBalancer 指向 taidex-web Service,綁網域與憑證
9. Cloud SQL 連線:用 Cloud SQL Auth Proxy sidecar 或私有 IP(擇一,於 deployment 補上)

> `middleware.ts` 會 import `auth()`(含 PrismaAdapter)。這在自架 GKE / Node server 上沒問題,因為 Next.js standalone/Node 部署下 middleware 是跑在 Node runtime,不是 Vercel edge runtime。

## Dockerfile 設計重點

- 三階段 build:`deps`(安裝含 devDependencies 的完整依賴)→ `builder`(`prisma generate` + `next build` 產出 standalone + 編譯每日行情腳本)→ `runner`(最終執行 image)。
- base image 用 `node:22-alpine`:pnpm 11 需要 Node ≥ 22.13,`node:20-alpine` 會在 `pnpm install` 階段直接失敗(`ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`)。
- `corepack prepare pnpm@11.9.0 --activate` 固定 pnpm 版本(本機開發用的版本),避免 lockfile 格式與 corepack 預設抓到的版本不一致。
- `next.config.ts` 已設定 `output: "standalone"`,build 產物在 `.next/standalone/server.js`,靜態資源與 `public/`(本專案目前無 `public/` 目錄,`builder` 階段以 `mkdir -p public` 補一個空目錄,確保 COPY 不會失敗)需另外複製,這是 Next.js standalone 模式的既知限制。

## CronJob 的 tsx 問題怎麼解的

`scripts/ingest-daily.ts` 用 `@/lib/...` path alias、且原本用 `tsx`(devDependency)執行。Runner image 為了精簡與安全性,不會保留 devDependencies,所以 **不採用**「把 tsx 一起帶進 production image」的作法,改採 **方案(a):build 期間把腳本編譯成純 JS**:

- 在 `builder` 階段用 `esbuild`(`--bundle --platform=node --format=esm --packages=external`)把 `scripts/ingest-daily.ts` 連同它引用的 `lib/prisma.ts`、`lib/ingest/twseOpenApi.ts` 一起打包成單一檔案 `dist/ingest-daily.mjs`,`@/*` alias 在 bundle 時已解析完畢,執行期不需要任何路徑別名機制。
- `@prisma/client` 用 `--packages=external` 排除在 bundle 之外(它的 query engine 是原生執行檔,不能被 esbuild 打包),執行期改吃 runner image 裡的 `node_modules/@prisma/client`(見下方 prisma client 段落)。
- `esbuild` 原本只是其他 devDependency(vite/vitest)的間接依賴,經實測 `pnpm exec esbuild` 在全新 `pnpm install --frozen-lockfile` 之後的容器內找不到指令(`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`,本機開發目錄的 node_modules 是舊的、恰好有殘留 bin,才會誤以為可行)。因此把 `esbuild` 明確加為 `devDependencies`(`package.json` + `pnpm-lock.yaml`,`pnpm add -D esbuild`),讓它在乾淨安裝下也保證可用。這是本次任務唯一對 `package.json` 的異動,原因即上述可重現性問題。
- `builder` 階段最後執行 `pnpm prune --prod`,把 `tsx`、`typescript`、`vitest`、`esbuild`、`prisma`(CLI)等 devDependencies 從 `node_modules` 移除,只留 production dependencies(含已產生好的 `@prisma/client` engine)。`runner` 階段整包複製這份已 prune 過的 `node_modules`(而非只複製 `node_modules/.prisma`、`node_modules/@prisma`),因為 pnpm 用符號連結把 `@prisma/client` 指到 `node_modules/.pnpm/@prisma+client@.../node_modules/@prisma/client`,若只複製子資料夾,符號連結會斷掉;整包複製可保留完整、可解析的目錄結構。
- `k8s/cronjob.yaml` 的 `command` 因此是 `["node", "dist/ingest-daily.mjs"]`,而不是 brief 草稿裡的 `node node_modules/.bin/tsx scripts/ingest-daily.ts`。

### 驗證方式

- 檔案存在確認:`docker run --rm taidex:test ls -la dist` → 確認 `dist/ingest-daily.mjs` 存在於 image 內。
- **實際執行驗證**(比僅確認檔案存在更進一步):
  ```
  docker run --rm \
    -e DATABASE_URL="mysql://user:pass@localhost:3306/nonexistent" \
    -e AUTH_SECRET=test -e AUTH_LINE_ID=x -e AUTH_LINE_SECRET=x -e AUTH_URL=http://localhost:3000 \
    taidex:test node dist/ingest-daily.mjs
  ```
  實際輸出 `fetched 1368 rows`(成功向 TWSE OpenAPI 取得當日行情、`@/*` alias 已正確解析、`@prisma/client` 也正確載入),只在真正寫入不存在的資料庫時失敗(`Can't reach database server at localhost:3306`,預期中的錯誤,因為測試環境沒有真正的 MySQL)。這證明 bundle 本身、路徑別名解析、Prisma client 載入都是正確的,唯一未驗證的是「連到真正 Cloud SQL 之後」的寫入路徑(需要實際叢集/資料庫,超出本機驗證範圍)。
- 同樣方式也驗證了 web server:`docker run -d -p 18080:3000 ... taidex:test` 後 `curl http://localhost:18080/login` 回應 `HTTP 200`。

## Cloud SQL 連線

Deployment 目前假設 `DATABASE_URL` 直接指向可連線的 MySQL host(例如已設定好私有 IP 對等連線或已有 sidecar)。若採用 Cloud SQL Auth Proxy sidecar,需在 `k8s/deployment.yaml`(與 CronJob 的 `jobTemplate`)額外加上：

- 一個 `cloud-sql-proxy` container(image: `gcr.io/cloud-sql-connectors/cloud-sql-proxy`),用 Workload Identity 或掛載的 service account key 認證。
- `DATABASE_URL` 改指向 `127.0.0.1:3306`(proxy 監聽的本地埠)。

本次任務未加上 sidecar(需要實際的 Cloud SQL instance 連線資訊才能驗證),於此記錄擇一方案供之後補上。
