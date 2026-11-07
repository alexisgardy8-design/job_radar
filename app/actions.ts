"use server";
/** Toutes les actions serveur : compte (inscription, connexion, 2FA, sécurité) et application (CV, réglages, scan). */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Auth, Crypto, Totp, type User } from "@/lib/security.ts";
import { Database, JobsRepo, SettingsRepo } from "@/lib/database.ts";
import { CAREER_TYPES, CONTRACTS, Text, type CareerSite, type CareerType } from "@/lib/core.ts";
import { JobAI } from "@/lib/ai.ts";
import { Mailer } from "@/lib/mailer.ts";
import { Scanner } from "@/lib/scanner.ts";

function go(path: string, msg: string, kind: "err" | "ok" = "err"): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(msg)}`);
}
const field = (fd: FormData, k: string) => String(fd.get(k) ?? "");

async function requirePassword(user: User, fd: FormData, back: string) {
  if (!(await Crypto.verifyPassword(field(fd, "password"), user.password_hash))) go(back, "Mot de passe incorrect.");
}

/* =================== Compte =================== */

export async function signup(fd: FormData) {
  const back = "/login?mode=signup";
  const email = field(fd, "email").trim().toLowerCase();
  const pw = field(fd, "password");
  if (!Text.isEmail(email)) go(back, "Adresse e-mail invalide.");
  if (!Auth.signupAllowed(email)) go(back, "Les inscriptions sont réservées : demande à l'administrateur d'autoriser ton e-mail.");
  const problem = Auth.passwordProblem(pw);
  if (problem) go(back, problem);
  if (pw !== field(fd, "password2")) go(back, "Les deux mots de passe ne correspondent pas.");

  const q = await Database.get();
  const rows = (await q`INSERT INTO users (email, password_hash) VALUES (${email}, ${await Crypto.hashPassword(pw)})
                        ON CONFLICT (email) DO NOTHING RETURNING id`) as { id: number }[];
  if (!rows[0]) go(back, "Impossible de créer ce compte. Si tu en as déjà un, connecte-toi.");
  await Auth.startSession(rows[0].id);
  go("/settings", "Compte créé. Commence par importer ton CV.", "ok");
}

export async function login(fd: FormData) {
  const email = field(fd, "email").trim().toLowerCase();
  if (await Auth.blocked(email)) go("/login", "Trop de tentatives. Réessaie dans 15 minutes.");
  const q = await Database.get();
  const user = ((await q`SELECT * FROM users WHERE email = ${email}`) as User[])[0];
  // Hash factice si l'e-mail n'existe pas : même temps de réponse, aucun compte révélé.
  const ok = await Crypto.verifyPassword(field(fd, "password"), user?.password_hash ?? Crypto.DUMMY_HASH);
  if (!user || !ok) {
    await Auth.failed(email);
    go("/login", "E-mail ou mot de passe incorrect.");
  }
  if (user.totp_enabled) {
    await Auth.startMfa(user.id);
    redirect("/login?mode=2fa");
  }
  await Auth.startSession(user.id);
  redirect("/");
}

export async function verifyMfa(fd: FormData) {
  const userId = await Auth.mfaUserId();
  if (!userId) go("/login", "Session expirée, reconnecte-toi.");
  const q = await Database.get();
  const user = ((await q`SELECT * FROM users WHERE id = ${userId}`) as User[])[0];
  if (!user?.totp_enabled || !user.totp_secret_enc) go("/login", "Session expirée, reconnecte-toi.");
  if (await Auth.blocked(user.email)) go("/login", "Trop de tentatives. Réessaie dans 15 minutes.");
  const code = field(fd, "code").trim().toLowerCase();

  const step = Totp.check(Crypto.decrypt(user.totp_secret_enc), code, Number(user.totp_last_step));
  if (step !== null) {
    const used = await q`UPDATE users SET totp_last_step = ${step} WHERE id = ${user.id} AND totp_last_step < ${step} RETURNING id`;
    if ((used as unknown[]).length) {
      await Auth.startSession(user.id);
      redirect("/");
    }
  }
  const hash = Crypto.sha256(code);
  if (user.recovery_codes.includes(hash)) {
    const left = user.recovery_codes.filter((c) => c !== hash);
    await q`UPDATE users SET recovery_codes = ${JSON.stringify(left)}::jsonb WHERE id = ${user.id}`;
    await Auth.startSession(user.id);
    go("/settings", `Connecté avec un code de secours. Il t'en reste ${left.length}.`, "ok");
  }
  await Auth.failed(user.email);
  go("/login?mode=2fa", "Code invalide.");
}

export async function cancelMfa() {
  (await cookies()).delete(Auth.MFA_COOKIE);
  redirect("/login");
}

export async function logout() {
  await Auth.endSession();
  redirect("/login");
}

/* =================== Sécurité =================== */
const SET = "/settings";

export async function startTotp() {
  const user = await Auth.require();
  await (await Database.get())`UPDATE users SET totp_pending_enc = ${Crypto.encrypt(Totp.newSecret())} WHERE id = ${user.id}`;
  redirect(SET);
}

export async function confirmTotp(fd: FormData) {
  const user = await Auth.require();
  if (!user.totp_pending_enc) go(SET, "Recommence l'activation.");
  const secret = Crypto.decrypt(user.totp_pending_enc);
  const step = Totp.check(secret, field(fd, "code"), 0);
  if (step === null) go(SET, "Code incorrect : vérifie l'heure de ton téléphone et réessaie.");
  const codes = Totp.recoveryCodes();
  await (await Database.get())`
    UPDATE users SET totp_secret_enc = ${Crypto.encrypt(secret)}, totp_pending_enc = NULL, totp_enabled = true,
      totp_last_step = ${step}, recovery_codes = ${JSON.stringify(codes.map(Crypto.sha256))}::jsonb WHERE id = ${user.id}`;
  await Auth.flashSecret("jr_codes", codes.join(" "));
  go(SET, "Double authentification activée. Note tes codes de secours.", "ok");
}

export async function disableTotp(fd: FormData) {
  const user = await Auth.require();
  await requirePassword(user, fd, SET);
  await (await Database.get())`UPDATE users SET totp_enabled = false, totp_secret_enc = NULL, totp_pending_enc = NULL, recovery_codes = '[]'::jsonb WHERE id = ${user.id}`;
  go(SET, "Double authentification désactivée.", "ok");
}

export async function newRecoveryCodes(fd: FormData) {
  const user = await Auth.require();
  await requirePassword(user, fd, SET);
  const codes = Totp.recoveryCodes();
  await (await Database.get())`UPDATE users SET recovery_codes = ${JSON.stringify(codes.map(Crypto.sha256))}::jsonb WHERE id = ${user.id}`;
  await Auth.flashSecret("jr_codes", codes.join(" "));
  go(SET, "Nouveaux codes de secours générés.", "ok");
}

export async function changePassword(fd: FormData) {
  const user = await Auth.require();
  await requirePassword(user, fd, SET);
  const problem = Auth.passwordProblem(field(fd, "next"));
  if (problem) go(SET, problem);
  const q = await Database.get();
  await q`UPDATE users SET password_hash = ${await Crypto.hashPassword(field(fd, "next"))} WHERE id = ${user.id}`;
  await q`DELETE FROM sessions WHERE user_id = ${user.id} AND token_hash <> ${(await Auth.sessionHash()) ?? ""}`;
  go(SET, "Mot de passe changé, tes autres sessions sont déconnectées.", "ok");
}

export async function revokeOtherSessions() {
  const user = await Auth.require();
  await (await Database.get())`DELETE FROM sessions WHERE user_id = ${user.id} AND token_hash <> ${(await Auth.sessionHash()) ?? ""}`;
  go(SET, "Autres sessions déconnectées.", "ok");
}

export async function newIngestToken() {
  const user = await Auth.require();
  const token = Crypto.token();
  await (await Database.get())`UPDATE users SET ingest_token_hash = ${Crypto.sha256(token)} WHERE id = ${user.id}`;
  await Auth.flashSecret("jr_ingest", token);
  go(SET, "Nouveau jeton généré (l'ancien ne fonctionne plus).", "ok");
}

export async function deleteAccount(fd: FormData) {
  const user = await Auth.require();
  if (field(fd, "confirm").trim().toLowerCase() !== user.email) go(SET, "Recopie exactement ton e-mail pour confirmer.");
  await requirePassword(user, fd, SET);
  await (await Database.get())`DELETE FROM users WHERE id = ${user.id}`; // cascade : sessions, réglages, offres
  (await cookies()).delete(Auth.COOKIE);
  go("/login", "Compte supprimé.", "ok");
}

/* =================== Application =================== */

export async function uploadCv(fd: FormData) {
  const user = await Auth.require();
  const repo = new SettingsRepo(user.id);
  const file = fd.get("cv");
  const pasted = field(fd, "cvText").trim();
  if (file instanceof File && file.size > 0) {
    if (file.type !== "application/pdf") go(SET, "Le CV doit être un PDF.");
    if (file.size > 5_000_000) go(SET, "PDF trop lourd (5 Mo max).");
    await repo.update({ cvText: await JobAI.readCv(new Uint8Array(await file.arrayBuffer())), cvName: file.name });
  } else if (pasted) {
    await repo.update({ cvText: pasted.slice(0, 30_000), cvName: "texte collé" });
  } else {
    go(SET, "Aucun CV fourni.");
  }
  go(SET, "CV enregistré.", "ok");
}

export async function saveSettings(fd: FormData) {
  const user = await Auth.require();
  const careers: CareerSite[] = field(fd, "careers").split("\n").slice(0, 30).flatMap((line) => {
    const [type, id, label] = line.split("|").map((x) => x.trim());
    if (!CAREER_TYPES.includes(type as CareerType) || !id || (type === "workday" && !Text.isUrl(id))) return [];
    return [{ type: type as CareerType, id, label: label || id }];
  });
  const email = field(fd, "email").trim().toLowerCase();
  await new SettingsRepo(user.id).update({
    filters: {
      titleKeywords: Text.list(field(fd, "titleKeywords"), 15),
      excludeKeywords: Text.list(field(fd, "excludeKeywords"), 40),
      contractTypes: CONTRACTS.filter((c) => fd.get(`contract_${c}`)),
      locations: Text.list(field(fd, "locations"), 15),
      departements: Text.list(field(fd, "departements"), 5).filter((d) => /^(\d{2,3}|2[AB])$/.test(d)),
      minStartDate: /^\d{4}-\d{2}-\d{2}$/.test(field(fd, "minStartDate")) ? field(fd, "minStartDate") : null,
      strictStartDate: fd.get("strictStartDate") === "on",
      scoreThreshold: Math.max(0, Math.min(100, Number(field(fd, "scoreThreshold")) || 70)),
    },
    sources: { webSearch: fd.get("webSearch") === "on", franceTravail: fd.get("franceTravail") === "on", adzuna: fd.get("adzuna") === "on", careers },
    notify: { enabled: fd.get("notifyEnabled") === "on", email: Text.isEmail(email) ? email : null },
  });
  go(SET, "Réglages enregistrés.", "ok");
}

export async function sendTestEmail() {
  const user = await Auth.require();
  const to = (await new SettingsRepo(user.id).get()).notify.email ?? user.email;
  try { await Mailer.sendTest(to); } catch (e) { go(SET, String(e).slice(0, 250)); }
  go(SET, `E-mail de test envoyé à ${to}.`, "ok");
}

export async function scanNow() {
  const user = await Auth.require();
  if (await new SettingsRepo(user.id).scannedWithin(10)) go("/", "Un scan a déjà eu lieu il y a moins de 10 minutes.");
  const r = await (await Scanner.forUser(user.id)).run();
  const msg = `Scan terminé : ${r.fetched} offres collectées, ${r.inserted} nouvelles, ${r.scored} notées, ${r.sent} envoyées par e-mail.`;
  redirect(`/?ok=${encodeURIComponent(msg)}${r.errors.length ? `&err=${encodeURIComponent(r.errors.slice(0, 4).join(" | "))}` : ""}`);
}

export async function dismissJob(fd: FormData) {
  const user = await Auth.require();
  await new JobsRepo(user.id).dismiss(Number(fd.get("id")));
  revalidatePath("/");
}
