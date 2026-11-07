import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { checkPassword, createSessionToken, SESSION_COOKIE, SESSION_DAYS } from "@/lib/auth.ts";

async function login(formData: FormData) {
  "use server";
  const ok = await checkPassword(String(formData.get("password") ?? ""));
  if (!ok) {
    await new Promise((r) => setTimeout(r, 1500)); // ralentit les essais en série
    redirect("/login?e=1");
  }
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86_400,
  });
  redirect("/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  return (
    <main className="login">
      <div className="card">
        <h1 style={{ fontSize: 20, marginTop: 0 }}>Job Radar</h1>
        {e && <div className="flash err">Mot de passe incorrect.</div>}
        <form action={login} className="stack">
          <label>Mot de passe<input type="password" name="password" autoFocus required autoComplete="current-password" /></label>
          <button className="btn primary" type="submit">Se connecter</button>
        </form>
      </div>
    </main>
  );
}
