import QRCode from "qrcode";
import { Auth, Crypto, Totp } from "@/lib/security.ts";
import { Database, SettingsRepo } from "@/lib/database.ts";
import { CONTRACTS } from "@/lib/core.ts";
import { Mailer } from "@/lib/mailer.ts";
import { Flash, Nav, SubmitButton } from "../components.tsx";
import {
  changePassword, confirmTotp, deleteAccount, disableTotp, newIngestToken, newRecoveryCodes,
  revokeOtherSessions, saveSettings, sendTestEmail, startTotp, uploadCv,
} from "../actions.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const user = await Auth.require();
  const s = await new SettingsRepo(user.id).get();
  const f = s.filters;
  const q = await Database.get();
  const sessions = (await q`SELECT token_hash, created_at, user_agent FROM sessions WHERE user_id = ${user.id} AND expires_at > now() ORDER BY created_at DESC`) as
    { token_hash: string; created_at: string; user_agent: string | null }[];
  const mine = await Auth.sessionHash();
  const codes = (await Auth.readSecret("jr_codes"))?.split(" ");
  const ingestToken = await Auth.readSecret("jr_ingest");
  const pending = user.totp_pending_enc ? Crypto.decrypt(user.totp_pending_enc) : null;
  const qr = pending ? await QRCode.toDataURL(Totp.uri(pending, user.email), { margin: 1, width: 220 }) : null;
  const appUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "";
  const has = (k: string) => !!process.env[k];

  return (
    <main className="wrap">
      <Nav active="reglages" email={user.email} />
      <Flash ok={sp.ok} err={sp.err} />

      <section className="card">
        <h2>1. Ton CV</h2>
        <p className="muted">
          {s.cvText ? `CV actuel : ${s.cvName} (${s.cvText.length.toLocaleString("fr-FR")} caractères). ` : "Aucun CV pour l'instant. "}
          Le PDF est converti en texte puis jeté : seul le texte est conservé, rattaché à ton compte.
        </p>
        <form action={uploadCv} className="stack">
          <label>Importer un PDF<input type="file" name="cv" accept="application/pdf" /></label>
          <label>…ou coller / corriger le texte<textarea name="cvText" defaultValue={s.cvText ?? ""} style={{ minHeight: 160 }} /></label>
          <SubmitButton pendingText="Lecture du CV…">Enregistrer le CV</SubmitButton>
        </form>
      </section>

      <form action={saveSettings} className="stack">
        <section className="card stack">
          <h2>2. Ce que tu cherches</h2>
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

        <section className="card stack">
          <h2>3. Sources</h2>
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

        <section className="card stack">
          <h2>4. Envoi par e-mail</h2>
          <label className="check"><input type="checkbox" name="notifyEnabled" defaultChecked={s.notify.enabled} />
            M&apos;envoyer les offres au-dessus de mon score minimum, avec le lien pour postuler</label>
          <label>Adresse de réception<span className="muted">Vide = {user.email}</span>
            <input type="email" name="email" defaultValue={s.notify.email ?? ""} placeholder={user.email} />
          </label>
          {!Mailer.configured && <p className="muted" style={{ margin: 0 }}>⚠ L&apos;envoi d&apos;e-mails n&apos;est pas encore configuré sur le serveur.</p>}
        </section>
        <SubmitButton>Enregistrer les réglages</SubmitButton>
      </form>
      <form action={sendTestEmail} style={{ margin: "10px 0 28px" }}><SubmitButton className="btn" pendingText="Envoi…">M&apos;envoyer un e-mail de test</SubmitButton></form>

      <h2 id="securite">Sécurité du compte</h2>

      <section className="card stack">
        <h2>Double authentification</h2>
        {codes && <div className="flash"><b>Codes de secours, à noter maintenant (affichés une seule fois) :</b><pre style={{ margin: "8px 0 0" }}>{codes.join("\n")}</pre></div>}
        {user.totp_enabled ? (
          <>
            <p style={{ margin: 0 }}>✅ Activée · {user.recovery_codes.length} code(s) de secours restant(s).</p>
            <div className="row">
              <form action={newRecoveryCodes} className="stack"><label>Mot de passe<input type="password" name="password" required /></label><button className="btn" type="submit">Nouveaux codes de secours</button></form>
              <form action={disableTotp} className="stack"><label>Mot de passe<input type="password" name="password" required /></label><button className="btn" type="submit">Désactiver la 2FA</button></form>
            </div>
          </>
        ) : pending && qr ? (
          <>
            <p style={{ margin: 0 }}>Scanne ce QR code avec ton application (Google Authenticator, Authy, Proton Pass…), puis saisis le code affiché.</p>
            <img src={qr} alt="QR code 2FA" width={220} height={220} style={{ background: "#fff", borderRadius: 8 }} />
            <p className="muted" style={{ margin: 0 }}>Clé manuelle : <code>{pending.match(/.{1,4}/g)?.join(" ")}</code></p>
            <form action={confirmTotp} className="stack">
              <label>Code à 6 chiffres<input type="text" name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={7} /></label>
              <SubmitButton>Activer</SubmitButton>
            </form>
          </>
        ) : (
          <form action={startTotp}><button className="btn primary" type="submit">Activer la 2FA</button></form>
        )}
      </section>

      <section className="card stack">
        <h2>Mot de passe</h2>
        <form action={changePassword} className="row">
          <label>Actuel<input type="password" name="password" required autoComplete="current-password" /></label>
          <label>Nouveau<input type="password" name="next" required minLength={10} autoComplete="new-password" /></label>
          <div><button className="btn" type="submit">Changer</button></div>
        </form>
      </section>

      <section className="card stack">
        <h2>Sessions actives</h2>
        {sessions.map((x) => (
          <div key={x.token_hash} className="muted">
            {new Date(x.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })} · {x.user_agent?.slice(0, 80) ?? "inconnu"}{x.token_hash === mine && <b> (cette session)</b>}
          </div>
        ))}
        <form action={revokeOtherSessions}><button className="btn" type="submit">Déconnecter les autres sessions</button></form>
      </section>

      <section className="card stack">
        <h2>Alertes e-mail LinkedIn / Indeed / JobTeaser (facultatif)</h2>
        <p className="muted" style={{ margin: 0 }}>
          Jeton personnel pour le script Gmail (<code>scripts/gmail-forwarder.gs</code>) avec <code>JOB_RADAR_URL = {appUrl}/api/ingest/email</code>.
          {user.ingest_token_hash ? " Un jeton est actif." : ""}
        </p>
        {ingestToken && <div className="flash"><b>Ton jeton (affiché une seule fois) :</b><br /><code style={{ wordBreak: "break-all" }}>{ingestToken}</code></div>}
        <form action={newIngestToken}><button className="btn" type="submit">{user.ingest_token_hash ? "Régénérer le jeton" : "Générer un jeton"}</button></form>
      </section>

      <section className="card stack">
        <h2>Supprimer mon compte</h2>
        <form action={deleteAccount} className="row">
          <label>Recopie ton e-mail<input type="email" name="confirm" required /></label>
          <label>Mot de passe<input type="password" name="password" required /></label>
          <div><button className="btn" type="submit" style={{ color: "var(--bad)" }}>Supprimer définitivement</button></div>
        </form>
      </section>
    </main>
  );
}
