/** Alertes e-mail transmises par le script Gmail d'un utilisateur, authentifié par son jeton personnel. */
import { Text, type RawJob } from "@/lib/core.ts";
import { JobAI } from "@/lib/ai.ts";
import { WebSearchSource } from "@/lib/sources.ts";
import { Scanner } from "@/lib/scanner.ts";
import { Private } from "@/lib/repos.ts";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const SENDERS = ["linkedin", "indeed", "hellowork", "jobteaser", "apec", "welcometothejungle", "francetravail", "wizbii"];
const MAX_BYTES = 200_000;

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (token.length < 40 || token.length > 100) return new Response("Unauthorized", { status: 401 });
  const userId = await Private.userByIngestToken(token);
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return new Response("Payload too large", { status: 413 });
  if (!(await Private.claim(userId, "ingest"))) return new Response("Quota journalier atteint", { status: 429 });

  const raw = await req.text();
  if (raw.length > MAX_BYTES) return new Response("Payload too large", { status: 413 });
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(raw) as Record<string, unknown>; } catch { return Response.json({ error: "JSON invalide" }, { status: 400 }); }
  const [from, subject, body] = ["from", "subject", "body"].map((k) => (typeof payload[k] === "string" ? (payload[k] as string) : ""));
  if (!body) return Response.json({ error: "body vide" }, { status: 400 });
  const sender = SENDERS.find((s) => from.toLowerCase().includes(s)) ?? "autre";

  const extracted = await JobAI.extractJobs("un e-mail d'alerte emploi", [`De : ${from.slice(0, 200)}\nObjet : ${subject.slice(0, 300)}\n\n${body.slice(0, 60_000)}`]);
  const jobs: RawJob[] = extracted.map((j) => ({
    source: `email:${sender}`, externalId: WebSearchSource.canonical(j.url), title: j.title, company: j.company,
    location: j.location, contract: Text.contract(j.contract) ?? Text.contract(j.title), url: j.url, description: null, postedAt: new Date().toISOString(),
  }));

  const report = await (await Scanner.forUser(userId)).process(jobs, 20);
  return Response.json(report);
}
