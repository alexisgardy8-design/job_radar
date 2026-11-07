"use client";
/**
 * Activation de la 2FA TOTP avec Supabase Auth, côté navigateur :
 * enroll() renvoie le QR code, challengeAndVerify() valide le premier code, puis le serveur génère les codes de secours.
 */
import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { finishMfaSetup } from "../actions.ts";

type Pending = { factorId: string; qr: string; secret: string };

export function MfaSetup({ url, anonKey }: { url: string; anonKey: string }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sb = () => createBrowserClient(url, anonKey);

  async function start() {
    setBusy(true); setError(null);
    const client = sb();
    // Un ancien essai non terminé bloquerait un nouvel enrôlement : on le supprime.
    const { data: list } = await client.auth.mfa.listFactors();
    for (const f of list?.all ?? []) if (f.status === "unverified") await client.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `Job Radar ${new Date().toISOString().slice(0, 10)}` });
    setBusy(false);
    if (error || !data) return setError(error?.message ?? "Activation impossible.");
    setPending({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function verify(form: FormData) {
    if (!pending) return;
    setBusy(true); setError(null);
    const { error } = await sb().auth.mfa.challengeAndVerify({ factorId: pending.factorId, code: String(form.get("code") ?? "").replace(/\s/g, "") });
    if (error) { setBusy(false); return setError("Code incorrect : vérifie l'heure de ton téléphone et réessaie."); }
    await finishMfaSetup(); // redirige avec les codes de secours
  }

  if (!pending) {
    return (
      <>
        {error && <div className="flash err">{error}</div>}
        <div><button className="btn primary" type="button" onClick={start} disabled={busy}>{busy ? "Préparation…" : "Activer la 2FA"}</button></div>
      </>
    );
  }
  return (
    <>
      <p style={{ margin: 0 }}>Scanne ce QR code avec ton application (Google Authenticator, Authy, Proton Pass…), puis saisis le code affiché.</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={pending.qr} alt="QR code 2FA" width={220} height={220} style={{ background: "#fff", borderRadius: 8 }} />
      <p className="muted" style={{ margin: 0 }}>Clé manuelle : <code>{pending.secret.match(/.{1,4}/g)?.join(" ")}</code></p>
      {error && <div className="flash err">{error}</div>}
      <form action={verify} className="stack">
        <label>Code à 6 chiffres<input type="text" name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={7} /></label>
        <div><button className="btn primary" type="submit" disabled={busy}>{busy ? "Vérification…" : "Activer"}</button></div>
      </form>
    </>
  );
}
