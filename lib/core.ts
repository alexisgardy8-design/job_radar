/** Domaine : types, valeurs par défaut, utilitaires texte et filtre d'offres. */

export type ContractType = "CDI" | "CDD" | "STAGE" | "ALTERNANCE" | "FREELANCE" | "VIE";
export const CONTRACTS: ContractType[] = ["CDI", "CDD", "VIE", "STAGE", "ALTERNANCE", "FREELANCE"];

export type CareerType = "greenhouse" | "lever" | "smartrecruiters" | "workday";
export const CAREER_TYPES: CareerType[] = ["greenhouse", "lever", "smartrecruiters", "workday"];

/** Langues proposées dans les réglages (forme canonique, en minuscules). */
export const LANGUAGES = ["français", "anglais", "espagnol", "allemand", "italien", "portugais", "néerlandais", "arabe", "chinois"] as const;

export interface Filters {
  /** Postes recherchés : servent à interroger les sources et à prioriser les offres (pas à les exclure). */
  titleKeywords: string[];
  contractTypes: ContractType[];
  locations: string[];
  departements: string[];
  minStartDate: string | null;
  strictStartDate: boolean;
  scoreThreshold: number;
  /** Langues maîtrisées : une offre qui en exige une autre est écartée. Vide = pas de filtre. */
  languages: string[];
  /** Années d'expérience exigées au maximum. null = pas de filtre. */
  maxExperienceYears: number | null;
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
  /** Langues exigées par l'offre (absent sur les anciens verdicts). */
  languagesRequired?: string[];
  /** Années d'expérience minimum exigées (absent sur les anciens verdicts). */
  experienceYearsMin?: number | null;
  /** Raison pour laquelle l'offre est écartée par les filtres langue / expérience, sinon null. */
  filteredReason?: string | null;
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
    contractTypes: ["CDI", "VIE"],
    locations: ["Paris", "Île-de-France", "La Défense", "Montrouge", "Hauts-de-Seine"],
    departements: ["75", "92"],
    minStartDate: "2027-09-01",
    strictStartDate: false,
    scoreThreshold: 70,
    languages: ["français", "anglais"],
    maxExperienceYears: 2,
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

/** Langue canonique citée dans un texte libre (« Anglais courant » → « anglais »), ou null. */
const LANGUAGE_ALIASES: [string, RegExp][] = [
  ["français", /\b(francais|french)\b/], ["anglais", /\b(anglais|english)\b/], ["espagnol", /\b(espagnol|spanish)\b/],
  ["allemand", /\b(allemand|german|deutsch)\b/], ["italien", /\b(italien|italian)\b/], ["portugais", /\b(portugais|portuguese)\b/],
  ["néerlandais", /\b(neerlandais|dutch|flamand)\b/], ["arabe", /\b(arabe|arabic)\b/], ["chinois", /\b(chinois|mandarin|chinese)\b/],
];
export function canonicalLanguage(label: string): string | null {
  const n = Text.norm(label);
  return LANGUAGE_ALIASES.find(([, re]) => re.test(n))?.[0] ?? null;
}

/** Nom lisible du site où l'offre a été trouvée. */
export function sourceName(source: string, url?: string): string {
  const SITES: [RegExp, string][] = [
    [/linkedin/, "LinkedIn"], [/indeed/, "Indeed"], [/hellowork/, "HelloWork"], [/welcometothejungle/, "Welcome to the Jungle"],
    [/jobteaser/, "JobTeaser"], [/apec/, "APEC"], [/francetravail|france_travail/, "France Travail"], [/wizbii/, "Wizbii"],
    [/adzuna/, "Adzuna"], [/greenhouse/, "Greenhouse"], [/lever/, "Lever"], [/smartrecruiters/, "SmartRecruiters"],
    [/myworkdayjobs|workday/, "Workday"], [/teamtailor/, "Teamtailor"],
  ];
  let host = "";
  try { host = url ? new URL(url).hostname.replace(/^www\./, "") : ""; } catch {}
  const hay = `${source} ${host}`.toLowerCase();
  const site = SITES.find(([re]) => re.test(hay))?.[1] ?? (host || source.replace(/^(web|email):/, ""));
  return source.startsWith("email:") ? `${site} (alerte e-mail)` : site;
}

/**
 * Filtres de l'utilisateur.
 * - reject() : avant l'IA, gratuit — contrat et localisation. Une information absente ne fait jamais écarter une offre.
 * - afterScoring() : après l'IA, qui détecte les langues et l'expérience exigées.
 * - relevance() : priorise les offres dont le titre correspond aux postes recherchés (sans exclure les autres).
 */
export class JobFilter {
  constructor(private readonly f: Filters) {}

  reject(job: RawJob): string | null {
    const { f } = this;
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

  afterScoring(v: Verdict): string | null {
    const { f } = this;
    if (f.languages.length && v.languagesRequired?.length) {
      const missing = [...new Set(v.languagesRequired.map(canonicalLanguage).filter((l): l is string => !!l && !f.languages.includes(l)))];
      if (missing.length) return `langue demandée : ${missing.join(", ")}`;
    }
    if (f.maxExperienceYears !== null && typeof v.experienceYearsMin === "number" && v.experienceYearsMin > f.maxExperienceYears) {
      return `${v.experienceYearsMin} ans d'expérience demandés`;
    }
    return null;
  }

  relevance(job: RawJob): number {
    return this.f.titleKeywords.some((k) => Text.hasWords(job.title, k, true)) ? 1 : 0;
  }
}
