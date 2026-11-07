export type ContractType = "CDI" | "CDD" | "STAGE" | "ALTERNANCE" | "FREELANCE" | "VIE" | "AUTRE";

export interface Filters {
  /** Mots-clés de poste : une offre est gardée si son titre contient au moins l'un d'eux. */
  titleKeywords: string[];
  /** Mots à exclure du titre (ex. "stage", "senior", "head of"). */
  excludeKeywords: string[];
  contractTypes: ContractType[];
  /** Lieux acceptés (villes, "Paris", "Île-de-France", "remote"...). Vide = partout. */
  locations: string[];
  /** Départements pour France Travail (ex. ["75","92"]). */
  departements: string[];
  /** Date de début minimum (AAAA-MM-JJ). */
  minStartDate: string | null;
  /** Si vrai, une offre dont le démarrage est explicitement avant minStartDate est écartée. */
  strictStartDate: boolean;
  /** Score minimum (0–100) pour être notifié. */
  scoreThreshold: number;
}

export type CareerSourceType = "greenhouse" | "lever" | "smartrecruiters" | "workday" | "sitemap";

export interface CareerSource {
  type: CareerSourceType;
  /** greenhouse : board token · lever : site · smartrecruiters : company id · workday : URL du site carrière · sitemap : URL du sitemap */
  id: string;
  label: string;
  /** sitemap uniquement : ne garder que les URL contenant ce texte (ex. "/job/"). */
  urlFilter?: string;
}

export interface Sources {
  /** Recherche web (Perplexity via AI Gateway) : couvre LinkedIn, Indeed, HelloWork, JobTeaser… indexés. */
  webSearch: boolean;
  franceTravail: boolean;
  adzuna: boolean;
  careers: CareerSource[];
}

export interface NotifySettings {
  email: string | null;
  telegramChatId: string | null;
}

export interface Settings {
  cvText: string | null;
  cvName: string | null;
  filters: Filters;
  sources: Sources;
  notify: NotifySettings;
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
  /** Pour les sources dont la liste ne contient pas la description. */
  detailRef?: string;
}

export const DEFAULT_FILTERS: Filters = {
  titleKeywords: ["risk", "risque", "contrôle interne", "audit", "analyst", "analyste", "graduate"],
  excludeKeywords: ["stage", "stagiaire", "intern", "alternance", "apprenti", "senior", "head of", "director", "directeur", "lead"],
  contractTypes: ["CDI", "VIE"],
  locations: ["Paris", "Île-de-France", "La Défense", "Montrouge", "Hauts-de-Seine"],
  departements: ["75", "92"],
  minStartDate: "2027-09-01",
  strictStartDate: false,
  scoreThreshold: 70,
};

export const DEFAULT_SOURCES: Sources = { webSearch: true, franceTravail: true, adzuna: true, careers: [] };
export const DEFAULT_NOTIFY: NotifySettings = { email: null, telegramChatId: null };
