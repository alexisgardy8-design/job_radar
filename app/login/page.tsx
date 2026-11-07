import Link from "next/link";
import { redirect } from "next/navigation";
import { authState, readFlash } from "@/lib/auth.ts";
import { forgotPassword, login, logout, signup, verifyMfa } from "../actions.ts";
import { Flash, SubmitButton } from "../components.tsx";

export const dynamic = "force-dynamic";

/** Connexion, inscription (?mode=signup), mot de passe oublié (?mode=forgot) et 2FA (?mode=2fa). */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  const state = await authState();
  if (state.status === "ok") redirect("/");
  if (state.status === "mfa_required" && mode !== "2fa") redirect("/login?mode=2fa");
  if (state.status === "anonymous" && mode === "2fa") redirect("/login");
  const flash = await readFlash();

  const title = { signup: "Créer un compte", forgot: "Mot de passe oublié", "2fa": "Double authentification" }[mode ?? ""] ?? "Job Radar";

  return (
    <main className="login">
      <div className="card">
        <h1 style={{ fontSize: 20, marginTop: 0 }}>{title}</h1>
        <Flash flash={flash} />

        {mode === "2fa" ? (
          <>
            <form action={verifyMfa} className="stack">
              <label>Code à 6 chiffres de ton application<span className="muted">Ou un code de secours (xxxxx-xxxxx-xxxxx-xxxxx).</span>
                <input type="text" name="code" inputMode="text" autoComplete="one-time-code" autoFocus required maxLength={23} />
              </label>
              <SubmitButton>Valider</SubmitButton>
            </form>
            <form action={logout} style={{ marginTop: 10 }}><button className="btn small" type="submit">Annuler</button></form>
          </>
        ) : mode === "signup" ? (
          <>
            <form action={signup} className="stack">
              <label>E-mail<input type="email" name="email" autoFocus required autoComplete="email" /></label>
              <label>Mot de passe<span className="muted">10 caractères min., lettres et chiffres ou symboles.</span>
                <input type="password" name="password" required minLength={10} maxLength={72} autoComplete="new-password" />
              </label>
              <label>Confirmer le mot de passe<input type="password" name="password2" required minLength={10} maxLength={72} autoComplete="new-password" /></label>
              <SubmitButton pendingText="Création…">Créer mon compte</SubmitButton>
            </form>
            <p className="muted" style={{ marginBottom: 0 }}>Déjà inscrit ? <Link href="/login">Se connecter</Link></p>
          </>
        ) : mode === "forgot" ? (
          <>
            <form action={forgotPassword} className="stack">
              <label>E-mail du compte<input type="email" name="email" autoFocus required autoComplete="email" /></label>
              <SubmitButton pendingText="Envoi…">Recevoir un lien de réinitialisation</SubmitButton>
            </form>
            <p className="muted" style={{ marginBottom: 0 }}><Link href="/login">Retour à la connexion</Link></p>
          </>
        ) : (
          <>
            <form action={login} className="stack">
              <label>E-mail<input type="email" name="email" autoFocus required autoComplete="username" /></label>
              <label>Mot de passe<input type="password" name="password" required autoComplete="current-password" /></label>
              <SubmitButton pendingText="Connexion…">Se connecter</SubmitButton>
            </form>
            <p className="muted" style={{ marginBottom: 0 }}>
              <Link href="/login?mode=forgot">Mot de passe oublié ?</Link> · Pas encore de compte ? <Link href="/login?mode=signup">Créer un compte</Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
