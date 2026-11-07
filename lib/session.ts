import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "./auth.ts";

/** Défense en profondeur : chaque Server Action revérifie la session. */
export async function requireAuth() {
  const jar = await cookies();
  if (!(await verifySessionToken(jar.get(SESSION_COOKIE)?.value))) redirect("/login");
}
