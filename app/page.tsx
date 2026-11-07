import Link from "next/link";
import { sql, getSettings, type JobRow } from "@/lib/db.ts";
import { dismissJob, logout, scanNow } from "./actions.ts";
import { ScanButton } from "./scan-button.tsx";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const VIEWS = {
  top: "Meilleurs matchs",
  all: "Toutes les notées",
  filtered: "Écartées au tri",
} as const;
type View = keyof typeof VIEWS;

function scoreClass(s: number | null, threshold: number) {
  if (s == null) return "low";
  return s >= threshold ? "" : s >= 50 ? "mid" : "low";
}

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : null);

export default async function Home({ searchParams }: { searchParams: Promise<{ v?: string; flash?: string; errs?: string }> }) {
  const sp = await searchParams;
  const view: View = sp.v && sp.v in VIEWS ? (sp.v as View) : "top";
  const s = await getSettings();

  const jobs = (view === "top"
    ? await sql()`SELECT * FROM jobs WHERE status = 'scored' AND NOT dismissed AND score >= ${s.filters.scoreThreshold} ORDER BY score DESC, first_seen DESC LIMIT 100`
    : view === "all"
    ? await sql()`SELECT * FROM jobs WHERE status = 'scored' AND NOT dismissed ORDER BY first_seen DESC, score DESC LIMIT 200`
    : await sql()`SELECT * FROM jobs WHERE status = 'filtered_out' ORDER BY first_seen DESC LIMIT 200`) as JobRow[];

  const [stats] = (await sql()`
    SELECT count(*) FILTER (WHERE first_seen > now() - interval '7 days')::int AS week,
           count(*) FILTER (WHERE status = 'scored')::int AS scored,
           count(*) FILTER (WHERE status = 'scored' AND score >= ${s.filters.scoreThreshold})::int AS good,
           count(*) FILTER (WHERE status = 'pending')::int AS pending
    FROM jobs`) as { week: number; scored: number; good: number; pending: number }[];
  const [lastRun] = (await sql()`SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 1`) as
    { started_at: string; finished_at: string | null; errors: string[] }[];

  return (
    <main className="wrap">
      <header className="top">
        <h1>Job Radar</h1>
        <nav>
          <Link href="/" className="active">Offres</Link>
          <Link href="/settings">Réglages</Link>
          <form action={logout}><button className="btn" type="submit">Déconnexion</button></form>
        </nav>
      </header>

      {!s.cvText && <div className="flash err">Commence par importer ton CV dans <Link href="/settings">Réglages</Link> : sans CV, rien n'est noté.</div>}
      {sp.flash && <div className="flash">{sp.flash}</div>}
      {sp.errs && <div className="flash err">Erreurs : {sp.errs}</div>}

      <div className="stats">
        <div className="stat"><b>{stats.good}</b><span className="muted">matchs ≥ {s.filters.scoreThreshold}</span></div>
        <div className="stat"><b>{stats.scored}</b><span className="muted">offres notées</span></div>
        <div className="stat"><b>{stats.week}</b><span className="muted">vues cette semaine</span></div>
        <div className="stat">
          <span className="muted">Dernier scan</span>
          <b style={{ fontSize: 15 }}>{lastRun ? new Date(lastRun.started_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "jamais"}</b>
          <form action={scanNow}><ScanButton /></form>
        </div>
      </div>

      <div className="filters">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <Link key={v} href={`/?v=${v}`} className={`btn small${v === view ? " primary" : ""}`}>{VIEWS[v]}</Link>
        ))}
      </div>

      {jobs.length === 0 && <div className="card muted">Rien ici pour l&apos;instant. Lance un scan ou élargis tes filtres.</div>}

      {jobs.map((j) => (
        <article key={j.id} className="card job">
          <div className={`score ${scoreClass(j.score, s.filters.scoreThreshold)}`}>{j.score ?? "–"}</div>
          <div>
            <h3><a href={j.url} target="_blank" rel="noopener noreferrer">{j.title}</a></h3>
            <div className="muted">{[j.company, j.location].filter(Boolean).join(" · ")}</div>
            <div className="tags">
              <span className="tag">{j.source.replace(/^(web|email|sitemap):/, "")}</span>
              {(j.contract || j.verdict?.contractDetected) && <span className="tag">{j.contract ?? j.verdict?.contractDetected}</span>}
              {j.verdict?.experienceRequired && <span className="tag">exp. {j.verdict.experienceRequired}</span>}
              {j.verdict?.startDate && (
                <span className={`tag ${j.verdict.startDateCompatible === "yes" ? "ok" : j.verdict.startDateCompatible === "no" ? "no" : ""}`}>
                  début : {j.verdict.startDate}
                </span>
              )}
              {fmt(j.posted_at ?? j.first_seen) && <span className="tag">{fmt(j.posted_at ?? j.first_seen)}</span>}
              {j.filter_reason && <span className="tag no">{j.filter_reason}</span>}
            </div>
            {j.verdict && (
              <>
                <div style={{ fontSize: 14 }}>{j.verdict.summary}</div>
                {j.verdict.strengths.length > 0 && <ul className="pts">{j.verdict.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul>}
                {j.verdict.gaps.length > 0 && <ul className="pts gaps">{j.verdict.gaps.map((x, i) => <li key={i}>{x}</li>)}</ul>}
              </>
            )}
            {view !== "filtered" && (
              <form action={dismissJob} style={{ marginTop: 8 }}>
                <input type="hidden" name="id" value={j.id} />
                <button className="btn small" type="submit">Masquer</button>
              </form>
            )}
          </div>
        </article>
      ))}
    </main>
  );
}
