import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { listTransactions } from "@/lib/holdings/service";
import { buildDividendSuggestions, type DividendSuggestion } from "@/lib/holdings/dividendSuggestions";

// 近 200 天 + 未來事件;actionable 判定窗最長 120 天,再往前的事件必然已記帳或放棄(見 dividendSuggestions.ts)。
const LOOKBACK_MS = 200 * 86_400_000;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const txns = await listTransactions(session.user.id);
  const heldSymbols = [...new Set(txns.map((t) => t.stockSymbol))];
  if (heldSymbols.length === 0) return Response.json({ actionable: [], upcoming: [] });

  const events = await prisma.dividendEvent.findMany({
    where: {
      stockSymbol: { in: heldSymbols },
      exDate: { gte: new Date(Date.now() - LOOKBACK_MS) },
    },
  });

  const { actionable, upcoming } = buildDividendSuggestions(
    txns,
    events.map((e) => ({
      stockSymbol: e.stockSymbol,
      kind: e.kind as "CASH" | "STOCK",
      exDate: new Date(e.exDate),
      perShare: e.perShare,
      paymentDate: e.paymentDate ? new Date(e.paymentDate) : null,
      year: e.year,
    })),
    new Date(),
  );

  const symbols = [...new Set([...actionable, ...upcoming].map((s) => s.symbol))];
  const stocks = symbols.length > 0
    ? await prisma.stock.findMany({ where: { symbol: { in: symbols } } })
    : [];
  const nameBySymbol = new Map(stocks.map((s) => [s.symbol, s.name]));
  const withName = (s: DividendSuggestion) => ({ ...s, name: nameBySymbol.get(s.symbol) ?? s.symbol });

  return Response.json({
    actionable: actionable.map(withName),
    upcoming: upcoming.map(withName),
  });
}
