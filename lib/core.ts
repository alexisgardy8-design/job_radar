/** Domaine : types, valeurs par défaut, utilitaires texte et filtre d'offres. */

export type ContractType = "CDI" | "CDD" | "STAGE" | "ALTERNANCE" | "FREELANCE" | "VIE";
export const CONTRACTS: ContractType[] = ["CDI", "CDD", "VIE", "STAGE", "ALTERNANCE", "FREELANCE"];

export type CareerType = "greenhouse" | "lever" | "smartrecruiters" | "workday";
export const CAREER_TYPES: CareerType[] = ["greenhouse", "lever", "smartrecruiters", "workday"];

export interface Filters {
  titleKeywords: string[];
  excludeKeywords: string[];
  contractTypes: ContractType[];
  locations: string[];
  departements: string[];
  minStartDate: string | null;
  strictStartDate: boolean;
  scoreThreshold: number;
}

export interface CareerSite { type: CareerType; id: string; label: string }

export interface Settings {
  cvText: string | null;
  cvName: string | null;
  filters: Filters;
  sources: { webSearch: boolean; franceTravail: boolean; adzuna: boolean; careers: CareerSite[] };
  /** Les e-mails partent uniquement vers l'adresse du compte, vérifiée par Supabase Auth. */
  notify: { enabled: boolean };
}

/** Offre normalisée, quelle que soit la source. */
export interface RawJob {
  source: string;
  externalId: string;
  title: string;
  company: string | null;
  location: string | null;
  contract: ContractType | null;
  url: string;
  description: string | null;
  postedAt: string | null;
}

export interface Verdict {
  score: number;
  summary: string;
  strengths: string[];
  gaps: string[];
  startDate: string | null;
  startDateCompatible: "yes" | "no" | "unknown";
  experienceRequired: string | null;
  contractDetected: string | null;
}

/** Offre retenue (score ≥ seuil) : envoyée par e-mail et gardée parmi les 10 meilleures du compte. */
export interface Match {
  id: number;
  title: string;
  company: string | null;
  location: string | null;
  contract: string | null;
  source: string;
  url: string;
  score: number;
  verdict: Verdict;
  found_at: string;
  sent_at: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  cvText: null,
  cvName: null,
  filters: {
    titleKeywords: ["risk", "risque", "contrôle interne", "audit", "analyst", "analyste", "graduate"],
    excludeKeywords: ["stage", "stagiaire", "intern", "alternance", "apprenti", "senior", "head of", "director", "directeur", "lead"],
    contractTypes: ["CDI", "VIE"],
    locations: ["Paris", "Île-de-France", "La Défense", "Montrouge", "Hauts-de-Seine"],
    departements: ["75", "92"],
    minStartDate: "2027-09-01",
    strictStartDate: false,
    scoreThreshold: 70,
  },
  sources: { webSearch: true, franceTravail: true, adzuna: true, careers: [] },
  notify: { enabled: true },
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", eacute: "é", egrave: "è", agrave: "à" };

/** Utilitaires texte (fonctions pures). */
export class Text {
  static decode(s: string): string {
    return s
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
  }

  /** HTML (y compris échappé) → texte lisible. */
  static fromHtml(html: string | null | undefined): string | null {
    if (!html) return null;
    const s = Text.decode((html.includes("&lt;") ? Text.decode(html) : html)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " "))
      .replace(/[ \t ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return s || null;
  }

  /** Minuscules, sans accents ni ponctuation. */
  static norm(s: string): string {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim();
  }

  /**
   * `needle` apparaît comme mot(s) entier(s) dans `haystack`.
   * `inflected` accepte aussi pluriel et féminin (risque → risques, analyst → analyste) : utile pour les mots-clés
   * recherchés, mais pas pour les exclusions (« intern » ne doit pas exclure « contrôle interne »).
   */
  static hasWords(haystack: string, needle: string, inflected = false): boolean {
    const n = Text.norm(needle);
    if (!n) return false;
    const h = ` ${Text.norm(haystack)} `;
    if (!inflected) return h.includes(` ${n} `);
    const words = n.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:e|s|x|es)?");
    return new RegExp(`(^| )${words.join(" ")}( |$)`).test(h.trim());
  }

  static cut(s: string | null | undefined, max: number): string | null {
    return s ? (s.length > max ? s.slice(0, max) + "…" : s) : null;
  }

  /** Liste saisie « une par ligne ou séparée par des virgules ». */
  static list(input: string | null | undefined, max = 30): string[] {
    return [...new Set((input ?? "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean))].slice(0, max);
  }

  static contract(label: string | null | undefined): ContractType | null {
    const l = Text.norm(label ?? "");
    if (/\b(cdi|permanent|indetermine)\b/.test(l)) return "CDI";
    if (/\b(cdd|fixed term|determinee|temporary|temporaire)\b/.test(l)) return "CDD";
    if (/\b(stage|internship|intern|stagiaire)\b/.test(l)) return "STAGE";
    if (/\b(alternance|apprentissage|apprenticeship|apprenti)\b/.test(l)) return "ALTERNANCE";
    if (/\b(vie|volontariat international)\b/.test(l)) return "VIE";
    if (/\b(freelance|contractor|independant)\b/.test(l)) return "FREELANCE";
    return null;
  }

  static isUrl(u: string): boolean {
    return /^https?:\/\//i.test(u);
  }

  static isEmail(e: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
  }
}

/** Tri gratuit avant l'IA. Une information absente ne fait jamais écarter une offre. */
export class JobFilter {
  constructor(private readonly f: Filters) {}

  /** Raison du rejet, ou null si l'offre est gardée. */
  reject(job: RawJob): string | null {
    const { f } = this;
    const excluded = f.excludeKeywords.find((k) => Text.hasWords(job.title, k));
    if (excluded) return `titre exclu (« ${excluded} »)`;
    if (f.titleKeywords.length && !f.titleKeywords.some((k) => Text.hasWords(job.title, k, true))) return "titre hors cible";
    const contract = job.contract ?? Text.contract(job.title);
    if (contract && f.contractTypes.length && !f.contractTypes.includes(contract)) return `contrat ${contract}`;
    if (job.location && f.locations.length) {
      const loc = Text.norm(job.location);
      const ok = f.locations.some((l) => loc.includes(Text.norm(l)))
        || f.departements.some((d) => new RegExp(`(^|\\D)${d}(\\D|$)`).test(job.location!))
        || (/remote|teletravail/.test(loc) && f.locations.some((l) => /remote|teletravail/.test(Text.norm(l))));
      if (!ok) return `lieu (${job.location})`;
    }
    return null;
  }
}
