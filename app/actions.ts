"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/session.ts";
import { SESSION_COOKIE } from "@/lib/auth.ts";
import { getSettings, saveCv, saveSettingsJson, sql } from "@/lib/db.ts";
import { parseList } from "@/lib/filters.ts";
import { runScan } from "@/lib/scan.ts";
import { pdfToText } from "@/lib/ai.ts";
import { notifyTest } from "@/lib/notify.ts";
import type { CareerSource, CareerSourceType, ContractType } from "@/lib/types.ts";

export async function scanNow() {
  await requireAuth();
  const r = await runScan("manuel");
  const msg = `Scan terminé : ${r.fetched} offres collectées, ${r.inserted} nouvelles, ${r.scored} notées, ${r.notified} notifiées.`;
  redirect(`/?flash=${encodeURIComponent(msg)}${r.errors.length ? `&errs=${encodeURIComponent(r.errors.slice(0, 5).join(" | "))}` : ""}`);
}

export async function dismissJob(formData: FormData) {
  await requireAuth();
  await sql()`UPDATE jobs SET dismissed = true WHERE id = ${Number(formData.get("id"))}`;
  revalidatePath("/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export async function uploadCv(formData: FormData) {
  await requireAuth();
  const file = formData.get("cv");
  const pasted = String(formData.get("cvText") ?? "").trim();
  if (file instanceof File && file.size > 0) {
    if (file.type !== "application/pdf") redirect("/settings?err=Le CV doit être un PDF");
    if (file.size > 5_000_000) redirect("/settings?err=PDF trop lourd (5 Mo max)");
    const text = await pdfToText(new Uint8Array(await file.arrayBuffer()));
    await saveCv(text, file.name);
  } else if (pasted) {
    await saveCv(pasted, "texte collé");
  } else {
    redirect("/settings?err=Aucun CV fourni");
  }
  redirect("/settings?ok=CV enregistré");
}

const CONTRACTS: ContractType[] = ["CDI", "CDD", "VIE", "STAGE", "ALTERNANCE", "FREELANCE"];
const CAREER_TYPES: CareerSourceType[] = ["greenhouse", "lever", "smartrecruiters", "workday", "sitemap"];

/** Une source carrière par ligne : "type | identifiant | Nom affiché | filtre d'URL (sitemap)" */
function parseCareers(input: string): CareerSource[] {
  return input.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).flatMap((line) => {
    const [type, id, label, urlFilter] = line.split("|").map((x) => x?.trim());
    if (!CAREER_TYPES.includes(type as CareerSourceType) || !id) return [];
    return [{ type: type as CareerSourceType, id, label: label || id, ...(urlFilter ? { urlFilter } : {}) }];
  });
}

export async function saveSettings(formData: FormData) {
  await requireAuth();
  const g = (k: string) => String(formData.get(k) ?? "");
  const threshold = Math.max(0, Math.min(100, Number(g("scoreThreshold")) || 70));
  await saveSettingsJson(
    {
      titleKeywords: parseList(g("titleKeywords")),
      excludeKeywords: parseList(g("excludeKeywords")),
      contractTypes: CONTRACTS.filter((c) => formData.get(`contract_${c}`)),
      locations: parseList(g("locations")),
      departements: parseList(g("departements")).filter((d) => /^\d{2,3}$|^2[AB]$/.test(d)),
      minStartDate: /^\d{4}-\d{2}-\d{2}$/.test(g("minStartDate")) ? g("minStartDate") : null,
      strictStartDate: formData.get("strictStartDate") === "on",
      scoreThreshold: threshold,
    },
    {
      webSearch: formData.get("src_webSearch") === "on",
      franceTravail: formData.get("src_franceTravail") === "on",
      adzuna: formData.get("src_adzuna") === "on",
      careers: parseCareers(g("careers")),
    },
    {
      email: g("email").trim() || null,
      telegramChatId: g("telegramChatId").trim() || null,
    },
  );
  redirect("/settings?ok=Réglages enregistrés");
}

export async function testNotification() {
  await requireAuth();
  const s = await getSettings();
  const errors = await notifyTest(s.notify);
  redirect(errors.length ? `/settings?err=${encodeURIComponent(errors.join(" | "))}` : "/settings?ok=Notification de test envoyée");
}
