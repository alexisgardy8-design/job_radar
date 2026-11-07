/**
 * Clients Supabase (serveur uniquement).
 * - forRequest() : client lié à la session de l'utilisateur (cookies) : la RLS s'applique.
 * - admin()      : clé service_role, contourne la RLS. Réservé au cron, à l'ingestion et aux tables internes,
 *                  toujours avec un user_id déjà authentifié.
 * - stateless()  : client sans cookies, pour revérifier un mot de passe sans toucher à la session courante.
 */
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} manquant (voir .env.example)`);
  return v;
}

export const supabaseUrl = () => env("NEXT_PUBLIC_SUPABASE_URL");
export const supabaseAnonKey = () => env("NEXT_PUBLIC_SUPABASE_ANON_KEY");

export async function forRequest(): Promise<SupabaseClient> {
  const jar = await cookies();
  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        // Les Server Components ne peuvent pas écrire de cookies : le middleware s'en charge.
        try { for (const { name, value, options } of list) jar.set(name, value, options); } catch {}
      },
    },
  });
}

let adminClient: SupabaseClient | null = null;
export function admin(): SupabaseClient {
  return (adminClient ??= createClient(supabaseUrl(), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  }));
}

export function stateless(): SupabaseClient {
  return createClient(supabaseUrl(), supabaseAnonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Lève une erreur lisible si Supabase en renvoie une. */
export function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what} : ${res.error.message}`);
  return res.data;
}
