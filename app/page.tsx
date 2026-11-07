import Link from "next/link";
import { readFlash, requireUser } from "@/lib/auth.ts";
import { forRequest } from "@/lib/supabase.ts";
import { Matches, Profiles } from "@/lib/repos.ts";
import { Text, type Settings } from "@/lib/core.ts";
import { dismissMatch } from "./actions.ts";
import { Flash, Nav, Ring, ScanPanel } from "./components.tsx";

export const dynamic = "force-dynamic";

const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : null);

/** Complétude du profil, calculée à partir des réglages existants. */
function profileSteps(s: Settings, has2fa: boolean) {
  return [
    { label: "Importer ton CV", done: !!s.cvText, points: 35, href: "/settings#cv" },
    { label: "Choisir tes mots-clés", done: s.filters.titleKeywords.length > 0, points: 15, href: "/settings#recherche" },
    { label: "Indiquer tes lieux", done: s.filters.locations.length > 0, points: 10, href: "/settings#recherche" },
    { label: "Choisir tes contrats", done: s.filters.contractTypes.length > 0, points: 10, href: "/settings#recherche" },
    { label: "Activer les e-mails", done: s.notify.enabled, points: 10, href: "/settings#email" },
    { label: "Activer la double authentification", done: has2fa, points: 20, href: "/settings#securite" },
  ];
}

/** Les meilleurs matchs du compte (10 max), conservés 30 jours. */
export default async function Home() {
  const user = await requireUser();
  const db = await forRequest();
  const [s, matches, flash] = await Promise.all([new Profiles(db, user.id).get(), new Matches(db, user.id).list(), readFlash()]);
  const threshold = s.filters.scoreThreshold;
  const steps = profileSteps(s, !!user.totpFactorId);
  const strength = steps.reduce((n, x) => n + (x.done ? x.points : 0), 0);
  const next = steps.find((x) => !x.done);
  const best = matches[0]?.score ?? null;
  const name = user.email.split("@")[0].split(/[._-]/)[0];

  return (
    <main className="wrap">
      <Nav active="offres" email={user.email} />
      <Flash flash={flash} />

      <section className="hero">
        <div className="hero-text">
          <p className="eyebrow">Ton radar à offres</p>
          <h1>Salut {name.charAt(0).toUpperCase() + name.slice(1)} 👋</h1>
          <p className="hero-sub">
            {matches.length
              ? <>Tu as <b>{matches.length} match{matches.length > 1 ? "s" : ""}</b> au-dessus de {threshold}{best !== null ? <>, le meilleur à <b>{best}/100</b></> : null}.</>
              : <>Lance un scan : l&apos;IA lit les offres du moment et garde celles qui collent à ton CV.</>}
          </p>
          <div className="kpis">
            <div className="kpi"><b>{matches.length}</b><span>matchs gardés</span></div>
            <div className="kpi"><b>{best ?? "–"}</b><span>meilleur score</span></div>
            <div className="kpi"><b>{threshold}</b><span>score minimum</span></div>
          </div>
        </div>
        <ScanPanel hasCv={!!s.cvText} threshold={threshold} />
      </section>

      <div className="layout">
        <section>
          <div className="section-head">
            <h2>🎯 Tes meilleurs matchs</h2>
            <span className="muted small">Les {Matches.KEEP} meilleurs, gardés 30 jours</span>
          </div>

          {!matches.length && (
            <div className="card empty">
              <div className="empty-icon">🛰️</div>
              <h3>Aucun match pour l&apos;instant</h3>
              <p className="muted">Lance un scan, ou baisse ton score minimum dans le profil si tes critères sont très précis.</p>
            </div>
          )}

          {matches.map((j, i) => {
            const v = j.verdict;
            const url = Text.isUrl(j.url) ? j.url : "#";
            const tone = j.score >= 85 ? "good" : j.score >= threshold ? "brand" : "mid";
            return (
              <article key={j.id} className={`card job ${i === 0 ? "featured" : ""}`}>
                <Ring value={j.score} tone={tone} />
                <div className="job-body">
                  <div className="job-badges">
                    {i === 0 && <span className="pill hot">🔥 Top match</span>}
                    {j.score >= 85 && i !== 0 && <span className="pill gem">💎 Pépite</span>}
                    {j.sent_at && <span className="pill">📬 Reçu par e-mail</span>}
                    <span className="pill soft">{day(j.found_at)}</span>
                  </div>
                  <h3><a href={url} target="_blank" rel="noopener noreferrer">{j.title}</a></h3>
                  <div className="muted">{[j.company, j.location].filter(Boolean).join(" · ")}</div>
                  <div className="tags">
                    <span className="tag">{j.source.replace(/^(web|email):/, "")}</span>
                    {(j.contract || v?.contractDetected) && <span className="tag">{j.contract ?? v?.contractDetected}</span>}
                    {v?.experienceRequired && <span className="tag">exp. {v.experienceRequired}</span>}
                    {v?.startDate && <span className={`tag ${v.startDateCompatible === "yes" ? "ok" : v.startDateCompatible === "no" ? "no" : ""}`}>début : {v.startDate}</span>}
                  </div>
                  {v && (
                    <>
                      <p className="summary">{v.summary}</p>
                      <div className="pros-cons">
                        {v.strengths.length > 0 && <ul className="pros">{v.strengths.map((x, k) => <li key={k}>{x}</li>)}</ul>}
                        {v.gaps.length > 0 && <ul className="cons">{v.gaps.map((x, k) => <li key={k}>{x}</li>)}</ul>}
                      </div>
                    </>
                  )}
                  <form action={dismissMatch} className="job-actions">
                    <a className="btn primary" href={url} target="_blank" rel="noopener noreferrer">Postuler →</a>
                    <input type="hidden" name="id" value={j.id} />
                    <button className="btn ghost" type="submit">Masquer</button>
                  </form>
                </div>
              </article>
            );
          })}
        </section>

        <aside>
          <div className="card side">
            <h2>💪 Force du profil</h2>
            <div className="strength">
              <Ring value={strength} size={92} stroke={9} tone={strength >= 80 ? "good" : "brand"} label={<>{strength}<small>%</small></>} />
              <div>
                <b>{strength >= 100 ? "Profil au top !" : strength >= 70 ? "Presque parfait" : "À compléter"}</b>
                {next && <p className="muted small">Prochaine étape : <Link href={next.href}>{next.label}</Link> (+{next.points}%)</p>}
              </div>
            </div>
            <ul className="checklist">
              {steps.map((x) => (
                <li key={x.label} className={x.done ? "done" : ""}>
                  <span className="check-dot">{x.done ? "✓" : ""}</span>
                  {x.done ? x.label : <Link href={x.href}>{x.label}</Link>}
                  <span className="muted small">+{x.points}%</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="card side">
            <h2>🧭 Ta recherche</h2>
            <div className="chips">
              {s.filters.titleKeywords.slice(0, 8).map((k) => <span key={k} className="chip">{k}</span>)}
            </div>
            <div className="chips">
              {s.filters.contractTypes.map((c) => <span key={c} className="chip brand">{c}</span>)}
              {s.filters.locations.slice(0, 3).map((l) => <span key={l} className="chip">📍 {l}</span>)}
            </div>
            <Link className="btn ghost small" href="/settings#recherche">Modifier</Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
