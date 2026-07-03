import { auth } from "@/auth";
import { getIndices } from "@/lib/market-overview/service";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  return Response.json({ indices: await getIndices() });
}
