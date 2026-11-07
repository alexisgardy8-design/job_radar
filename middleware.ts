import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Rafraîchit la session Supabase (cookies) à chaque requête, puis oriente :
// pas de session → /login ; mot de passe validé mais 2FA attendue → /login?mode=2fa.
// La vérification de référence reste côté serveur (requireUser) et en base (RLS + mfa_ok()).
const PUBLIC = ["/login", "/auth/", "/api/cron/", "/api/ingest/"];

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list, headers) => {
        for (const { name, value } of list) req.cookies.set(name, value);
        res = NextResponse.next({ request: req });
        for (const { name, value, options } of list) res.cookies.set(name, value, options);
        for (const [k, v] of Object.entries(headers ?? {})) res.headers.set(k, v);
      },
    },
  });

  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/")) return res;

  const { data } = await sb.auth.getUser();
  const isPublic = PUBLIC.some((p) => pathname.startsWith(p));
  const redirectTo = (path: string) => {
    const url = req.nextUrl.clone();
    url.pathname = path.split("?")[0];
    url.search = path.includes("?") ? path.slice(path.indexOf("?")) : "";
    const r = NextResponse.redirect(url);
    for (const c of res.cookies.getAll()) r.cookies.set(c);
    return r;
  };

  if (!data.user) return isPublic ? res : redirectTo("/login");
  if (!isPublic) {
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") return redirectTo("/login?mode=2fa");
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
