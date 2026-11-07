/**
 * Session et 2FA, déléguées à Supabase Auth (mots de passe, e-mails de vérification, TOTP, sessions révocables).
 * Ce module ne fait qu'exposer l'utilisateur courant aux pages et aux actions.
 */
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { forRequest, stateless } from "./supabase.ts";

export interface AppUser {
  id: string;
  email: string;
  /** Id du facteur TOTP vérifié, ou null si la 2FA n'est pas active. */
  totpFactorId: string | null;
}

export type AuthState = { status: "anonymous" } | { status: "mfa_required"; user: AppUser } | { status: "ok"; user: AppUser };

/** État d'authentification de la requête (mis en cache pendant la requête). getUser() valide le jeton auprès de Supabase. */
export const authState = cache(async (): Promise<AuthState> => {
  const sb = await forRequest();
  const { data } = await sb.auth.getUser();
  if (!data.user?.email) return { status: "anonymous" };
  const factor = data.user.factors?.find((f) => f.factor_type === "totp" && f.status === "verified");
  const user: AppUser = { id: data.user.id, email: data.user.email, totpFactorId: factor?.id ?? null };
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  return aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2" ? { status: "mfa_required", user } : { status: "ok", user };
});

/** Utilisateur entièrement authentifié (mot de passe + 2FA si active), sinon redirection. */
export async function requireUser(): Promise<AppUser> {
  const s = await authState();
  if (s.status === "anonymous") redirect("/login");
  if (s.status === "mfa_required") redirect("/login?mode=2fa");
  return s.user;
}

/** Revérifie le mot de passe avant une action sensible, sans modifier la session courante. */
export async function passwordOk(email: string, password: string): Promise<boolean> {
  if (!password) return false;
  const sb = stateless();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return false;
  await sb.auth.signOut({ scope: "local" }); // ferme la session temporaire créée par la vérification
  return true;
}

/* --- Messages flash : cookie httpOnly de 20 s plutôt que l'URL (pas de texte injectable dans un lien) --- */
const FLASH = "jr_flash";
export type Flash = { kind: "ok" | "err"; msg: string };

export async function setFlash(kind: Flash["kind"], msg: string): Promise<void> {
  (await cookies()).set(FLASH, JSON.stringify({ kind, msg: msg.slice(0, 500) }), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 20,
  });
}

export async function readFlash(): Promise<Flash | null> {
  try {
    const v = (await cookies()).get(FLASH)?.value;
    const f = v ? (JSON.parse(v) as Flash) : null;
    return f && (f.kind === "ok" || f.kind === "err") && typeof f.msg === "string" ? f : null;
  } catch { return null; }
}

/** Pose un message flash puis redirige. */
export async function go(path: string, msg: string, kind: Flash["kind"] = "err"): Promise<never> {
  await setFlash(kind, msg);
  redirect(path);
}
