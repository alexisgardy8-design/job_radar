/**
 * Sites carrière d'entreprises, via les API publiques que leurs propres pages utilisent :
 * Greenhouse, Lever, SmartRecruiters (API publiques documentées) et Workday.
 */
import type { CareerSource, Filters, RawJob } from "../types.ts";
import { getJson } from "./http.ts";
import { guessContract, htmlToText } from "../text.ts";

/* ---------------- Greenhouse ---------------- */
interface GhJob { id: number; title: string; absolute_url: string; updated_at?: string; location?: { name?: string }; content?: string }

export function parseGreenhouse(json: { jobs?: GhJob[] } | null, src: CareerSource): RawJob[] {
  return (json?.jobs ?? []).map((j) => ({
    source: `greenhouse:${src.id}`,
    externalId: String(j.id),
    title: j.title,
    company: src.label,
    location: j.location?.name ?? null,
    contract: guessContract(j.title),
    url: j.absolute_url,
    description: htmlToText(j.content),
    postedAt: j.updated_at ?? null,
  }));
}

async function fetchGreenhouse(src: CareerSource): Promise<RawJob[]> {
  const json = await getJson<{ jobs?: GhJob[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(src.id)}/jobs?content=true`,
  );
  return parseGreenhouse(json, src);
}

/* ---------------- Lever ---------------- */
interface LeverJob {
  id: string; text: string; hostedUrl: string; createdAt?: number;
  categories?: { location?: string; commitment?: string };
  descriptionPlain?: string; lists?: { text: string; content: string }[]; additionalPlain?: string;
}

export function parseLever(json: LeverJob[] | null, src: CareerSource): RawJob[] {
  return (json ?? []).map((j) => ({
    source: `lever:${src.id}`,
    externalId: j.id,
    title: j.text,
    company: src.label,
    location: j.categories?.location ?? null,
    contract: guessContract(j.categories?.commitment) ?? guessContract(j.text),
    url: j.hostedUrl,
    description: [j.descriptionPlain, ...(j.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content) ?? ""}`), j.additionalPlain]
      .filter(Boolean).join("\n\n") || null,
    postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
  }));
}

async function fetchLever(src: CareerSource): Promise<RawJob[]> {
  // Préfixe "eu:" pour les entreprises hébergées sur l'instance européenne de Lever.
  const eu = src.id.startsWith("eu:");
  const site = eu ? src.id.slice(3) : src.id;
  const host = eu ? "api.eu.lever.co" : "api.lever.co";
  const json = await getJson<LeverJob[]>(`https://${host}/v0/postings/${encodeURIComponent(site)}?mode=json`);
  return parseLever(json, src);
}

/* ---------------- SmartRecruiters ---------------- */
interface SrPosting {
  id: string; name: string; releasedDate?: string;
  location?: { city?: string; region?: string; country?: string; remote?: boolean };
  typeOfEmployment?: { label?: string };
  company?: { name?: string; identifier?: string };
}

export function parseSmartRecruiters(json: { content?: SrPosting[] } | null, src: CareerSource): RawJob[] {
  return (json?.content ?? []).map((p) => ({
    source: `smartrecruiters:${src.id}`,
    externalId: p.id,
    title: p.name,
    company: p.company?.name ?? src.label,
    location: [p.location?.city, p.location?.region, p.location?.country?.toUpperCase(), p.location?.remote ? "remote" : null]
      .filter(Boolean).join(", ") || null,
    contract: guessContract(p.typeOfEmployment?.label) ?? guessContract(p.name),
    url: `https://jobs.smartrecruiters.com/${encodeURIComponent(src.id)}/${p.id}`,
    description: null,
    postedAt: p.releasedDate ?? null,
    detailRef: `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(src.id)}/postings/${p.id}`,
  }));
}

async function fetchSmartRecruiters(src: CareerSource): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const json = await getJson<{ content?: SrPosting[]; totalFound?: number }>(
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(src.id)}/postings?limit=100&offset=${offset}`,
    );
    const page = parseSmartRecruiters(json, src);
    out.push(...page);
    if (page.length < 100) break;
  }
  return out;
}

/* ---------------- Workday ---------------- */
interface WdPosting { title: string; externalPath: string; locationsText?: string; postedOn?: string }

/** "https://acme.wd3.myworkdayjobs.com/fr-FR/AcmeCareers" → { origin, tenant, site } */
export function parseWorkdayUrl(raw: string): { origin: string; tenant: string; site: string } {
  const u = new URL(raw.trim());
  if (!u.hostname.endsWith(".myworkdayjobs.com")) throw new Error(`URL Workday invalide : ${raw}`);
  const tenant = u.hostname.split(".")[0];
  const parts = u.pathname.split("/").filter(Boolean).filter((p) => !/^[a-z]{2}-[A-Z]{2}$/.test(p));
  const site = parts[0];
  if (!site) throw new Error(`Site Workday introuvable dans l'URL : ${raw}`);
  return { origin: u.origin, tenant, site };
}

export function parseWorkday(json: { jobPostings?: WdPosting[] } | null, src: CareerSource): RawJob[] {
  const { origin, tenant, site } = parseWorkdayUrl(src.id);
  return (json?.jobPostings ?? []).filter((p) => p.externalPath).map((p) => ({
    source: `workday:${tenant}/${site}`,
    externalId: p.externalPath,
    title: p.title,
    company: src.label,
    location: p.locationsText ?? null,
    contract: guessContract(p.title),
    url: `${origin}/${site}${p.externalPath}`,
    description: null,
    postedAt: null, // Workday donne "Posted 3 Days Ago" : inutilisable tel quel
    detailRef: `${origin}/wday/cxs/${tenant}/${site}${p.externalPath}`,
  }));
}

async function fetchWorkday(src: CareerSource, f: Filters): Promise<RawJob[]> {
  const { origin, tenant, site } = parseWorkdayUrl(src.id);
  const out: RawJob[] = [];
  for (const kw of f.titleKeywords) {
    for (let offset = 0; offset < 60; offset += 20) {
      const json = await getJson<{ jobPostings?: WdPosting[] }>(`${origin}/wday/cxs/${tenant}/${site}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: kw }),
      });
      const page = parseWorkday(json, src);
      out.push(...page);
      if (page.length < 20) break;
    }
  }
  return out;
}

/* ---------------- Détail (description) à la demande ---------------- */
export async function fetchDetail(job: { source: string; detailRef?: string | null }): Promise<string | null> {
  if (!job.detailRef) return null;
  if (job.source.startsWith("smartrecruiters:")) {
    const d = await getJson<{ jobAd?: { sections?: Record<string, { title?: string; text?: string }> } }>(job.detailRef);
    const sections = d?.jobAd?.sections ?? {};
    return htmlToText(Object.values(sections).map((s) => `<h3>${s.title ?? ""}</h3>${s.text ?? ""}`).join(""));
  }
  if (job.source.startsWith("workday:")) {
    const d = await getJson<{ jobPostingInfo?: { jobDescription?: string; startDate?: string; timeType?: string } }>(job.detailRef);
    const info = d?.jobPostingInfo;
    if (!info) return null;
    return [htmlToText(info.jobDescription), info.timeType && `Temps : ${info.timeType}`, info.startDate && `Publiée le : ${info.startDate}`]
      .filter(Boolean).join("\n");
  }
  return null;
}

export async function fetchCareerSource(src: CareerSource, f: Filters): Promise<RawJob[]> {
  switch (src.type) {
    case "greenhouse": return fetchGreenhouse(src);
    case "lever": return fetchLever(src);
    case "smartrecruiters": return fetchSmartRecruiters(src);
    case "workday": return fetchWorkday(src, f);
    case "sitemap": throw new Error("Les sources sitemap sont gérées par lib/sources/sitemap.ts");
  }
}
