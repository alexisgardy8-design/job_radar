/**
 * Arrivée depuis un lien reçu par e-mail (confirmation d'inscription, mot de passe oublié, changement d'e-mail).
 * Accepte le format token_hash (recommandé, fonctionne sur n'importe quel appareil) et le format PKCE (?code=).
 */
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { forRequest } from "@/lib/supabase.ts";
import { setFlash } from "@/lib/auth.ts";

const NEXT_ALLOWED = ["/", "/settings", "/reset"];

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const next = NEXT_ALLOWED.includes(p.get("next") ?? "") ? p.get("next")! : "/";
  const sb = await forRequest();

  const tokenHash = p.get("token_hash");
  const type = p.get("type") as EmailOtpType | null;
  const code = p.get("code");
  const { error } = tokenHash && type
    ? await sb.auth.verifyOtp({ token_hash: tokenHash, type })
    : code ? await sb.auth.exchangeCodeForSession(code) : { error: new Error("lien incomplet") };

  if (error) {
    await setFlash("err", "Lien invalide ou expiré. Recommence la démarche.");
    redirect("/login");
  }
  if (type === "email_change") await setFlash("ok", "Adresse e-mail mise à jour.");
  if (type === "signup" || type === "email") await setFlash("ok", "Adresse confirmée. Commence par importer ton CV, puis active la double authentification.");
  redirect(type === "recovery" ? "/reset" : next);
}
