/**
 * Orchestration par compte, entièrement en mémoire :
 * collecte → offres jamais vues → tri gratuit → scoring IA → e-mail des meilleures.
 * En base, on n'écrit que l'empreinte des offres notées (seen_jobs) et les 10 meilleurs matchs.
 * Le scan respecte une échéance (deadline) pour ne jamais dépasser la limite de 300 s de Vercel,
 * et peut publier sa progression (onProgress) pour l'affichage en direct.
 */
import { JobFilter, Text, type RawJob, type Settings, type Verdict } from "./core.ts";
import { JobSource } from "./sources.ts";
import { JobAI } from "./ai.ts";
import { Mailer } from "./mailer.ts";
import { Matches, Private, Profiles, SeenJobs } from "./repos.ts";
import { admin, check } from "./supabase.ts";

export interface ScanReport { fetched: number; fresh: number; scored: number; matched: number; sent: number; best: number | null; errors: string[] }

export type ScanEvent =
  | { type: "collect"; sources: string[] }
  | { type: "source"; name: string; count: number; error?: string; done: number; total: number }
  | { type: "filter"; fetched: number; fresh: number; toScore: number }
  | { type: "scoring"; done: number; total: number; best: number | null }
  | { type: "email"; sent: number }
  | { type: "done"; report: ScanReport; top: { title: string; company: string | null; score: number }[] };

export interface ScanOptions { deadline?: number; onProgress?: (e: ScanEvent) => void }

/** Nom lisible d'une source pour l'affichage. */
export function sourceLabel(name: string): string {
  if (name === "web") return "Recherche web (LinkedIn, Indeed, HelloWork…)";
  if (name === "france_travail") return "France Travail";
  if (name === "adzuna") return "Adzuna";
  const [type, id] = name.split(":");
  return `Site carrière ${id ?? type}`;
}

export class Scanner {
  /** Durée maximale d'un scan (la fonction Vercel est coupée à 300 s). */
  static readonly BUDGET_MS = Number(process.env.SCAN_BUDGET_MS ?? 230_000);

  private constructor(private readonly userId: string, private readonly email: string, private readonly settings: Settings) {}

  /** Charge le compte avec le client service_role (cron, ingestion, scan manuel après authentification). */
  static async forUser(userId: string): Promise<Scanner> {
    const db = admin();
    const { data, error } = await db.auth.admin.getUserById(userId);
    if (error || !data.user?.email) throw new Error(`compte ${userId} introuvable`);
    const row = check(await db.from("profiles").select("cv_text, cv_name, filters, sources, notify_enabled").eq("user_id", userId).maybeSingle(), "profil");
    return new Scanner(userId, data.user.email, Profiles.toSettings(row));
  }

  /** Scan complet à partir des sources du compte. */
  async run(opts: ScanOptions = {}): Promise<ScanReport> {
    const deadline = opts.deadline ?? Date.now() + Scanner.BUDGET_MS;
    const emit = opts.onProgress ?? (() => {});
    const errors: string[] = [];
    const sources = JobSource.forSettings(this.settings);
    if (!sources.length) errors.push("aucune source active ou configurée");
    emit({ type: "collect", sources: sources.map((s) => sourceLabel(s.name)) });

    // Collecte en parallèle, bornée à la moitié du temps disponible.
    let done = 0;
    const collectBy = Date.now() + (deadline - Date.now()) / 2;
    const results = await Promise.all(sources.map(async (s) => {
      try {
        const jobs = await Promise.race([
          s.fetch(),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("trop lent, ignorée pour ce scan")), Math.max(5_000, collectBy - Date.now()))),
        ]);
        emit({ type: "source", name: sourceLabel(s.name), count: jobs.length, done: ++done, total: sources.length });
        return jobs;
      } catch (e) {
        const msg = String((e as Error)?.message ?? e).slice(0, 200);
        errors.push(`${sourceLabel(s.name)} : ${msg}`);
        emit({ type: "source", name: sourceLabel(s.name), count: 0, error: msg, done: ++done, total: sources.length });
        return [];
      }
    }));
    const report = await this.process(results.flat(), Number(process.env.MAX_SCORED_PER_RUN ?? 40), { deadline, onProgress: emit });
    await Private.touchScan(this.userId);
    return { ...report, errors: [...errors, ...report.errors] };
  }

  /** Traite une liste d'offres (scan ou alertes e-mail). */
  async process(jobs: RawJob[], maxScored: number, opts: ScanOptions = {}): Promise<ScanReport> {
    const deadline = opts.deadline ?? Date.now() + Scanner.BUDGET_MS;
    const emit = opts.onProgress ?? (() => {});
    const { cvText, filters, notify } = this.settings;
    const report: ScanReport = { fetched: jobs.length, fresh: 0, scored: 0, matched: 0, sent: 0, best: null, errors: [] };
    if (!cvText) {
      report.errors.push("aucun CV importé : rien n'est noté");
      emit({ type: "done", report, top: [] });
      return report;
    }

    // 1. Dédoublonnage dans le lot, puis on écarte ce qui a déjà été noté.
    const byKey = new Map(jobs.map((j) => [SeenJobs.key(j), j]));
    const unseen = await SeenJobs.unseen(this.userId, [...byKey.keys()]);
    report.fresh = unseen.size;

    // 2. Filtres gratuits (contrat, lieu). Les offres écartées ne sont pas marquées : elles reviendront si les filtres changent.
    // Priorité aux titres qui correspondent aux postes recherchés, puis aux plus récentes ;
    // au-delà de maxScored, les offres restent non vues et passent au scan suivant.
    const filter = new JobFilter(filters);
    const toScore = [...unseen].map((key) => ({ key, job: byKey.get(key)! }))
      .filter(({ job }) => !filter.reject(job))
      .sort((a, b) => filter.relevance(b.job) - filter.relevance(a.job)
        || (Date.parse(b.job.postedAt ?? "") || 0) - (Date.parse(a.job.postedAt ?? "") || 0))
      .slice(0, maxScored);
    emit({ type: "filter", fetched: jobs.length, fresh: unseen.size, toScore: toScore.length });

    // 3. Scoring IA par lots (une requête par lot). Une offre non notée n'est pas marquée : elle sera retentée.
    const scored: { key: string; job: RawJob; verdict: Verdict }[] = [];
    emit({ type: "scoring", done: 0, total: toScore.length, best: null });
    for (let i = 0; i < toScore.length; i += JobAI.BATCH) {
      if (Date.now() > deadline - 50_000) {
        report.errors.push(`temps écoulé : ${toScore.length - i} offre(s) seront notées au prochain scan`);
        break;
      }
      const batch = toScore.slice(i, i + JobAI.BATCH);
      try {
        const verdicts = await JobAI.scoreBatch(batch.map((b) => b.job), cvText, filters);
        // Filtres langue / expérience, appliqués sur ce que l'IA a détecté.
        batch.forEach((item, k) => {
          const v = verdicts[k];
          if (v) scored.push({ ...item, verdict: { ...v, filteredReason: filter.afterScoring(v) } });
        });
      } catch (e) {
        report.errors.push(`scoring : ${String((e as Error)?.message ?? e).slice(0, 150)}`);
        if (/quota|indisponible/i.test(String(e))) break; // inutile d'insister : les offres restantes passeront au prochain scan
      }
      report.best = scored.reduce<number | null>((m, s) => (m === null || s.verdict.score > m ? s.verdict.score : m), null);
      emit({ type: "scoring", done: Math.min(i + batch.length, toScore.length), total: toScore.length, best: report.best });
    }
    report.scored = scored.length;
    await SeenJobs.mark(this.userId, scored.map((s) => s.key));

    // 4. Les matchs (score ≥ seuil et filtres respectés) sont envoyés par e-mail ; les autres sont gardés pour l'affichage sur demande.
    const byScore = [...scored].sort((a, b) => b.verdict.score - a.verdict.score);
    const good = byScore.filter((s) => s.verdict.score >= filters.scoreThreshold && !s.verdict.filteredReason).slice(0, Matches.SHOW);
    const others = byScore.filter((s) => !good.includes(s)).slice(0, Matches.STORE - Matches.SHOW);
    report.matched = good.length;
    let sentAt: string | null = null;
    if (good.length && notify.enabled) {
      try {
        await Mailer.sendJobs(this.email, good.map(({ job, verdict }) => ({
          title: job.title, company: job.company, location: job.location, contract: job.contract ?? verdict.contractDetected,
          url: Text.isUrl(job.url) ? job.url : "#", score: verdict.score, verdict, source: job.source,
        })));
        sentAt = new Date().toISOString();
        report.sent = good.length;
      } catch (e) {
        report.errors.push(`e-mail : ${String(e).slice(0, 150)}`);
      }
      emit({ type: "email", sent: report.sent });
    }
    await Matches.save(this.userId, [...good.map((g) => ({ ...g, sentAt })), ...others.map((o) => ({ ...o, sentAt: null }))]);
    emit({ type: "done", report, top: good.slice(0, 3).map(({ job, verdict }) => ({ title: job.title, company: job.company, score: verdict.score })) });
    return report;
  }
}
