import { readFlash, requireUser } from "@/lib/auth.ts";
import { forRequest, supabaseAnonKey, supabaseUrl } from "@/lib/supabase.ts";
import { Private, Profiles } from "@/lib/repos.ts";
import { CONTRACTS } from "@/lib/core.ts";
import { Mailer } from "@/lib/mailer.ts";
import { Flash, Nav, PendingSteps, SubmitButton } from "../components.tsx";
import { MfaSetup } from "./mfa-setup.tsx";
import {
  changePassword, deleteAccount, disableMfa, newIngestToken, newRecoveryCodes,
  revokeOtherSessions, saveSettings, sendTestEmail, uploadCv,
} from "../actions.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function SettingsPage() {
  const user = await requireUser();
  const [s, priv, flash] = await Promise.all([new Profiles(await forRequest(), user.id).get(), Private.get(user.id), readFlash()]);
  const f = s.filters;
  const appUrl = process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  const has = (k: string) => !!process.env[k];

  return (
    <main className="wrap">
      <Nav active="reglages" email={user.email} />
      <Flash flash={flash} />

      <div className="page-head">
        <h1>Profil & réglages</h1>
        <p className="muted">Ton CV et tes critères guident l&apos;IA : plus ils sont précis, meilleurs sont les matchs.</p>
      </div>

      <section className="card" id="cv">
        <h2><span className="step-num">1</span> 📄 Ton CV</h2>
        <p className="muted">
          {s.cvText ? `CV actuel : ${s.cvName} (${s.cvText.length.toLocaleString("fr-FR")} caractères). ` : "Aucun CV pour l'instant. "}
          Le PDF est converti en texte puis jeté : seul le texte est conservé, rattaché à ton compte.
        </p>
        <form action={uploadCv} className="stack">
          <label>Importer un PDF<input type="file" name="cv" accept="application/pdf" /></label>
          <label>…ou coller / corriger le texte<textarea name="cvText" defaultValue={s.cvText ?? ""} style={{ minHeight: 160 }} /></label>
          <SubmitButton pendingText="Lecture du CV…">Enregistrer le CV</SubmitButton>
          <PendingSteps steps={["Envoi du PDF", "Lecture par l'IA", "Extraction des expériences et compétences", "Enregistrement dans ton profil"]} everyMs={5000} />
        </form>
      </section>

      <form action={saveSettings} className="stack">
        <section className="card stack" id="recherche">
          <h2><span className="step-num">2</span> 🧭 Ce que tu cherches</h2>
          <label>Mots-clés de poste<span className="muted">Une offre est gardée si son titre contient l&apos;un d&apos;eux. Un par ligne.</span>
            <textarea name="titleKeywords" defaultValue={f.titleKeywords.join("\n")} />
          </label>
          <label>Mots à exclure du titre<textarea name="excludeKeywords" defaultValue={f.excludeKeywords.join("\n")} /></label>
          <div className="checks">
            {CONTRACTS.map((c) => <label key={c} className="check"><input type="checkbox" name={`contract_${c}`} defaultChecked={f.contractTypes.includes(c)} />{c}</label>)}
          </div>
          <div className="row">
            <label>Lieux acceptés<textarea name="locations" defaultValue={f.locations.join("\n")} /></label>
            <label>Départements (France Travail)<textarea name="departements" defaultValue={f.departements.join("\n")} /></label>
          </div>
          <div className="row">
            <label>Début au plus tôt<input type="date" name="minStartDate" defaultValue={f.minStartDate ?? ""} /></label>
            <label>Score minimum pour l&apos;e-mail<input type="number" name="scoreThreshold" min={0} max={100} defaultValue={f.scoreThreshold} /></label>
          </div>
          <label className="check"><input type="checkbox" name="strictStartDate" defaultChecked={f.strictStartDate} />Écarter les offres qui démarrent explicitement avant cette date</label>
        </section>

        <section className="card stack" id="sources">
          <h2><span className="step-num">3</span> 🛰️ Sources</h2>
          <label className="check"><input type="checkbox" name="webSearch" defaultChecked={s.sources.webSearch} />
            Recherche web gratuite : LinkedIn, Indeed, HelloWork, JobTeaser, WTTJ, APEC, sites carrière {has("TAVILY_API_KEY") ? "" : "· non configurée sur le serveur"}</label>
          <label className="check"><input type="checkbox" name="franceTravail" defaultChecked={s.sources.franceTravail} />
            France Travail {has("FRANCE_TRAVAIL_CLIENT_ID") ? "" : "· non configurée sur le serveur"}</label>
          <label className="check"><input type="checkbox" name="adzuna" defaultChecked={s.sources.adzuna} />
            Adzuna {has("ADZUNA_APP_ID") ? "" : "· non configurée sur le serveur"}</label>
          <label>Sites carrière<span className="muted">Une ligne par site : <code>type | identifiant | Nom</code> — greenhouse, lever, smartrecruiters ou workday (URL complète).</span>
            <textarea name="careers" defaultValue={s.sources.careers.map((c) => `${c.type} | ${c.id} | ${c.label}`).join("\n")}
              placeholder="workday | https://exemple.wd3.myworkdayjobs.com/fr-FR/Careers | Exemple Bank" style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }} />
          </label>
        </section>

        <section className="card stack" id="email">
          <h2><span className="step-num">4</span> 📬 Envoi par e-mail</h2>
          <label className="check"><input type="checkbox" name="notifyEnabled" defaultChecked={s.notify.enabled} />
            M&apos;envoyer les offres au-dessus de mon score minimum, avec le lien pour postuler</label>
          <p className="muted" style={{ margin: 0 }}>Envoi à l&apos;adresse de ton compte : {user.email}</p>
          {!Mailer.configured && <p className="muted" style={{ margin: 0 }}>⚠ L&apos;envoi d&apos;e-mails n&apos;est pas encore configuré sur le serveur.</p>}
        </section>
        <div className="sticky-save"><SubmitButton pendingText="Enregistrement…">💾 Enregistrer les réglages</SubmitButton></div>
      </form>
      <form action={sendTestEmail} style={{ margin: "10px 0 28px" }}><SubmitButton className="btn" pendingText="Envoi…">M&apos;envoyer un e-mail de test</SubmitButton></form>

      <div className="page-head" id="securite">
        <h1>🛡️ Sécurité du compte</h1>
      </div>

      <section className="card stack">
        <h2>🔐 Double authentification</h2>
        {user.totpFactorId ? (
          <>
            <p style={{ margin: 0 }}>✅ Activée · {priv.recoveryLeft} code(s) de secours restant(s).</p>
            <div className="row">
              <form action={newRecoveryCodes} className="stack"><label>Mot de passe<input type="password" name="password" required /></label><button className="btn" type="submit">Nouveaux codes de secours</button></form>
              <form action={disableMfa} className="stack"><label>Mot de passe<input type="password" name="password" required /></label><button className="btn" type="submit">Désactiver la 2FA</button></form>
            </div>
          </>
        ) : (
          <MfaSetup url={supabaseUrl()} anonKey={supabaseAnonKey()} />
        )}
      </section>

      <section className="card stack">
        <h2>🔑 Mot de passe</h2>
        <form action={changePassword} className="row">
          <label>Actuel<input type="password" name="password" required autoComplete="current-password" /></label>
          <label>Nouveau<input type="password" name="next" required minLength={10} autoComplete="new-password" /></label>
          <div><button className="btn" type="submit">Changer</button></div>
        </form>
      </section>

      <section className="card stack">
        <h2>💻 Sessions</h2>
        <p className="muted" style={{ margin: 0 }}>Déconnecte tous tes autres appareils (téléphone, autre navigateur…). Changer de mot de passe le fait aussi.</p>
        <form action={revokeOtherSessions}><button className="btn" type="submit">Déconnecter les autres sessions</button></form>
      </section>

      <section className="card stack">
        <h2>📥 Alertes e-mail LinkedIn / Indeed / JobTeaser <span className="pill soft">facultatif</span></h2>
        <p className="muted" style={{ margin: 0 }}>
          Jeton personnel pour le script Gmail (<code>scripts/gmail-forwarder.gs</code>) avec <code>JOB_RADAR_URL = {appUrl}/api/ingest/email</code>.
          {priv.hasIngestToken ? " Un jeton est actif." : ""}
        </p>
        <form action={newIngestToken}><button className="btn" type="submit">{priv.hasIngestToken ? "Régénérer le jeton" : "Générer un jeton"}</button></form>
      </section>

      <section className="card stack danger">
        <h2>🗑️ Supprimer mon compte</h2>
        <form action={deleteAccount} className="row">
          <label>Recopie ton e-mail<input type="email" name="confirm" required /></label>
          <label>Mot de passe<input type="password" name="password" required /></label>
          <div><button className="btn danger" type="submit">Supprimer définitivement</button></div>
        </form>
      </section>
    </main>
  );
}
