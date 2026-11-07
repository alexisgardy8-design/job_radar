import { checkBearer } from "@/lib/auth.ts";
import { runScan } from "@/lib/scan.ts";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Appelé chaque jour par Vercel Cron (voir vercel.json), avec "Authorization: Bearer $CRON_SECRET".
export async function GET(req: Request) {
  if (!checkBearer(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await runScan("cron");
  return Response.json(result);
}
