/**
 * Scan manuel avec progression en direct : renvoie un flux NDJSON (un événement JSON par ligne)
 * lu par le composant ScanPanel. Mêmes règles que le reste de l'app : utilisateur authentifié (2FA comprise) et quota.
 */
import { authState } from "@/lib/auth.ts";
import { Private } from "@/lib/repos.ts";
import { Scanner, type ScanEvent } from "@/lib/scanner.ts";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST() {
  const state = await authState();
  if (state.status !== "ok") return Response.json({ error: "Session expirée, reconnecte-toi." }, { status: 401 });
  const userId = state.user.id;
  const l = Private.LIMITS.scan;
  if (!(await Private.claim(userId, "scan"))) {
    return Response.json({ error: `Scan manuel limité à ${l.max} par jour, un toutes les ${l.minutes} minutes.` }, { status: 429 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ScanEvent | { type: "error"; message: string }) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await (await Scanner.forUser(userId)).run({ onProgress: send });
      } catch (e) {
        send({ type: "error", message: String((e as Error)?.message ?? e).slice(0, 250) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
