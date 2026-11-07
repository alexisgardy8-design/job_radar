import Link from "next/link";
import { getSettings } from "@/lib/db.ts";
import { saveSettings, testNotification, uploadCv, logout } from "../actions.ts";
import type { ContractType } from "@/lib/types.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CONTRACTS: ContractType[] = ["CDI", "CDD", "VIE", "STAGE", "ALTERNANCE", "FREELANCE"];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const s = await getSettings();
  const f = s.filters;
  const careersText = s.sources.careers.map((c) => [c.type, c.id, c.label, c.urlFilter].filter(Boolean).join(" | ")).join("\n");
  const envOk = (k: string) => Boolean(process.env[k]);

  return (
    <main className="wrap">
      <header className="top">
        <h1>Réglages</h1>
        <nav>
          <Link href="/">Offres</Link>
          <Link href="/settings" className="active">Réglages</Link>
          <form action={logout}><button className="btn" type="submit">Déconnexion</button></form>
        </nav>
      </header>
      {sp.ok && <div className="flash">{sp.ok}</div>}
      {sp.err && <div className="flash err">{sp.err}</div>}

      <section className="card">
        <h2>1. Ton CV</h2>
        <p className="muted">
          {s.cvText ? `CV actuel : ${s.cvName} (${s.cvText.length.toLocaleString("fr-FR")} caractères). ` : "Aucun CV pour l'instant. "}
          Le PDF est converti en texte puis jeté : seul le texte est conservé dans ta base.
        </p>
        <form action={uploadCv} className="stack">
          <label>Importer un PDF<input type="file" name="cv" accept="application/pdf" /></label>
          <label>…ou coller / corriger le texte<span className="muted">Laisse vide si tu importes un PDF.</span>
            <textarea name="cvText" defaultValue={s.cvText ?? ""} style={{ minHeight: 160 }} />
          </label>
          <button className="btn primary" type="submit">Enregistrer le CV</button>
        </form>
      </section>

      <form action={saveSettings} className="stack">
        <section className="card stack">
          <h2>2. Ce que tu cherches</h2>
          <label>Mots-clés de poste<span className="muted">Une offre est gardée si son titre contient l&apos;un d&apos;eux. Un par ligne.</span>
            <textarea name="titleKeywords" defaultValue={f.titleKeywords.join("\n")} />
          </label>
          <label>Mots à exclure du titre<textarea name="excludeKeywords" defaultValue={f.excludeKeywords.join("\n")} /></label>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Types de contrat</div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              {CONTRACTS.map((c) => (
                <label key={c} className="check"><input type="checkbox" name={`contract_${c}`} defaultChecked={f.contractTypes.includes(c)} />{c}</label>
              ))}
            </div>
          </div>
          <div className="row">
            <label>Lieux acceptés<span className="muted">Villes, régions, « remote ». Un par ligne.</span>
              <textarea name="locations" defaultValue={f.locations.join("\n")} />
            </label>
            <label>Départements (France Travail)<span className="muted">Ex. 75, 92 (5 max).</span>
              <textarea name="departements" defaultValue={f.departements.join("\n")} />
            </label>
          </div>
          <div className="row">
            <label>Début au plus tôt<input type="date" name="minStartDate" defaultValue={f.minStartDate ?? ""} /></label>
            <label>Score minimum pour être notifié<input type="number" name="scoreThreshold" min={0} max={100} defaultValue={f.scoreThreshold} /></label>
          </div>
          <label className="check">
            <input type="checkbox" name="strictStartDate" defaultChecked={f.strictStartDate} />
            Écarter les offres qui démarrent explicitement avant cette date
          </label>
          <p className="muted" style={{ margin: 0 }}>
            Conseil : la plupart des CDI affichent « dès que possible ». Laisse cette case décochée tant que tu cherches loin à l&apos;avance :
            la date de début reste affichée et prise en compte dans la note.
          </p>
        </section>

        <section className="card stack">
          <h2>3. Sources</h2>
          <label className="check"><input type="checkbox" name="src_webSearch" defaultChecked={s.sources.webSearch} />
            Recherche web : LinkedIn, Indeed, HelloWork, JobTeaser, WTTJ, APEC, sites carrière indexés (≈ 0,005 $/recherche)</label>
          <label className="check"><input type="checkbox" name="src_franceTravail" defaultChecked={s.sources.franceTravail} />
            France Travail (API officielle) {envOk("FRANCE_TRAVAIL_CLIENT_ID") ? "" : "· identifiants absents"}</label>
          <label className="check"><input type="checkbox" name="src_adzuna" defaultChecked={s.sources.adzuna} />
            Adzuna (API gratuite) {envOk("ADZUNA_APP_ID") ? "" : "· identifiants absents"}</label>
          <label>Sites carrière<span className="muted">
            Une ligne par site : <code>type | identifiant | Nom</code>. Types : greenhouse (token du board), lever (nom du site, préfixe <code>eu:</code> si besoin),
            smartrecruiters (id entreprise), workday (URL complète du site carrière), sitemap (URL du sitemap <code>| Nom | /filtre-url/</code>).
          </span>
            <textarea name="careers" defaultValue={careersText} placeholder={"workday | https://exemple.wd3.myworkdayjobs.com/fr-FR/Careers | Exemple Bank\nsitemap | https://jobs.exemple.com/sitemap.xml | Exemple | /job/"} style={{ minHeight: 120, fontFamily: "ui-monospace, monospace", fontSize: 13 }} />
          </label>
          <p className="muted" style={{ margin: 0 }}>
            Alertes e-mail : {envOk("INGEST_SECRET") ? "point d'entrée actif, installe le script Gmail (voir README)." : "désactivées (INGEST_SECRET absent)."}
          </p>
        </section>

        <section className="card stack">
          <h2>4. Notifications</h2>
          <div className="row">
            <label>E-mail {envOk("RESEND_API_KEY") ? "" : <span className="muted">(RESEND_API_KEY absent)</span>}
              <input type="email" name="email" defaultValue={s.notify.email ?? ""} />
            </label>
            <label>Telegram chat id {envOk("TELEGRAM_BOT_TOKEN") ? "" : <span className="muted">(TELEGRAM_BOT_TOKEN absent)</span>}
              <input type="text" name="telegramChatId" defaultValue={s.notify.telegramChatId ?? ""} placeholder="ex. 123456789" />
            </label>
          </div>
        </section>

        <button className="btn primary" type="submit">Enregistrer les réglages</button>
      </form>

      <form action={testNotification} style={{ marginTop: 12 }}>
        <button className="btn" type="submit">Envoyer une notification de test</button>
      </form>
    </main>
  );
}
