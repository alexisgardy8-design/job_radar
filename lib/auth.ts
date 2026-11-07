/**
 * Session mono-utilisateur : cookie httpOnly signé HMAC-SHA256 (Web Crypto, compatible Edge).
 * Format : "<expiration epoch ms>.<signature hex>"
 */
export const SESSION_COOKIE = "jr_session";
export const SESSION_DAYS = 30;

const enc = new TextEncoder();

async function hmac(data: string): Promise<string> {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET manquant ou trop court (32 caractères min.)");
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(): Promise<string> {
  const exp = String(Date.now() + SESSION_DAYS * 86_400_000);
  return `${exp}.${await hmac(exp)}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(exp));
}

/** Compare le mot de passe saisi à APP_PASSWORD via leurs HMAC (temps constant). */
export async function checkPassword(input: string): Promise<boolean> {
  const expected = process.env.APP_PASSWORD;
  if (!expected || expected.length < 10) throw new Error("APP_PASSWORD manquant ou trop court (10 caractères min.)");
  return safeEqual(await hmac(`pw:${input}`), await hmac(`pw:${expected}`));
}

/** Vérifie un secret passé en en-tête Bearer (cron) en temps constant. */
export function checkBearer(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  return safeEqual(header, `Bearer ${secret}`);
}
