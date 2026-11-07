/** Accès aux données. Tout ce qui est lié à un compte prend un user_id déjà authentifié. */
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_SETTINGS, Text, type Match, type RawJob, type Settings, type Verdict } from "./core.ts";
import { admin, check } from "./supabase.ts";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

interface ProfileRow { cv_text: string | null; cv_name: string | null; filters: Partial<Settings["filters"]>; sources: Partial<Settings["sources"]>; notify_enabled: boolean }

/** Profil : CV et réglages. Avec le client de la requête, la RLS limite l'accès au propriétaire. */
export class Profiles {
  constructor(private readonly db: SupabaseClient, private readonly userId: string) {}

  static toSettings(row: ProfileRow | null): Settings {
    const d = DEFAULT_SETTINGS;
    const obj = <T,>(v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Partial<T>) : {});
    const sources = { ...d.sources, ...obj<Settings["sources"]>(row?.sources) };
    return {
      cvText: row?.cv_text ?? null,
      cvName: row?.cv_name ?? null,
      filters: { ...d.filters, ...obj<Settings["filters"]>(row?.filters) },
      sources: { ...sources, careers: Array.isArray(sources.careers) ? sources.careers : [] },
      notify: { enabled: row?.notify_enabled ?? true },
    };
  }

  async get(): Promise<Settings> {
    const res = await this.db.from("profiles").select("cv_text, cv_name, filters, sources, notify_enabled").eq("user_id", this.userId).maybeSingle();
    return Profiles.toSettings(check(res, "lecture du profil") as ProfileRow | null);
  }

  async update(patch: { cvText?: string; cvName?: string; filters?: Settings["filters"]; sources?: Settings["sources"]; notifyEnabled?: boolean }): Promise<void> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.cvText !== undefined) row.cv_text = patch.cvText;
    if (patch.cvName !== undefined) row.cv_name = patch.cvName;
    if (patch.filters) row.filters = patch.filters;
    if (patch.sources) row.sources = patch.sources;
    if (patch.notifyEnabled !== undefined) row.notify_enabled = patch.notifyEnabled;
    check(await this.db.from("profiles").update(row).eq("user_id", this.userId), "enregistrement du profil");
  }

  /** Comptes à scanner par le cron : ceux qui ont un CV, du moins récemment scanné au plus récent. */
  static async scannable(): Promise<string[]> {
    const db = admin();
    const ids = (check(await db.from("profiles").select("user_id").not("cv_text", "is", null), "comptes") as { user_id: string }[]).map((r) => r.user_id);
    if (!ids.length) return [];
    const last = new Map((check(await db.from("user_private").select("user_id, last_scan_at").in("user_id", ids), "derniers scans") as
      { user_id: string; last_scan_at: string | null }[]).map((r) => [r.user_id, r.last_scan_at ? Date.parse(r.last_scan_at) : 0]));
    return ids.sort((a, b) => (last.get(a) ?? 0) - (last.get(b) ?? 0));
  }
}

/** Meilleurs matchs du compte (10 max). */
export class Matches {
  static readonly KEEP = 10;

  constructor(private readonly db: SupabaseClient, private readonly userId: string) {}

  async list(): Promise<Match[]> {
    const res = await this.db.from("matches").select("id, title, company, location, contract, source, url, score, verdict, found_at, sent_at")
      .eq("user_id", this.userId).order("score", { ascending: false }).order("found_at", { ascending: false }).limit(Matches.KEEP);
    return check(res, "lecture des matchs") as Match[];
  }

  async dismiss(id: number): Promise<void> {
    check(await this.db.from("matches").delete().eq("user_id", this.userId).eq("id", id), "suppression du match");
  }

  /** Ajoute les nouveaux matchs puis ne garde que les KEEP meilleurs (service_role). */
  static async save(userId: string, items: { key: string; job: RawJob; verdict: Verdict }[], sentAt: string | null): Promise<void> {
    if (!items.length) return;
    const db = admin();
    check(await db.from("matches").upsert(items.map(({ key, job, verdict }) => ({
      user_id: userId, job_key: key, title: Text.cut(job.title, 300), company: Text.cut(job.company, 200), location: Text.cut(job.location, 200),
      contract: job.contract ?? verdict.contractDetected, source: job.source, url: job.url, score: verdict.score, verdict, sent_at: sentAt,
    })), { onConflict: "user_id,job_key", ignoreDuplicates: true }), "enregistrement des matchs");
    check(await db.rpc("trim_matches", { p_user: userId, p_keep: Matches.KEEP }), "tri des matchs");
  }
}

/** Empreintes des offres déjà notées (service_role). */
export class SeenJobs {
  static key(j: RawJob): string {
    return sha256(`${j.source}|${j.externalId}`);
  }

  /** Clés jamais vues parmi `keys`. */
  static async unseen(userId: string, keys: string[]): Promise<Set<string>> {
    const fresh = new Set(keys);
    for (let i = 0; i < keys.length; i += 50) {
      const res = await admin().from("seen_jobs").select("job_key").eq("user_id", userId).in("job_key", keys.slice(i, i + 50));
      for (const r of check(res, "offres déjà vues") as { job_key: string }[]) fresh.delete(r.job_key);
    }
    return fresh;
  }

  static async mark(userId: string, keys: string[]): Promise<void> {
    if (!keys.length) return;
    check(await admin().from("seen_jobs").upsert(keys.map((job_key) => ({ user_id: userId, job_key })), { onConflict: "user_id,job_key", ignoreDuplicates: true }), "marquage des offres");
  }
}

/** Données internes du compte : quotas, jeton d'ingestion, codes de secours (service_role, jamais exposées au navigateur). */
export class Private {
  /** Quotas : au plus `max` par jour, et une utilisation toutes les `minutes`. */
  static readonly LIMITS = { scan: { minutes: 10, max: 3 }, ingest: { minutes: 0, max: 50 }, testmail: { minutes: 5, max: 3 } } as const;

  static async claim(userId: string, kind: keyof typeof Private.LIMITS): Promise<boolean> {
    const l = Private.LIMITS[kind];
    return check(await admin().rpc("claim", { p_user: userId, p_kind: kind, p_interval: `${l.minutes} minutes`, p_max: l.max }), "quota") === true;
  }

  static async touchScan(userId: string): Promise<void> {
    check(await admin().from("user_private").update({ last_scan_at: new Date().toISOString() }).eq("user_id", userId), "date du scan");
  }

  static async get(userId: string): Promise<{ hasIngestToken: boolean; recoveryLeft: number }> {
    const row = check(await admin().from("user_private").select("ingest_token_hash, recovery_codes").eq("user_id", userId).maybeSingle(), "données internes") as
      { ingest_token_hash: string | null; recovery_codes: string[] } | null;
    return { hasIngestToken: !!row?.ingest_token_hash, recoveryLeft: row?.recovery_codes.length ?? 0 };
  }

  /* --- Jeton du script Gmail --- */
  static async newIngestToken(userId: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    check(await admin().from("user_private").update({ ingest_token_hash: sha256(token) }).eq("user_id", userId), "jeton");
    return token;
  }

  static async userByIngestToken(token: string): Promise<string | null> {
    const row = check(await admin().from("user_private").select("user_id").eq("ingest_token_hash", sha256(token)).maybeSingle(), "jeton") as { user_id: string } | null;
    return row?.user_id ?? null;
  }

  /* --- Codes de secours 2FA : 80 bits chacun, stockés hachés --- */
  static async newRecoveryCodes(userId: string): Promise<string[]> {
    const codes = Array.from({ length: 8 }, () => (randomBytes(10).toString("hex").match(/.{5}/g) ?? []).join("-"));
    check(await admin().from("user_private").update({ recovery_codes: codes.map((c) => sha256(c)) }).eq("user_id", userId), "codes de secours");
    return codes;
  }

  static async clearRecoveryCodes(userId: string): Promise<void> {
    check(await admin().from("user_private").update({ recovery_codes: [] }).eq("user_id", userId), "codes de secours");
  }

  /** Consomme un code ; nombre restant, ou null si invalide. */
  static async useRecoveryCode(userId: string, code: string): Promise<number | null> {
    const normalized = code.trim().toLowerCase();
    if (!/^[0-9a-f]{5}(-[0-9a-f]{5}){3}$/.test(normalized)) return null;
    return check(await admin().rpc("use_recovery_code", { p_user: userId, p_hash: sha256(normalized) }), "code de secours") as number | null;
  }
}
