/** Envoi des offres par e-mail (SMTP, ex. Gmail + mot de passe d'application : gratuit, ~500 mails/jour). */
import nodemailer from "nodemailer";
import { Text, type JobRow } from "./core.ts";

const esc = (s: string | null | undefined) => (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export class Mailer {
  private static transport: nodemailer.Transporter | null = null;

  static get configured(): boolean {
    return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
  }

  private static get smtp(): nodemailer.Transporter {
    if (!Mailer.configured) throw new Error("envoi d'e-mails non configuré (SMTP_USER / SMTP_PASS)");
    const port = Number(process.env.SMTP_PORT ?? 465);
    return (Mailer.transport ??= nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    }));
  }

  private static get appUrl(): string | null {
    return process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null;
  }

  /** E-mail récapitulatif personnalisé : une carte par offre, avec score, raisons et bouton « Postuler ». */
  static async sendJobs(to: string, jobs: JobRow[]): Promise<void> {
    if (!jobs.length) return;
    const best = jobs[0];
    const subject = jobs.length === 1
      ? `${best.score}/100 · ${best.title}${best.company ? ` – ${best.company}` : ""}`
      : `${jobs.length} offres pour toi · meilleure : ${best.score}/100 ${best.title}`;
    await Mailer.smtp.sendMail({
      from: process.env.MAIL_FROM || `Job Radar <${process.env.SMTP_USER}>`,
      to,
      subject,
      html: Mailer.html(to, jobs),
      text: jobs.map((j) => `${j.score}/100 · ${j.title} — ${j.company ?? ""} (${j.location ?? ""})\n${j.verdict?.summary ?? ""}\nPostuler : ${j.url}`).join("\n\n"),
    });
  }

  static async sendTest(to: string): Promise<void> {
    await Mailer.sendJobs(to, [{
      id: 0, source: "test", title: "Offre de test : tes e-mails Job Radar fonctionnent", company: "Job Radar", location: "Paris",
      contract: "CDI", url: "https://example.com", description: null, posted_at: null, first_seen: new Date().toISOString(),
      status: "scored", filter_reason: null, score: 99, notified_at: null, dismissed: false,
      verdict: { score: 99, summary: "Si tu lis ceci, l'envoi fonctionne.", strengths: ["Configuration SMTP OK"], gaps: [], startDate: null, startDateCompatible: "unknown", experienceRequired: null, contractDetected: "CDI" },
    }]);
  }

  private static html(to: string, jobs: JobRow[]): string {
    const app = Mailer.appUrl;
    const cards = jobs.map((j) => {
      const v = j.verdict;
      const [bg, fg] = (j.score ?? 0) >= 85 ? ["#e6f4ea", "#1e6b3a"] : ["#eef4e6", "#3d6b1e"];
      const meta = [j.company, j.location, j.contract ?? v?.contractDetected, v?.experienceRequired && `exp. ${v.experienceRequired}`, v?.startDate && `début : ${v.startDate}`]
        .filter(Boolean).map(esc).join(" · ");
      return `<tr><td style="padding:0 0 14px"><table role="presentation" width="100%" style="border:1px solid #e6e5e0;border-radius:10px;background:#fff"><tr><td style="padding:16px 18px">
        <span style="background:${bg};color:${fg};font-weight:700;border-radius:12px;padding:2px 10px;font-size:13px">${j.score}/100</span>
        <div style="font-size:17px;font-weight:600;margin:8px 0 2px">${esc(j.title)}</div>
        <div style="font-size:13px;color:#6b6b66">${meta}</div>
        ${v?.summary ? `<p style="font-size:14px;margin:10px 0 6px">${esc(v.summary)}</p>` : ""}
        ${v?.strengths.length ? `<div style="font-size:13px;color:#1e6b3a">✔ ${v.strengths.map(esc).join("<br>✔ ")}</div>` : ""}
        ${v?.gaps.length ? `<div style="font-size:13px;color:#8a5300;margin-top:4px">⚠ ${v.gaps.map(esc).join("<br>⚠ ")}</div>` : ""}
        <a href="${esc(Text.isUrl(j.url) ? j.url : "#")}" style="display:inline-block;margin-top:12px;background:#2f5d50;color:#fff;text-decoration:none;font-weight:600;padding:9px 16px;border-radius:8px;font-size:14px">Voir l'offre et postuler →</a>
      </td></tr></table></td></tr>`;
    }).join("");
    return `<!doctype html><html lang="fr"><body style="margin:0;background:#f7f7f5;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1c1c1a">
      <table role="presentation" width="100%"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" style="max-width:640px">
        <tr><td style="padding:0 0 16px"><div style="font-size:20px;font-weight:700">Job Radar</div>
          <div style="font-size:14px;color:#6b6b66">${jobs.length} nouvelle(s) offre(s) correspondant à ton CV, triées par score.</div></td></tr>
        ${cards}
        <tr><td style="font-size:12px;color:#6b6b66;padding-top:8px">Envoyé à ${esc(to)} selon les filtres de ton compte.
          ${app ? `<a href="${app}" style="color:#2f5d50">Ouvrir Job Radar</a> · <a href="${app}/settings" style="color:#2f5d50">Modifier mes filtres ou me désabonner</a>` : ""}</td></tr>
      </table></td></tr></table></body></html>`;
  }
}
