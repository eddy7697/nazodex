import { auth } from "@/auth";
import { getHistory } from "@/lib/stocks/history";

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const { symbol } = await params;
  const days = Number(new URL(req.url).searchParams.get("days") ?? "60");
  const data = await getHistory(symbol, days);
  return Response.json({ data });
}
