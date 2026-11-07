import { generateText, Output } from "ai";
import { z } from "zod";
import type { Filters, RawJob } from "./types.ts";
import type { Verdict } from "./db.ts";
import { truncate } from "./text.ts";

const MODEL = () => process.env.SCORING_MODEL || "anthropic/claude-haiku-5.5";

/* ---------- CV PDF → texte ---------- */
export async function pdfToText(pdf: Uint8Array): Promise<string> {
  const { text } = await generateText({
    model: MODEL(),
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "Retranscris fidèlement ce CV en texte brut structuré (sections, postes, dates, compétences). N'ajoute ni ne résume rien. Réponds uniquement avec le texte du CV." },
        { type: "file", data: pdf, mediaType: "application/pdf" },
      ],
    }],
  });
  return text.trim();
}

/* ---------- Scoring CV ↔ offre ---------- */
const verdictSchema = z.object({
  score: z.number().int().min(0).max(100).describe("Adéquation globale CV ↔ offre, 0 à 100"),
  summary: z.string().describe("Une phrase : pourquoi cette offre colle ou non au profil"),
  strengths: z.array(z.string()).max(3).describe("Points forts du candidat pour CE poste"),
  gaps: z.array(z.string()).max(3).describe("Écarts ou points bloquants"),
  startDate: z.string().nullable().describe("Date ou période de début indiquée dans l'offre, sinon null"),
  startDateCompatible: z.enum(["yes", "no", "unknown"]).describe("Compatible avec la date de début minimum du candidat ?"),
  experienceRequired: z.string().nullable().describe("Expérience demandée, ex. '0-2 ans', sinon null"),
  contractDetected: z.string().nullable().describe("Type de contrat détecté dans l'offre (CDI, CDD, VIE, stage...), sinon null"),
});

export async function scoreJob(job: RawJob, cv: string, f: Filters): Promise<Verdict> {
  const partial = !job.description || job.description.length < 400;
  const { output } = await generateText({
    model: MODEL(),
    output: Output.object({ schema: verdictSchema }),
    system: [
      "Tu es un recruteur exigeant en finance (banque, risque, audit, data). Tu évalues l'adéquation entre un CV et une offre.",
      "Barème : 85-100 = profil quasi idéal ; 70-84 = bon match, candidature recommandée ; 50-69 = partiel ; <50 = hors cible.",
      "Pénalise fortement : expérience exigée nettement supérieure à celle du candidat, contrat hors des contrats recherchés, métier différent.",
      "L'expérience en alternance compte comme de l'expérience professionnelle réelle, au prorata.",
      partial ? "La description est partielle (extrait ou alerte e-mail) : juge sur le titre, l'entreprise et le lieu, et reste prudent (pas plus de 80)." : "",
    ].filter(Boolean).join("\n"),
    prompt: [
      `CRITÈRES DU CANDIDAT\n- Contrats recherchés : ${f.contractTypes.join(", ")}\n- Lieux : ${f.locations.join(", ") || "indifférent"}\n- Début au plus tôt : ${f.minStartDate ?? "indifférent"}`,
      `CV DU CANDIDAT\n${truncate(cv, 8000)}`,
      `OFFRE\nTitre : ${job.title}\nEntreprise : ${job.company ?? "?"}\nLieu : ${job.location ?? "?"}\nContrat : ${job.contract ?? "?"}\nPubliée : ${job.postedAt ?? "?"}\n\n${truncate(job.description, 9000) ?? "(pas de description)"}`,
    ].join("\n\n"),
  });

  let score = output.score;
  if (f.strictStartDate && output.startDateCompatible === "no") score = Math.min(score, 40);
  return { ...output, score };
}

/* ---------- Alertes e-mail → offres ---------- */
const extractedSchema = z.object({
  jobs: z.array(z.object({
    title: z.string(),
    company: z.string().nullable(),
    location: z.string().nullable(),
    url: z.string().describe("Lien EXACT de l'offre tel qu'il apparaît dans l'e-mail"),
    snippet: z.string().nullable().describe("Extrait de description éventuel présent dans l'e-mail"),
  })),
});

export type ExtractedJob = z.infer<typeof extractedSchema>["jobs"][number];

export async function extractJobsFromEmail(subject: string, from: string, text: string): Promise<ExtractedJob[]> {
  const { output } = await generateText({
    model: MODEL(),
    output: Output.object({ schema: extractedSchema }),
    system: "Tu extrais les offres d'emploi d'un e-mail d'alerte (LinkedIn, Indeed, HelloWork, JobTeaser, APEC, Welcome to the Jungle...). Ignore les publicités, les articles et les liens de désabonnement. Ne fabrique jamais de lien : recopie uniquement ceux présents.",
    prompt: `Expéditeur : ${from}\nObjet : ${subject}\n\n${truncate(text, 30000)}`,
  });
  return output.jobs;
}
