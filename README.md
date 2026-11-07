# Job Radar

Veille d'offres d'emploi multi-comptes. Chaque utilisateur crée son compte (e-mail, mot de passe et 2FA facultative), importe son CV et règle ses filtres. Chaque matin, l'application collecte les nouvelles offres, l'IA les note par rapport à son CV, et il reçoit par e-mail les meilleures, avec le lien pour postuler.

## Structure

```
lib/
  core.ts       Types, réglages par défaut, utilitaires texte (Text), filtre d'offres (JobFilter)
  security.ts   Crypto (scrypt, AES-GCM, HMAC) · Totp (RFC 6238) · Auth (comptes, sessions, anti-bruteforce)
  database.ts   Database (Neon, schéma auto-créé) · SettingsRepo · JobsRepo
  sources.ts    JobSource (abstraite) → WebSearch, FranceTravail, Adzuna, Greenhouse, Lever, SmartRecruiters, Workday
  ai.ts         JobAI : lecture du CV, scoring, extraction d'offres
  mailer.ts     Mailer : e-mail personnalisé (SMTP)
  scanner.ts    Scanner : collecte → tri → scoring → e-mail, pour un compte
app/
  actions.ts    Toutes les actions serveur (compte, sécurité, CV, réglages, scan)
  components.tsx  Nav, Flash, SubmitButton
  login/        Connexion · inscription (?mode=signup) · 2FA (?mode=2fa)
  settings/     CV, filtres, sources, e-mail, sécurité du compte
  page.tsx      Tableau des offres
  api/cron/scan        Scan quotidien de tous les comptes (Vercel Cron)
  api/ingest/email     Alertes e-mail transmises par le script Gmail (facultatif)
```

## Sources (légales et gratuites)

- **Recherche web avec Tavily** (1 000 recherches/mois offertes, sans carte bancaire). Elle trouve les offres indexées sur LinkedIn, Indeed, HelloWork, JobTeaser, Welcome to the Jungle, APEC et les sites carrière. On interroge le moteur de recherche : ces sites ne sont jamais scrapés.
- **France Travail** et **Adzuna** : API publiques gratuites.
- **Sites carrière** : API publiques Greenhouse, Lever, SmartRecruiters et Workday.
- **Alertes e-mail** (facultatif) : un script Gmail transmet tes alertes LinkedIn, Indeed, etc.

L'IA (lecture du CV, scoring) passe par Vercel AI Gateway, qui offre 5 $ de crédit chaque mois.

## Sécurité

- Les mots de passe sont hachés avec scrypt et un sel aléatoire. Les comparaisons se font en temps constant, et une réponse identique est renvoyée que l'e-mail existe ou non.
- Les sessions utilisent un jeton aléatoire de 256 bits, stocké dans un cookie httpOnly. Seul son SHA-256 est enregistré en base, et chaque session est révocable.
- La 2FA repose sur TOTP. Le secret est chiffré en AES-256-GCM, un même code ne peut pas être réutilisé, et l'utilisateur dispose de 8 codes de secours à usage unique (stockés hachés).
- Anti-bruteforce : 5 échecs en 15 minutes bloquent l'e-mail concerné, 30 échecs bloquent l'IP.
- Toutes les requêtes SQL sont paramétrées, et chaque requête est limitée aux données du compte connecté.
- Les inscriptions sont réservées aux adresses listées dans `ALLOWED_SIGNUP_EMAILS`.

## Configuration

Copie `.env.example` en `.env` pour travailler en local (git ignore ce fichier). En production, mets les mêmes clés dans Vercel → Settings → Environment Variables.

1. **Base de données** : Vercel → Storage → Create Database → Neon. Les tables se créent automatiquement.
2. **Recherche web** : crée une clé gratuite sur https://app.tavily.com et mets-la dans `TAVILY_API_KEY`.
3. **E-mails** : sur ton compte Gmail, active la validation en 2 étapes, puis crée un mot de passe d'application sur https://myaccount.google.com/apppasswords. Mets ton adresse dans `SMTP_USER` et ce mot de passe dans `SMTP_PASS`.
4. **Comptes autorisés** : renseigne `ALLOWED_SIGNUP_EMAILS`, par exemple `moi@gmail.com,ami@gmail.com` ou un domaine comme `@edu.devinci.fr`.
5. **Facultatif** : `FRANCE_TRAVAIL_CLIENT_ID` / `FRANCE_TRAVAIL_CLIENT_SECRET` et `ADZUNA_APP_ID` / `ADZUNA_APP_KEY`.

Le scan automatique tourne chaque jour à 06:00 UTC (`vercel.json`). Sur la page des offres, chacun peut aussi lancer un scan manuel, au maximum un toutes les 10 minutes.

## Développement

```bash
npm install
npm run dev
npm run typecheck
```
