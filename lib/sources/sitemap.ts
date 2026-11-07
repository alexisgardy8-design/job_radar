/**
 * Source générique « sitemap + JSON-LD » :
 * lit le sitemap public d'un site carrière, puis le bloc schema.org/JobPosting
 * que chaque page d'offre publie pour les moteurs de recherche.
 * Respecte le robots.txt du site (règles « User-agent: * »).
 */
import type { CareerSource, RawJob } from "../types.ts";
import { containsWords, decodeEntities, guessContract, htmlToText, norm } from "../text.ts";

const UA = "JobRadar/1.0 (personal job alert)";

async function getText(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xml,text/xml,*/*" },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status} sur ${url}`);
  return res.text();
}

/* ---------- robots.txt ---------- */
export interface RobotsRules { allow: string[]; disallow: string[] }

export function parseRobots(txt: string | null): RobotsRules {
  const rules: RobotsRules = { allow: [], disallow: [] };
  if (!txt) return rules;
  let applies = false;
  let inAgentBlock = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!inAgentBlock) applies = false;
      inAgentBlock = true;
      if (val === "*" || /jobradar/i.test(val)) applies = true;
      continue;
    }
    inAgentBlock = false;
    if (!applies) continue;
    if (key === "disallow" && val) rules.disallow.push(val);
    if (key === "allow" && val) rules.allow.push(val);
  }
  return rules;
}

function ruleMatches(rule: string, path: string): number {
  const anchored = rule.endsWith("$");
  const body = anchored ? rule.slice(0, -1) : rule;
  const re = new RegExp("^" + body.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""));
  return re.test(path) ? body.length : -1;
}

/** Règle la plus longue gagne ; à égalité, Allow gagne (comportement de Google). */
export function isAllowed(rules: RobotsRules, path: string): boolean {
  let best = -1;
  let allowed = true;
  for (const r of rules.disallow) { const l = ruleMatches(r, path); if (l > best) { best = l; allowed = false; } }
  for (const r of rules.allow) { const l = ruleMatches(r, path); if (l >= best && l >= 0) { best = l; allowed = true; } }
  return allowed;
}

/* ---------- sitemap ---------- */
export interface SitemapEntry { loc: string; lastmod: string | null }

export function parseSitemap(xml: string): { urls: SitemapEntry[]; sitemaps: string[] } {
  const blocks = (tag: string) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "gi"))].map((m) => m[1]);
  const val = (block: string, tag: string) => {
    const m = block.match(new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</${tag}>`, "i"));
    return m ? decodeEntities(m[1].trim()) : null;
  };
  return {
    urls: blocks("url").map((b) => ({ loc: val(b, "loc")!, lastmod: val(b, "lastmod") })).filter((e) => e.loc),
    sitemaps: blocks("sitemap").map((b) => val(b, "loc")!).filter(Boolean),
  };
}

/* ---------- JSON-LD JobPosting ---------- */
type Json = Record<string, unknown>;

function findJobPosting(node: unknown): Json | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) { for (const n of node) { const f = findJobPosting(n); if (f) return f; } return null; }
  const o = node as Json;
  const t = o["@type"];
  if (t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"))) return o;
  if (o["@graph"]) return findJobPosting(o["@graph"]);
  return null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function locationText(loc: unknown): string | null {
  const list = Array.isArray(loc) ? loc : loc ? [loc] : [];
  const parts = list.map((l) => {
    const a = ((l as Json)?.address ?? {}) as Json;
    return [str(a.addressLocality), str(a.postalCode), str(a.addressRegion), str(a.addressCountry) ?? str((a.addressCountry as Json)?.name)]
      .filter(Boolean).join(", ");
  }).filter(Boolean);
  return parts.length ? [...new Set(parts)].join(" | ") : null;
}

export function extractJobPosting(html: string, url: string, src: CareerSource): RawJob | null {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const jp = findJobPosting(data);
    if (!jp) continue;
    const title = str(jp.title);
    if (!title) continue;
    const employment = Array.isArray(jp.employmentType) ? jp.employmentType.join(" ") : str(jp.employmentType);
    const remote = jp.jobLocationType === "TELECOMMUTE" ? "remote" : null;
    const start = str(jp.jobStartDate);
    const desc = htmlToText(str(jp.description));
    return {
      source: `sitemap:${new URL(url).hostname}`,
      externalId: url,
      title: decodeEntities(title),
      company: str((jp.hiringOrganization as Json)?.name) ?? src.label,
      location: [locationText(jp.jobLocation), remote].filter(Boolean).join(" | ") || null,
      contract: guessContract(employment) ?? guessContract(title),
      url,
      description: [desc, start && `Date de début indiquée : ${start}`].filter(Boolean).join("\n\n") || null,
      postedAt: str(jp.datePosted),
    };
  }
  return null;
}

/* ---------- orchestration ---------- */

/** Étape 1 : URL candidates du sitemap (récentes, autorisées par robots.txt). */
export async function listSitemapUrls(src: CareerSource, sinceDays: number): Promise<{ urls: string[]; robots: RobotsRules }> {
  const origin = new URL(src.id).origin;
  const robots = parseRobots(await getText(`${origin}/robots.txt`).catch(() => null));
  const cutoff = Date.now() - sinceDays * 86_400_000;
  const entries: SitemapEntry[] = [];
  const queue = [src.id];
  let fetched = 0;
  while (queue.length && fetched < 6) {
    const xml = await getText(queue.shift()!);
    fetched++;
    if (!xml) continue;
    const parsed = parseSitemap(xml);
    entries.push(...parsed.urls);
    const children = src.urlFilter ? parsed.sitemaps.filter((s) => /job|offre|career|emploi|position/i.test(s)) : parsed.sitemaps;
    queue.push(...(children.length ? children : parsed.sitemaps));
  }
  const urls = entries
    .filter((e) => !src.urlFilter || e.loc.includes(src.urlFilter))
    .filter((e) => !e.lastmod || Date.parse(e.lastmod) >= cutoff || Number.isNaN(Date.parse(e.lastmod)))
    .map((e) => e.loc)
    .filter((u) => { try { const x = new URL(u); return x.origin === origin && isAllowed(robots, x.pathname + x.search); } catch { return false; } });
  return { urls: [...new Set(urls)], robots };
}

/** Classe les URL : celles dont le slug contient un mot-clé passent en premier. */
export function rankBySlug(urls: string[], keywords: string[]): string[] {
  const slug = (u: string) => { try { return norm(decodeURIComponent(new URL(u).pathname)); } catch { return norm(u); } };
  const score = (u: string) => (keywords.some((k) => containsWords(slug(u), k)) ? 0 : 1);
  return [...urls].sort((a, b) => score(a) - score(b));
}

/** Étape 2 : lit les pages d'offres (avec une pause pour ménager le site). */
export async function fetchJobPages(urls: string[], src: CareerSource): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (const url of urls) {
    const html = await getText(url).catch(() => null);
    if (html) { const job = extractJobPosting(html, url, src); if (job) out.push(job); }
    await new Promise((r) => setTimeout(r, 500));
  }
  return out;
}
