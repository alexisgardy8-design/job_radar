# Job Radar

Agent personnel de veille d'offres d'emploi : il collecte les nouvelles offres chaque jour, les trie selon tes filtres, les note par rapport à ton CV avec une IA, et t'envoie les meilleures par e-mail et/ou Telegram.

## Comment il trouve les offres (uniquement par des moyens légaux)

| Source | Ce qu'elle couvre | Coût |
|---|---|---|
| **Recherche web** (Perplexity via Vercel AI Gateway) | Offres indexées par les moteurs de recherche sur LinkedIn, Indeed, HelloWork, JobTeaser, Welcome to the Jungle, APEC, les sites carrière des banques… On interroge le moteur, sans visiter ces sites. | ≈ 0,005 $ par recherche, soit 2 à 4 € par mois |
| **France Travail** (API officielle) | Offres France Travail et celles de ses partenaires | Gratuit |
| **Adzuna** (API) | Agrégateur d'offres françaises | Gratuit |
| **Sites carrière** | Greenhouse, Lever, SmartRecruiters, Workday : les API publiques qu'utilisent les pages carrière elles-mêmes | Gratuit |
| **Sitemaps** | N'importe quel site carrière qui publie un sitemap avec des données `JobPosting`. Le robots.txt est respecté. | Gratuit |
| **Alertes e-mail** (facultatif) | Tes propres alertes LinkedIn, Indeed, HelloWork, JobTeaser… transmises par un script dans ton Gmail | Gratuit |

LinkedIn, Indeed et JobTeaser ne sont jamais scrapés directement : leurs conditions d'utilisation l'interdisent.

Le scoring IA (Claude Haiku via AI Gateway) coûte quelques centimes par jour. AI Gateway offre 5 $ de crédit gratuit par mois, ce qui suffit en général à couvrir le tout.

## Fonctionnement

```
Cron quotidien (06:00 UTC) ─┬─ recherche web ─┐
                            ├─ France Travail ┤
                            ├─ Adzuna ────────┼─► dédoublonnage ─► tri gratuit (titre, contrat, lieu)
                            ├─ sites carrière ┤                        │
Script Gmail (toutes les h) ┴─ alertes e-mail ┘                        ▼
                                                     IA : score /100 vs ton CV, points forts, écarts, date de début
                                                                       │
                                                       score ≥ seuil ─► e-mail / Telegram + tableau de bord
```

## Déploiement (≈ 20 min)

### 1. Mettre le code sur GitHub et créer le projet Vercel
```bash
cd job-radar
npm install
git init && git add -A && git commit -m "Job Radar"
# crée un repo privé sur GitHub, pousse le code, puis sur vercel.com : Add New → Project → importe le repo
```
Tu peux aussi déployer directement avec `npx vercel` depuis le dossier.

### 2. Base de données
Dans le projet Vercel : **Storage → Create → Neon (Postgres)**. `DATABASE_URL` est ajoutée automatiquement.
Ouvre ensuite la console SQL de Neon et colle le contenu de `db/schema.sql`.

### 3. IA
Dans le dashboard Vercel, **AI Gateway** s'active depuis l'onglet du même nom. Une fois déployé, l'authentification se fait seule (OIDC). Pour tester en local uniquement, crée une clé et mets-la dans `AI_GATEWAY_API_KEY`.

### 4. Variables d'environnement (Settings → Environment Variables)
Pars de `.env.example`. Le minimum :
- `APP_PASSWORD` : ton mot de passe de connexion (long)
- `SESSION_SECRET` et `CRON_SECRET` : génère-les avec `openssl rand -hex 32`
- au moins un canal de notification :
  - **Telegram** : crée un bot avec @BotFather → `TELEGRAM_BOT_TOKEN`. Envoie un message à ton bot, puis ouvre `https://api.telegram.org/bot<TOKEN>/getUpdates` pour récupérer ton `chat.id`, que tu colles ensuite dans les Réglages du site.
  - **E-mail** : clé Resend → `RESEND_API_KEY`

Facultatif : `FRANCE_TRAVAIL_CLIENT_ID/SECRET` (francetravail.io → créer une application → s'abonner à « Offres d'emploi v2 »), `ADZUNA_APP_ID/KEY` (developer.adzuna.com), `INGEST_SECRET` (alertes e-mail).

Redéploie après avoir ajouté les variables.

### 5. Premier lancement
1. Ouvre le site et connecte-toi.
2. **Réglages** : importe ton CV (PDF), puis règle tes mots-clés, contrats, lieux, date de début et seuil.
3. Clique sur **Envoyer une notification de test**.
4. Reviens sur **Offres** et clique sur **Scanner maintenant**.

Ensuite, le cron tourne tout seul chaque jour. Le plan gratuit Vercel n'autorise qu'un cron par jour. Avec le plan Pro, tu peux passer `vercel.json` à `0 */4 * * *` pour scanner toutes les 4 heures.

### 6. (Facultatif) Alertes e-mail LinkedIn / Indeed / JobTeaser
Suis les instructions en tête de `scripts/gmail-forwarder.gs`. Le script tourne dans **ton** compte Google, lit uniquement les mails portant le libellé `job-alerts`, et t'envoie une notification dans l'heure dès qu'une alerte contient une offre qui matche.

## Ajouter des sites carrière
Dans Réglages → Sites carrière, mets une ligne par site :
```
workday | https://<entreprise>.wd3.myworkdayjobs.com/fr-FR/<Site> | Nom
greenhouse | <board-token> | Nom          # boards.greenhouse.io/<board-token>
lever | <site> | Nom                      # jobs.lever.co/<site>  (eu:<site> pour jobs.eu.lever.co)
smartrecruiters | <CompanyId> | Nom       # jobs.smartrecruiters.com/<CompanyId>
sitemap | https://site/sitemap.xml | Nom | /job/
```
Pour trouver le bon identifiant, ouvre la page carrière de l'entreprise et regarde l'URL des offres.

## Sécurité
- Un seul utilisateur. Le cookie de session est httpOnly, signé HMAC et valable 30 jours. Chaque action serveur revérifie la session.
- Le cron et l'ingestion e-mail sont protégés par leur propre secret, comparé en temps constant.
- Le PDF du CV n'est pas stocké : seul le texte extrait est conservé, dans ta base Neon.
- Le site est en `noindex`.

## Développement
```bash
cp .env.example .env.local   # remplis-le
npm run dev
npm test                     # tests de la logique (filtres, parsing des sources, robots.txt, JSON-LD)
npm run typecheck
```
