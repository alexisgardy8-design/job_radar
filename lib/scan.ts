import { getSettings, sql, type JobRow } from "./db.ts";
import { prefilter } from "./filters.ts";
import type { RawJob, Settings } from "./types.ts";
import { truncate } from "./text.ts";
import { fetchFranceTravail } from "./sources/francetravail.ts";
import { fetchAdzuna } from "./sources/adzuna.ts";
import { fetchCareerSource, fetchDetail } from "./sources/careers.ts";
import { fetchJobPages, listSitemapUrls, rankBySlug } from "./sources/sitemap.ts";
import { fetchWebSearch } from "./sources/websearch.ts";
import { mapLimit } from "./sources/http.ts";
import { scoreJob } from "./ai.ts";
import { notify } from "./notify.ts";

const SINCE_DAYS = 3;

/** Insère les nouvelles offres (pré-filtrées) ; renvoie le nombre réellement nouvelles. */
export async function insertJobs(jobs: RawJob[], s: Settings): Promise<number> {
  let inserted = 0;
  for (const j of jobs) {
    const pf = prefilter(j, s.filters);
    const rows = (await sql()`
      INSERT INTO jobs (source, external_id, title, company, location, contract, url, description, detail_ref, posted_at, status, filter_reason)
      VALUES (${j.source}, ${j.externalId}, ${truncate(j.title, 300)}, ${j.company}, ${j.location}, ${j.contract}, ${j.url},
              ${truncate(j.description, 15000)}, ${j.detailRef ?? null}, ${j.postedAt && !Number.isNaN(Date.parse(j.postedAt)) ? j.postedAt : null},
              ${pf.keep ? "pending" : "filtered_out"}, ${pf.keep ? null : pf.reason})
      ON CONFLICT (source, external_id) DO NOTHING
      RETURNING id`) as { id: number }[];
    inserted += rows.length;
  }
  return inserted;
}

/** Même offre vue sur deux sources (ex. JobTeaser et site carrière) : on ne garde que la première. */
async function markCrossSourceDuplicates() {
  await sql()`
    UPDATE jobs j SET status = 'filtered_out', filter_reason = 'doublon'
    WHERE j.status = 'pending' AND EXISTS (
      SELECT 1 FROM jobs o WHERE o.id < j.id AND o.status <> 'filtered_out'
        AND lower(o.title) = lower(j.title) AND lower(coalesce(o.company,'')) = lower(coalesce(j.company,''))
        AND lower(coalesce(o.company,'')) <> '')`;
}

/** Note les offres en attente, puis envoie les meilleures non encore notifiées. */
export async function scoreAndNotify(s: Settings, limit: number): Promise<{ scored: number; notified: number; errors: string[] }> {
  const errors: string[] = [];
  if (!s.cvText) return { scored: 0, notified: 0, errors: ["Aucun CV importé : rien n'est noté"] };

  await markCrossSourceDuplicates();
  const pending = (await sql()`
    SELECT * FROM jobs WHERE status = 'pending' ORDER BY first_seen DESC LIMIT ${limit}`) as JobRow[];

  let scored = 0;
  await mapLimit(pending, 4, async (row) => {
    try {
      let description = row.description;
      if (!description && row.detail_ref) description = await fetchDetail({ source: row.source, detailRef: row.detail_ref }).catch(() => null);
      const verdict = await scoreJob({
        source: row.source, externalId: "", title: row.title, company: row.company, location: row.location,
        contract: row.contract as RawJob["contract"], url: row.url, description, postedAt: row.posted_at,
      }, s.cvText!, s.filters);
      await sql()`
        UPDATE jobs SET status = 'scored', score = ${verdict.score}, verdict = ${JSON.stringify(verdict)}::jsonb,
          description = coalesce(description, ${truncate(description, 15000)})
        WHERE id = ${row.id}`;
      scored++;
    } catch (e) {
      errors.push(`scoring #${row.id} : ${String(e).slice(0, 200)}`);
      await sql()`UPDATE jobs SET status = 'error', filter_reason = ${String(e).slice(0, 300)} WHERE id = ${row.id}`;
    }
  });

  const toSend = (await sql()`
    SELECT * FROM jobs WHERE status = 'scored' AND notified_at IS NULL AND NOT dismissed
      AND score >= ${s.filters.scoreThreshold}
    ORDER BY score DESC LIMIT 25`) as JobRow[];
  if (toSend.length) {
    const notifErrors = await notify(s.notify, toSend);
    errors.push(...notifErrors);
    if (notifErrors.length === 0 || notifErrors.length < Number(!!s.notify.email) + Number(!!s.notify.telegramChatId)) {
      const ids = toSend.map((j) => j.id);
      await sql()`UPDATE jobs SET notified_at = now() WHERE id = ANY(${ids})`;
    }
  }
  return { scored, notified: toSend.length, errors };
}

/** Scan complet : collecte sur toutes les sources, tri, scoring, notification. */
export async function runScan(trigger: string) {
  const s = await getSettings();
  const runRows = (await sql()`INSERT INTO scan_runs (trigger) VALUES (${trigger}) RETURNING id`) as { id: number }[];
  const runId = runRows[0].id;
  const errors: string[] = [];
  const collected: RawJob[] = [];

  const tasks: [string, () => Promise<RawJob[]>][] = [];
  if (s.sources.franceTravail && process.env.FRANCE_TRAVAIL_CLIENT_ID) tasks.push(["France Travail", () => fetchFranceTravail(s.filters, SINCE_DAYS)]);
  if (s.sources.adzuna && process.env.ADZUNA_APP_ID) tasks.push(["Adzuna", () => fetchAdzuna(s.filters, SINCE_DAYS)]);
  if (s.sources.webSearch) tasks.push(["Recherche web", () => fetchWebSearch(s.filters, "week")]);
  for (const src of s.sources.careers) {
    if (src.type === "sitemap") {
      tasks.push([`Sitemap ${src.label}`, async () => {
        const { urls } = await listSitemapUrls(src, 14);
        const known = new Set(((await sql()`SELECT external_id FROM jobs WHERE external_id = ANY(${urls})`) as { external_id: string }[]).map((r) => r.external_id));
        const fresh = rankBySlug(urls.filter((u) => !known.has(u)), s.filters.titleKeywords).slice(0, 25);
        return fetchJobPages(fresh, src);
      }]);
    } else {
      tasks.push([`${src.type} ${src.label}`, () => fetchCareerSource(src, s.filters)]);
    }
  }

  const results = await Promise.allSettled(tasks.map(([, fn]) => fn()));
  results.forEach((r, i) => {
    if (r.status === "fulfilled") collected.push(...r.value);
    else errors.push(`${tasks[i][0]} : ${String(r.reason).slice(0, 300)}`);
  });

  const inserted = await insertJobs(collected, s);
  const res = await scoreAndNotify(s, Number(process.env.MAX_SCORED_PER_RUN ?? 40));
  errors.push(...res.errors);

  await sql()`
    UPDATE scan_runs SET finished_at = now(), fetched = ${collected.length}, inserted = ${inserted},
      scored = ${res.scored}, notified = ${res.notified}, errors = ${JSON.stringify(errors)}::jsonb
    WHERE id = ${runId}`;
  return { fetched: collected.length, inserted, ...res, errors };
}
