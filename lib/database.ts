/** Accès Postgres (Neon) : schéma auto-appliqué + dépôts par compte. Toutes les requêtes sont paramétrées. */
import { neon } from "@neondatabase/serverless";
import { DEFAULT_SETTINGS, Text, type JobRow, type RawJob, type Settings, type Verdict } from "./core.ts";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id bigserial PRIMARY KEY,
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    totp_secret_enc text,
    totp_pending_enc text,
    totp_enabled boolean NOT NULL DEFAULT false,
    totp_last_step bigint NOT NULL DEFAULT 0,
    recovery_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
    ingest_token_hash text UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    user_agent text)`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
    id bigserial PRIMARY KEY, key text NOT NULL, at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS login_attempts_key_idx ON login_attempts (key, at)`,
  `CREATE TABLE IF NOT EXISTS user_settings (
    user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data jsonb NOT NULL DEFAULT '{}'::jsonb,
    last_scan timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS user_jobs (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source text NOT NULL,
    external_id text NOT NULL,
    title text NOT NULL,
    company text, location text, contract text,
    url text NOT NULL,
    description text,
    posted_at timestamptz,
    first_seen timestamptz NOT NULL DEFAULT now(),
    status text NOT NULL DEFAULT 'pending',
    filter_reason text,
    score integer,
    verdict jsonb,
    notified_at timestamptz,
    dismissed boolean NOT NULL DEFAULT false,
    UNIQUE (user_id, source, external_id))`,
  `CREATE INDEX IF NOT EXISTS user_jobs_status_idx ON user_jobs (user_id, status)`,
];

type Sql = ReturnType<typeof neon>;

export class Database {
  private static client: Sql | null = null;
  private static ready: Promise<void> | null = null;

  /** Client SQL prêt à l'emploi (schéma créé au premier appel). */
  static async get(): Promise<Sql> {
    if (!this.client) {
      const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
      if (!url) throw new Error("DATABASE_URL manquant : ajoute la base Neon au projet Vercel");
      this.client = neon(url);
    }
    const client = this.client;
    this.ready ??= (async () => { for (const q of SCHEMA) await client.query(q); })().catch((e) => { this.ready = null; throw e; });
    await this.ready;
    return client;
  }
}

/** Réglages d'un compte (CV, filtres, sources, envoi) stockés en un seul JSON. */
export class SettingsRepo {
  constructor(private readonly userId: number) {}

  async get(): Promise<Settings> {
    const q = await Database.get();
    const row = ((await q`SELECT data FROM user_settings WHERE user_id = ${this.userId}`) as { data: Partial<Settings> }[])[0];
    const d = row?.data ?? {};
    return {
      cvText: d.cvText ?? null,
      cvName: d.cvName ?? null,
      filters: { ...DEFAULT_SETTINGS.filters, ...d.filters },
      sources: { ...DEFAULT_SETTINGS.sources, ...d.sources },
      notify: { ...DEFAULT_SETTINGS.notify, ...d.notify },
    };
  }

  async update(patch: Partial<Settings>): Promise<void> {
    const q = await Database.get();
    await q`
      INSERT INTO user_settings (user_id, data) VALUES (${this.userId}, ${JSON.stringify(patch)}::jsonb)
      ON CONFLICT (user_id) DO UPDATE SET data = user_settings.data || EXCLUDED.data, updated_at = now()`;
  }

  /** Vrai si un scan a eu lieu il y a moins de `minutes`. */
  async scannedWithin(minutes: number): Promise<boolean> {
    const q = await Database.get();
    const rows = await q`SELECT 1 FROM user_settings WHERE user_id = ${this.userId} AND last_scan > now() - make_interval(mins => ${minutes})`;
    return (rows as unknown[]).length > 0;
  }

  async touchScan(): Promise<void> {
    const q = await Database.get();
    await q`UPDATE user_settings SET last_scan = now() WHERE user_id = ${this.userId}`;
  }

  /** Comptes à scanner par le cron : ceux qui ont un CV, du moins récemment scanné au plus récent. */
  static async scannableUsers(): Promise<number[]> {
    const q = await Database.get();
    const rows = (await q`SELECT user_id FROM user_settings WHERE data->>'cvText' IS NOT NULL ORDER BY last_scan NULLS FIRST`) as { user_id: number }[];
    return rows.map((r) => r.user_id);
  }
}

/** Offres d'un compte. */
export class JobsRepo {
  constructor(private readonly userId: number) {}

  /** Insère si nouvelle ; renvoie true si l'offre n'existait pas. */
  async insert(j: RawJob, rejectReason: string | null): Promise<boolean> {
    const q = await Database.get();
    const posted = j.postedAt && !Number.isNaN(Date.parse(j.postedAt)) ? j.postedAt : null;
    const rows = await q`
      INSERT INTO user_jobs (user_id, source, external_id, title, company, location, contract, url, description, posted_at, status, filter_reason)
      VALUES (${this.userId}, ${j.source}, ${j.externalId}, ${Text.cut(j.title, 300)}, ${j.company}, ${j.location}, ${j.contract}, ${j.url},
              ${Text.cut(j.description, 15000)}, ${posted}, ${rejectReason ? "filtered_out" : "pending"}, ${rejectReason})
      ON CONFLICT (user_id, source, external_id) DO NOTHING RETURNING id`;
    return (rows as unknown[]).length > 0;
  }

  async pending(limit: number): Promise<JobRow[]> {
    const q = await Database.get();
    return (await q`SELECT * FROM user_jobs WHERE user_id = ${this.userId} AND status = 'pending' ORDER BY first_seen DESC LIMIT ${limit}`) as JobRow[];
  }

  async setVerdict(id: number, v: Verdict): Promise<void> {
    const q = await Database.get();
    await q`UPDATE user_jobs SET status = 'scored', score = ${v.score}, verdict = ${JSON.stringify(v)}::jsonb WHERE id = ${id} AND user_id = ${this.userId}`;
  }

  async setError(id: number, err: string): Promise<void> {
    const q = await Database.get();
    await q`UPDATE user_jobs SET status = 'error', filter_reason = ${err.slice(0, 300)} WHERE id = ${id} AND user_id = ${this.userId}`;
  }

  async unsent(threshold: number): Promise<JobRow[]> {
    const q = await Database.get();
    return (await q`
      SELECT * FROM user_jobs WHERE user_id = ${this.userId} AND status = 'scored' AND notified_at IS NULL
        AND NOT dismissed AND score >= ${threshold} ORDER BY score DESC LIMIT 20`) as JobRow[];
  }

  async markSent(ids: number[]): Promise<void> {
    const q = await Database.get();
    await q`UPDATE user_jobs SET notified_at = now() WHERE user_id = ${this.userId} AND id = ANY(${ids})`;
  }

  async dismiss(id: number): Promise<void> {
    const q = await Database.get();
    await q`UPDATE user_jobs SET dismissed = true WHERE id = ${id} AND user_id = ${this.userId}`;
  }

  async list(view: "top" | "all" | "filtered", threshold: number): Promise<JobRow[]> {
    const q = await Database.get();
    const u = this.userId;
    const rows = view === "top"
      ? await q`SELECT * FROM user_jobs WHERE user_id = ${u} AND status = 'scored' AND NOT dismissed AND score >= ${threshold} ORDER BY score DESC, first_seen DESC LIMIT 100`
      : view === "all"
      ? await q`SELECT * FROM user_jobs WHERE user_id = ${u} AND status = 'scored' AND NOT dismissed ORDER BY first_seen DESC LIMIT 200`
      : await q`SELECT * FROM user_jobs WHERE user_id = ${u} AND status = 'filtered_out' ORDER BY first_seen DESC LIMIT 200`;
    return rows as JobRow[];
  }

  async stats(threshold: number): Promise<{ good: number; scored: number; week: number }> {
    const q = await Database.get();
    const rows = (await q`
      SELECT count(*) FILTER (WHERE status = 'scored' AND score >= ${threshold})::int AS good,
             count(*) FILTER (WHERE status = 'scored')::int AS scored,
             count(*) FILTER (WHERE first_seen > now() - interval '7 days')::int AS week
      FROM user_jobs WHERE user_id = ${this.userId}`) as { good: number; scored: number; week: number }[];
    return rows[0];
  }
}
