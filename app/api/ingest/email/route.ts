/** Alertes e-mail transmises par le script Gmail d'un utilisateur, authentifié par son jeton personnel. */
import { Database } from "@/lib/database.ts";
import { Crypto } from "@/lib/security.ts";
import { Text, type RawJob } from "@/lib/core.ts";
import { JobAI } from "@/lib/ai.ts";
import { WebSearchSource } from "@/lib/sources.ts";
import { Scanner } from "@/lib/scanner.ts";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const SENDERS = ["linkedin", "indeed", "hellowork", "jobteaser", "apec", "welcometothejungle", "francetravail", "wizbii"];

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (token.length < 40) return new Response("Unauthorized", { status: 401 });
  const q = await Database.get();
  const user = ((await q`SELECT id FROM users WHERE ingest_token_hash = ${Crypto.sha256(token)}`) as { id: number }[])[0];
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { from = "", subject = "", body = "" } = (await req.json()) as Record<string, string>;
  if (!body) return Response.json({ error: "body vide" }, { status: 400 });
  const sender = SENDERS.find((s) => from.toLowerCase().includes(s)) ?? "autre";

  const extracted = await JobAI.extractJobs("un e-mail d'alerte emploi", [`De : ${from.slice(0, 200)}\nObjet : ${subject.slice(0, 300)}\n\n${body.slice(0, 60_000)}`]);
  const jobs: RawJob[] = extracted.map((j) => ({
    source: `email:${sender}`, externalId: WebSearchSource.canonical(j.url), title: j.title, company: j.company,
    location: j.location, contract: Text.contract(j.contract) ?? Text.contract(j.title), url: j.url, description: null, postedAt: new Date().toISOString(),
  }));

  const scanner = await Scanner.forUser(user.id);
  const inserted = await scanner.ingest(jobs);
  const res = inserted ? await scanner.scoreAndSend(20) : { scored: 0, sent: 0, errors: [] };
  return Response.json({ extracted: jobs.length, inserted, ...res });
}
