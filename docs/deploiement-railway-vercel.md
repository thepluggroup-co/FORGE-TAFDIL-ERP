# Déploiement — Railway (API) & Vercel (Web ERP + Shop)

Nouvelle URL publique de l'API (service Railway « shimmering-balance ») :

```
https://shimmering-balance-forge-tafdil.up.railway.app
```

Ancienne URL (abonnement expiré, hors service) : `https://forge-tafdil-erp-tafdil.up.railway.app`

Dans le code, l'URL de repli a été mise à jour dans `apps/web/src/lib/api-client.ts`
et `apps/shop/lib/forge-api.ts`. Les variables d'environnement restent prioritaires
sur ces valeurs de repli : il faut donc AUSSI les mettre à jour dans Vercel.

---

## 1. Railway — service « shimmering-balance » (API Hono)

### Réglages du service (Settings)

| Réglage | Valeur |
|---|---|
| Source | Repo GitHub `thepluggroup-co/forge-tafdil-erp`, branche `main` |
| Root Directory | *(vide — racine du monorepo)* |
| Config as code | `railway.json` (déjà dans le repo) |
| Build Command | `pnpm install && pnpm --filter @forge/api build` (fourni par `railway.json`) |
| Start Command | `node apps/api/dist/index.js` (fourni par `railway.json`) |
| Healthcheck Path | `/health` |
| Networking | Domaine public `shimmering-balance-forge-tafdil.up.railway.app` (déjà généré) |

> Ne PAS définir `PORT` manuellement : Railway l'injecte et l'API l'écoute.

### Variables (onglet *Variables* → *Raw Editor*)

**Obligatoires** — sans elles l'API démarre mais l'authentification / la base échouent :

```env
NODE_ENV=production
SUPABASE_URL=https://lcfuuwwsfqdhphhsbkky.supabase.co
SUPABASE_ANON_KEY=<anon key Supabase>
SUPABASE_SERVICE_ROLE_KEY=<service_role key Supabase>
SUPABASE_JWT_SECRET=<JWT secret Supabase>
FRONTEND_URL=https://forge-tafdil-erp-web.vercel.app,https://forge-tafdil.vercel.app
INVITE_REDIRECT_URL=https://forge-tafdil-erp-web.vercel.app
SITE_URL=https://shop.tafdil.cm
SHOP_API_SECRET=<même valeur que dans le projet Vercel du shop>
```

**Fonctionnelles** — à renseigner si la fonctionnalité est utilisée :

```env
ANTHROPIC_API_KEY=
NOKASH_APPLICATION_KEY=
NOKASH_INTEGRATION_KEY=
NOKASH_CALLBACK_URL=https://shimmering-balance-forge-tafdil.up.railway.app/api/paiements/webhook
CALLMEBOT_APIKEY=
DIRECTEUR_WHATSAPP_PHONE=+237...
DIRECTEUR_EMAIL=
AFRICASTALKING_USERNAME=
AFRICASTALKING_API_KEY=
AFRICASTALKING_SENDER_ID=
AFRICASTALKING_ENV=production
SMS_DEFAULT_COUNTRY_CODE=237
EMAIL_PROVIDER=          # resend | brevo | smtp
EMAIL_API_KEY=
EMAIL_FROM=
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_SECURE=
WHATSAPP_API_TOKEN=
WHATSAPP_BUSINESS_PHONE_ID=
WHATSAPP_TAFDIL_NUMBER=
FIREBASE_SERVICE_ACCOUNT_JSON=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
MOBILE_APP_URL=
```

Où retrouver les valeurs (l'ancien service est expiré) :
- Si l'ancien projet est encore visible dans Railway, ses *Variables* restent souvent
  consultables même service arrêté : *Raw Editor* → tout copier → coller ici, puis
  corriger `NOKASH_CALLBACK_URL`.
- Sinon : clés Supabase dans *Supabase → Project Settings → API* ; `SHOP_API_SECRET`
  dans *Vercel → projet Shop → Environment Variables* ; clés NOKASH, Africa's Talking,
  CallMeBot, Resend/Brevo, Anthropic dans leurs tableaux de bord respectifs
  (ou en régénérer de nouvelles).

### Vérification

1. Ouvrir `https://shimmering-balance-forge-tafdil.up.railway.app/health` → doit répondre 200.
2. Dans *Deploy Logs*, la ligne `[boot] SERVICE_ROLE_KEY : SET` doit apparaître.
3. L'ancien service est expiré : rien à couper, mais ne pas le réactiver plus tard
   sans l'arrêter, sinon deux API tourneraient (doubles relances/rapports WhatsApp).

---

## 2. Vercel — projet Web ERP (`forge-tafdil-erp-web`)

*Settings → Environment Variables* (environnement **Production**, et Preview si utilisé) :

```env
VITE_API_URL=https://shimmering-balance-forge-tafdil.up.railway.app
VITE_SUPABASE_URL=https://lcfuuwwsfqdhphhsbkky.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key Supabase>
VITE_SHOP_URL=https://shop.tafdil.cm
```

**Important :** les variables `VITE_*` sont figées au moment du build.
Après modification : *Deployments* → dernier déploiement → *Redeploy*
(décocher « Use existing Build Cache »).

## 3. Vercel — projet Shop (`shop.tafdil.cm`)

```env
FORGE_API_URL=https://shimmering-balance-forge-tafdil.up.railway.app
NEXT_PUBLIC_FORGE_API_URL=https://shimmering-balance-forge-tafdil.up.railway.app
NEXT_PUBLIC_SITE_URL=https://shop.tafdil.cm
SHOP_API_SECRET=<même valeur que sur Railway>
```

Si `NEXT_PUBLIC_API_URL` existe encore dans le projet, la mettre aussi à la nouvelle
URL ou la supprimer (le code lit `FORGE_API_URL` en premier). Puis *Redeploy*.

---

## 4. GitHub Actions (`.github/workflows/deploy.yml`)

Le job « Deploy API (Railway) » utilise `railway up --service <nom>`.

1. *Repo → Settings → Secrets and variables → Actions → Secrets* :
   remplacer `RAILWAY_TOKEN` par un **Project Token** du nouveau projet
   (Railway → projet → *Settings → Tokens*, environnement `production`).
2. Onglet *Variables* : créer `RAILWAY_SERVICE_NAME` = nom exact du service
   tel qu'affiché dans Railway (probablement `shimmering-balance`).
   Sans cette variable, le workflow utilise l'ancien nom `forge-tafdil-api`.

Si Railway est aussi branché directement sur GitHub (auto-deploy), choisir **une seule**
méthode, sinon chaque push sur `main` déclenche deux déploiements.

## 5. Postes de build locaux (desktop / mobile)

`apps/web/.env.local` et `apps/mobile/.env.local` :

```env
VITE_API_URL=https://shimmering-balance-forge-tafdil.up.railway.app
```

L'app desktop reprend cette valeur au build : les installateurs déjà distribués
appellent l'ancienne URL, désormais hors service → **ils sont en panne**. La mise
à jour automatique passe par GitHub Releases (pas par l'API) : publier une nouvelle
version (`pnpm --filter @forge/desktop release:win`, voir `docs/desktop-release.md`)
construite avec la nouvelle `VITE_API_URL` corrige les postes au prochain lancement.
Idem pour l'app mobile : rebâtir et redistribuer.

## 6. Services externes

- **NOKASH** (tableau de bord marchand) : URL de callback =
  `https://shimmering-balance-forge-tafdil.up.railway.app/api/paiements/webhook`
- Tout autre webhook pointant vers l'ancienne URL Railway doit être mis à jour.
