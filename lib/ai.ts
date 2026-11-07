/** Appels IA (Vercel AI Gateway) : lecture du CV, scoring, extraction d'offres. */
import { generateText, Output } from "ai";
import { z } from "zod";
import { Text, type Filters, type RawJob, type Verdict } from "./core.ts";

const verdictSchema = z.object({
  score: z.number().int().min(0).max(100).describe("Adéquation globale CV ↔ offre, 0 à 100"),
  summary: z.string().describe("Une phrase : pourquoi l'offre colle ou non au profil"),
  strengths: z.array(z.string()).max(3).describe("Atouts du candidat pour CE poste"),
  gaps: z.array(z.string()).max(3).describe("Écarts ou points bloquants"),
  startDate: z.string().nullable().describe("Date ou période de début indiquée, sinon null"),
  startDateCompatible: z.enum(["yes", "no", "unknown"]).describe("Compatible avec le début au plus tôt du candidat ?"),
  experienceRequired: z.string().nullable().describe("Expérience demandée, ex. '0-2 ans', sinon null"),
  contractDetected: z.string().nullable().describe("Contrat détecté (CDI, CDD, VIE, stage…), sinon null"),
});

const extractedSchema = z.object({
  jobs: z.array(z.object({
    index: z.number().int().describe("Numéro du bloc source"),
    title: z.string(),
    company: z.string().nullable(),
    location: z.string().nullable(),
    contract: z.string().nullable(),
    url: z.string().describe("Lien EXACT de l'offre, recopié de la source"),
    postedDate: z.string().nullable().describe("AAAA-MM-JJ si visible"),
  })),
});

export type ExtractedJob = z.infer<typeof extractedSchema>["jobs"][number];

export class JobAI {
  private static get model() {
    return process.env.SCORING_MODEL || "anthropic/claude-haiku-5.5";
  }

  /** CV PDF → texte brut fidèle. */
  static async readCv(pdf: Uint8Array): Promise<string> {
    const { text } = await generateText({
      model: JobAI.model,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Retranscris fidèlement ce CV en texte brut structuré (sections, postes, dates, compétences). N'ajoute ni ne résume rien." },
          { type: "file", data: pdf, mediaType: "application/pdf" },
        ],
      }],
    });
    return text.trim();
  }

  /** Note une offre par rapport au CV. */
  static async score(job: RawJob, cv: string, f: Filters): Promise<Verdict> {
    const partial = (job.description?.length ?? 0) < 400;
    const { output } = await generateText({
      model: JobAI.model,
      output: Output.object({ schema: verdictSchema }),
      system: [
        "Tu es un recruteur exigeant. Tu évalues l'adéquation entre un CV et une offre d'emploi.",
        "Barème : 85-100 quasi idéal ; 70-84 bon match ; 50-69 partiel ; <50 hors cible.",
        "Pénalise fortement : expérience exigée nettement supérieure, contrat non recherché, métier différent.",
        "L'alternance compte comme expérience professionnelle réelle.",
        partial ? "Description partielle : juge sur titre, entreprise et lieu, sans dépasser 80." : "",
      ].join("\n"),
      prompt: `CRITÈRES : contrats ${f.contractTypes.join(", ")} · lieux ${f.locations.join(", ") || "indifférent"} · début au plus tôt ${f.minStartDate ?? "indifférent"}

CV
${Text.cut(cv, 8000)}

OFFRE
${job.title} — ${job.company ?? "?"} — ${job.location ?? "?"} — contrat ${job.contract ?? "?"} — publiée ${job.postedAt ?? "?"}
${Text.cut(job.description, 9000) ?? "(pas de description)"}`,
    });
    return f.strictStartDate && output.startDateCompatible === "no" ? { ...output, score: Math.min(output.score, 40) } : output;
  }

  /** Extrait des offres d'un texte (résultats de recherche ou e-mail d'alerte). Jamais de lien inventé. */
  static async extractJobs(context: string, blocks: string[]): Promise<ExtractedJob[]> {
    if (!blocks.length) return [];
    const { output } = await generateText({
      model: JobAI.model,
      output: Output.object({ schema: extractedSchema }),
      system: `Tu extrais des offres d'emploi précises depuis ${context}. Ignore les listes d'offres, articles, guides salaires, publicités et liens de désabonnement. Recopie uniquement des liens présents. null si un champ est absent.`,
      prompt: blocks.map((b, i) => `[${i}]\n${b}`).join("\n\n---\n\n"),
    });
    return (output.jobs as ExtractedJob[]).filter((j) => Text.isUrl(j.url));
  }
}
