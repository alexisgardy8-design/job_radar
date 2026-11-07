import Link from "next/link";
import { readFlash, requireUser } from "@/lib/auth.ts";
import { forRequest } from "@/lib/supabase.ts";
import { Matches, Profiles } from "@/lib/repos.ts";
import { Text } from "@/lib/core.ts";
import { dismissMatch, scanNow } from "./actions.ts";
import { Flash, Nav, SubmitButton } from "./components.tsx";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : null);

/** Les meilleurs matchs du compte (10 max), conservés 30 jours. */
export default async function Home() {
  const user = await requireUser();
  const db = await forRequest();
  const [s, matches, flash] = await Promise.all([new Profiles(db, user.id).get(), new Matches(db, user.id).list(), readFlash()]);
  const threshold = s.filters.scoreThreshold;

  return (
    <main className="wrap">
      <Nav active="offres" email={user.email} />
      {!s.cvText && <div className="flash err">Commence par importer ton CV dans <Link href="/settings">Réglages</Link> : sans CV, rien n&apos;est noté.</div>}
      <Flash flash={flash} />

      <div className="stats">
        <div className="stat"><b>{matches.length}</b><span className="muted">meilleurs matchs gardés (≥ {threshold}, {Matches.KEEP} max)</span></div>
        <div className="stat">
          <span className="muted">Scan automatique chaque matin, résultats envoyés par e-mail</span>
          <form action={scanNow} style={{ marginTop: 6 }}><SubmitButton className="btn small primary" pendingText="Scan en cours (1 à 4 min)…">Scanner maintenant</SubmitButton></form>
        </div>
      </div>

      {!matches.length && <div className="card muted">Aucun match pour l&apos;instant. Lance un scan, ou baisse ton score minimum dans les réglages.</div>}

      {matches.map((j) => {
        const v = j.verdict;
        const url = Text.isUrl(j.url) ? j.url : "#";
        return (
          <article key={j.id} className="card job">
            <div className={`score ${j.score >= threshold ? "" : j.score >= 50 ? "mid" : "low"}`}>{j.score}</div>
            <div>
              <h3><a href={url} target="_blank" rel="noopener noreferrer">{j.title}</a></h3>
              <div className="muted">{[j.company, j.location].filter(Boolean).join(" · ")}</div>
              <div className="tags">
                <span className="tag">{j.source.replace(/^(web|email):/, "")}</span>
                {(j.contract || v?.contractDetected) && <span className="tag">{j.contract ?? v?.contractDetected}</span>}
                {v?.experienceRequired && <span className="tag">exp. {v.experienceRequired}</span>}
                {v?.startDate && <span className={`tag ${v.startDateCompatible === "yes" ? "ok" : v.startDateCompatible === "no" ? "no" : ""}`}>début : {v.startDate}</span>}
                <span className="tag">{day(j.found_at)}</span>
                {j.sent_at && <span className="tag ok">envoyé par e-mail</span>}
              </div>
              {v && (
                <>
                  <div style={{ fontSize: 14 }}>{v.summary}</div>
                  {v.strengths.length > 0 && <ul className="pts">{v.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul>}
                  {v.gaps.length > 0 && <ul className="pts gaps">{v.gaps.map((x, i) => <li key={i}>{x}</li>)}</ul>}
                </>
              )}
              <form action={dismissMatch} style={{ marginTop: 8, display: "flex", gap: 6 }}>
                <a className="btn small primary" href={url} target="_blank" rel="noopener noreferrer">Postuler</a>
                <input type="hidden" name="id" value={j.id} />
                <button className="btn small" type="submit">Masquer</button>
              </form>
            </div>
          </article>
        );
      })}
    </main>
  );
}
