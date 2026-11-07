/** Orchestration par compte : collecte → tri → scoring IA → e-mail. */
import { Database, JobsRepo, SettingsRepo } from "./database.ts";
import { JobFilter, Text, type RawJob, type Settings } from "./core.ts";
import { JobSource } from "./sources.ts";
import { JobAI } from "./ai.ts";
import { Mailer } from "./mailer.ts";

export interface ScanReport { fetched: number; inserted: number; scored: number; sent: number; errors: string[] }

export class Scanner {
  private readonly jobs: JobsRepo;
  private readonly repo: SettingsRepo;

  private constructor(private readonly userId: number, private readonly email: string, private readonly settings: Settings) {
    this.jobs = new JobsRepo(userId);
    this.repo = new SettingsRepo(userId);
  }

  static async forUser(userId: number): Promise<Scanner> {
    const q = await Database.get();
    const user = ((await q`SELECT email FROM users WHERE id = ${userId}`) as { email: string }[])[0];
    if (!user) throw new Error(`compte ${userId} introuvable`);
    return new Scanner(userId, user.email, await new SettingsRepo(userId).get());
  }

  /** Scan complet. */
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
    const inserted = await this.ingest(collected);
    const rest = await this.scoreAndSend(Number(process.env.MAX_SCORED_PER_RUN ?? 40));
    await this.repo.touchScan();
    return { fetched: collected.length, inserted, ...rest, errors: [...errors, ...rest.errors] };
  }

  /** Enregistre les nouvelles offres, pré-filtrées gratuitement. */
  async ingest(jobs: RawJob[]): Promise<number> {
    const filter = new JobFilter(this.settings.filters);
    let n = 0;
    for (const j of jobs) if (await this.jobs.insert(j, filter.reject(j))) n++;
    return n;
  }

  /** Note les offres en attente puis envoie celles au-dessus du seuil. */
  async scoreAndSend(limit: number): Promise<Omit<ScanReport, "fetched" | "inserted">> {
    const { cvText, filters, notify } = this.settings;
    if (!cvText) return { scored: 0, sent: 0, errors: ["aucun CV importé : rien n'est noté"] };
    const errors: string[] = [];
    let scored = 0;

    const pending = await this.jobs.pending(limit);
    for (let i = 0; i < pending.length; i += 4) {
      await Promise.all(pending.slice(i, i + 4).map(async (row) => {
        try {
          const verdict = await JobAI.score({ ...row, externalId: "", contract: Text.contract(row.contract), postedAt: row.posted_at }, cvText, filters);
          await this.jobs.setVerdict(row.id, verdict);
          scored++;
        } catch (e) {
          errors.push(`scoring : ${String(e).slice(0, 150)}`);
          await this.jobs.setError(row.id, String(e));
        }
      }));
    }

    let sent = 0;
    const toSend = notify.enabled ? await this.jobs.unsent(filters.scoreThreshold) : [];
    if (toSend.length) {
      try {
        await Mailer.sendJobs(notify.email ?? this.email, toSend);
        await this.jobs.markSent(toSend.map((j) => j.id));
        sent = toSend.length;
      } catch (e) {
        errors.push(`e-mail : ${String(e).slice(0, 150)}`);
      }
    }
    return { scored, sent, errors };
  }
}
