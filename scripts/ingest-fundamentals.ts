import { prisma } from "@/lib/prisma";
import { fetchMonthRevenue, fetchQuarterlyEps } from "@/lib/ingest/twseFundamentals";

async function ingestRevenue(): Promise<number> {
  const rows = await fetchMonthRevenue();
  for (const r of rows) {
    const month = new Date(`${r.month}T00:00:00Z`);
    await prisma.monthlyRevenue.upsert({
      where: { stockSymbol_month: { stockSymbol: r.symbol, month } },
      create: { stockSymbol: r.symbol, month, revenue: r.revenue, yoyPct: r.yoyPct },
      update: { revenue: r.revenue, yoyPct: r.yoyPct }, // 公司更正申報時官方值會變,重跑覆寫
    });
  }
  return rows.length;
}

async function ingestEps(): Promise<number> {
  const rows = await fetchQuarterlyEps();
  for (const r of rows) {
    const quarter = new Date(`${r.quarter}T00:00:00Z`);
    await prisma.quarterlyEps.upsert({
      where: { stockSymbol_quarter: { stockSymbol: r.symbol, quarter } },
      create: { stockSymbol: r.symbol, quarter, eps: r.eps },
      update: { eps: r.eps },
    });
  }
  return rows.length;
}

async function main() {
  let okSources = 0;
  try {
    console.log(`月營收: ${await ingestRevenue()} rows`);
    okSources++;
  } catch (e) {
    console.error(`月營收失敗: ${(e as Error).message}`);
  }
  try {
    console.log(`季EPS: ${await ingestEps()} rows`);
    okSources++;
  } catch (e) {
    console.error(`季EPS失敗: ${(e as Error).message}`);
  }
  if (okSources === 0) {
    console.error("兩源皆失敗");
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
