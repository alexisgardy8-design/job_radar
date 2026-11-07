/**
 * Source n°1 : recherche web (Perplexity Search via Vercel AI Gateway).
 * Les moteurs de recherche indexent les offres publiques de LinkedIn, Indeed, HelloWork,
 * JobTeaser, Welcome to the Jungle, APEC et des sites carrière : on interroge le moteur,
 * on ne visite pas ces sites.
 */
import { gateway, generateText, Output, stepCountIs } from "ai";
import { z } from "zod";
import type { Filters, RawJob } from "../types.ts";
import { guessContract, truncate } from "../text.ts";

export const JOB_DOMAINS = [
  "linkedin.com", "indeed.com", "fr.indeed.com", "hellowork.com", "jobteaser.com",
  "welcometothejungle.com", "apec.fr", "francetravail.fr", "wizbii.com",
  "group.bnpparibas", "careers.societegenerale.com", "jobs.ca-cib.com", "groupebpce.com",
  "myworkdayjobs.com", "greenhouse.io", "lever.co", "smartrecruiters.com", "teamtailor.com",
];

const MODEL = () => process.env.SCORING_MODEL || "anthropic/claude-haiku-5.5";

export interface SearchHit { url: string; title: string; snippet: string; date: string | null }

/** Récupère récursivement tous les objets {url, title, ...} d'une sortie d'outil, quelle que soit sa forme. */
export function collectHits(node: unknown, out: SearchHit[] = []): SearchHit[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((n) => collectHits(n, out)); return out; }
  const o = node as Record<string, unknown>;
  if (typeof o.url === "string" && /^https?:\/\//.test(o.url)) {
    const text = [o.snippet, o.content, o.text, o.description].find((v) => typeof v === "string") as string | undefined;
    out.push({
      url: o.url,
      title: typeof o.title === "string" ? o.title : "",
      snippet: text ?? "",
      date: (typeof o.date === "string" && o.date) || (typeof o.publishedDate === "string" && o.publishedDate) || null,
    });
  }
  for (const v of Object.values(o)) if (v && typeof v === "object") collectHits(v, out);
  return out;
}

/** Requêtes de recherche construites à partir des filtres. */
export function buildQueries(f: Filters): string[] {
  const where = f.locations[0] ?? "France";
  const contract = f.contractTypes.includes("CDI") ? "CDI" : f.contractTypes[0] ?? "";
  const qs = f.titleKeywords.flatMap((k) => [
    `offre emploi ${contract} "${k}" ${where}`,
    `${k} job ${where} ${contract === "CDI" ? "permanent" : ""} junior OR graduate`,
  ]);
  if (f.contractTypes.includes("CDI")) qs.push(`graduate programme CDI ${where} banque finance 2027`);
  if (f.contractTypes.includes("VIE")) qs.push(`VIE finance risque ${f.titleKeywords.slice(0, 2).join(" ")}`);
  return [...new Set(qs.map((q) => q.replace(/\s+/g, " ").trim()))];
}

/** Étape 1 : le modèle exécute les recherches ; on récupère les résultats bruts de l'outil. */
async function runSearches(queries: string[], recency: "day" | "week" | "month"): Promise<SearchHit[]> {
  const result = await generateText({
    model: MODEL(),
    tools: {
      perplexity_search: gateway.tools.perplexitySearch({
        maxResults: 10,
        maxTokensPerPage: 1500,
        searchRecencyFilter: recency,
        searchDomainFilter: JOB_DOMAINS.slice(0, 20),
      }),
    },
    stopWhen: stepCountIs(queries.length + 2),
    system: "Tu es un outil de collecte. Appelle perplexity_search une fois pour CHAQUE requête fournie, telle quelle, puis réponds simplement « terminé ».",
    prompt: queries.map((q, i) => `${i + 1}. ${q}`).join("\n"),
  });
  const hits: SearchHit[] = [];
  for (const step of result.steps) for (const tr of step.toolResults) collectHits((tr as { output?: unknown }).output, hits);
  for (const s of result.sources ?? []) {
    if (s.sourceType === "url") hits.push({ url: s.url, title: s.title ?? "", snippet: "", date: null });
  }
  const seen = new Map<string, SearchHit>();
  for (const h of hits) {
    const key = h.url.split("#")[0];
    const prev = seen.get(key);
    if (!prev || h.snippet.length > prev.snippet.length) seen.set(key, h);
  }
  return [...seen.values()];
}

const extractSchema = z.object({
  items: z.array(z.object({
    index: z.number().int(),
    isSingleJobOffer: z.boolean().describe("Vrai seulement si la page est UNE offre d'emploi précise (pas une liste, un article, un guide salaire)"),
    title: z.string().nullable(),
    company: z.string().nullable(),
    location: z.string().nullable(),
    contract: z.string().nullable(),
    postedDate: z.string().nullable().describe("AAAA-MM-JJ si visible"),
  })),
});

/** Étape 2 : on transforme les résultats en offres structurées, en écartant le bruit. */
async function hitsToJobs(hits: SearchHit[]): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  for (let i = 0; i < hits.length; i += 25) {
    const batch = hits.slice(i, i + 25);
    const { output } = await generateText({
      model: MODEL(),
      output: Output.object({ schema: extractSchema }),
      system: "Pour chaque résultat de recherche, indique s'il s'agit d'une offre d'emploi unique et extrais ses champs. N'invente rien : null si absent.",
      prompt: batch.map((h, j) => `[${j}] ${h.title}\nURL: ${h.url}\nDate: ${h.date ?? "?"}\n${truncate(h.snippet, 1200)}`).join("\n\n---\n\n"),
    });
    for (const it of output.items) {
      const h = batch[it.index];
      if (!h || !it.isSingleJobOffer || !it.title) continue;
      jobs.push({
        source: `web:${new URL(h.url).hostname.replace(/^www\./, "")}`,
        externalId: canonicalUrl(h.url),
        title: it.title,
        company: it.company,
        location: it.location,
        contract: guessContract(it.contract) ?? guessContract(it.title),
        url: h.url,
        description: h.snippet || null,
        postedAt: it.postedDate ?? h.date,
      });
    }
  }
  return jobs;
}

/** Normalise une URL pour dédoublonner (enlève tracking, langue JobTeaser, etc.). */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    for (const p of [...u.searchParams.keys()]) if (/^(utm_|ref|refId|trackingId|trk|from|src)/i.test(p)) u.searchParams.delete(p);
    u.hostname = u.hostname.replace(/^www\./, "");
    u.pathname = u.pathname.replace(/^\/(fr|en|da|de|es)\/job-offers\//, "/job-offers/").replace(/\/$/, "");
    const li = u.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d{6,})/);
    if (u.hostname.endsWith("linkedin.com") && li) return `linkedin:${li[1]}`;
    return u.toString();
  } catch { return raw; }
}

export async function fetchWebSearch(f: Filters, recency: "day" | "week" | "month" = "week"): Promise<RawJob[]> {
  const queries = buildQueries(f).slice(0, Number(process.env.MAX_SEARCHES_PER_RUN ?? 12));
  const hits = await runSearches(queries, recency);
  return hitsToJobs(hits);
}
