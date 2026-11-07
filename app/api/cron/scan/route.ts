import { timingSafeEqual } from "node:crypto";
import { Profiles } from "@/lib/repos.ts";
import { Scanner } from "@/lib/scanner.ts";
import { admin } from "@/lib/supabase.ts";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header), b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Vercel Cron (vercel.json) : ménage, puis scan de chaque compte ayant un CV, du moins récemment scanné au plus récent. */
export async function GET(req: Request) {
  if (!authorized(req.headers.get("authorization"))) return new Response("Unauthorized", { status: 401 });
  const started = Date.now();
  await admin().rpc("purge_old");
  const users = await Profiles.scannable();
  const report: { user: string; sent?: number; error?: string }[] = [];
  for (const id of users) {
    if (Date.now() - started > 200_000) break; // les comptes restants passent en premier au prochain cron
    try {
      report.push({ user: id, sent: (await (await Scanner.forUser(id)).run({ deadline: started + 270_000 })).sent });
    } catch (e) {
      report.push({ user: id, error: String(e).slice(0, 200) });
    }
  }
  return Response.json({ users: users.length, processed: report.length, report });
}
