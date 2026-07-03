import { auth } from "@/auth";
import { getStrategySnapshot } from "@/lib/strategy/service";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  try {
    const snapshot = await getStrategySnapshot();
    return Response.json(snapshot);
  } catch {
    return new Response("Upstream unavailable", { status: 502 });
  }
}
