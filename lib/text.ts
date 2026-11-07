import type { ContractType } from "./types.ts";

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘",
  eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", ecirc: "ê", ocirc: "ô", ucirc: "û", icirc: "î",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/** HTML → texte brut lisible (gère aussi le HTML échappé de Greenhouse). */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  let s = html.includes("&lt;") ? decodeEntities(html) : html;
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s || null;
}

/** Minuscules, sans accents, espaces normalisés : pour comparer des mots-clés. */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();
}

/** Vrai si `needle` apparaît comme mot ou suite de mots entière dans `haystack`. */
export function containsWords(haystack: string, needle: string): boolean {
  const h = ` ${norm(haystack)} `;
  const n = norm(needle);
  if (!n) return false;
  return h.includes(` ${n} `);
}

export function truncate(s: string | null, max: number): string | null {
  if (!s) return s;
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** Devine le type de contrat à partir d'un libellé libre. */
export function guessContract(label: string | null | undefined): ContractType | null {
  if (!label) return null;
  const l = norm(label);
  if (/\b(cdi|permanent|indetermine|full time permanent)\b/.test(l)) return "CDI";
  if (/\b(cdd|fixed term|determinee|temporary|temporaire)\b/.test(l)) return "CDD";
  if (/\b(stage|internship|intern|stagiaire)\b/.test(l)) return "STAGE";
  if (/\b(alternance|apprentissage|apprenticeship|apprenti)\b/.test(l)) return "ALTERNANCE";
  if (/\b(v i e|vie|volontariat international)\b/.test(l)) return "VIE";
  if (/\b(freelance|contractor|independant)\b/.test(l)) return "FREELANCE";
  return null;
}
