import { prisma } from "@/lib/prisma";
import { createFinMindClient } from "@/lib/finmind/client";
import { getStockInfo, getStockPrice, type FinMindStockInfo } from "@/lib/finmind/datasets";
import { shouldSkipSymbol, chunk } from "@/lib/ingest/backfillPlan";

function isoDaysAgo(days: number, now = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

async function upsertStocks(stocks: FinMindStockInfo[]) {
  for (const s of stocks) {
    await prisma.stock.upsert({
      where: { symbol: s.symbol },
      create: { symbol: s.symbol, name: s.name, market: s.market, industry: s.industry },
      update: { name: s.name, market: s.market, industry: s.industry },
    });
  }
}

async function main() {
  const yearsArg = process.argv.find((a) => a.startsWith("--years="));
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const years = Math.max(1, Number(yearsArg?.split("=")[1]) || 5);
  const limit = Number(limitArg?.split("=")[1]) || 0;

  const endIso = new Date().toISOString().slice(0, 10);
  const startIso = isoDaysAgo(years * 365);
  const targetStart = new Date(`${startIso}T00:00:00Z`);

  const client = createFinMindClient();
  const stocks = await getStockInfo(client);
  console.log(`universe: ${stocks.length} stocks(TSE+OTC),回填 ${startIso}..${endIso}`);
  await upsertStocks(stocks);

  // 斷點續跑:已有足夠深歷史的股票跳過
  const grouped = await prisma.dailyQuote.groupBy({ by: ["stockSymbol"], _min: { date: true } });
  const earliestBySymbol = new Map(grouped.map((g) => [g.stockSymbol, g._min.date]));
  let targets = stocks
    .map((s) => s.symbol)
    .filter((sym) => !shouldSkipSymbol(earliestBySymbol.get(sym) ?? null, targetStart));
  if (limit > 0) targets = targets.slice(0, limit);
  console.log(`targets: ${targets.length} symbols(其餘已回填,跳過)`);

  const failures: string[] = [];
  let rowsDone = 0;

  async function backfillOne(symbol: string, i: number, total: number) {
    const rows = await getStockPrice(client, symbol, startIso, endIso);
    for (const batch of chunk(rows, 1000)) {
      const res = await prisma.dailyQuote.createMany({
        data: batch.map((r) => ({
          stockSymbol: symbol,
          date: new Date(`${r.date}T00:00:00Z`),
          open: r.open, high: r.high, low: r.low, close: r.close, volume: BigInt(r.volume),
        })),
        skipDuplicates: true, // 既有列(每日 ingest)不覆蓋
      });
      rowsDone += res.count;
    }
    console.log(`${i + 1}/${total} ${symbol}: ${rows.length} rows`);
  }

  for (let i = 0; i < targets.length; i++) {
    try {
      await backfillOne(targets[i], i, targets.length);
    } catch (e) {
      failures.push(targets[i]);
      console.error(`${targets[i]} failed: ${(e as Error).message}`);
    }
  }

  // 失敗檔收尾重試一輪(限流恢復後通常會過)
  const retryFailures: string[] = [];
  for (let i = 0; i < failures.length; i++) {
    try {
      await backfillOne(failures[i], i, failures.length);
    } catch (e) {
      retryFailures.push(`${failures[i]}: ${(e as Error).message}`);
    }
  }

  console.log(`done, ${rowsDone} new rows`);
  if (retryFailures.length) {
    console.error(`failures (${retryFailures.length}):\n${retryFailures.join("\n")}`);
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
