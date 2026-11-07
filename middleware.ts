import { NextResponse, type NextRequest } from "next/server";

// Pré-filtre rapide en Edge : sans cookie de session, on renvoie vers /login.
// La validation réelle (session en base, non expirée) se fait côté serveur dans requireUser().
const PUBLIC = ["/login", "/api/cron/", "/api/ingest/"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (req.cookies.get("jr_sid")?.value) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
