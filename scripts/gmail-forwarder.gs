/**
 * Job Radar – transfert des alertes emploi depuis TON Gmail (facultatif).
 *
 * Ce script ne lit QUE les fils portant le libellé "job-alerts" et ne les envoie qu'à ton site.
 * Installation :
 *  1. Dans Gmail, crée un filtre : De = jobalerts-noreply@linkedin.com OR alert@indeed.com OR
 *     hellowork OR jobteaser OR apec OR welcometothejungle → « Appliquer le libellé : job-alerts ».
 *  2. Va sur https://script.google.com → Nouveau projet → colle ce fichier.
 *  3. Paramètres du projet → Propriétés du script : ajoute
 *       JOB_RADAR_URL   = https://ton-projet.vercel.app/api/ingest/email
 *       INGEST_SECRET   = (la même valeur que sur Vercel)
 *  4. Exécute une fois `forwardJobAlerts` (Google te demande l'autorisation), puis
 *     Déclencheurs → Ajouter → forwardJobAlerts, basé sur le temps, toutes les heures.
 */
const LABEL = "job-alerts";
const DONE_LABEL = "job-alerts/traite";

function forwardJobAlerts() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty("JOB_RADAR_URL");
  const secret = props.getProperty("INGEST_SECRET");
  if (!url || !secret) throw new Error("JOB_RADAR_URL / INGEST_SECRET manquants dans les propriétés du script");

  const done = GmailApp.getUserLabelByName(DONE_LABEL) || GmailApp.createLabel(DONE_LABEL);
  const threads = GmailApp.search(`label:${LABEL} -label:${DONE_LABEL.replace("/", "-")} newer_than:3d`, 0, 20);

  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      const res = UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "application/json",
        headers: { Authorization: "Bearer " + secret },
        payload: JSON.stringify({ from: msg.getFrom(), subject: msg.getSubject(), body: htmlWithLinks(msg.getBody()) }),
        muteHttpExceptions: true,
      });
      if (res.getResponseCode() >= 300) throw new Error("Job Radar a répondu " + res.getResponseCode() + " : " + res.getContentText());
    });
    thread.addLabel(done);
  });
}

/** Garde le texte ET les liens (href) pour que l'IA retrouve l'URL exacte de chaque offre. */
function htmlWithLinks(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, " $2 [$1] ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .slice(0, 60000);
}
