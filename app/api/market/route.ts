import { auth } from "@/auth";
import { getMarketOverview } from "@/lib/market-overview/service";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const overview = await getMarketOverview();
  return Response.json(overview);
}
