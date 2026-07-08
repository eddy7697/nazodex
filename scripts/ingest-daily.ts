import { prisma } from "@/lib/prisma";
import { fetchTwseDaily } from "@/lib/ingest/twseOpenApi";
import { fetchTpexDaily } from "@/lib/ingest/tpexOpenApi";
import { createFinMindClient } from "@/lib/finmind/client";
import { getStockInfo } from "@/lib/finmind/datasets";

type QuoteRow = {
  symbol: string; name: string;
  open: number; high: number; low: number; close: number; volume: number;
  date: string | null;
};

// 資料列自帶日期優先(民國轉 ISO);缺值 fallback 今日 UTC 午夜(pod 跑 UTC,與回填一致)
function quoteDate(row: QuoteRow, fallback: Date): Date {
  return row.date ? new Date(`${row.date}T00:00:00Z`) : fallback;
}

async function ingestMarket(label: string, market: "TSE" | "OTC", rows: QuoteRow[], fallback: Date) {
  for (const r of rows) {
    await prisma.stock.upsert({
      where: { symbol: r.symbol },
      create: { symbol: r.symbol, name: r.name, market },
      update: { name: r.name },
    });
    const date = quoteDate(r, fallback);
    await prisma.dailyQuote.upsert({
      where: { stockSymbol_date: { stockSymbol: r.symbol, date } },
      create: {
        stockSymbol: r.symbol, date,
        open: r.open, high: r.high, low: r.low, close: r.close, volume: BigInt(r.volume),
      },
      update: {
        open: r.open, high: r.high, low: r.low, close: r.close, volume: BigInt(r.volume),
      },
    });
  }
  console.log(`${label}: ${rows.length} rows`);
}

async function main() {
  const fallback = new Date();
  fallback.setUTCHours(0, 0, 0, 0);

  let okSources = 0;
  try {
    await ingestMarket("TWSE(上市)", "TSE", await fetchTwseDaily(), fallback);
    okSources++;
  } catch (e) {
    console.error(`TWSE 失敗,本日上市缺口: ${(e as Error).message}`);
  }
  try {
    await ingestMarket("TPEX(上櫃)", "OTC", await fetchTpexDaily(), fallback);
    okSources++;
  } catch (e) {
    console.error(`TPEX 失敗,本日上櫃缺口: ${(e as Error).message}`);
  }
  if (okSources === 0) {
    console.error("兩源皆失敗");
    process.exitCode = 1;
  }

  // 每月 1 日刷新股票宇宙(市場別/產業別);失敗只警告,不影響行情
  if (new Date().getUTCDate() === 1) {
    try {
      const stocks = await getStockInfo(createFinMindClient());
      for (const s of stocks) {
        await prisma.stock.upsert({
          where: { symbol: s.symbol },
          create: { symbol: s.symbol, name: s.name, market: s.market, industry: s.industry },
          update: { market: s.market, industry: s.industry },
        });
      }
      console.log(`universe refreshed: ${stocks.length} stocks`);
    } catch (e) {
      console.error(`universe refresh 失敗(下月再試): ${(e as Error).message}`);
    }
  }

  console.log("ingest done");
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
