import type { Filters, RawJob } from "./types.ts";
import { containsWords, guessContract, norm } from "./text.ts";

export type PrefilterResult = { keep: true } | { keep: false; reason: string };

const REMOTE_WORDS = ["remote", "teletravail", "full remote", "a distance"];

/**
 * Tri gratuit et rapide, avant tout appel à l'IA :
 * titre (mots-clés / exclusions), type de contrat, lieu.
 * Une information absente ne fait jamais écarter une offre.
 */
export function prefilter(job: RawJob, f: Filters): PrefilterResult {
  const title = job.title ?? "";

  const excluded = f.excludeKeywords.find((k) => containsWords(title, k));
  if (excluded) return { keep: false, reason: `titre exclu (« ${excluded} »)` };

  if (f.titleKeywords.length > 0 && !f.titleKeywords.some((k) => containsWords(title, k))) {
    return { keep: false, reason: "titre hors cible" };
  }

  const contract = job.contract ?? guessContract(title);
  if (contract && f.contractTypes.length > 0 && !f.contractTypes.includes(contract)) {
    return { keep: false, reason: `contrat ${contract}` };
  }

  if (job.location && f.locations.length > 0) {
    const loc = norm(job.location);
    const ok =
      f.locations.some((l) => loc.includes(norm(l))) ||
      f.departements.some((d) => new RegExp(`(^|\\D)${d}(\\D|$)`).test(job.location!)) ||
      (f.locations.some((l) => REMOTE_WORDS.includes(norm(l))) && REMOTE_WORDS.some((w) => loc.includes(w)));
    if (!ok) return { keep: false, reason: `lieu (${job.location})` };
  }

  return { keep: true };
}

/** Parse une saisie « un élément par ligne ou séparé par des virgules ». */
export function parseList(input: string | null | undefined): string[] {
  if (!input) return [];
  return [...new Set(input.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean))];
}
