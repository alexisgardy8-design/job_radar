/**
 * Sources d'offres (uniquement légales et gratuites). Chaque source est une classe qui implémente fetch().
 * - WebSearchSource : moteur de recherche Tavily (1 000 requêtes/mois offertes) → offres indexées sur
 *   LinkedIn, Indeed, HelloWork, JobTeaser, WTTJ, APEC, sites carrière. On interroge le moteur, pas ces sites.
 * - FranceTravailSource, AdzunaSource : API publiques gratuites.
 * - Greenhouse / Lever / SmartRecruiters / Workday : API publiques des pages carrière d'entreprises.
 */
import { JobFilter, Text, type CareerSite, type Filters, type RawJob, type Settings } from "./core.ts";
import { JobAI } from "./ai.ts";

export abstract class JobSource {
  abstract readonly name: string;
  constructor(protected readonly filters: Filters) {}
  abstract fetch(): Promise<RawJob[]>;

  protected async json<T>(url: string, init: RequestInit = {}): Promise<T | null> {
    const res = await fetch(url, {
      ...init,
      headers: { Accept: "application/json", "User-Agent": "JobRadar/1.0", ...init.headers },
      signal: AbortSignal.timeout(25_000),
      cache: "no-store",
    });
    if (res.status === 204) return null;
    if (!res.ok) throw new Error(`${res.status} sur ${new URL(url).host} ${(await res.text()).slice(0, 150)}`);
    return (await res.json()) as T;
  }

  protected job(p: Partial<RawJob> & Pick<RawJob, "externalId" | "title" | "url">): RawJob {
    return { source: this.name, company: null, location: null, contract: Text.contract(p.title), description: null, postedAt: null, ...p };
  }

  /** Sources actives pour un compte, selon ses réglages et les clés disponibles sur le serveur. */
  static forSettings(s: Settings): JobSource[] {
    const f = s.filters;
    const list: JobSource[] = [];
    if (s.sources.webSearch && process.env.TAVILY_API_KEY) list.push(new WebSearchSource(f));
    if (s.sources.franceTravail && process.env.FRANCE_TRAVAIL_CLIENT_ID) list.push(new FranceTravailSource(f));
    if (s.sources.adzuna && process.env.ADZUNA_APP_ID) list.push(new AdzunaSource(f));
    for (const site of s.sources.careers) list.push(CareerSource.create(site, f));
    return list;
  }
}

/* ---------------- Recherche web (Tavily, gratuit) ---------------- */
export class WebSearchSource extends JobSource {
  readonly name = "web";
  static readonly DOMAINS = [
    "linkedin.com", "indeed.com", "hellowork.com", "jobteaser.com", "welcometothejungle.com", "apec.fr",
    "francetravail.fr", "wizbii.com", "group.bnpparibas", "careers.societegenerale.com", "jobs.ca-cib.com",
    "groupebpce.com", "myworkdayjobs.com", "greenhouse.io", "lever.co", "smartrecruiters.com", "teamtailor.com",
  ];

  private queries(): string[] {
    const { titleKeywords, locations, contractTypes } = this.filters;
    const where = locations[0] ?? "France";
    const contract = contractTypes.includes("CDI") ? "CDI" : contractTypes[0] ?? "";
    const qs = titleKeywords.map((k) => `offre emploi ${contract} "${k}" ${where}`);
    if (contractTypes.includes("CDI")) qs.push(`graduate programme CDI ${where} 2027`);
    return qs.slice(0, Number(process.env.MAX_SEARCHES_PER_RUN ?? 4));
  }

  async fetch(): Promise<RawJob[]> {
    const hits = new Map<string, { title: string; url: string; content: string; published_date?: string }>();
    for (const query of this.queries()) {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.TAVILY_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, search_depth: "basic", time_range: "week", max_results: 15, include_domains: WebSearchSource.DOMAINS }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 432 || res.status === 433) throw new Error("quota Tavily gratuit atteint ce mois-ci");
      if (!res.ok) throw new Error(`Tavily ${res.status}`);
      for (const r of ((await res.json()) as { results?: { title: string; url: string; content: string; published_date?: string }[] }).results ?? []) {
        hits.set(WebSearchSource.canonical(r.url), r);
      }
    }
    const list = [...hits.values()];
    const out: RawJob[] = [];
    for (let i = 0; i < list.length; i += 25) {
      const batch = list.slice(i, i + 25);
      const jobs = await JobAI.extractJobs("des résultats de recherche web (une page par bloc)",
        batch.map((h) => `${h.title}\nURL: ${h.url}\nDate: ${h.published_date ?? "?"}\n${Text.cut(h.content, 1200)}`));
      for (const j of jobs) {
        const hit = batch[j.index];
        if (!hit) continue;
        out.push({
          source: `web:${new URL(hit.url).hostname.replace(/^www\./, "")}`,
          externalId: WebSearchSource.canonical(hit.url),
          title: j.title, company: j.company, location: j.location,
          contract: Text.contract(j.contract) ?? Text.contract(j.title),
          url: hit.url, description: hit.content || null, postedAt: j.postedDate ?? hit.published_date ?? null,
        });
      }
    }
    return out;
  }

  /** URL normalisée pour dédoublonner (tracking, langue, identifiant LinkedIn). */
  static canonical(raw: string): string {
    try {
      const u = new URL(raw);
      u.hash = "";
      for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref|trk|tracking|from|src)/i.test(k)) u.searchParams.delete(k);
      u.hostname = u.hostname.replace(/^www\./, "");
      u.pathname = u.pathname.replace(/^\/[a-z]{2}\/job-offers\//, "/job-offers/").replace(/\/$/, "");
      const li = u.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d{6,})/);
      return u.hostname.endsWith("linkedin.com") && li ? `linkedin:${li[1]}` : u.toString();
    } catch { return raw; }
  }
}

/* ---------------- France Travail (API officielle) ---------------- */
export class FranceTravailSource extends JobSource {
  readonly name = "france_travail";

  private async token(): Promise<string> {
    const res = await fetch("https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.FRANCE_TRAVAIL_CLIENT_ID ?? "",
        client_secret: process.env.FRANCE_TRAVAIL_CLIENT_SECRET ?? "",
        scope: "api_offresdemploiv2 o2dsoffre",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`jeton France Travail ${res.status}`);
    return ((await res.json()) as { access_token: string }).access_token;
  }

  async fetch(): Promise<RawJob[]> {
    const token = await this.token();
    const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
    const now = new Date();
    const contracts = this.filters.contractTypes.filter((c) => c === "CDI" || c === "CDD").join(",");
    type Offre = { id: string; intitule: string; description?: string; dateCreation?: string; typeContrat?: string; entreprise?: { nom?: string }; lieuTravail?: { libelle?: string }; origineOffre?: { urlOrigine?: string } };
    const out: RawJob[] = [];
    for (const kw of this.filters.titleKeywords) {
      const p = new URLSearchParams({ motsCles: kw, range: "0-149", minCreationDate: iso(new Date(+now - 3 * 86_400_000)), maxCreationDate: iso(now) });
      if (contracts) p.set("typeContrat", contracts);
      if (this.filters.departements.length) p.set("departement", this.filters.departements.join(","));
      const data = await this.json<{ resultats?: Offre[] }>(`https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?${p}`, { headers: { Authorization: `Bearer ${token}` } });
      for (const o of data?.resultats ?? []) {
        out.push(this.job({
          externalId: o.id, title: o.intitule, company: o.entreprise?.nom ?? null, location: o.lieuTravail?.libelle ?? null,
          contract: Text.contract(o.typeContrat), description: o.description ?? null, postedAt: o.dateCreation ?? null,
          url: o.origineOffre?.urlOrigine || `https://candidat.francetravail.fr/offres/recherche/detail/${o.id}`,
        }));
      }
    }
    return out;
  }
}

/* ---------------- Adzuna (API gratuite) ---------------- */
export class AdzunaSource extends JobSource {
  readonly name = "adzuna";

  async fetch(): Promise<RawJob[]> {
    type Ad = { id: string; title: string; description?: string; created?: string; redirect_url: string; contract_type?: string; company?: { display_name?: string }; location?: { display_name?: string } };
    const out: RawJob[] = [];
    for (const kw of this.filters.titleKeywords) {
      const p = new URLSearchParams({
        app_id: process.env.ADZUNA_APP_ID ?? "", app_key: process.env.ADZUNA_APP_KEY ?? "",
        what: kw, where: this.filters.locations[0] ?? "France", results_per_page: "50", max_days_old: "3", sort_by: "date",
      });
      const data = await this.json<{ results?: Ad[] }>(`https://api.adzuna.com/v1/api/jobs/fr/search/1?${p}`);
      for (const a of data?.results ?? []) {
        const title = Text.fromHtml(a.title) ?? a.title;
        out.push(this.job({
          externalId: String(a.id), title, url: a.redirect_url, company: a.company?.display_name ?? null,
          location: a.location?.display_name ?? null, description: Text.fromHtml(a.description), postedAt: a.created ?? null,
          contract: a.contract_type === "permanent" ? "CDI" : a.contract_type === "contract" ? "CDD" : Text.contract(title),
        }));
      }
    }
    return out;
  }
}

/* ---------------- Sites carrière (API publiques des ATS) ---------------- */
export abstract class CareerSource extends JobSource {
  readonly name: string;
  constructor(protected readonly site: CareerSite, filters: Filters) {
    super(filters);
    this.name = `${site.type}:${site.id}`;
  }

  static create(site: CareerSite, f: Filters): CareerSource {
    switch (site.type) {
      case "greenhouse": return new GreenhouseSource(site, f);
      case "lever": return new LeverSource(site, f);
      case "smartrecruiters": return new SmartRecruitersSource(site, f);
      case "workday": return new WorkdaySource(site, f);
    }
  }

  /** Ne garde que les offres qui passent le filtre (évite de charger des descriptions inutiles). */
  protected keep(jobs: RawJob[]): RawJob[] {
    const filter = new JobFilter(this.filters);
    return jobs.filter((j) => !filter.reject(j)).slice(0, 25);
  }
}

class GreenhouseSource extends CareerSource {
  async fetch() {
    type G = { id: number; title: string; absolute_url: string; updated_at?: string; location?: { name?: string }; content?: string };
    const data = await this.json<{ jobs?: G[] }>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(this.site.id)}/jobs?content=true`);
    return (data?.jobs ?? []).map((j) => this.job({
      externalId: String(j.id), title: j.title, url: j.absolute_url, company: this.site.label,
      location: j.location?.name ?? null, description: Text.fromHtml(j.content), postedAt: j.updated_at ?? null,
    }));
  }
}

class LeverSource extends CareerSource {
  async fetch() {
    type L = { id: string; text: string; hostedUrl: string; createdAt?: number; categories?: { location?: string; commitment?: string }; descriptionPlain?: string };
    const [host, site] = this.site.id.startsWith("eu:") ? ["api.eu.lever.co", this.site.id.slice(3)] : ["api.lever.co", this.site.id];
    const data = await this.json<L[]>(`https://${host}/v0/postings/${encodeURIComponent(site)}?mode=json`);
    return (data ?? []).map((j) => this.job({
      externalId: j.id, title: j.text, url: j.hostedUrl, company: this.site.label, location: j.categories?.location ?? null,
      contract: Text.contract(j.categories?.commitment) ?? Text.contract(j.text), description: j.descriptionPlain ?? null,
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    }));
  }
}

class SmartRecruitersSource extends CareerSource {
  async fetch() {
    type P = { id: string; name: string; releasedDate?: string; location?: { city?: string; country?: string }; typeOfEmployment?: { label?: string } };
    const id = encodeURIComponent(this.site.id);
    const data = await this.json<{ content?: P[] }>(`https://api.smartrecruiters.com/v1/companies/${id}/postings?limit=100`);
    const jobs = this.keep((data?.content ?? []).map((p) => this.job({
      externalId: p.id, title: p.name, url: `https://jobs.smartrecruiters.com/${id}/${p.id}`, company: this.site.label,
      location: [p.location?.city, p.location?.country?.toUpperCase()].filter(Boolean).join(", ") || null,
      contract: Text.contract(p.typeOfEmployment?.label) ?? Text.contract(p.name), postedAt: p.releasedDate ?? null,
    })));
    for (const j of jobs) {
      const d = await this.json<{ jobAd?: { sections?: Record<string, { text?: string }> } }>(`https://api.smartrecruiters.com/v1/companies/${id}/postings/${j.externalId}`).catch(() => null);
      j.description = Text.fromHtml(Object.values(d?.jobAd?.sections ?? {}).map((s) => s.text ?? "").join("<p>"));
    }
    return jobs;
  }
}

/** id = URL du site carrière, ex. https://acme.wd3.myworkdayjobs.com/fr-FR/AcmeCareers */
class WorkdaySource extends CareerSource {
  async fetch() {
    const u = new URL(this.site.id);
    if (!u.hostname.endsWith(".myworkdayjobs.com")) throw new Error(`URL Workday invalide : ${this.site.id}`);
    const tenant = u.hostname.split(".")[0];
    const site = u.pathname.split("/").filter((p) => p && !/^[a-z]{2}-[A-Z]{2}$/.test(p))[0];
    const api = `${u.origin}/wday/cxs/${tenant}/${site}`;
    type W = { title: string; externalPath: string; locationsText?: string };
    const found: RawJob[] = [];
    for (const kw of this.filters.titleKeywords) {
      const data = await this.json<{ jobPostings?: W[] }>(`${api}/jobs`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: kw }),
      });
      for (const p of data?.jobPostings ?? []) {
        found.push(this.job({ externalId: p.externalPath, title: p.title, url: `${u.origin}/${site}${p.externalPath}`, company: this.site.label, location: p.locationsText ?? null }));
      }
    }
    const jobs = this.keep([...new Map(found.map((j) => [j.externalId, j])).values()]);
    for (const j of jobs) {
      const d = await this.json<{ jobPostingInfo?: { jobDescription?: string } }>(`${api}${j.externalId}`).catch(() => null);
      j.description = Text.fromHtml(d?.jobPostingInfo?.jobDescription);
    }
    return jobs;
  }
}
