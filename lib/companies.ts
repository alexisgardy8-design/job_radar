/**
 * Secteurs et grandes entreprises par pays, avec le domaine de leur site carrière.
 * Le scan ajoute automatiquement à ses recherches les sites carrière des entreprises des secteurs choisis
 * (recherche web Tavily limitée à ces domaines : on interroge le moteur, les sites ne sont jamais scrapés).
 * Pour ajouter une entreprise : une ligne { name, domain } dans le bon secteur.
 */

export const SECTORS = [
  { id: "banque-assurance", label: "Banque & assurance", emoji: "🏦" },
  { id: "conseil-audit", label: "Conseil & audit", emoji: "📊" },
  { id: "tech-numerique", label: "Tech & numérique", emoji: "💻" },
  { id: "industrie-aero", label: "Industrie, aéro & auto", emoji: "✈️" },
  { id: "energie-environnement", label: "Énergie & environnement", emoji: "⚡" },
  { id: "luxe-conso", label: "Luxe, conso & distribution", emoji: "🛍️" },
  { id: "sante-pharma", label: "Santé & pharma", emoji: "💊" },
  { id: "transport-logistique", label: "Transport & logistique", emoji: "🚆" },
  { id: "btp-immobilier", label: "BTP & immobilier", emoji: "🏗️" },
  { id: "secteur-public", label: "Secteur public", emoji: "🏛️" },
] as const;

export type SectorId = (typeof SECTORS)[number]["id"];
export const SECTOR_IDS = SECTORS.map((s) => s.id) as SectorId[];

export interface Company { name: string; domain: string }

/** Grandes entreprises françaises par secteur (domaine utilisé pour cibler la recherche). */
export const COMPANIES_FR: Record<SectorId, Company[]> = {
  "banque-assurance": [
    { name: "BNP Paribas", domain: "group.bnpparibas" },
    { name: "Crédit Agricole CIB", domain: "jobs.ca-cib.com" },
    { name: "Crédit Agricole", domain: "groupecreditagricole.jobs" },
    { name: "Société Générale", domain: "careers.societegenerale.com" },
    { name: "Natixis / BPCE", domain: "groupebpce.com" },
    { name: "BPCE", domain: "recrutement.bpce.fr" },
    { name: "AXA", domain: "recrutement.axa.fr" },
    { name: "Generali", domain: "generali.fr" },
    { name: "Allianz", domain: "allianz.fr" },
    { name: "Crédit Mutuel / CIC", domain: "recrutement.creditmutuel.fr" },
    { name: "La Banque Postale", domain: "labanquepostale.com" },
    { name: "CNP Assurances", domain: "cnp.fr" },
    { name: "Amundi", domain: "amundi.com" },
  ],
  "conseil-audit": [
    { name: "Deloitte", domain: "deloitte.com" },
    { name: "PwC", domain: "pwc.fr" },
    { name: "EY", domain: "ey.com" },
    { name: "KPMG", domain: "kpmg.com" },
    { name: "Forvis Mazars", domain: "forvismazars.com" },
    { name: "Accenture", domain: "accenture.com" },
    { name: "Capgemini Invent", domain: "capgemini.com" },
    { name: "Wavestone", domain: "wavestone.com" },
    { name: "Sia Partners", domain: "sia-partners.com" },
    { name: "BCG", domain: "careers.bcg.com" },
  ],
  "tech-numerique": [
    { name: "Capgemini", domain: "capgemini.com" },
    { name: "Sopra Steria", domain: "soprasteria.com" },
    { name: "Atos", domain: "atos.net" },
    { name: "Orange", domain: "orange.jobs" },
    { name: "Dassault Systèmes", domain: "3ds.com" },
    { name: "Thales", domain: "careers.thalesgroup.com" },
    { name: "OVHcloud", domain: "ovhcloud.com" },
    { name: "Doctolib", domain: "careers.doctolib.com" },
  ],
  "industrie-aero": [
    { name: "Airbus", domain: "airbus.com" },
    { name: "Safran", domain: "safran-group.com" },
    { name: "Thales", domain: "careers.thalesgroup.com" },
    { name: "Renault Group", domain: "renaultgroup.com" },
    { name: "Stellantis", domain: "stellantis.com" },
    { name: "Michelin", domain: "michelin.com" },
    { name: "Saint-Gobain", domain: "saint-gobain.com" },
    { name: "Schneider Electric", domain: "se.com" },
    { name: "Alstom", domain: "alstom.com" },
  ],
  "energie-environnement": [
    { name: "TotalEnergies", domain: "totalenergies.com" },
    { name: "EDF", domain: "edf.fr" },
    { name: "Engie", domain: "engie.com" },
    { name: "Veolia", domain: "veolia.com" },
    { name: "Air Liquide", domain: "airliquide.com" },
  ],
  "luxe-conso": [
    { name: "LVMH", domain: "lvmh.com" },
    { name: "L'Oréal", domain: "careers.loreal.com" },
    { name: "Kering", domain: "kering.com" },
    { name: "Hermès", domain: "hermes.com" },
    { name: "Danone", domain: "danone.com" },
    { name: "Pernod Ricard", domain: "pernod-ricard.com" },
    { name: "Carrefour", domain: "carrefour.com" },
  ],
  "sante-pharma": [
    { name: "Sanofi", domain: "sanofi.com" },
    { name: "Servier", domain: "servier.com" },
    { name: "Ipsen", domain: "ipsen.com" },
    { name: "bioMérieux", domain: "biomerieux.com" },
    { name: "EssilorLuxottica", domain: "essilorluxottica.com" },
  ],
  "transport-logistique": [
    { name: "SNCF", domain: "sncf.com" },
    { name: "Air France", domain: "recrutement.airfrance.com" },
    { name: "CMA CGM", domain: "cmacgm-group.com" },
    { name: "Geodis", domain: "geodis.com" },
    { name: "RATP", domain: "ratp.fr" },
  ],
  "btp-immobilier": [
    { name: "Vinci", domain: "vinci.com" },
    { name: "Bouygues", domain: "bouygues.com" },
    { name: "Eiffage", domain: "eiffage.com" },
  ],
  "secteur-public": [
    { name: "Choisir le service public", domain: "choisirleservicepublic.gouv.fr" },
  ],
};

/** Entreprises ciblées pour les secteurs choisis (sans doublon de domaine). */
export function companiesFor(sectors: string[]): Company[] {
  const seen = new Set<string>();
  return sectors.flatMap((s) => COMPANIES_FR[s as SectorId] ?? []).filter((c) => !seen.has(c.domain) && seen.add(c.domain));
}

/** Entreprise correspondant à une URL, ou null. */
export function companyOfUrl(url: string): Company | null {
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
  for (const list of Object.values(COMPANIES_FR)) {
    const c = list.find((x) => host === x.domain || host.endsWith(`.${x.domain}`));
    if (c) return c;
  }
  return null;
}

export const sectorLabel = (id: string) => SECTORS.find((s) => s.id === id)?.label ?? id;
