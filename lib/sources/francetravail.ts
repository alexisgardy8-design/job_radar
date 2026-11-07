import type { ContractType, Filters, RawJob } from "../types.ts";
import { getJson } from "./http.ts";
import { guessContract } from "../text.ts";

const TOKEN_URL = "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
const SEARCH_URL = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";

const CONTRACT_CODES: Partial<Record<ContractType, string>> = { CDI: "CDI", CDD: "CDD", FREELANCE: "LIB" };

interface FtOffre {
  id: string;
  intitule: string;
  description?: string;
  dateCreation?: string;
  typeContrat?: string;
  typeContratLibelle?: string;
  natureContrat?: string;
  entreprise?: { nom?: string };
  lieuTravail?: { libelle?: string };
  origineOffre?: { urlOrigine?: string };
}

export function parseFranceTravail(json: { resultats?: FtOffre[] } | null): RawJob[] {
  return (json?.resultats ?? []).map((o) => ({
    source: "france_travail",
    externalId: o.id,
    title: o.intitule,
    company: o.entreprise?.nom ?? null,
    location: o.lieuTravail?.libelle ?? null,
    contract:
      o.typeContrat === "CDI" ? "CDI" :
      o.typeContrat === "CDD" ? "CDD" :
      guessContract(`${o.natureContrat ?? ""} ${o.typeContratLibelle ?? ""}`),
    url: o.origineOffre?.urlOrigine || `https://candidat.francetravail.fr/offres/recherche/detail/${o.id}`,
    description: o.description ?? null,
    postedAt: o.dateCreation ?? null,
  }));
}

async function getToken(): Promise<string> {
  const id = process.env.FRANCE_TRAVAIL_CLIENT_ID;
  const secret = process.env.FRANCE_TRAVAIL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("FRANCE_TRAVAIL_CLIENT_ID / SECRET manquants");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: id,
      client_secret: secret,
      scope: "api_offresdemploiv2 o2dsoffre",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`France Travail token : ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

export async function fetchFranceTravail(f: Filters, sinceDays = 3): Promise<RawJob[]> {
  const token = await getToken();
  const now = new Date();
  const since = new Date(now.getTime() - sinceDays * 86_400_000);
  const contracts = f.contractTypes.map((c) => CONTRACT_CODES[c]).filter(Boolean).join(",");
  const out: RawJob[] = [];

  // Une requête par mot-clé : plus de rappel qu'une requête combinée.
  for (const kw of f.titleKeywords) {
    const params = new URLSearchParams({
      motsCles: kw,
      range: "0-149",
      minCreationDate: iso(since),
      maxCreationDate: iso(now),
    });
    if (contracts) params.set("typeContrat", contracts);
    if (f.departements.length) params.set("departement", f.departements.slice(0, 5).join(","));
    const json = await getJson<{ resultats?: FtOffre[] }>(`${SEARCH_URL}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    out.push(...parseFranceTravail(json));
  }
  return out;
}
