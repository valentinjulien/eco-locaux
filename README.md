# Eco-Locaux Prospect

Outil interne de prospection commerciale d'Eco-Locaux : pipeline des prospects, fiches détaillées et rédaction d'email assistée par IA.

Livrable 3B du dossier de mission. L'application lit et écrit dans la base **Baserow** d'Eco-Locaux et déclenche le workflow **n8n** de génération d'email.

---

## Ce qu'il faut savoir en trois lignes

- **Aucune dépendance** : ni framework, ni compilation. Du HTML, du CSS et du JavaScript.
- **Trois modes** : démonstration (hors ligne), serveur (recommandé en ligne), direct (poste personnel).
- **Tests** : 56 tests de logique métier, 23 tests des fonctions serveur, 13 tests du bilan hebdomadaire, 40 parcours dans un vrai navigateur.

---

## Démarrer en local

```bash
npm install          # installe Playwright, nécessaire uniquement pour les tests
npm run dev          # http://localhost:3000
```

`scripts/serveur.js` sert `public/` et monte les fichiers de `api/` sur `/api/<nom>`, **exactement comme le fait Vercel**. Ce que vous testez en local est donc ce qui tournera en ligne — c'est littéralement le même fichier :

- `npm run dev` ajoute le rechargement à chaud des fonctions et lit `.env.local` ;
- `npm start` est le mode production, celui que lance le conteneur : pas de rechargement, en-têtes de sécurité, arrêt propre sur `SIGTERM`.

La production est le comportement par défaut, sans drapeau : un démarrage par Docker ne peut pas basculer en mode développement par accident.

Sans aucune configuration, l'application démarre en **mode démonstration** : 19 prospects réels figés, écritures en mémoire, aucun appel réseau. Suffisant pour explorer l'interface.

### Dans VS Code

Ouvrez le dossier, puis `F5` → « Lancer le serveur de développement ». Les extensions conseillées sont proposées à l'ouverture.

---

## Les trois modes

| Mode | Où vit le jeton Baserow | Quand l'utiliser |
|---|---|---|
| **Démonstration** | nulle part | Explorer l'outil, former un commercial, faire une démonstration sans réseau |
| **Serveur** | dans les variables d'environnement, côté serveur | **Déploiement en ligne.** Le navigateur ne voit jamais le jeton |
| **Direct** | dans le navigateur de l'utilisateur | Poste personnel d'un commercial, jamais une URL publique |

Le mode se choisit dans l'écran **Configuration** de l'application.

---

## Où déployer

L'application se déploie de trois façons, selon ce que vous voulez garder.

| Cible | Ce que vous obtenez | Ce qu'il faut |
|---|---|---|
| **Coolify** (ou tout hébergeur Docker) | Mode serveur complet, aucun plafond de durée, aucune mise en veille | Un serveur à vous · `Dockerfile` |
| **Vercel** | Mode serveur complet, rien à administrer | Un compte · `vercel.json` |
| **Hébergeur statique** | Modes démonstration et direct seulement — **le jeton Baserow repart dans le navigateur** | `dist/app_eco-locaux.html` |

Les deux premières servent exactement le même code : `scripts/serveur.js` et les fonctions de `api/` ne connaissent pas leur hébergeur.

---

## Déployer sur Coolify

### 1. Le serveur

Coolify s'installe sur une machine **dédiée** — un VPS, pas votre poste de travail : il prend le port 80, le port 443 et le démon Docker. Comptez 2 Go de mémoire et Ubuntu à jour.

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Avant de lancer un script en `curl | bash`, ouvrez-le dans un navigateur et lisez-le : c'est le seul moment où vous pouvez encore le faire.

### 2. La ressource

Dans Coolify : **New Resource → Application → Private Repository (ou Public)**, puis choisir le dépôt.

- Build Pack : **Dockerfile**
- Dockerfile Location : `/Dockerfile`
- Port Exposes : **3000**
- Health Check Path : `/api/sante`

Le `Dockerfile` n'installe aucune dépendance : l'application n'en a aucune à l'exécution. La construction se résume à copier des fichiers, et l'image ne contient ni les tests, ni Playwright, ni `.env.local` — voir `.dockerignore`.

### 3. Les variables d'environnement

Les mêmes que sur Vercel (tableau ci-dessous). Dans Coolify, elles se déclarent dans l'onglet **Environment Variables** de l'application. Deux remarques :

- `PORT` est déjà fixé à 3000 par l'image : ne la redéclarez que si vous changez le port exposé.
- Cochez **Build Variable** uniquement si une variable doit exister pendant la construction. Aucune ne le doit ici — les secrets n'ont rien à faire dans une couche d'image.

### 4. Le domaine et HTTPS

Renseignez le domaine dans **Domains**, faites pointer son enregistrement A vers l'IP du serveur, et Coolify obtient le certificat Let's Encrypt. **Ne servez pas l'application en clair** : le code d'accès transite dans un en-tête à chaque appel.

### 5. Vérifier

```bash
curl https://votre-domaine/api/sante
```

La réponse dit quelles variables sont présentes, sans jamais révéler leur valeur :

```json
{ "statut": "ok", "mode_serveur": "actif", "manquant": [],
  "generation_email": "configurée", "node": "v22.x" }
```

Si vous préférez qu'un déploiement mal configuré **échoue** au lieu de démarrer à moitié, pointez le Health Check de Coolify sur `/api/sante?strict=1` : cette variante répond 503 tant qu'il manque une variable indispensable.

### Ce qui change par rapport à Vercel

| | Vercel | Coolify |
|---|---|---|
| Durée maximale d'un appel | 60 s (plan Hobby) | aucune limite imposée |
| Mise en veille | non | non |
| Usage commercial | interdit sur l'offre gratuite | libre, c'est votre serveur |
| En-têtes de sécurité | `vercel.json` | appliqués par `scripts/serveur.js` |
| Mises à jour système | prises en charge | à votre charge |

Le serveur applique lui-même les trois en-têtes que `vercel.json` déclarait (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`) : la sécurité ne dépend pas de l'hébergeur retenu.

---

## Déployer sur Vercel en une commande

```bash
npm run deployer
```

Le script rassemble la configuration, génère un code d'accès si vous n'en avez pas, relie le projet, pousse les variables d'environnement, déploie en production, puis interroge `/api/sante` et dit si l'application est réellement utilisable. Deux moments seulement demandent votre main : la connexion à votre compte Vercel, et le jeton Baserow s'il ne le trouve pas déjà dans `.env.local`.

Il est rejouable : une seconde exécution met à jour les variables et redéploie, sans rien vous redemander. Pour ne refaire que la vérification sur un déploiement existant :

```bash
npm run deployer -- --url https://votre-app.vercel.app
```

Les sections qui suivent décrivent les mêmes étapes à la main, si vous préférez tout voir passer.

---

## Déployer sur Vercel, étape par étape

### 1. Mettre le projet sur GitHub

```bash
git init
git add .
git commit -m "Eco-Locaux Prospect"
git branch -M main
git remote add origin https://github.com/<votre-compte>/eco-locaux-prospect.git
git push -u origin main
```

`.gitignore` exclut déjà `.env.local` : vos secrets ne partiront pas sur GitHub.

### 2. Importer dans Vercel

Sur [vercel.com](https://vercel.com) → **Add New** → **Project** → choisir le dépôt.

Vercel détecte la configuration dans `vercel.json`. Laissez les réglages par défaut :

- Framework Preset : **Other**
- Build Command : *(vide)*
- Output Directory : **public**

### 3. Déclarer les variables d'environnement

Dans **Settings → Environment Variables**, pour les trois environnements (Production, Preview, Development) :

| Variable | Valeur | Obligatoire |
|---|---|---|
| `APP_ACCESS_CODE` | une chaîne longue et aléatoire de votre choix | **oui** |
| `BASEROW_TOKEN` | votre jeton Baserow | **oui** |
| `BASEROW_URL` | `https://api.baserow.io` | non (valeur par défaut) |
| `BASEROW_TABLES` | `1148624,1148622,1148623,1148625,1148621` | **oui** |
| `BASEROW_TABLES_ECRITURE` | `1148624,1148625` | **oui** |
| `N8N_WEBHOOK_URL` | URL de production du webhook W6 | pour la génération |
| `N8N_WEBHOOK_KEY` | clé de l'en-tête `X-Api-Key` du workflow | si le workflow en exige une |

> Sans `APP_ACCESS_CODE`, les fonctions refusent **tous** les appels avec un code 503. C'est volontaire : un déploiement mal configuré se bloque au lieu de s'ouvrir.

### 4. Déployer et vérifier

Vercel déploie à chaque `git push`. Ensuite, dans l'application :

1. Ouvrir **Configuration**
2. Choisir le mode **Serveur**
3. Saisir le **code d'accès** (la valeur de `APP_ACCESS_CODE`)
4. Cliquer sur **Tester la connexion** — le serveur répond en décrivant sa configuration
5. **Enregistrer**

### Pour générer un jeton Baserow

Dans Baserow : **Paramètres → Jetons de base de données → Créer**. Donnez-lui :

- lecture, création et modification sur **Prospect** et **Interaction**
- lecture seule sur **TypeCommerce**, **Commercial** et **Secteur**
- aucun droit de suppression si vous voulez interdire la suppression depuis l'interface

La variable `BASEROW_TABLES_ECRITURE` ajoute une seconde barrière : même si le jeton permettait d'écrire partout, le serveur n'accepte les écritures que sur les tables qui y sont listées.

---

## Sécurité

Ce que les fonctions de `api/` garantissent :

- Le jeton Baserow et la clé du workflow **ne descendent jamais** dans le navigateur (vérifié par les tests API-04 et API-13).
- Les fonctions ne sont pas un proxy ouvert : seules cinq actions sont acceptées, sur les tables explicitement listées (API-05, API-07).
- Les écritures sont limitées à `BASEROW_TABLES_ECRITURE` (API-06).
- Le code d'accès est comparé en durée constante, pour ne pas le laisser deviner caractère par caractère.
- Sans configuration, le serveur se bloque plutôt que de s'ouvrir (API-18).

Ce que cela ne couvre pas, et qu'il faut savoir :

- Le code d'accès est **partagé par toute l'équipe**. Ce n'est pas une authentification par utilisateur : il protège l'URL publique, il ne trace pas qui fait quoi. Pour un usage au-delà de l'équipe actuelle, il faudrait une vraie authentification (Vercel Authentication, ou un fournisseur d'identité).
- Le rôle « manager » conditionne l'affichage du tableau de bord, pas l'accès aux données. La vraie barrière reste les droits du jeton Baserow.

---

## Structure du projet

```
eco-locaux-prospect/
├── public/                     servi tel quel par Vercel
│   ├── index.html
│   ├── styles/app.css          design system du Livrable 3A
│   └── js/
│       ├── core.js             logique métier pure (testée isolément)
│       ├── demo.js             extrait réel figé de la base
│       ├── api.js              trois modes d'accès aux données
│       ├── ui.js               rendu des écrans
│       ├── actions.js          événements et écritures
│       └── main.js             démarrage
├── api/                        fonctions serveur
│   ├── _commun.js              code d'accès, liste blanche, utilitaires
│   ├── baserow.js              relais vers l'API Baserow
│   ├── generer-email.js        relais vers le workflow n8n
│   └── sante.js                sonde de santé, sans secret exposé
├── tests/
│   ├── unit.test.js            56 tests de logique métier
│   ├── api.test.js             23 tests des fonctions serveur
│   ├── rapport.test.js         13 tests du bilan hebdomadaire
│   ├── e2e.test.js             40 parcours dans Chromium
│   └── stub-baserow.js         Baserow simulé pour les tests
├── scripts/
│   ├── serveur.js              sert public/ et monte api/ — dev et production
│   ├── deployer.js             déploiement Vercel en une commande
│   ├── rapport-hebdo.js        logique du bilan hebdomadaire (nœud Code de W7)
│   ├── verifier-w6.js          recette du workflow n8n
│   └── build-fichier-unique.js produit dist/app_eco-locaux.html
├── Dockerfile                  image pour Coolify, Docker, tout hébergeur de conteneurs
└── vercel.json                 configuration Vercel
```

### Pourquoi `core.js` est séparé

Toute la logique qui peut être fausse sans que cela se voie — mapping des champs Baserow, score de priorisation, filtres, indicateurs, garde-fous sur le texte produit par l'IA — vit dans un seul fichier sans aucune dépendance au navigateur. C'est ce qui permet de la tester en Node, et c'est le **même fichier** qui est chargé par l'application : il n'existe pas de version d'essai distincte.

---

## Tests

```bash
npm test             # 56 tests de logique métier         (~1 s)
npm run test:api     # 23 tests des fonctions serverless  (~3 s)
npm run test:e2e     # 40 parcours dans Chromium          (~90 s)
npm run test:tout    # les trois
```

Les tests de bout en bout démarrent eux-mêmes le serveur de développement, un **Baserow simulé** et un **faux workflow n8n**, puis pilotent un vrai navigateur. La chaîne `navigateur → fonction serverless → Baserow` est donc réellement traversée, sans toucher à votre base.

Ils vérifient notamment :

- que les 19 prospects remontent bien par le relais (E2E-34)
- qu'aucun jeton Baserow ne se retrouve dans le stockage du navigateur (E2E-35)
- qu'une création depuis l'interface arrive réellement dans la base (E2E-36)
- qu'un code d'accès erroné produit un message clair et laisse revenir en arrière (E2E-38, E2E-39)
- l'accessibilité : cibles de 44 px, focus visible, navigation au clavier, absence de défilement horizontal en mobile

---

## Version hors ligne

```bash
npm run build        # produit dist/app_eco-locaux.html
```

L'application entière dans un fichier unique, ouvrable par double-clic, sans serveur. Pratique pour une démonstration ou pour joindre l'outil à un dossier. Dans cette forme, seuls les modes **démonstration** et **direct** sont disponibles : le mode serveur a besoin des fonctions `/api/`.

---

## Workflow n8n

Le workflow **« Eco-Locaux – W6 Générer un email de prospection »** est déjà en place dans l'instance `valentinjulien06.app.n8n.cloud`, dans le projet personnel. Le fichier `W6_generer_email.json` en est la copie : il sert de sauvegarde et de pièce au dossier, et s'importe dans n'importe quelle autre instance n8n.

Treize nœuds, quatre groupes, une seule réponse synchrone :

| Groupe | Ce qu'il fait |
|---|---|
| 1. Validation et garde-fous RGPD | Refuse en **400** l'opposition à la prospection, l'absence d'email, le statut « perdu » — **avant** tout appel au modèle |
| 2. Rédaction assistée | Compose le prompt depuis la seule fiche utile, puis fait rédiger objet et corps |
| 3. Contrôle du texte produit | Rejoue les règles de l'application sur le texte reçu : **200** si conforme, **502** avec le brouillon sinon |
| 4. Service indisponible | Deux tentatives, puis **503** explicite plutôt qu'une erreur technique |

Deux points avant la mise en production :

1. **Le modèle ne demande aucune clé.** Le nœud « Modèle de rédaction » est branché sur la passerelle de modèles de l'instance (crédits n8n). Réflexion étendue désactivée, 2048 jetons : un premier essai à 900 jetons rendait un texte vide, la réflexion ayant consommé tout le budget.
2. **Le webhook exige un en-tête d'authentification.** Il faut créer dans n8n un identifiant *Header Auth* nommé `X-Api-Key`, avec la valeur de votre choix, le sélectionner sur le nœud « Webhook – Générer un email », puis activer le workflow. Reportez ensuite la même valeur dans `N8N_WEBHOOK_KEY` et l'URL de production dans `N8N_WEBHOOK_URL`. Tant que cet identifiant manque, n8n refuse d'activer le workflow : l'URL ne peut donc pas partir en production sans sa clé.

Le workflow applique ses propres garde-fous sur le texte produit, et l'application les rejoue à réception. Ce doublon est volontaire : il protège le cas où le workflow serait modifié sans que l'interface le sache.

---

## Vérifier le workflow n8n

Avant de brancher l'application sur n8n, vérifiez que le workflow W6 répond comme attendu :

```bash
node scripts/verifier-w6.js <url-du-webhook> [cle-x-api-key]
# ou, si .env.local est renseigné :
npm run verifier:w6
```

Le script envoie une demande réaliste (Boulangerie du Coin), contrôle la réponse avec **les mêmes garde-fous que l'application**, affiche le texte reçu, puis teste deux cas d'erreur : demande sans prospect, et clé erronée. Il indique quoi corriger plutôt que de signaler un échec sans explication.

### Quelle URL fournir

n8n propose plusieurs types d'URL, qui ne sont pas interchangeables :

| URL | À quoi elle sert | Utilisable ici |
|---|---|---|
| `…/webhook/<chemin>` | **URL de production d'un nœud Webhook.** C'est celle du workflow W6. | **oui** |
| `…/webhook-test/<chemin>` | URL de test : ne répond qu'après un clic sur « Listen for test event », une seule fois | non, sauf pour un essai ponctuel |
| `…/mcp-server/…`, `…/mcp/…` | **MCP Server Trigger** : expose vos workflows comme outils à un agent IA | non |

Le MCP Server Trigger et le nœud Webhook répondent à deux besoins différents. Le premier permet à une IA d'appeler vos workflows comme des outils ; le second expose une URL HTTP qui reçoit une requête et renvoie une réponse. L'application a besoin du second.

Pour obtenir la bonne URL : ouvrez le workflow W6 dans n8n, cliquez sur le nœud **« Webhook – Générer un email »**, basculez sur **Production URL**, et copiez-la. Le workflow doit être **actif** pour que cette URL réponde.

### Erreurs fréquentes

| Ce que dit le script | Cause | Correction |
|---|---|---|
| `404 : aucun workflow n'écoute` | Workflow inactif | Activer le workflow, reprendre l'URL de production |
| `401` ou `403` | Clé absente ou erronée | Passer la clé en deuxième argument, ou vérifier le credential du nœud Webhook |
| `La réponse n'est pas du JSON` | Le nœud Webhook ne renvoie pas la réponse du nœud « Respond to Webhook » | Régler le Webhook sur « Using Respond to Webhook node » |
| `Anomalie majeure : PROMESSE_INTERDITE` | Le modèle promet un résultat absolu | Resserrer le prompt du nœud « IA – Rédiger le message » |
| `Une clé erronée a été acceptée` | Pas d'authentification sur le webhook | Activer « Header Auth » sur le nœud Webhook : sans elle, l'URL est appelable par n'importe qui |

---

## Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| « Le serveur n'est pas configuré » | `APP_ACCESS_CODE` ou `BASEROW_TOKEN` absent sur Vercel | Ajouter la variable, puis **redéployer** : les variables ne sont lues qu'au déploiement |
| « Code d'accès refusé » | Le code saisi diffère de `APP_ACCESS_CODE` | Vérifier dans Configuration, attention aux espaces en fin de valeur |
| « La table N n'est pas dans la liste autorisée » | `BASEROW_TABLES` incomplet | Ajouter l'identifiant, redéployer |
| « La table N est en lecture seule » | Écriture sur une table absente de `BASEROW_TABLES_ECRITURE` | Comportement attendu : ajouter la table seulement si l'écriture est voulue |
| Le mode serveur n'apparaît pas | Application ouverte par double-clic (`file://`) | Lancer `npm run dev` ou utiliser l'URL Vercel |
| « Le workflow n'a pas répondu en 45 secondes » | Workflow lent ou inactif | Vérifier qu'il est activé dans n8n, et que l'URL est celle de production |

---

## Continuité avec les livrables précédents

| Élément | Origine |
|---|---|
| Six statuts du pipeline | champ `statut_vente`, Livrable 1A |
| Fiche énergie affichée et envoyée au modèle | `specificites_energetiques`, table TypeCommerce |
| Historique des emails générés | entité Interaction, Livrable 1A |
| Blocage sur opposition à la prospection | registre de traitements, Livrable 1C |
| Garde-fous et score de confiance | pattern Evaluator, Livrable 2 |
| Palette, typographie, accessibilité | `DESIGN.md`, Livrable 3A |
