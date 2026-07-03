import { auth } from "@/auth";
import { listWatchlist } from "@/lib/watchlist/service";
import { getSparklines } from "@/lib/stocks/history";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const items = await listWatchlist(session.user.id);
  const sparklines = await getSparklines(items.map((i) => i.stockSymbol));
  return Response.json({ sparklines });
}
