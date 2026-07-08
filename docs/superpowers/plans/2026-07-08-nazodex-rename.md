# Taidex → NazoDex 全面改名 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把產品從「Taidex」全面改名為「NazoDex」——品牌層(UI/文件/素材)、repo 層(GitHub/目錄/k8s 參考檔)、基礎設施層(GKE tenant、MySQL DB、域名、LINE Login/LIFF、Cloudflare DNS)一次到位,以藍綠切換方式零停機上線。

**Architecture:** 兩個 repo 各自演進:`~/taidex`(app,走 feat branch + PR)先完成品牌層改名;`~/devsecops-nazo`(IaC,直接 commit)新建 `nazodex` tenant 與 `nazodex_db`,資料從 `tradex_db` 複製,DNS/LINE 切換驗證後才拆除舊 `tradex` tenant。舊環境在切換完成前持續服務,不停機。

**Tech Stack:** Next.js App Router(standalone build)、Prisma + Cloud SQL MySQL 8、GKE(nginx ingress + Cloudflare Flexible SSL)、LINE Login/LIFF、pnpm、gh CLI。

## Global Constraints

- 對外顯示名一律 **NazoDex**(N、D 大寫);程式/DB/k8s/域名識別字一律小寫 **nazodex**。
- 新域名:**nazodex.nazo.com.tw**;LINE channel `1654117392` 與 LIFF_ID `1654117392-BKWVcPBa` 不變,只改 callback/endpoint URL。
- 新 DB 名:**nazodex_db**(instance `ecommerce-db`、user `app`、host `10.224.0.3` 不變)。
- app repo 開發流程照 CLAUDE.md:branch `feat/rename-nazodex` → `pnpm test` + `pnpm exec tsc --noEmit` + `pnpm build` 全過 → PR 回 master。**不直接 commit master。**
- 歷史 docs(specs/plans)**檔名一併 `git mv`**(taidex→nazodex),內文一併取代——終態 repo 內 grep 不到任何 taidex/Taidex/tradex。
- 品牌 CSS token(`--brand: #f59e0b`)、紅漲綠跌慣例、middleware matcher 排除清單(`icon.png|brand/|empty/|textures/`,檔名不變)都**不動**。
- 切換順序不可顛倒:資料複製 → 新環境驗證 → DNS/LINE 切換 → 觀察 → 才能拆舊環境。刪 `tradex` namespace 與 drop `tradex_db` 是破壞性操作,各自需要使用者明確確認。

---

## Phase A — App repo 品牌層(`~/taidex`,branch `feat/rename-nazodex`)

### Task 1: 建分支 + UI 字串改名

**Files:**
- Modify: `app/layout.tsx:4`
- Modify: `app/login/page.tsx:5`
- Modify: `app/liff/page.tsx:4`
- Modify: `components/liff/LiffClient.tsx:54,61`

**Interfaces:**
- Produces: 使用者可見的所有「Taidex」字樣變成「NazoDex」;檔案路徑與元件 API 不變。

- [ ] **Step 1: 建分支**

```bash
cd ~/taidex && git checkout master && git pull && git checkout -b feat/rename-nazodex
```

- [ ] **Step 2: 改四個 UI 檔的字串**

`app/layout.tsx` 第 4 行改為:

```tsx
export const metadata: Metadata = { title: "NazoDex 台股看板", description: "台股自選股看盤" };
```

`app/login/page.tsx` 第 5 行的 alt 改為:

```tsx
      <img src="/brand/logo-name.webp" alt="NazoDex 台股看板" width={288} height={288} className="w-72" />
```

`app/liff/page.tsx` 第 4 行改為:

```tsx
export const metadata: Metadata = { title: "NazoDex — LINE 入口" };
```

`components/liff/LiffClient.tsx` 第 54、61 行改為:

```tsx
      <h1 className="text-xl font-bold">NazoDex 台股看板</h1>
```

```tsx
        <p className="text-sm text-gray-400">正在進入 NazoDex…</p>
```

- [ ] **Step 3: 驗證這四個檔不再含 Taidex**

Run: `grep -rn "Taidex" app/ components/`
Expected: 無輸出

- [ ] **Step 4: 跑測試確認沒炸**

Run: `pnpm test`
Expected: 168 tests 全 PASS(既有測試不斷言品牌名,理應全綠)

- [ ] **Step 5: Commit**

```bash
git add app/layout.tsx app/login/page.tsx app/liff/page.tsx components/liff/LiffClient.tsx
git commit -m "rename: UI 字串 Taidex → NazoDex"
```

### Task 2: package.json / .env.example / k8s 參考檔

**Files:**
- Modify: `package.json:2`
- Modify: `.env.example:1`
- Modify: `k8s/deployment.yaml`(6 處)、`k8s/cronjob.yaml`(3 處)、`k8s/secret.example.yaml`(2 處)

**Interfaces:**
- Produces: 識別字 `nazodex`、範例 DB 名 `nazodex_db`。k8s/ 只是 app repo 內的參考範本(實際線上 manifest 在 devsecops-nazo),同步改掉避免誤導。

- [ ] **Step 1: 改 package.json 與 .env.example**

`package.json` 第 2 行:

```json
  "name": "nazodex",
```

`.env.example` 第 1 行:

```
DATABASE_URL="mysql://user:pass@host:3306/nazodex_db"
```

- [ ] **Step 2: 批次改 k8s 參考檔**

```bash
sed -i 's/taidex/nazodex/g' k8s/deployment.yaml k8s/cronjob.yaml k8s/secret.example.yaml
```

(涵蓋 `taidex-web`→`nazodex-web`、`taidex-secrets`→`nazodex-secrets`、`REGISTRY/taidex`→`REGISTRY/nazodex`、範例 DB 名。)

- [ ] **Step 3: 驗證**

Run: `grep -rin "taidex" package.json .env.example k8s/`
Expected: 無輸出

- [ ] **Step 4: Commit**

```bash
git add package.json .env.example k8s/
git commit -m "rename: 識別字與 k8s 參考檔 taidex → nazodex"
```

### Task 3: 素材管線目錄改名(taidex_assets → nazodex_assets)

**Files:**
- Modify: `scripts/prepare-assets.mjs:1,10`
- Modify: `.gitignore:10`
- Local(gitignored,不進 commit): `mv public/taidex_assets public/nazodex_assets`

**Interfaces:**
- Consumes: 無
- Produces: `pnpm assets:prepare` 改讀 `public/nazodex_assets/`;產物檔名(`public/brand/logo.webp` 等)不變,所以 middleware matcher 與元件引用都不用動。

- [ ] **Step 1: 改 script 路徑與註解**

`scripts/prepare-assets.mjs` 第 1 行註解與第 10 行:

```js
// 把 public/nazodex_assets/ 原始 PNG 處理成正式素材:
```

```js
const SRC = path.join(ROOT, "public/nazodex_assets");
```

`.gitignore` 第 10 行:

```
public/nazodex_assets/
```

- [ ] **Step 2: 搬本機原始素材(gitignored,只影響本機)**

```bash
mv public/taidex_assets public/nazodex_assets
```

- [ ] **Step 3: 驗證管線還能跑**

Run: `pnpm assets:prepare`
Expected: 正常輸出處理後的 webp(來源圖還是舊字樣沒關係,Task 8 換圖)

- [ ] **Step 4: Commit**

```bash
git add scripts/prepare-assets.mjs .gitignore
git commit -m "rename: 素材管線目錄 taidex_assets → nazodex_assets"
```

### Task 4: docs 檔名 git mv + 全文取代(含 README、CLAUDE.md)

**Files:**
- Rename: `docs/superpowers/specs/`、`docs/superpowers/plans/` 下所有含 `taidex` 的檔名(git mv → `nazodex`)
- Modify: 上述所有檔內文 + `README.md` + `CLAUDE.md` + `docs/DEPLOY.md`

**Interfaces:**
- Produces: 終態 repo 全域 grep 不到 taidex/Taidex/tradex;CLAUDE.md 內的文件連結指向改名後的檔名;域名一律寫 `nazodex.nazo.com.tw`、tenant 寫 `nazodex`、程式碼目錄寫 `~/nazodex`。

- [ ] **Step 1: git mv 所有 docs 檔名**

```bash
cd ~/taidex
for f in docs/superpowers/specs/*taidex* docs/superpowers/plans/*taidex*; do
  git mv "$f" "${f/taidex/nazodex}"
done
```

- [ ] **Step 2: 全文取代(三種大小寫 + 舊域名)**

```bash
grep -rl "Taidex\|taidex\|tradex" README.md CLAUDE.md docs/ | xargs sed -i \
  -e 's/Taidex/NazoDex/g' -e 's/taidex/nazodex/g' -e 's/tradex\.nazo\.com\.tw/nazodex.nazo.com.tw/g' \
  -e 's|tenants/tradex|tenants/nazodex|g' -e 's/租戶跑/租戶跑/' -e 's/`tradex`/`nazodex`/g' -e 's/deploy tradex/deploy nazodex/g'
```

注意:CLAUDE.md 的部署節提到「以 `tradex` 租戶」「`kubernetes/tenants/tradex/build-*.sh`」「`make deploy tradex`」——上面的 sed 已涵蓋;跑完人工重讀 CLAUDE.md 部署節,確認語意通順且指到新 tenant 路徑。本檔(2026-07-08-nazodex-rename.md)內文的歷史敘述("從 tradex_db 複製"等)是刻意保留的遷移記錄,加入 grep 排除即可。

- [ ] **Step 3: 全域驗證**

Run: `grep -rin "taidex\|tradex" --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude=2026-07-08-nazodex-rename.md .`
Expected: 無輸出(本遷移計畫自身除外)

- [ ] **Step 4: 跑完整驗證三件套**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm build`
Expected: 全過。build 過代表 metadata/引用路徑沒改壞。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "rename: docs/README/CLAUDE.md 全文與檔名 Taidex → NazoDex"
```

### Task 5: 發 PR 合回 master

- [ ] **Step 1: push + PR**

```bash
git push -u origin feat/rename-nazodex
gh pr create --title "rename: Taidex → NazoDex(品牌層)" --body "$(cat <<'EOF'
## Summary
- UI 字串、metadata、package.json、素材管線、k8s 參考檔、docs 檔名+全文:Taidex → NazoDex
- 域名引用改為 nazodex.nazo.com.tw(基礎設施切換由 devsecops-nazo 另行執行)

## Test plan
- [x] pnpm test(168)/ tsc --noEmit / pnpm build 全過
- [x] 全域 grep 無 taidex/tradex 殘留

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: 合併**

Run: `gh pr merge --squash --delete-branch`
Expected: master 上有改名 commit。**注意:此時 prod(tradex tenant)還沒重新部署,線上仍顯示舊名——沒關係,Phase C 切換時會用新 code build image。**

### Task 6: 品牌素材重生(需要使用者提供 AI 生圖)⚠️ 使用者動作

**Files:**
- Replace(本機 gitignored): `public/nazodex_assets/logo_with_name.png`(圖上烙著「Taidex」字樣,必換)、視需要 `logo.png`/`app_icon.png`
- Regenerate + commit: `public/brand/logo-name.webp`(由管線產出)

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-07-05-nazodex-design-language.md`(Task 4 改名後)內的 AI 生圖提示詞——把提示詞中的品牌字樣換成「NazoDex」重生成。
- Produces: 登入頁 wordmark 顯示 NazoDex。

- [ ] **Step 1(使用者): 用設計語言 spec 的提示詞生成新 wordmark PNG**,放進 `public/nazodex_assets/logo_with_name.png`(覆蓋)。純圖形的 `logo.png`、`app_icon.png`、紋理、空狀態圖若無文字可不換。
- [ ] **Step 2: 跑管線並確認產物**

```bash
pnpm assets:prepare && ls -la public/brand/
```

Expected: `logo-name.webp` mtime 更新。

- [ ] **Step 3: 本機肉眼驗證**

Run: `pnpm build && pnpm start`,開 `http://localhost:3000/login`
Expected: 登入頁 Logo 顯示 NazoDex(這步同時複驗 middleware matcher 沒被改壞——prod 模式下 brand/ 靜態圖必須載得出來)。

- [ ] **Step 4: 走 branch + PR 合入**

```bash
git checkout -b feat/nazodex-wordmark && git add public/brand/ && git commit -m "assets: NazoDex wordmark 重生成" && git push -u origin feat/nazodex-wordmark && gh pr create --fill && gh pr merge --squash --delete-branch
```

---

## Phase B — Repo 本體改名

### Task 7: GitHub repo 改名 + 本機目錄改名

**Interfaces:**
- Produces: GitHub `eddy7697/nazodex`;本機 `~/nazodex`。devsecops-nazo 的 build 腳本引用 `$HOME/taidex`,Task 8 一併改。

- [ ] **Step 1: GitHub 改名(gh 會自動更新本地 remote URL;舊名 GitHub 自動 301 轉址)**

```bash
cd ~/taidex && gh repo rename nazodex --yes
git remote -v
```

Expected: origin 顯示 `github.com:eddy7697/nazodex.git`

- [ ] **Step 2: 本機目錄改名**

```bash
cd ~ && mv ~/taidex ~/nazodex && cd ~/nazodex && git status
```

Expected: clean。**注意:Claude Code 的專案 session/memory 綁定舊路徑,改完目錄要在 `~/nazodex` 重開 session。**

---

## Phase C — 基礎設施藍綠切換(`~/devsecops-nazo`)

### Task 8: 建立 nazodex tenant 目錄

**Files:**
- Create: `kubernetes/tenants/nazodex/`(從 tradex 複製後全量改名)
- Create(不進 git): `kubernetes/tenants/nazodex/secret.yaml`

**Interfaces:**
- Consumes: 既有 `tenants/tradex/` 全部檔案為模板。
- Produces: `make deploy nazodex` 可用(Makefile 以 `ls kubernetes/tenants/` 自動發現);image 名 `asia-east1-docker.pkg.dev/frozenheart/ecommerce/nazodex:latest`;namespace `nazodex`;ingress host `nazodex.nazo.com.tw`;`DB_NAME=nazodex_db`;`AUTH_URL=https://nazodex.nazo.com.tw`;腳本讀 `NAZODEX_DIR`(預設 `$HOME/nazodex`)。

- [ ] **Step 1: 複製並全量改名**

```bash
cd ~/devsecops-nazo
cp -r kubernetes/tenants/tradex kubernetes/tenants/nazodex
cd kubernetes/tenants/nazodex
sed -i -e 's/tradex_db/nazodex_db/g' -e 's/tradex/nazodex/g' -e 's/Tradex/NazoDex/g' \
       -e 's/TAIDEX_DIR/NAZODEX_DIR/g' -e 's|\$HOME/taidex|\$HOME/nazodex|g' -e 's/taidex/nazodex/g' \
  deployment.yaml configmap.yaml ingress.yaml service.yaml namespace.yaml cronjob.yaml build-init.sh build-update.sh secret.yaml.example README.md
```

(順序重要:先 `tradex_db` 再 `tradex`,避免產生 `nazodex_db` 被二次取代。)

- [ ] **Step 2: 逐檔核對關鍵值**

Run: `grep -n "nazodex\|DB_NAME\|IMAGE\|AUTH_URL\|host:" deployment.yaml configmap.yaml ingress.yaml build-init.sh | grep -iv "^.*#"`
Expected 核對清單:
- deployment/cronjob image = `asia-east1-docker.pkg.dev/frozenheart/ecommerce/nazodex:latest`
- configmap `AUTH_URL: "https://nazodex.nazo.com.tw"`;`AUTH_LINE_ID`/`LIFF_ID` **維持原值不變**
- ingress host = `nazodex.nazo.com.tw`
- build-init.sh `DB_NAME="nazodex_db"`、`NAMESPACE="nazodex"`、`APP_DIR="${NAZODEX_DIR:-$HOME/nazodex}"`

- [ ] **Step 3: 建 secret.yaml(含真實密鑰,不進 git)**

```bash
kubectl get secret app-secrets -n tradex -o yaml > /tmp/claude-1000/-home-eddy-taidex/0dad0847-0866-4ec1-ab99-600891a60844/scratchpad/old-secret.yaml
```

以舊 secret 為底手工改兩處後存成 `kubernetes/tenants/nazodex/secret.yaml`:`metadata.namespace: nazodex`、`DATABASE_URL` 尾端資料庫名 `tradex_db` → `nazodex_db`(帳密 host 不變)。`AUTH_SECRET`、`AUTH_LINE_SECRET` 原值照搬。完成後刪掉 scratchpad 的暫存檔。

- [ ] **Step 4: Commit(secret 已被 tenant 目錄的 .gitignore 排除,確認後提交)**

```bash
cd ~/devsecops-nazo && git status kubernetes/tenants/nazodex/   # 確認 secret.yaml 未列入
git add kubernetes/tenants/nazodex && git commit -m "tenant: 新增 nazodex(Taidex→NazoDex 改名藍綠切換)"
```

### Task 9: 建新 DB + 複製資料

**Interfaces:**
- Produces: `nazodex_db` 內容 = `tradex_db` 完整快照。**複製後到 DNS 切換前,舊站的寫入(自選/持股異動)不會跟過來——切換窗口內請 Vincent/Grace 先不要操作,或切換後重跑一次複製。**

- [ ] **Step 1: 建 DB(冪等)**

```bash
gcloud sql databases create nazodex_db --instance=ecommerce-db --project=frozenheart
```

- [ ] **Step 2: 在叢集內跑 mysqldump 複製(從舊 secret 取連線資訊,不落地明文)**

```bash
DBURL=$(kubectl get secret app-secrets -n tradex -o jsonpath='{.data.DATABASE_URL}' | base64 -d)
# 形如 mysql://app:PASS@10.224.0.3:3306/tradex_db,拆出各段:
DB_USER=$(echo "$DBURL" | sed -E 's|mysql://([^:]+):.*|\1|')
DB_PASS=$(echo "$DBURL" | sed -E 's|mysql://[^:]+:([^@]+)@.*|\1|')
DB_HOST=$(echo "$DBURL" | sed -E 's|.*@([^:/]+).*|\1|')
kubectl run dbcopy -n tradex --image=mysql:8 --restart=Never \
  --env="DB_USER=$DB_USER" --env="DB_PASS=$DB_PASS" --env="DB_HOST=$DB_HOST" \
  --command -- bash -c 'mysqldump --single-transaction --set-gtid-purged=OFF -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" tradex_db | mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" nazodex_db && echo COPY_DONE'
kubectl logs -f pod/dbcopy -n tradex
```

Expected: 輸出 `COPY_DONE`。若 mysql 端報權限錯,先對 `app` 授權(`gcloud sql connect ecommerce-db --user=root`,執行 `GRANT ALL PRIVILEGES ON nazodex_db.* TO 'app'@'%'; FLUSH PRIVILEGES;`)再重跑。

- [ ] **Step 3: 抽樣核對筆數**

```bash
kubectl run dbcheck -n tradex --image=mysql:8 --restart=Never \
  --env="DB_USER=$DB_USER" --env="DB_PASS=$DB_PASS" --env="DB_HOST=$DB_HOST" \
  --command -- bash -c 'for db in tradex_db nazodex_db; do echo "== $db"; mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" -N -e "SELECT COUNT(*) FROM $db.User; SELECT COUNT(*) FROM $db.WatchlistItem; SELECT COUNT(*) FROM $db.HoldingTransaction; SELECT COUNT(*) FROM $db.DailyQuote;"; done'
kubectl logs pod/dbcheck -n tradex --follow
```

Expected: 兩組數字一致。

- [ ] **Step 4: 清理臨時 pod**

```bash
kubectl delete pod dbcopy dbcheck -n tradex
```

### Task 10: 部署 nazodex tenant

- [ ] **Step 1: 首次建置(build image from ~/nazodex + apply + rollout + 首灌)**

```bash
bash ~/devsecops-nazo/kubernetes/tenants/nazodex/build-init.sh
```

Expected: DB 已存在(略過建立)→ image push 成功 → rollout 就緒(initContainer 的 `migrate deploy` 對已複製的 DB 是 no-op)→ ingest job 跑完(對既有資料是 upsert,無害)。

- [ ] **Step 2: 進叢集內部驗證 app 活著(DNS 還沒切,先用 port-forward)**

```bash
kubectl port-forward svc/app -n nazodex 3100:3000 &
curl -s http://localhost:3100/login | grep -o "NazoDex" | head -1
kill %1
```

Expected: 輸出 `NazoDex`。

### Task 11: Cloudflare DNS + LINE 設定切換 ⚠️ 使用者動作(外部主控台)

- [ ] **Step 1(Cloudflare): 新增 DNS 記錄**(nazo.com.tw zone):`A  nazodex  <LB_IP>  Proxied(橘雲)`。LB_IP 用 `kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].ip}'` 取得(現值 104.155.221.104)。SSL 模式沿用 Flexible。**先不要刪 tradex 記錄。**
- [ ] **Step 2(LINE Developers Console,channel 1654117392):**
  - LINE Login 分頁 Callback URL **加入**(先不刪舊的):`https://nazodex.nazo.com.tw/api/auth/callback/line`
  - LIFF 分頁該 LIFF app 的 Endpoint URL 改為:`https://nazodex.nazo.com.tw/liff`(LIFF 入口網址 `https://liff.line.me/1654117392-BKWVcPBa` 不變)
- [ ] **Step 3: 驗證新域名通了**

```bash
curl -sI https://nazodex.nazo.com.tw/login | head -3
```

Expected: `HTTP/2 200`。

### Task 12: E2E 驗證(新域名全流程)

- [ ] **Step 1(使用者/Playwright): 手機或瀏覽器走 LINE 登入** `https://nazodex.nazo.com.tw` → 確認能登入、自選股/持股資料完整(= 複製的 DB 生效)。
- [ ] **Step 2: LIFF 入口驗證**——LINE 內開 `https://liff.line.me/1654117392-BKWVcPBa`,確認導向新域名且底部 safe area 正常。
- [ ] **Step 3: 若切換窗口期間舊站有寫入**,重跑 Task 9 Step 2 的複製(mysqldump 全量覆蓋)後再請家人重新確認資料。
- [ ] **Step 4: 隔日確認 cronjob**——`kubectl get jobs -n nazodex`,15:00 後有成功的 ingest-daily job、`/` 首頁行情有更新。

### Task 13: 拆除舊環境(破壞性,分兩步、各需確認)⚠️

- [ ] **Step 1(觀察期後,建議切換順跑 3–7 天): 刪 tradex namespace + DNS + IaC 目錄**

```bash
kubectl delete namespace tradex                     # 刪光 deployment/cronjob/secret
cd ~/devsecops-nazo && git rm -r kubernetes/tenants/tradex && git commit -m "tenant: 移除 tradex(已改名 nazodex)"
```

Cloudflare 刪 `tradex` A 記錄(或留一條 Redirect Rule `tradex.nazo.com.tw/* → https://nazodex.nazo.com.tw/$1` 301 一陣子);LINE console 移除舊 callback URL。

- [ ] **Step 2(再觀察 1–2 週): drop 舊 DB**

```bash
gcloud sql databases delete tradex_db --instance=ecommerce-db --project=frozenheart
```

執行前跟使用者口頭確認一次。此前 `tradex_db` 就是現成的回滾備份,不用另外備份。

---

## Phase D — 收尾

### Task 14: 記憶與文件同步

- [ ] **Step 1: 更新 Claude memory**——`/home/eddy/.claude/projects/-home-eddy-taidex/memory/` 內 `taidex-project.md`、`taidex-design-language.md`、`MEMORY.md` 的品牌名與域名改為 NazoDex / nazodex.nazo.com.tw(注意:目錄改名後新 session 的 memory 路徑會變成 `-home-eddy-nazodex`,舊 memory 需搬移或重建)。
- [ ] **Step 2: 確認 CLAUDE.md 部署節**與 devsecops-nazo 實況一致(tenant 路徑、`make deploy nazodex`、`NAZODEX_DIR`)。
- [ ] **Step 3: 回滾預案備忘**——觀察期內若新環境出問題:Cloudflare 把流量指回 tradex(記錄還在)、LINE callback 舊 URL 還在,即刻恢復;唯 DB 已分岔,需把窗口期寫入手工補回。

---

## Self-Review 紀錄

- 覆蓋檢查:UI 4 檔、package.json、.env.example、k8s 參考檔 3 份、素材管線 2 檔、docs 20+ 份檔名+內文、README、CLAUDE.md、GitHub repo、本機目錄、tenant 12 檔、DB、DNS、LINE callback/LIFF endpoint、AUTH_URL、memory——對照 Phase A–D 均有對應 task。
- 順序檢查:資料複製(T9)在部署(T10)前、部署在 DNS/LINE 切換(T11)前、切換在拆除(T13)前;LINE callback 採「先加後刪」、DNS 舊記錄保留到觀察期結束,隨時可回滾。
- 已知損益:切換窗口的舊站寫入需重複製(T12 Step 3 有補救);wordmark 依賴使用者 AI 生圖(T6),在那之前登入頁仍顯示舊字樣的圖。
