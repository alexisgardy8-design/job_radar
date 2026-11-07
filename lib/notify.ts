import type { JobRow } from "./db.ts";
import type { NotifySettings } from "./types.ts";

const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function emailHtml(jobs: JobRow[], appUrl: string | null): string {
  const rows = jobs.map((j) => `
    <tr><td style="padding:14px 0;border-bottom:1px solid #eee">
      <div style="font-size:13px;color:#666">${esc(j.company)} · ${esc(j.location)} · ${esc(j.contract ?? j.verdict?.contractDetected ?? "")}</div>
      <a href="${esc(j.url)}" style="font-size:16px;font-weight:600;color:#1a1a1a">${esc(j.title)}</a>
      <span style="margin-left:8px;background:#e8f5e9;color:#1b5e20;border-radius:10px;padding:2px 8px;font-size:13px">${j.score}/100</span>
      <div style="font-size:14px;margin-top:6px">${esc(j.verdict?.summary)}</div>
      ${j.verdict?.gaps?.length ? `<div style="font-size:13px;color:#8a5300;margin-top:4px">À surveiller : ${esc(j.verdict.gaps.join(" · "))}</div>` : ""}
    </td></tr>`).join("");
  return `<div style="font-family:system-ui,sans-serif;max-width:640px">
    <h2 style="margin:0 0 8px">${jobs.length} nouvelle${jobs.length > 1 ? "s" : ""} offre${jobs.length > 1 ? "s" : ""} pour toi</h2>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    ${appUrl ? `<p><a href="${esc(appUrl)}">Ouvrir Job Radar</a></p>` : ""}
  </div>`;
}

async function sendEmail(to: string, jobs: JobRow[], appUrl: string | null) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY manquant");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || "Job Radar <onboarding@resend.dev>",
      to: [to],
      subject: `Job Radar : ${jobs.length} offre${jobs.length > 1 ? "s" : ""} (meilleur score ${jobs[0].score}/100)`,
      html: emailHtml(jobs, appUrl),
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status} : ${await res.text()}`);
}

async function sendTelegram(chatId: string, jobs: JobRow[], appUrl: string | null) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN manquant");
  const blocks = jobs.map((j) =>
    `<b>${j.score}/100</b> · <a href="${esc(j.url)}">${esc(j.title)}</a>\n${esc(j.company)} · ${esc(j.location)}\n<i>${esc(j.verdict?.summary)}</i>`);
  const messages: string[] = [];
  let cur = `🎯 <b>${jobs.length} nouvelle(s) offre(s)</b>\n\n`;
  for (const b of blocks) {
    if ((cur + b).length > 3800) { messages.push(cur); cur = ""; }
    cur += b + "\n\n";
  }
  if (appUrl) cur += `<a href="${esc(appUrl)}">Ouvrir Job Radar</a>`;
  messages.push(cur);
  for (const text of messages) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } }),
    });
    if (!res.ok) throw new Error(`Telegram ${res.status} : ${await res.text()}`);
  }
}

export async function notify(n: NotifySettings, jobs: JobRow[]): Promise<string[]> {
  if (!jobs.length) return [];
  const appUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null;
  const errors: string[] = [];
  const tasks: Promise<void>[] = [];
  if (n.email) tasks.push(sendEmail(n.email, jobs, appUrl).catch((e) => { errors.push(String(e)); }));
  if (n.telegramChatId) tasks.push(sendTelegram(n.telegramChatId, jobs, appUrl).catch((e) => { errors.push(String(e)); }));
  if (!tasks.length) errors.push("Aucun canal de notification configuré");
  await Promise.all(tasks);
  return errors;
}

/** Message de test depuis la page Réglages. */
export async function notifyTest(n: NotifySettings): Promise<string[]> {
  const fake = {
    id: 0, source: "test", title: "Offre de test – Job Radar fonctionne", company: "Job Radar", location: "Paris",
    contract: "CDI", url: "https://example.com", description: null, detail_ref: null, posted_at: null,
    first_seen: new Date().toISOString(), status: "scored", filter_reason: null, score: 99,
    verdict: { score: 99, summary: "Si tu lis ceci, les notifications marchent.", strengths: [], gaps: [], startDate: null, startDateCompatible: "unknown", experienceRequired: null, contractDetected: "CDI" },
    notified_at: null, dismissed: false,
  } satisfies JobRow;
  return notify(n, [fake]);
}
