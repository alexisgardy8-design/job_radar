import Link from "next/link";
import { Auth } from "@/lib/security.ts";
import { JobsRepo, SettingsRepo } from "@/lib/database.ts";
import { Text } from "@/lib/core.ts";
import { dismissJob, scanNow } from "./actions.ts";
import { Flash, Nav, SubmitButton } from "./components.tsx";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const VIEWS = { top: "Meilleurs matchs", all: "Toutes les notées", filtered: "Écartées au tri" } as const;
type View = keyof typeof VIEWS;

const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : null);

export default async function Home({ searchParams }: { searchParams: Promise<{ v?: string; ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const view: View = sp.v && sp.v in VIEWS ? (sp.v as View) : "top";
  const user = await Auth.require();
  const s = await new SettingsRepo(user.id).get();
  const repo = new JobsRepo(user.id);
  const threshold = s.filters.scoreThreshold;
  const [jobs, stats] = await Promise.all([repo.list(view, threshold), repo.stats(threshold)]);

  return (
    <main className="wrap">
      <Nav active="offres" email={user.email} />
      {!s.cvText && <div className="flash err">Commence par importer ton CV dans <Link href="/settings">Réglages</Link> : sans CV, rien n&apos;est noté.</div>}
      <Flash ok={sp.ok} err={sp.err} />

      <div className="stats">
        <div className="stat"><b>{stats.good}</b><span className="muted">matchs ≥ {threshold}</span></div>
        <div className="stat"><b>{stats.scored}</b><span className="muted">offres notées</span></div>
        <div className="stat"><b>{stats.week}</b><span className="muted">vues cette semaine</span></div>
        <div className="stat">
          <span className="muted">Scan automatique chaque matin</span>
          <form action={scanNow} style={{ marginTop: 6 }}><SubmitButton className="btn small primary" pendingText="Scan en cours (1 à 4 min)…">Scanner maintenant</SubmitButton></form>
        </div>
      </div>

      <div className="filters">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <Link key={v} href={`/?v=${v}`} className={`btn small${v === view ? " primary" : ""}`}>{VIEWS[v]}</Link>
        ))}
      </div>

      {!jobs.length && <div className="card muted">Rien ici pour l&apos;instant. Lance un scan ou élargis tes filtres.</div>}

      {jobs.map((j) => {
        const v = j.verdict;
        const url = Text.isUrl(j.url) ? j.url : "#";
        return (
          <article key={j.id} className="card job">
            <div className={`score ${j.score == null ? "low" : j.score >= threshold ? "" : j.score >= 50 ? "mid" : "low"}`}>{j.score ?? "–"}</div>
            <div>
              <h3><a href={url} target="_blank" rel="noopener noreferrer">{j.title}</a></h3>
              <div className="muted">{[j.company, j.location].filter(Boolean).join(" · ")}</div>
              <div className="tags">
                <span className="tag">{j.source.replace(/^(web|email):/, "")}</span>
                {(j.contract || v?.contractDetected) && <span className="tag">{j.contract ?? v?.contractDetected}</span>}
                {v?.experienceRequired && <span className="tag">exp. {v.experienceRequired}</span>}
                {v?.startDate && <span className={`tag ${v.startDateCompatible === "yes" ? "ok" : v.startDateCompatible === "no" ? "no" : ""}`}>début : {v.startDate}</span>}
                <span className="tag">{day(j.posted_at ?? j.first_seen)}</span>
                {j.filter_reason && <span className="tag no">{j.filter_reason}</span>}
              </div>
              {v && (
                <>
                  <div style={{ fontSize: 14 }}>{v.summary}</div>
                  {v.strengths.length > 0 && <ul className="pts">{v.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul>}
                  {v.gaps.length > 0 && <ul className="pts gaps">{v.gaps.map((x, i) => <li key={i}>{x}</li>)}</ul>}
                </>
              )}
              {view !== "filtered" && (
                <form action={dismissJob} style={{ marginTop: 8, display: "flex", gap: 6 }}>
                  <a className="btn small primary" href={url} target="_blank" rel="noopener noreferrer">Postuler</a>
                  <input type="hidden" name="id" value={j.id} />
                  <button className="btn small" type="submit">Masquer</button>
                </form>
              )}
            </div>
          </article>
        );
      })}
    </main>
  );
}
