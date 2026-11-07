import { neon } from "@neondatabase/serverless";
import {
  DEFAULT_FILTERS, DEFAULT_NOTIFY, DEFAULT_SOURCES,
  type Filters, type NotifySettings, type Settings, type Sources,
} from "./types.ts";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (
  id          integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cv_text     text,
  cv_name     text,
  filters     jsonb NOT NULL DEFAULT '{}'::jsonb,
  sources     jsonb NOT NULL DEFAULT '{}'::jsonb,
  notify      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
)`,
  `INSERT INTO settings (id) VALUES (1) ON CONFLICT DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS jobs (
  id           bigserial PRIMARY KEY,
  source       text NOT NULL,
  external_id  text NOT NULL,
  title        text NOT NULL,
  company      text,
  location     text,
  contract     text,
  url          text NOT NULL,
  description  text,
  detail_ref   text,
  posted_at    timestamptz,
  first_seen   timestamptz NOT NULL DEFAULT now(),
  status       text NOT NULL DEFAULT 'pending',   -- pending | filtered_out | scored | error
  filter_reason text,
  score        integer,
  verdict      jsonb,
  notified_at  timestamptz,
  dismissed    boolean NOT NULL DEFAULT false,
  UNIQUE (source, external_id)
)`,
  `CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status)`,
  `CREATE INDEX IF NOT EXISTS jobs_score_idx ON jobs (score DESC) WHERE status = 'scored'`,
  `CREATE TABLE IF NOT EXISTS scan_runs (
  id          bigserial PRIMARY KEY,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  trigger     text,
  fetched     integer DEFAULT 0,
  inserted    integer DEFAULT 0,
  scored      integer DEFAULT 0,
  notified    integer DEFAULT 0,
  errors      jsonb DEFAULT '[]'::jsonb
)`,
];

let _sql: ReturnType<typeof neon> | null = null;
let _ready: Promise<void> | null = null;

/** Crée les tables au premier accès (idempotent) : pas besoin de passer par la console SQL. */
export function ensureSchema(): Promise<void> {
  if (!_ready) {
    const db = sql();
    _ready = (async () => { for (const q of SCHEMA) await db.query(q); })().catch((e) => { _ready = null; throw e; });
  }
  return _ready;
}

export function sql() {
  if (!_sql) {
    const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
    if (!url) throw new Error("DATABASE_URL manquant : ajoute la base Neon au projet Vercel");
    _sql = neon(url);
  }
  return _sql;
}

type SettingsRow = { cv_text: string | null; cv_name: string | null; filters: Partial<Filters>; sources: Partial<Sources>; notify: Partial<NotifySettings> };

export async function getSettings(): Promise<Settings> {
  await ensureSchema();
  const rows = (await sql()`SELECT cv_text, cv_name, filters, sources, notify FROM settings WHERE id = 1`) as SettingsRow[];
  const r = rows[0];
  return {
    cvText: r?.cv_text ?? null,
    cvName: r?.cv_name ?? null,
    filters: { ...DEFAULT_FILTERS, ...(r?.filters ?? {}) },
    sources: { ...DEFAULT_SOURCES, ...(r?.sources ?? {}) },
    notify: { ...DEFAULT_NOTIFY, ...(r?.notify ?? {}) },
  };
}

export async function saveCv(text: string, name: string) {
  await sql()`
    INSERT INTO settings (id, cv_text, cv_name) VALUES (1, ${text}, ${name})
    ON CONFLICT (id) DO UPDATE SET cv_text = EXCLUDED.cv_text, cv_name = EXCLUDED.cv_name, updated_at = now()`;
}

export async function saveSettingsJson(filters: Filters, sources: Sources, notify: NotifySettings) {
  await sql()`
    INSERT INTO settings (id, filters, sources, notify)
    VALUES (1, ${JSON.stringify(filters)}::jsonb, ${JSON.stringify(sources)}::jsonb, ${JSON.stringify(notify)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET filters = EXCLUDED.filters, sources = EXCLUDED.sources,
      notify = EXCLUDED.notify, updated_at = now()`;
}

export interface JobRow {
  id: number; source: string; title: string; company: string | null; location: string | null;
  contract: string | null; url: string; description: string | null; detail_ref: string | null;
  posted_at: string | null; first_seen: string; status: string; filter_reason: string | null;
  score: number | null; verdict: Verdict | null; notified_at: string | null; dismissed: boolean;
}

export interface Verdict {
  score: number;
  summary: string;
  strengths: string[];
  gaps: string[];
  startDate: string | null;
  startDateCompatible: "yes" | "no" | "unknown";
  experienceRequired: string | null;
  contractDetected: string | null;
}
