# Job Radar

Veille d'offres d'emploi multi-comptes. Chaque utilisateur crée son compte (e-mail vérifié, mot de passe, 2FA facultative), importe son CV et règle ses filtres. Chaque matin, l'application collecte les nouvelles offres, l'IA les note par rapport à son CV, et il reçoit par e-mail les meilleures, avec le lien pour postuler.

## Données conservées

Les comptes sont gérés par **Supabase Auth**. La base ne garde que le strict nécessaire :

| Table | Contenu | Durée |
|---|---|---|
| `profiles` | CV (texte), filtres, sources, envoi activé ou non | tant que le compte existe |
| `matches` | les 10 meilleurs matchs du compte (affichés sur la page d'accueil) | 30 jours |
| `seen_jobs` | empreinte (hash) des offres déjà notées, sans titre ni lien | 60 jours |
| `user_private` | date du dernier scan, jeton du script Gmail (haché), codes de secours 2FA (hachés) | tant que le compte existe |
| `usage` | compteurs de quotas journaliers | 7 jours |

Les offres collectées restent en mémoire pendant le scan. Seules les meilleures sont envoyées par e-mail et gardées dans `matches`.

## Structure

```
supabase/migrations/0001_init.sql   Schéma, RLS, triggers, fonctions (à exécuter une fois)
lib/
  core.ts       Types, réglages par défaut, utilitaires texte (Text), filtre d'offres (JobFilter)
  supabase.ts   Clients Supabase : requête (RLS), admin (service_role), sans état
  auth.ts       Utilisateur courant, niveau 2FA (aal), revérification du mot de passe, messages flash
  repos.ts      Profiles · Matches · SeenJobs · Private (quotas, jeton, codes de secours)
  sources.ts    JobSource (abstraite) → WebSearch, FranceTravail, Adzuna, Greenhouse, Lever, SmartRecruiters, Workday
  ai.ts         JobAI : lecture du CV, scoring, extraction d'offres
  mailer.ts     Mailer : e-mail personnalisé (SMTP)
  scanner.ts    Scanner : collecte → offres jamais vues → tri → scoring → e-mail → 10 meilleurs matchs
middleware.ts   Rafraîchit la session Supabase, renvoie vers /login ou vers l'étape 2FA
app/
  actions.ts    Actions serveur (compte, sécurité, CV, réglages, scan)
  login/        Connexion · inscription · mot de passe oublié · 2FA
  reset/        Nouveau mot de passe (après le lien reçu par e-mail)
  auth/confirm  Arrivée depuis les liens des e-mails Supabase
  settings/     CV, filtres, sources, e-mail, sécurité du compte (mfa-setup.tsx : activation 2FA)
  page.tsx      Les 10 meilleurs matchs
  api/cron/scan        Ménage + scan quotidien de tous les comptes (Vercel Cron)
  api/ingest/email     Alertes e-mail transmises par le script Gmail (facultatif)
```

## Sources (légales et gratuites)

- **Recherche web avec Tavily** (1 000 recherches/mois offertes, sans carte bancaire). Elle trouve les offres indexées sur LinkedIn, Indeed, HelloWork, JobTeaser, Welcome to the Jungle, APEC et les sites carrière. On interroge le moteur de recherche : ces sites ne sont jamais scrapés.
- **Sites carrière des grandes entreprises** : quand l'utilisateur choisit un secteur (ex. banque & assurance), le scan ajoute des recherches limitées aux sites carrière des plus grandes entreprises françaises du secteur (BNP Paribas, CA-CIB, Société Générale, BPCE, AXA, Generali…). Catalogue modifiable dans `lib/companies.ts`, `MAX_COMPANY_SEARCHES` requêtes par scan (3 par défaut).
- **France Travail** et **Adzuna** : API publiques gratuites.
- **Sites carrière** : API publiques Greenhouse, Lever, SmartRecruiters et Workday.
- **Alertes e-mail** (facultatif) : un script Gmail transmet tes alertes LinkedIn, Indeed, etc.

L'IA (lecture du CV, scoring) passe par **Google Gemini**, gratuit sans carte bancaire (`GOOGLE_GENERATIVE_AI_API_KEY`, modèles `GEMINI_MODEL`, liste de secours essayée dans l'ordre, par défaut `gemini-flash-lite-latest,gemini-3.5-flash-lite,gemini-flash-latest`). Les offres sont notées par lots de 5 et les appels espacés (`AI_RPM`, 12 par minute par défaut) pour rester sous la limite de l'offre gratuite. Attention : avec l'offre gratuite, Google peut utiliser les données envoyées (dont les CV) pour améliorer ses produits. Sans clé Gemini, l'app utilise Vercel AI Gateway, qui exige une carte bancaire enregistrée.

## Sécurité

- **Comptes** : Supabase Auth gère le hachage des mots de passe, la vérification de l'e-mail, le « mot de passe oublié », la limite de tentatives et les sessions révocables.
- **2FA** : TOTP via Supabase (QR code, application d'authentification). Si la 2FA est active, une session qui n'a passé que le mot de passe (`aal1`) n'accède à rien : le middleware, le serveur (`requireUser`) et la base (RLS + `mfa_ok()`) l'exigent tous les trois. 8 codes de secours (80 bits, stockés hachés) permettent de désactiver la 2FA si le téléphone est perdu ; toutes les sessions sont alors fermées.
- **Inscriptions** : réservées aux adresses de `signup_allowlist`, vérifiées par un trigger en base, même si quelqu'un appelle l'API Supabase directement. L'e-mail doit être confirmé.
- **RLS** : chaque utilisateur ne lit et ne modifie que son profil et ses matchs. Les tables internes (`user_private`, `seen_jobs`, `usage`) ne sont accessibles qu'avec la clé `service_role`, côté serveur.
- **Actions sensibles** (désactiver la 2FA, changer le mot de passe, supprimer le compte) : mot de passe redemandé. Changer de mot de passe ou activer la 2FA déconnecte les autres sessions.
- **Quotas par compte** : 3 scans manuels par jour (1 toutes les 10 min), 50 e-mails transférés par jour, 3 e-mails de test par jour.
- **E-mails** : envoyés uniquement à l'adresse du compte, vérifiée par Supabase.
- **Messages** : passés par un cookie de 20 s, jamais dans l'URL. En-têtes de sécurité (anti-clickjacking, HSTS, nosniff).

## Configuration

Copie `.env.example` en `.env` pour travailler en local (git ignore ce fichier). En production, mets les mêmes clés dans Vercel → Settings → Environment Variables.

1. **Supabase**
   - SQL Editor : exécute `supabase/migrations/0001_init.sql`, puis autorise les inscriptions :
     `insert into public.signup_allowlist (pattern) values ('moi@gmail.com'), ('@edu.devinci.fr');`
   - Project Settings → API : copie l'URL, la clé `anon` et la clé `service_role` dans `.env`.
   - Authentication → URL Configuration : *Site URL* = ton URL publique, et ajoute `https://ton-site/auth/confirm` aux *Redirect URLs*.
   - Authentication → Sign In / Providers → Email : laisse *Confirm email* activé.
   - Authentication → Multi-Factor : vérifie que *TOTP* est activé.
   - Authentication → Emails → SMTP Settings : branche ton SMTP (le même Gmail que ci-dessous). Sans ça, Supabase n'envoie que quelques e-mails par heure.
   - Facultatif, mais recommandé pour que les liens marchent sur n'importe quel appareil : dans Authentication → Emails → Templates, remplace le lien de *Confirm signup* par
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/settings`
     et celui de *Reset password* par
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`.
   - Le plan gratuit met en pause un projet inactif pendant 7 jours : le cron quotidien suffit à le garder actif.
2. **IA gratuite** : crée une clé sur https://aistudio.google.com/apikey (connexion Google, sans carte) et mets-la dans `GOOGLE_GENERATIVE_AI_API_KEY`.
3. **Recherche web** : crée une clé gratuite sur https://app.tavily.com et mets-la dans `TAVILY_API_KEY`. Le quota de 1 000 recherches par mois est partagé entre tous les comptes (4 par scan par défaut).
4. **E-mails** : sur ton compte Gmail, active la validation en 2 étapes, puis crée un mot de passe d'application sur https://myaccount.google.com/apppasswords. Mets ton adresse dans `SMTP_USER` et ce mot de passe dans `SMTP_PASS`.
5. **Facultatif** : `FRANCE_TRAVAIL_CLIENT_ID` / `FRANCE_TRAVAIL_CLIENT_SECRET` et `ADZUNA_APP_ID` / `ADZUNA_APP_KEY`.

Le scan automatique tourne chaque jour à 06:00 UTC (`vercel.json`). Il commence par un ménage (empreintes de plus de 60 jours, matchs de plus de 30 jours).

## Développement

```bash
npm install
npm run dev
npm run typecheck
```
