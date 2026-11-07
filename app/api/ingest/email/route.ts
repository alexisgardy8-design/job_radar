/**
 * Réception des alertes e-mail (LinkedIn, Indeed, HelloWork, JobTeaser, APEC, WTTJ…),
 * envoyées par le script Google Apps Script fourni (scripts/gmail-forwarder.gs).
 * Corps attendu : { from, subject, body } — protégé par INGEST_SECRET en Bearer.
 */
import { checkBearer } from "@/lib/auth.ts";
import { getSettings } from "@/lib/db.ts";
import { extractJobsFromEmail } from "@/lib/ai.ts";
import { insertJobs, scoreAndNotify } from "@/lib/scan.ts";
import { canonicalUrl } from "@/lib/sources/websearch.ts";
import { guessContract } from "@/lib/text.ts";
import type { RawJob } from "@/lib/types.ts";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function senderSource(from: string): string {
  const f = from.toLowerCase();
  for (const s of ["linkedin", "indeed", "hellowork", "jobteaser", "apec", "welcometothejungle", "francetravail", "wizbii"]) {
    if (f.includes(s)) return s;
  }
  return "autre";
}

export async function POST(req: Request) {
  if (!checkBearer(req.headers.get("authorization"), process.env.INGEST_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { from = "", subject = "", body = "" } = (await req.json()) as { from?: string; subject?: string; body?: string };
  if (!body) return Response.json({ error: "body vide" }, { status: 400 });

  const extracted = await extractJobsFromEmail(subject, from, body);
  const src = `email:${senderSource(from)}`;
  const jobs: RawJob[] = extracted
    .filter((j) => /^https?:\/\//.test(j.url))
    .map((j) => ({
      source: src,
      externalId: canonicalUrl(j.url),
      title: j.title,
      company: j.company,
      location: j.location,
      contract: guessContract(j.title),
      url: j.url,
      description: j.snippet,
      postedAt: new Date().toISOString(),
    }));

  const s = await getSettings();
  const inserted = await insertJobs(jobs, s);
  // Notification immédiate pour les alertes : c'est tout l'intérêt de la source e-mail.
  const res = inserted > 0 ? await scoreAndNotify(s, 20) : { scored: 0, notified: 0, errors: [] };
  return Response.json({ extracted: jobs.length, inserted, ...res });
}
