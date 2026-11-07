"use server";
/** Actions serveur : compte (Supabase Auth), sécurité, CV, réglages, scan. */

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { authState, go, passwordOk, requireUser, setFlash } from "@/lib/auth.ts";
import { admin, forRequest } from "@/lib/supabase.ts";
import { Matches, Private, Profiles } from "@/lib/repos.ts";
import { CAREER_TYPES, CONTRACTS, LANGUAGES, Text, type CareerSite, type CareerType } from "@/lib/core.ts";
import { JobAI } from "@/lib/ai.ts";
import { SECTOR_IDS } from "@/lib/companies.ts";
import { Mailer } from "@/lib/mailer.ts";

const field = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const SET = "/settings";

function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "Le mot de passe doit faire au moins 10 caractères.";
  if (pw.length > 72) return "Mot de passe trop long (72 caractères max.).";
  if (!/[a-zA-Z]/.test(pw) || !/[^a-zA-Z]/.test(pw)) return "Mélange des lettres et des chiffres ou symboles.";
  return null;
}

async function siteUrl(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
}

/* =================== Connexion =================== */

export async function signup(fd: FormData) {
  const back = "/login?mode=signup";
  const email = field(fd, "email").trim().toLowerCase();
  const pw = field(fd, "password");
  if (!Text.isEmail(email)) await go(back, "Adresse e-mail invalide.");
  const problem = passwordProblem(pw);
  if (problem) await go(back, problem);
  if (pw !== field(fd, "password2")) await go(back, "Les deux mots de passe ne correspondent pas.");

  const sb = await forRequest();
  const { error } = await sb.auth.signUp({ email, password: pw, options: { emailRedirectTo: `${await siteUrl()}/auth/confirm?next=/settings` } });
  // L'autorisation d'inscription est vérifiée en base (trigger) : on ne distingue pas les cas pour ne rien révéler.
  if (error && /signup_not_allowed|Database error/i.test(error.message)) await go(back, "Les inscriptions sont réservées : demande à l'administrateur d'autoriser ton e-mail.");
  if (error && !/already registered/i.test(error.message)) await go(back, error.message);
  await go("/login", "Si cette adresse peut être inscrite, un e-mail de confirmation vient d'être envoyé. Clique sur le lien pour activer ton compte.", "ok");
}

export async function login(fd: FormData) {
  const sb = await forRequest();
  const { error } = await sb.auth.signInWithPassword({ email: field(fd, "email").trim().toLowerCase(), password: field(fd, "password") });
  if (error) {
    if (/not confirmed/i.test(error.message)) await go("/login", "Confirme d'abord ton adresse e-mail (lien reçu à l'inscription).");
    if (/rate limit|too many/i.test(error.message)) await go("/login", "Trop de tentatives. Réessaie dans quelques minutes.");
    await go("/login", "E-mail ou mot de passe incorrect.");
  }
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  redirect(aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2" ? "/login?mode=2fa" : "/");
}

export async function verifyMfa(fd: FormData) {
  const state = await authState();
  if (state.status === "ok") redirect("/");
  if (state.status === "anonymous") return go("/login", "Session expirée, reconnecte-toi.");
  const { user } = state;
  const code = field(fd, "code").trim();

  if (/^\d{6}$/.test(code.replace(/\s/g, "")) && user.totpFactorId) {
    const sb = await forRequest();
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: user.totpFactorId, code: code.replace(/\s/g, "") });
    if (!error) redirect("/");
    await go("/login?mode=2fa", /rate limit|too many/i.test(error.message) ? "Trop de tentatives. Réessaie dans quelques minutes." : "Code invalide.");
  }

  // Code de secours : désactive la 2FA (Supabase déconnecte alors toutes les sessions), puis reconnexion par mot de passe.
  const left = await Private.useRecoveryCode(user.id, code);
  if (left === null) await go("/login?mode=2fa", "Code invalide.");
  const db = admin();
  const { data } = await db.auth.admin.mfa.listFactors({ userId: user.id });
  for (const f of data?.factors ?? []) await db.auth.admin.mfa.deleteFactor({ id: f.id, userId: user.id });
  await Private.clearRecoveryCodes(user.id);
  await (await forRequest()).auth.signOut({ scope: "local" });
  await go("/login", "Code de secours accepté : la double authentification est désactivée. Reconnecte-toi avec ton mot de passe, puis réactive-la.", "ok");
}

export async function logout() {
  await (await forRequest()).auth.signOut({ scope: "local" });
  redirect("/login");
}

export async function forgotPassword(fd: FormData) {
  const email = field(fd, "email").trim().toLowerCase();
  if (Text.isEmail(email)) {
    await (await forRequest()).auth.resetPasswordForEmail(email, { redirectTo: `${await siteUrl()}/auth/confirm?next=/reset` });
  }
  await go("/login", "Si un compte existe pour cette adresse, un lien de réinitialisation vient d'être envoyé.", "ok");
}

/** Nouveau mot de passe après le lien reçu par e-mail (session de récupération, 2FA comprise si active). */
export async function resetPassword(fd: FormData) {
  await requireUser();
  const pw = field(fd, "password");
  const problem = passwordProblem(pw);
  if (problem) await go("/reset", problem);
  if (pw !== field(fd, "password2")) await go("/reset", "Les deux mots de passe ne correspondent pas.");
  const sb = await forRequest();
  const { error } = await sb.auth.updateUser({ password: pw });
  if (error) await go("/reset", error.message);
  await sb.auth.signOut({ scope: "others" });
  await go(SET, "Mot de passe modifié, tes autres sessions sont déconnectées.", "ok");
}

/* =================== Sécurité du compte =================== */

/** Appelée par le composant d'activation, une fois le facteur TOTP vérifié côté navigateur. */
export async function finishMfaSetup() {
  const user = await requireUser();
  if (!user.totpFactorId) await go(SET, "La double authentification n'est pas active.");
  const codes = await Private.newRecoveryCodes(user.id);
  await (await forRequest()).auth.signOut({ scope: "others" }); // les sessions ouvertes sans 2FA sont fermées
  await setFlash("ok", `Double authentification activée. Codes de secours, à noter maintenant (affichés une seule fois) : ${codes.join("  ")}`);
  redirect(`${SET}#securite`);
}

export async function disableMfa(fd: FormData) {
  const user = await requireUser(); // session aal2 obligatoire quand la 2FA est active
  if (!user.totpFactorId) await go(SET, "La double authentification n'est pas active.");
  if (!(await passwordOk(user.email, field(fd, "password")))) await go(SET, "Mot de passe incorrect.");
  const { error } = await (await forRequest()).auth.mfa.unenroll({ factorId: user.totpFactorId! });
  if (error) await go(SET, error.message);
  await Private.clearRecoveryCodes(user.id);
  await go(SET, "Double authentification désactivée.", "ok");
}

export async function newRecoveryCodes(fd: FormData) {
  const user = await requireUser();
  if (!user.totpFactorId) await go(SET, "Active d'abord la double authentification.");
  if (!(await passwordOk(user.email, field(fd, "password")))) await go(SET, "Mot de passe incorrect.");
  const codes = await Private.newRecoveryCodes(user.id);
  await go(`${SET}#securite`, `Nouveaux codes de secours (les anciens ne marchent plus) : ${codes.join("  ")}`, "ok");
}

export async function changePassword(fd: FormData) {
  const user = await requireUser();
  if (!(await passwordOk(user.email, field(fd, "password")))) await go(SET, "Mot de passe actuel incorrect.");
  const next = field(fd, "next");
  const problem = passwordProblem(next);
  if (problem) await go(SET, problem);
  const sb = await forRequest();
  const { error } = await sb.auth.updateUser({ password: next });
  if (error) await go(SET, error.message);
  await sb.auth.signOut({ scope: "others" });
  await go(SET, "Mot de passe changé, tes autres sessions sont déconnectées.", "ok");
}

/* =================== Mon compte =================== */

export async function updateDisplayName(fd: FormData) {
  await requireUser();
  // Nom affiché seulement : sans caractères de contrôle, 50 caractères max. Jamais utilisé pour une autorisation.
  const name = field(fd, "displayName").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 50);
  const { error } = await (await forRequest()).auth.updateUser({ data: { display_name: name || null } });
  if (error) await go(SET, error.message);
  await go(`${SET}#compte`, name ? `C'est noté, ${name} !` : "Nom affiché retiré.", "ok");
}

export async function changeEmail(fd: FormData) {
  const user = await requireUser();
  const next = field(fd, "email").trim().toLowerCase();
  if (!Text.isEmail(next)) await go(`${SET}#compte`, "Adresse e-mail invalide.");
  if (next === user.email) await go(`${SET}#compte`, "C'est déjà ton adresse actuelle.");
  if (!(await passwordOk(user.email, field(fd, "password")))) await go(`${SET}#compte`, "Mot de passe incorrect.");
  if (!(await Private.emailAllowed(next))) await go(`${SET}#compte`, "Cette adresse ne fait pas partie des adresses autorisées. Demande à l'administrateur de l'ajouter.");
  const { error } = await (await forRequest()).auth.updateUser({ email: next }, { emailRedirectTo: `${await siteUrl()}/auth/confirm?next=/settings` });
  if (error) await go(`${SET}#compte`, /already|registered|exists/i.test(error.message) ? "Cette adresse est déjà utilisée par un autre compte." : error.message);
  await go(`${SET}#compte`, `Lien de confirmation envoyé à ${next}. Ton adresse changera une fois le lien cliqué (Supabase peut aussi demander une confirmation sur l'ancienne adresse).`, "ok");
}

export async function revokeOtherSessions() {
  await requireUser();
  await (await forRequest()).auth.signOut({ scope: "others" });
  await go(SET, "Autres sessions déconnectées.", "ok");
}

export async function newIngestToken() {
  const user = await requireUser();
  const token = await Private.newIngestToken(user.id);
  await go(SET, `Nouveau jeton pour le script Gmail (affiché une seule fois, l'ancien ne marche plus) : ${token}`, "ok");
}

export async function deleteAccount(fd: FormData) {
  const user = await requireUser();
  if (field(fd, "confirm").trim().toLowerCase() !== user.email) await go(SET, "Recopie exactement ton e-mail pour confirmer.");
  if (!(await passwordOk(user.email, field(fd, "password")))) await go(SET, "Mot de passe incorrect.");
  const { error } = await admin().auth.admin.deleteUser(user.id); // cascade : profil, matchs, empreintes, quotas
  if (error) await go(SET, error.message);
  await (await forRequest()).auth.signOut({ scope: "local" });
  await go("/login", "Compte supprimé.", "ok");
}

/* =================== Application =================== */

export async function uploadCv(fd: FormData) {
  const user = await requireUser();
  const repo = new Profiles(await forRequest(), user.id);
  const file = fd.get("cv");
  const pasted = field(fd, "cvText").trim();
  if (file instanceof File && file.size > 0) {
    if (file.type !== "application/pdf") await go(SET, "Le CV doit être un PDF.");
    if (file.size > 5_000_000) await go(SET, "PDF trop lourd (5 Mo max).");
    let text = "";
    try {
      text = await JobAI.readCv(new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
      await go(SET, `Lecture du PDF impossible (${String((e as Error)?.message ?? e).slice(0, 200)}). Tu peux coller le texte de ton CV à la place.`);
    }
    await repo.update({ cvText: text.slice(0, 40_000), cvName: file.name.slice(0, 200) });
  } else if (pasted) {
    await repo.update({ cvText: pasted.slice(0, 40_000), cvName: "texte collé" });
  } else {
    await go(SET, "Aucun CV fourni.");
  }
  await go(SET, "CV enregistré.", "ok");
}

export async function saveSettings(fd: FormData) {
  const user = await requireUser();
  const careers: CareerSite[] = field(fd, "careers").split("\n").slice(0, 15).flatMap((line) => {
    const [type, id, label] = line.split("|").map((x) => x.trim());
    if (!CAREER_TYPES.includes(type as CareerType) || !id || id.length > 300 || (type === "workday" && !Text.isUrl(id))) return [];
    return [{ type: type as CareerType, id, label: (label || id).slice(0, 100) }];
  });
  await new Profiles(await forRequest(), user.id).update({
    filters: {
      titleKeywords: Text.list(field(fd, "titleKeywords"), 15),
      contractTypes: CONTRACTS.filter((c) => fd.get(`contract_${c}`)),
      locations: Text.list(field(fd, "locations"), 15),
      departements: Text.list(field(fd, "departements"), 5).filter((d) => /^(\d{2,3}|2[AB])$/.test(d)),
      minStartDate: /^\d{4}-\d{2}-\d{2}$/.test(field(fd, "minStartDate")) ? field(fd, "minStartDate") : null,
      strictStartDate: fd.get("strictStartDate") === "on",
      scoreThreshold: Math.max(0, Math.min(100, Number(field(fd, "scoreThreshold")) || 70)),
      languages: LANGUAGES.filter((l) => fd.get(`lang_${l}`)),
      sectors: SECTOR_IDS.filter((id) => fd.get(`sector_${id}`)),
      maxExperienceYears: field(fd, "maxExperienceYears") === "" ? null : Math.max(0, Math.min(30, Number(field(fd, "maxExperienceYears")) || 0)),
    },
    sources: { webSearch: fd.get("webSearch") === "on", franceTravail: fd.get("franceTravail") === "on", adzuna: fd.get("adzuna") === "on", careers },
    notifyEnabled: fd.get("notifyEnabled") === "on",
  });
  await go(SET, "Réglages enregistrés.", "ok");
}

export async function sendTestEmail() {
  const user = await requireUser();
  if (!(await Private.claim(user.id, "testmail"))) await go(SET, "Patiente quelques minutes avant un nouvel e-mail de test.");
  try { await Mailer.sendTest(user.email); } catch (e) { await go(SET, String(e).slice(0, 250)); }
  await go(SET, `E-mail de test envoyé à ${user.email}.`, "ok");
}

export async function dismissMatch(fd: FormData) {
  const user = await requireUser();
  const id = Number(fd.get("id"));
  if (Number.isSafeInteger(id)) await new Matches(await forRequest(), user.id).dismiss(id);
  revalidatePath("/");
}
