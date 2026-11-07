import { readFlash, requireUser } from "@/lib/auth.ts";
import { resetPassword } from "../actions.ts";
import { Flash, SubmitButton } from "../components.tsx";

export const dynamic = "force-dynamic";

/** Choix d'un nouveau mot de passe après le lien « mot de passe oublié ». */
export default async function ResetPage() {
  const user = await requireUser();
  return (
    <main className="login">
      <div className="login-brand"><span className="brand-dot" />Job Radar</div>
      <div className="card login-card">
        <h1>Nouveau mot de passe</h1>
        <p className="muted">{user.email}</p>
        <Flash flash={await readFlash()} />
        <form action={resetPassword} className="stack">
          <label>Nouveau mot de passe<span className="muted">10 caractères min., lettres et chiffres ou symboles.</span>
            <input type="password" name="password" required minLength={10} maxLength={72} autoComplete="new-password" autoFocus />
          </label>
          <label>Confirmer<input type="password" name="password2" required minLength={10} maxLength={72} autoComplete="new-password" /></label>
          <SubmitButton pendingText="Enregistrement…">Enregistrer</SubmitButton>
        </form>
      </div>
    </main>
  );
}
