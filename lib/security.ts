/**
 * Sécurité (runtime Node.js) :
 * - Crypto : scrypt pour les mots de passe, AES-256-GCM pour les secrets TOTP, HMAC pour les jetons courts.
 * - Totp : RFC 6238 (compatible Google Authenticator, Authy, Proton Pass…), anti-rejeu.
 * - Auth : comptes, sessions révocables (seul le SHA-256 du jeton est stocké), anti-bruteforce.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { Database } from "./database.ts";

function appSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET manquant ou trop court (32 caractères min.)");
  return s;
}

export class Crypto {
  private static readonly SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
  static readonly DUMMY_HASH = `scrypt$32768$8$1$${Buffer.alloc(16).toString("base64")}$${Buffer.alloc(64).toString("base64")}`;

  static sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
  static token = (bytes = 32) => randomBytes(bytes).toString("base64url");

  static equal(a: string, b: string): boolean {
    const ba = Buffer.from(a), bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }

  private static derive(pw: string, salt: Buffer, len: number, o = Crypto.SCRYPT): Promise<Buffer> {
    return new Promise((res, rej) => scrypt(pw.normalize("NFKC"), salt, len, o, (e, k) => (e ? rej(e) : res(k))));
  }

  static async hashPassword(pw: string): Promise<string> {
    const salt = randomBytes(16);
    const { N, r, p } = Crypto.SCRYPT;
    return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${(await Crypto.derive(pw, salt, 64)).toString("base64")}`;
  }

  static async verifyPassword(pw: string, stored: string): Promise<boolean> {
    const [alg, N, r, p, salt, key] = stored.split("$");
    if (alg !== "scrypt") return false;
    const expected = Buffer.from(key, "base64");
    const got = await Crypto.derive(pw, Buffer.from(salt, "base64"), expected.length, { N: +N, r: +r, p: +p, maxmem: Crypto.SCRYPT.maxmem });
    return timingSafeEqual(got, expected);
  }

  private static key = () => createHash("sha256").update(`job-radar:enc:${appSecret()}`).digest();

  static encrypt(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", Crypto.key(), iv);
    const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return [iv, c.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
  }

  static decrypt(blob: string): string {
    const [iv, tag, data] = blob.split(".").map((s) => Buffer.from(s, "base64"));
    const d = createDecipheriv("aes-256-gcm", Crypto.key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString("utf8");
  }

  /** Jeton signé `payload.expiration.signature`. */
  static sign(payload: string, ttlSec: number): string {
    const body = `${payload}.${Date.now() + ttlSec * 1000}`;
    return `${body}.${createHmac("sha256", appSecret()).update(body).digest("base64url")}`;
  }

  static verify(token: string | undefined): string | null {
    if (!token) return null;
    const i = token.lastIndexOf(".");
    const body = token.slice(0, i);
    if (!Crypto.equal(token.slice(i + 1), createHmac("sha256", appSecret()).update(body).digest("base64url"))) return null;
    const j = body.lastIndexOf(".");
    return Number(body.slice(j + 1)) < Date.now() ? null : body.slice(0, j);
  }
}

export class Totp {
  private static readonly B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  static base32(buf: Buffer): string {
    let bits = 0, value = 0, out = "";
    for (const byte of buf) {
      value = (value << 8) | byte; bits += 8;
      while (bits >= 5) { out += Totp.B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
    }
    return bits > 0 ? out + Totp.B32[(value << (5 - bits)) & 31] : out;
  }

  private static unbase32(s: string): Buffer {
    let bits = 0, value = 0;
    const out: number[] = [];
    for (const ch of s.toUpperCase().replace(/[^A-Z2-7]/g, "")) {
      value = (value << 5) | Totp.B32.indexOf(ch); bits += 5;
      if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
    }
    return Buffer.from(out);
  }

  static newSecret = () => Totp.base32(randomBytes(20));

  static code(secret: string, step: number): string {
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(step));
    const h = createHmac("sha1", Totp.unbase32(secret)).update(msg).digest();
    const o = h[h.length - 1] & 15;
    return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000).padStart(6, "0");
  }

  /** Pas de temps accepté (±30 s de tolérance), ou null. Refuse tout pas ≤ lastStep (anti-rejeu). */
  static check(secret: string, input: string, lastStep: number, now = Date.now()): number | null {
    const c = input.replace(/\s/g, "");
    if (!/^\d{6}$/.test(c)) return null;
    const step = Math.floor(now / 30_000);
    return [step - 1, step, step + 1].find((s) => s > lastStep && Totp.code(secret, s) === c) ?? null;
  }

  static uri(secret: string, email: string): string {
    return `otpauth://totp/Job%20Radar:${encodeURIComponent(email)}?secret=${secret}&issuer=Job%20Radar&digits=6&period=30`;
  }

  static recoveryCodes(): string[] {
    return Array.from({ length: 8 }, () => {
      const s = Totp.base32(randomBytes(5)).toLowerCase();
      return `${s.slice(0, 4)}-${s.slice(4, 8)}`;
    });
  }
}

export interface User {
  id: number; email: string; password_hash: string; totp_secret_enc: string | null; totp_pending_enc: string | null;
  totp_enabled: boolean; totp_last_step: number; recovery_codes: string[]; ingest_token_hash: string | null;
}

export class Auth {
  static readonly COOKIE = "jr_sid";
  static readonly MFA_COOKIE = "jr_mfa";
  private static readonly DAYS = 30;

  static cookie(maxAge: number, path = "/") {
    return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path, maxAge };
  }

  static passwordProblem(pw: string): string | null {
    if (pw.length < 10) return "Le mot de passe doit faire au moins 10 caractères.";
    if (pw.length > 200) return "Mot de passe trop long.";
    if (!/[a-zA-Z]/.test(pw) || !/[^a-zA-Z]/.test(pw)) return "Mélange des lettres et des chiffres ou symboles.";
    return null;
  }

  /** ALLOWED_SIGNUP_EMAILS : e-mails ou domaines (@ecole.fr) séparés par des virgules, ou « * ». */
  static signupAllowed(email: string): boolean {
    const list = (process.env.ALLOWED_SIGNUP_EMAILS ?? "").toLowerCase().split(/[,\s]+/).filter(Boolean);
    return list.includes("*") || list.some((x) => (x.startsWith("@") ? email.endsWith(x) : email === x));
  }

  static bearerOk(header: string | null, secret: string | undefined): boolean {
    return !!secret && !!header && Crypto.equal(header, `Bearer ${secret}`);
  }

  /* --- Anti-bruteforce : 5 échecs / 15 min par e-mail, 30 par IP --- */
  private static async ip(): Promise<string> {
    const h = await headers();
    return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  }

  static async blocked(email: string): Promise<boolean> {
    const q = await Database.get();
    const r = ((await q`
      SELECT count(*) FILTER (WHERE key = ${"e:" + email})::int AS e, count(*) FILTER (WHERE key = ${"ip:" + (await Auth.ip())})::int AS i
      FROM login_attempts WHERE at > now() - interval '15 minutes'`) as { e: number; i: number }[])[0];
    return r.e >= 5 || r.i >= 30;
  }

  static async failed(email: string): Promise<void> {
    const q = await Database.get();
    await q`INSERT INTO login_attempts (key) VALUES (${"e:" + email}), (${"ip:" + (await Auth.ip())})`;
    await q`DELETE FROM login_attempts WHERE at < now() - interval '1 day'`;
  }

  /* --- Sessions --- */
  static async startSession(userId: number): Promise<void> {
    const q = await Database.get();
    const token = Crypto.token();
    const ua = (await headers()).get("user-agent")?.slice(0, 200) ?? null;
    await q`DELETE FROM login_attempts WHERE key = (SELECT 'e:' || email FROM users WHERE id = ${userId})`;
    await q`INSERT INTO sessions (token_hash, user_id, expires_at, user_agent)
            VALUES (${Crypto.sha256(token)}, ${userId}, now() + make_interval(days => ${Auth.DAYS}), ${ua})`;
    const jar = await cookies();
    jar.set(Auth.COOKIE, token, Auth.cookie(Auth.DAYS * 86_400));
    jar.delete(Auth.MFA_COOKIE);
  }

  static async endSession(): Promise<void> {
    const jar = await cookies();
    const hash = await Auth.sessionHash();
    if (hash) await (await Database.get())`DELETE FROM sessions WHERE token_hash = ${hash}`;
    jar.delete(Auth.COOKIE);
  }

  static async sessionHash(): Promise<string | null> {
    const t = (await cookies()).get(Auth.COOKIE)?.value;
    return t ? Crypto.sha256(t) : null;
  }

  /** Utilisateur connecté (mis en cache pendant la requête), ou null. */
  static current = cache(async (): Promise<User | null> => {
    const hash = await Auth.sessionHash();
    if (!hash) return null;
    const q = await Database.get();
    const rows = (await q`
      SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ${hash} AND s.expires_at > now()`) as User[];
    return rows[0] ?? null;
  });

  static async require(): Promise<User> {
    const u = await Auth.current();
    if (!u) redirect("/login");
    return u;
  }

  /* --- Étape 2FA : mot de passe validé, code attendu (5 min) --- */
  static async startMfa(userId: number): Promise<void> {
    (await cookies()).set(Auth.MFA_COOKIE, Crypto.sign(`mfa:${userId}`, 300), Auth.cookie(300));
  }

  static async mfaUserId(): Promise<number | null> {
    const p = Crypto.verify((await cookies()).get(Auth.MFA_COOKIE)?.value);
    return p?.startsWith("mfa:") ? Number(p.slice(4)) : null;
  }

  /** Secret affiché une seule fois (codes de secours, jeton) via un cookie chiffré de 2 minutes. */
  static async flashSecret(name: string, value: string): Promise<void> {
    (await cookies()).set(name, Crypto.encrypt(value), { ...Auth.cookie(120), sameSite: "strict" });
  }

  static async readSecret(name: string): Promise<string | null> {
    const v = (await cookies()).get(name)?.value;
    try { return v ? Crypto.decrypt(v) : null; } catch { return null; }
  }
}
