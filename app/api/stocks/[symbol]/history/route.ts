import { auth } from "@/auth";
import { getHistory } from "@/lib/stocks/history";

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const { symbol } = await params;
  const raw = Number(new URL(req.url).searchParams.get("days") ?? "60");
  const days = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 365) : 60;
  const data = await getHistory(symbol, days);
  return Response.json({ data });
}
