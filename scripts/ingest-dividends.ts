import { prisma } from "@/lib/prisma";
import { createFinMindClient } from "@/lib/finmind/client";
import { getDividends } from "@/lib/finmind/datasets";

async function main() {
  const [watch, held] = await Promise.all([
    prisma.watchlistItem.findMany({ distinct: ["stockSymbol"], select: { stockSymbol: true } }),
    prisma.holdingTransaction.findMany({ distinct: ["stockSymbol"], select: { stockSymbol: true } }),
  ]);
  const symbols = [...new Set([...watch, ...held].map((r) => r.stockSymbol))].sort();
  const startIso = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  console.log(`dividends: ${symbols.length} symbols, since ${startIso}`);

  const client = createFinMindClient();
  const failures: string[] = [];
  let eventCount = 0;
  for (const symbol of symbols) {
    try {
      const events = await getDividends(client, symbol, startIso);
      for (const e of events) {
        const exDate = new Date(`${e.exDate}T00:00:00Z`);
        const paymentDate = e.paymentDate ? new Date(`${e.paymentDate}T00:00:00Z`) : null;
        await prisma.dividendEvent.upsert({
          where: { stockSymbol_exDate_kind: { stockSymbol: e.symbol, exDate, kind: e.kind } },
          create: { stockSymbol: e.symbol, kind: e.kind, exDate, perShare: e.perShare, paymentDate, year: e.year },
          update: { perShare: e.perShare, paymentDate, year: e.year }, // 公告更正覆寫
        });
        eventCount++;
      }
      console.log(`${symbol}: ${events.length} events`);
    } catch (err) {
      failures.push(`${symbol}: ${(err as Error).message}`);
    }
  }
  console.log(`done, ${eventCount} events upserted`);
  if (failures.length) {
    console.error(`failures (${failures.length}):\n${failures.join("\n")}`);
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
