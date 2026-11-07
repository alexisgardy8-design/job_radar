import Link from "next/link";
import { redirect } from "next/navigation";
import { Auth } from "@/lib/security.ts";
import { cancelMfa, login, signup, verifyMfa } from "../actions.ts";
import { Flash, SubmitButton } from "../components.tsx";

export const dynamic = "force-dynamic";

/** Connexion, inscription (?mode=signup) et second facteur (?mode=2fa) sur une seule page. */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ mode?: string; ok?: string; err?: string }> }) {
  const { mode, ok, err } = await searchParams;
  if (await Auth.current()) redirect("/");
  if (mode === "2fa" && !(await Auth.mfaUserId())) redirect("/login");

  return (
    <main className="login">
      <div className="card">
        <h1 style={{ fontSize: 20, marginTop: 0 }}>{mode === "signup" ? "Créer un compte" : mode === "2fa" ? "Double authentification" : "Job Radar"}</h1>
        <Flash ok={ok} err={err} />

        {mode === "2fa" ? (
          <>
            <form action={verifyMfa} className="stack">
              <label>Code à 6 chiffres de ton application<span className="muted">Ou un code de secours (xxxx-xxxx).</span>
                <input type="text" name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required maxLength={12} />
              </label>
              <SubmitButton>Valider</SubmitButton>
            </form>
            <form action={cancelMfa} style={{ marginTop: 10 }}><button className="btn small" type="submit">Annuler</button></form>
          </>
        ) : mode === "signup" ? (
          <>
            <form action={signup} className="stack">
              <label>E-mail<input type="email" name="email" autoFocus required autoComplete="email" /></label>
              <label>Mot de passe<span className="muted">10 caractères min., lettres et chiffres ou symboles.</span>
                <input type="password" name="password" required minLength={10} autoComplete="new-password" />
              </label>
              <label>Confirmer le mot de passe<input type="password" name="password2" required minLength={10} autoComplete="new-password" /></label>
              <SubmitButton pendingText="Création…">Créer mon compte</SubmitButton>
            </form>
            <p className="muted" style={{ marginBottom: 0 }}>Déjà inscrit ? <Link href="/login">Se connecter</Link></p>
          </>
        ) : (
          <>
            <form action={login} className="stack">
              <label>E-mail<input type="email" name="email" autoFocus required autoComplete="username" /></label>
              <label>Mot de passe<input type="password" name="password" required autoComplete="current-password" /></label>
              <SubmitButton pendingText="Connexion…">Se connecter</SubmitButton>
            </form>
            <p className="muted" style={{ marginBottom: 0 }}>Pas encore de compte ? <Link href="/login?mode=signup">Créer un compte</Link></p>
          </>
        )}
      </div>
    </main>
  );
}
