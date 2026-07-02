import { auth } from "@/auth";
import { searchStocks } from "@/lib/stocks/search";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const results = await searchStocks(q);
  return Response.json({ results });
}
