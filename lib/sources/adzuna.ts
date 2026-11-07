import type { Filters, RawJob } from "../types.ts";
import { getJson } from "./http.ts";
import { guessContract, htmlToText } from "../text.ts";

interface AdzunaJob {
  id: string;
  title: string;
  description?: string;
  created?: string;
  redirect_url: string;
  contract_type?: string; // "permanent" | "contract"
  contract_time?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
}

export function parseAdzuna(json: { results?: AdzunaJob[] } | null): RawJob[] {
  return (json?.results ?? []).map((j) => ({
    source: "adzuna",
    externalId: String(j.id),
    title: htmlToText(j.title) ?? j.title,
    company: j.company?.display_name ?? null,
    location: j.location?.display_name ?? null,
    contract: j.contract_type === "permanent" ? "CDI" : j.contract_type === "contract" ? "CDD" : guessContract(j.title),
    url: j.redirect_url,
    // Adzuna ne renvoie qu'un extrait : le scoring en tient compte.
    description: htmlToText(j.description),
    postedAt: j.created ?? null,
  }));
}

export async function fetchAdzuna(f: Filters, sinceDays = 3): Promise<RawJob[]> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) throw new Error("ADZUNA_APP_ID / ADZUNA_APP_KEY manquants");
  const where = f.locations[0] ?? "France";
  const out: RawJob[] = [];

  for (const kw of f.titleKeywords) {
    const params = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      what: kw,
      where,
      results_per_page: "50",
      max_days_old: String(sinceDays),
      sort_by: "date",
    });
    if (f.contractTypes.length === 1 && f.contractTypes[0] === "CDI") params.set("permanent", "1");
    const json = await getJson<{ results?: AdzunaJob[] }>(`https://api.adzuna.com/v1/api/jobs/fr/search/1?${params}`);
    out.push(...parseAdzuna(json));
  }
  return out;
}
