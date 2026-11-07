/**
 * Orchestration par compte, entièrement en mémoire :
 * collecte → offres jamais vues → tri gratuit → scoring IA → e-mail des meilleures.
 * En base, on n'écrit que l'empreinte des offres notées (seen_jobs) et les 10 meilleurs matchs.
 */
import { JobFilter, Text, type RawJob, type Settings, type Verdict } from "./core.ts";
import { JobSource } from "./sources.ts";
import { JobAI } from "./ai.ts";
import { Mailer } from "./mailer.ts";
import { Matches, Private, Profiles, SeenJobs } from "./repos.ts";
import { admin, check } from "./supabase.ts";

export interface ScanReport { fetched: number; fresh: number; scored: number; matched: number; sent: number; errors: string[] }

export class Scanner {
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
  async run(): Promise<ScanReport> {
    const errors: string[] = [];
    const sources = JobSource.forSettings(this.settings);
    if (!sources.length) errors.push("aucune source active ou configurée");
    const results = await Promise.allSettled(sources.map((s) => s.fetch()));
    const collected = results.flatMap((r, i) => {
      if (r.status === "fulfilled") return r.value;
      errors.push(`${sources[i].name} : ${String(r.reason).slice(0, 200)}`);
      return [];
    });
    const report = await this.process(collected, Number(process.env.MAX_SCORED_PER_RUN ?? 40));
    await Private.touchScan(this.userId);
    return { ...report, errors: [...errors, ...report.errors] };
  }

  /** Traite une liste d'offres (scan ou alertes e-mail). */
  async process(jobs: RawJob[], maxScored: number): Promise<ScanReport> {
    const { cvText, filters, notify } = this.settings;
    const report: ScanReport = { fetched: jobs.length, fresh: 0, scored: 0, matched: 0, sent: 0, errors: [] };
    if (!cvText) return { ...report, errors: ["aucun CV importé : rien n'est noté"] };

    // 1. Dédoublonnage dans le lot, puis on écarte ce qui a déjà été noté.
    const byKey = new Map(jobs.map((j) => [SeenJobs.key(j), j]));
    const unseen = await SeenJobs.unseen(this.userId, [...byKey.keys()]);
    report.fresh = unseen.size;

    // 2. Tri gratuit. Les offres écartées ne sont pas marquées : elles reviendront si les filtres changent.
    // Les plus récentes d'abord ; au-delà de maxScored, les offres restent non vues et passent au scan suivant.
    const filter = new JobFilter(filters);
    const toScore = [...unseen].map((key) => ({ key, job: byKey.get(key)! }))
      .filter(({ job }) => !filter.reject(job))
      .sort((a, b) => (Date.parse(b.job.postedAt ?? "") || 0) - (Date.parse(a.job.postedAt ?? "") || 0))
      .slice(0, maxScored);

    // 3. Scoring IA, 4 en parallèle. Une offre en erreur n'est pas marquée : elle sera retentée.
    const scored: { key: string; job: RawJob; verdict: Verdict }[] = [];
    for (let i = 0; i < toScore.length; i += 4) {
      await Promise.all(toScore.slice(i, i + 4).map(async (item) => {
        try {
          scored.push({ ...item, verdict: await JobAI.score(item.job, cvText, filters) });
        } catch (e) {
          report.errors.push(`scoring : ${String(e).slice(0, 150)}`);
        }
      }));
    }
    report.scored = scored.length;
    await SeenJobs.mark(this.userId, scored.map((s) => s.key));

    // 4. Les meilleures : e-mail puis conservation des 10 meilleures du compte.
    const good = scored.filter((s) => s.verdict.score >= filters.scoreThreshold).sort((a, b) => b.verdict.score - a.verdict.score).slice(0, Matches.KEEP);
    report.matched = good.length;
    let sentAt: string | null = null;
    if (good.length && notify.enabled) {
      try {
        await Mailer.sendJobs(this.email, good.map(({ job, verdict }) => ({
          title: job.title, company: job.company, location: job.location, contract: job.contract ?? verdict.contractDetected,
          url: Text.isUrl(job.url) ? job.url : "#", score: verdict.score, verdict,
        })));
        sentAt = new Date().toISOString();
        report.sent = good.length;
      } catch (e) {
        report.errors.push(`e-mail : ${String(e).slice(0, 150)}`);
      }
    }
    await Matches.save(this.userId, good, sentAt);
    return report;
  }
}
