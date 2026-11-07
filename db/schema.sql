-- À exécuter une fois dans la console SQL de Neon (ou via `psql $DATABASE_URL -f db/schema.sql`)

CREATE TABLE IF NOT EXISTS settings (
  id          integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cv_text     text,
  cv_name     text,
  filters     jsonb NOT NULL DEFAULT '{}'::jsonb,
  sources     jsonb NOT NULL DEFAULT '{}'::jsonb,
  notify      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS jobs (
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
);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status);
CREATE INDEX IF NOT EXISTS jobs_score_idx ON jobs (score DESC) WHERE status = 'scored';

CREATE TABLE IF NOT EXISTS scan_runs (
  id          bigserial PRIMARY KEY,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  trigger     text,
  fetched     integer DEFAULT 0,
  inserted    integer DEFAULT 0,
  scored      integer DEFAULT 0,
  notified    integer DEFAULT 0,
  errors      jsonb DEFAULT '[]'::jsonb
);
