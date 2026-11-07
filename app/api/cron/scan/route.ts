import { Auth } from "@/lib/security.ts";
import { SettingsRepo } from "@/lib/database.ts";
import { Scanner } from "@/lib/scanner.ts";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Vercel Cron (vercel.json) : scanne chaque compte ayant un CV, du moins récemment scanné au plus récent. */
export async function GET(req: Request) {
  if (!Auth.bearerOk(req.headers.get("authorization"), process.env.CRON_SECRET)) return new Response("Unauthorized", { status: 401 });
  const started = Date.now();
  const users = await SettingsRepo.scannableUsers();
  const report: { user: number; sent?: number; error?: string }[] = [];
  for (const id of users) {
    if (Date.now() - started > 240_000) break; // les comptes restants passent en premier au prochain cron
    try {
      report.push({ user: id, sent: (await (await Scanner.forUser(id)).run()).sent });
    } catch (e) {
      report.push({ user: id, error: String(e).slice(0, 200) });
    }
  }
  return Response.json({ users: users.length, processed: report.length, report });
}
