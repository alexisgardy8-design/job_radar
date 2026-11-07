import Link from "next/link";
import { nameOf, readFlash, requireUser } from "@/lib/auth.ts";
import { forRequest } from "@/lib/supabase.ts";
import { Matches, Profiles } from "@/lib/repos.ts";
import { Text, sourceName, type Match, type Settings } from "@/lib/core.ts";
import { SECTORS, sectorLabel } from "@/lib/companies.ts";
import { dismissMatch } from "./actions.ts";
import { Flash, Nav, Ring, ScanPanel } from "./components.tsx";

export const dynamic = "force-dynamic";

const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : null);

/** Complétude du profil, calculée à partir des réglages existants. */
function profileSteps(s: Settings, has2fa: boolean) {
  return [
    { label: "Importer ton CV", done: !!s.cvText, points: 35, href: "/settings#cv" },
    { label: "Indiquer les postes recherchés", done: s.filters.titleKeywords.length > 0, points: 15, href: "/settings#recherche" },
    { label: "Indiquer tes lieux", done: s.filters.locations.length > 0, points: 10, href: "/settings#recherche" },
    { label: "Choisir tes contrats", done: s.filters.contractTypes.length > 0, points: 10, href: "/settings#recherche" },
    { label: "Activer les e-mails", done: s.notify.enabled, points: 10, href: "/settings#email" },
    { label: "Activer la double authentification", done: has2fa, points: 20, href: "/settings#securite" },
  ];
}

/** Les meilleurs matchs du compte (10 max), conservés 30 jours. */
export default async function Home({ searchParams }: { searchParams: Promise<{ voir?: string }> }) {
  const showAll = (await searchParams).voir === "tout";
  const user = await requireUser();
  const db = await forRequest();
  const [s, all, flash] = await Promise.all([new Profiles(db, user.id).get(), new Matches(db, user.id).list(), readFlash()]);
  const threshold = s.filters.scoreThreshold;
  // Le seuil peut avoir changé depuis le scan : on recalcule à l'affichage.
  const matches = all.filter((m) => m.score >= threshold && !m.verdict?.filteredReason).slice(0, Matches.SHOW);
  const others = all.filter((m) => !matches.includes(m));
  const steps = profileSteps(s, !!user.totpFactorId);
  const strength = steps.reduce((n, x) => n + (x.done ? x.points : 0), 0);
  const next = steps.find((x) => !x.done);
  const best = matches[0]?.score ?? null;
  const name = nameOf(user);

  return (
    <main className="wrap">
      <Nav active="offres" email={user.email} name={name} />
      <Flash flash={flash} />

      <section className="hero">
        <div className="hero-text">
          <p className="eyebrow">Ton radar à offres</p>
          <h1>Salut {name} 👋</h1>
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
            <span className="muted small">Score ≥ {threshold} et filtres respectés · {Matches.SHOW} max, gardés 30 jours</span>
          </div>

          {!matches.length && (
            <div className="card empty">
              <div className="empty-icon">🛰️</div>
              <h3>Aucun match pour l&apos;instant</h3>
              <p className="muted">Lance un scan, ou baisse ton score minimum dans le profil si tes critères sont très précis.</p>
            </div>
          )}

          {matches.map((j, i) => <MatchCard key={j.id} j={j} rank={i} threshold={threshold} />)}

          {others.length > 0 && (
            <div className="reveal">
              <Link className="btn ghost" href={showAll ? "/" : "/?voir=tout#autres"} scroll={!showAll}>
                {showAll ? "Masquer les offres sous ton seuil" : `👀 Voir aussi ${others.length} offre${others.length > 1 ? "s" : ""} sous ton seuil ou écartée${others.length > 1 ? "s" : ""}`}
              </Link>
            </div>
          )}

          {showAll && others.length > 0 && (
            <>
              <div className="section-head" id="autres">
                <h2>🗂️ Sous ton seuil ou écartées</h2>
                <span className="muted small">Notées par l&apos;IA mais pas envoyées</span>
              </div>
              {others.map((j) => <MatchCard key={j.id} j={j} rank={-1} threshold={threshold} />)}
            </>
          )}
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
            <div className="chips">
              {s.filters.sectors.map((id) => <span key={id} className="chip brand">{SECTORS.find((x) => x.id === id)?.emoji} {sectorLabel(id)}</span>)}
              {s.filters.languages.map((l) => <span key={l} className="chip">🗣️ {l}</span>)}
              {s.filters.maxExperienceYears !== null && <span className="chip">🎓 ≤ {s.filters.maxExperienceYears} an{s.filters.maxExperienceYears > 1 ? "s" : ""} d&apos;exp.</span>}
            </div>
            <Link className="btn ghost small" href="/settings#recherche">Modifier</Link>
          </div>
        </aside>
      </div>
    </main>
  );
}

/** Carte d'une offre notée. rank = position parmi les matchs, -1 pour une offre sous le seuil ou écartée. */
function MatchCard({ j, rank, threshold }: { j: Match; rank: number; threshold: number }) {
  const v = j.verdict;
  const url = Text.isUrl(j.url) ? j.url : "#";
  const below = rank < 0;
  const tone = j.score >= 85 ? "good" : j.score >= threshold ? "brand" : j.score >= 50 ? "mid" : "low";
  const site = sourceName(j.source, j.url);
  return (
    <article className={`card job ${rank === 0 ? "featured" : ""} ${below ? "dim" : ""}`}>
      <Ring value={j.score} tone={tone} />
      <div className="job-body">
        <div className="job-badges">
          <span className="source-pill" title={`Offre trouvée sur ${site}`}><span className="source-ico">{site.charAt(0)}</span>Trouvé sur {site}</span>
          {rank === 0 && <span className="pill hot">🔥 Top match</span>}
          {!below && j.score >= 85 && rank !== 0 && <span className="pill gem">💎 Pépite</span>}
          {below && v?.filteredReason && <span className="pill warn">⛔ {v.filteredReason}</span>}
          {below && !v?.filteredReason && j.score < threshold && <span className="pill warn">Sous ton seuil ({j.score} &lt; {threshold})</span>}
          {j.sent_at && <span className="pill">📬 Reçu par e-mail</span>}
          <span className="pill soft">{day(j.found_at)}</span>
        </div>
        <h3><a href={url} target="_blank" rel="noopener noreferrer">{j.title}</a></h3>
        <div className="muted">{[j.company, j.location].filter(Boolean).join(" · ")}</div>
        <div className="tags">
          {v?.sector && v.sector !== "inconnu" && v.sector !== "autre" && <span className="tag">🏢 {sectorLabel(v.sector)}</span>}
          {(j.contract || v?.contractDetected) && <span className="tag">📝 {j.contract ?? v?.contractDetected}</span>}
          {(typeof v?.experienceYearsMin === "number" || v?.experienceRequired) && (
            <span className="tag">🎓 {typeof v?.experienceYearsMin === "number" ? (v.experienceYearsMin === 0 ? "débutant accepté" : `${v.experienceYearsMin} an${v.experienceYearsMin > 1 ? "s" : ""} min.`) : v?.experienceRequired}</span>
          )}
          {v?.languagesRequired?.length ? <span className="tag">🗣️ {v.languagesRequired.join(", ")}</span> : null}
          {v?.startDate && <span className={`tag ${v.startDateCompatible === "yes" ? "ok" : v.startDateCompatible === "no" ? "no" : ""}`}>📅 début : {v.startDate}</span>}
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
          <a className="btn primary" href={url} target="_blank" rel="noopener noreferrer">Postuler sur {site.replace(" (alerte e-mail)", "")} →</a>
          <input type="hidden" name="id" value={j.id} />
          <button className="btn ghost" type="submit">Masquer</button>
        </form>
      </div>
    </article>
  );
}
