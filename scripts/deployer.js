#!/usr/bin/env node
/* ============================================================
   Déploiement sur Vercel, en une commande.

     npm run deployer

   Le script fait tout ce qui peut l'être sans vous : il rassemble
   la configuration, génère un code d'accès si vous n'en avez pas,
   relie le projet, pousse les variables d'environnement, déploie
   en production, puis interroge la sonde de santé et dit si
   l'application est réellement utilisable.

   Deux moments seulement demandent votre main : la connexion à
   votre compte Vercel, et le jeton Baserow si le script ne le
   trouve pas déjà.

   Il est rejouable : une seconde exécution met simplement à jour
   les variables et redéploie.
   ============================================================ */

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const RACINE = path.join(__dirname, '..');
const ENV_LOCAL = path.join(RACINE, '.env.local');

const C = { ok: '\x1b[32m', ko: '\x1b[31m', att: '\x1b[33m', gris: '\x1b[90m', gras: '\x1b[1m', z: '\x1b[0m' };
const ligne = (s) => console.log(s);
const titre = (s) => console.log('\n' + C.gras + s + C.z);
const bon = (s) => console.log('  ' + C.ok + '✓' + C.z + ' ' + s);
const mauvais = (s) => console.log('  ' + C.ko + '✗' + C.z + ' ' + s);
const alerte = (s) => console.log('  ' + C.att + '!' + C.z + ' ' + s);
const note = (s) => console.log('    ' + C.gris + s + C.z);

// Valeurs propres au projet : elles viennent du schéma réel de la base,
// relevé avant d'écrire la moindre ligne de code.
const TABLES = '1148624,1148622,1148623,1148625,1148621';
const TABLES_ECRITURE = '1148624,1148625';

const OBLIGATOIRES = ['APP_ACCESS_CODE', 'BASEROW_TOKEN', 'BASEROW_TABLES', 'BASEROW_TABLES_ECRITURE'];
const FACULTATIVES = ['BASEROW_URL', 'N8N_WEBHOOK_URL', 'N8N_WEBHOOK_KEY'];

// ------------------------------------------------------------------ outils

function executer(commande, args, options) {
  const o = options || {};
  return spawnSync(commande, args, {
    cwd: RACINE,
    encoding: 'utf8',
    stdio: o.interactif ? 'inherit' : 'pipe',
    input: o.input,
    shell: process.platform === 'win32',
    env: process.env,
  });
}

// npx est présent avec Node ; on ne demande aucune installation globale.
const vercel = (args, options) => executer('npx', ['--yes', 'vercel@latest'].concat(args), options);

function demander(question, masque) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resoudre) => {
    if (!masque) return rl.question(question, (r) => { rl.close(); resoudre(r.trim()); });
    // Saisie masquée : un jeton ne doit pas rester lisible dans le terminal
    const sortie = process.stdout;
    rl.question(question, (r) => { rl.close(); sortie.write('\n'); resoudre(r.trim()); });
    rl._writeToOutput = function (s) { if (s.includes(question)) sortie.write(s); else sortie.write('*'); };
  });
}

function lireEnvLocal() {
  const valeurs = {};
  if (!fs.existsSync(ENV_LOCAL)) return valeurs;
  for (const l of fs.readFileSync(ENV_LOCAL, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) valeurs[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return valeurs;
}

function ecrireEnvLocal(cfg) {
  const lignes = ['# Écrit par scripts/deployer.js — ne jamais committer ce fichier.'];
  for (const [k, v] of Object.entries(cfg)) if (v) lignes.push(k + '=' + v);
  fs.writeFileSync(ENV_LOCAL, lignes.join('\n') + '\n', { mode: 0o600 });
}

// ------------------------------------------------------------------ étapes

async function rassemblerConfig() {
  titre('1. Configuration');
  const env = lireEnvLocal();
  const cfg = {};

  cfg.APP_ACCESS_CODE = process.env.APP_ACCESS_CODE || env.APP_ACCESS_CODE;
  if (!cfg.APP_ACCESS_CODE) {
    // 32 octets tirés du générateur cryptographique du système
    cfg.APP_ACCESS_CODE = crypto.randomBytes(24).toString('base64url');
    bon('Code d’accès généré : ' + C.gras + cfg.APP_ACCESS_CODE + C.z);
    note('Notez-le : il vous sera demandé dans l’écran Configuration de l’application.');
  } else {
    bon('Code d’accès repris de la configuration existante.');
  }

  cfg.BASEROW_TOKEN = process.env.BASEROW_TOKEN || env.BASEROW_TOKEN;
  if (!cfg.BASEROW_TOKEN) {
    ligne('');
    note('Dans Baserow : Paramètres → Jetons de base de données.');
    note('Droits attendus : lecture partout, création et modification sur Prospect et Interaction.');
    cfg.BASEROW_TOKEN = await demander('  Jeton Baserow : ', true);
    if (!cfg.BASEROW_TOKEN) {
      mauvais('Sans jeton Baserow, le mode serveur ne peut pas fonctionner.');
      process.exit(1);
    }
  }
  bon('Jeton Baserow : ' + cfg.BASEROW_TOKEN.slice(0, 4) + '…' + ' (' + cfg.BASEROW_TOKEN.length + ' caractères)');

  cfg.BASEROW_TABLES = env.BASEROW_TABLES || TABLES;
  cfg.BASEROW_TABLES_ECRITURE = env.BASEROW_TABLES_ECRITURE || TABLES_ECRITURE;
  bon('Tables autorisées : 5 en lecture, 2 en écriture');

  for (const nom of FACULTATIVES) {
    const v = process.env[nom] || env[nom];
    if (v) cfg[nom] = v;
  }
  if (cfg.N8N_WEBHOOK_URL) {
    bon('Workflow de génération : ' + cfg.N8N_WEBHOOK_URL);
    if (!cfg.N8N_WEBHOOK_KEY) alerte('Aucune clé pour ce webhook : son URL serait appelable par n’importe qui.');
  } else {
    alerte('Aucun workflow de génération déclaré — le reste de l’application fonctionnera.');
    note('À ajouter plus tard : N8N_WEBHOOK_URL et N8N_WEBHOOK_KEY, puis relancer ce script.');
  }

  ecrireEnvLocal(cfg);
  bon('Configuration enregistrée dans .env.local (exclue de git et de l’image Docker)');
  return cfg;
}

function verifierCompte() {
  titre('2. Compte Vercel');
  const qui = vercel(['whoami']);
  if (qui.status === 0 && (qui.stdout || '').trim()) {
    bon('Connecté en tant que ' + (qui.stdout || '').trim());
    return true;
  }
  alerte('Pas encore connecté — une page va s’ouvrir dans votre navigateur.');
  const connexion = vercel(['login'], { interactif: true });
  if (connexion.status !== 0) {
    mauvais('La connexion a échoué.');
    return false;
  }
  const qui2 = vercel(['whoami']);
  bon('Connecté en tant que ' + (qui2.stdout || '').trim());
  return true;
}

function relierProjet() {
  titre('3. Projet');
  if (fs.existsSync(path.join(RACINE, '.vercel', 'project.json'))) {
    bon('Projet déjà relié.');
    return true;
  }
  const r = vercel(['link', '--yes'], { interactif: true });
  if (r.status !== 0) { mauvais('Impossible de relier le projet.'); return false; }
  bon('Projet relié.');
  return true;
}

function pousserVariables(cfg) {
  titre('4. Variables d’environnement');
  let echecs = 0;
  for (const [nom, valeur] of Object.entries(cfg)) {
    if (!valeur) continue;
    // On retire d'abord : « env add » refuse une variable déjà définie,
    // et le script doit pouvoir être rejoué sans erreur.
    vercel(['env', 'rm', nom, 'production', '--yes']);
    const r = vercel(['env', 'add', nom, 'production'], { input: valeur + '\n' });
    if (r.status === 0) {
      bon(nom);
    } else {
      mauvais(nom + ' — ' + ((r.stderr || '').trim().split('\n').pop() || 'échec'));
      echecs++;
    }
  }
  if (echecs) {
    note('Vous pouvez aussi les saisir à la main : Settings → Environment Variables.');
  }
  return echecs === 0;
}

function deployer() {
  titre('5. Déploiement');
  note('Première mise en ligne : comptez une minute.');
  const r = vercel(['--prod', '--yes']);
  const sortie = ((r.stdout || '') + '\n' + (r.stderr || ''));
  if (r.status !== 0) {
    mauvais('Le déploiement a échoué.');
    ligne(C.gris + sortie.trim().split('\n').slice(-12).join('\n') + C.z);
    return null;
  }
  // La CLI écrit l'URL de production sur sa sortie standard
  const urls = sortie.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/gi) || [];
  const url = urls.length ? urls[urls.length - 1] : null;
  if (!url) {
    alerte('Déploiement terminé, mais l’URL n’a pas pu être lue dans la sortie.');
    return null;
  }
  bon('En ligne : ' + C.gras + url + C.z);
  return url;
}

async function verifier(url, cfg) {
  titre('6. Vérification');
  let r = null;
  for (let essai = 1; essai <= 5 && !r; essai++) {
    try {
      const rep = await fetch(url + '/api/sante', { signal: AbortSignal.timeout(15000) });
      r = { statut: rep.status, corps: await rep.json().catch(() => null) };
    } catch (e) {
      if (essai === 5) { mauvais('La sonde de santé est injoignable : ' + e.message); return false; }
      await new Promise((s) => setTimeout(s, 3000));   // le déploiement finit de se propager
    }
  }
  if (!r.corps) { mauvais('La sonde a répondu ' + r.statut + ' sans JSON exploitable.'); return false; }

  if (r.corps.mode_serveur === 'actif') bon('Mode serveur actif : le jeton Baserow reste côté serveur.');
  else {
    mauvais('Mode serveur inactif — il manque : ' + (r.corps.manquant || []).join(', '));
    note('Relancez le script, ou saisissez ces variables dans Settings → Environment Variables.');
    return false;
  }
  if (r.corps.generation_email === 'configurée') bon('Workflow de génération déclaré.');
  else alerte('Génération d’email non configurée (N8N_WEBHOOK_URL absente).');
  if (r.corps.cle_webhook === 'absente') alerte('Webhook n8n sans clé : son URL est ouverte à tous.');

  titre('C’est en ligne');
  ligne('  ' + C.gras + url + C.z);
  ligne('');
  ligne('  Dans l’application : écran ' + C.gras + 'Configuration' + C.z + ' → mode ' + C.gras + 'Serveur' + C.z + ' →');
  ligne('  saisir le code d’accès → ' + C.gras + 'Tester la connexion' + C.z + ' → Enregistrer.');
  ligne('');
  ligne('  Code d’accès : ' + C.gras + cfg.APP_ACCESS_CODE + C.z);
  ligne('');
  return true;
}

// ------------------------------------------------------------------ marche

(async () => {
  ligne('\n' + C.gras + 'Eco-Locaux Prospect — déploiement' + C.z);

  const majeure = Number(process.versions.node.split('.')[0]);
  if (majeure < 18) {
    mauvais('Node ' + process.versions.node + ' : il en faut au moins 18 (fetch natif).');
    process.exit(1);
  }
  if (!fs.existsSync(path.join(RACINE, 'vercel.json'))) {
    mauvais('Lancez ce script depuis le dossier du projet.');
    process.exit(1);
  }

  const cfg = await rassemblerConfig();

  // --url permet de ne refaire que la vérification, sur un déploiement
  // déjà en ligne, sans repasser par la mise en production.
  const iUrl = process.argv.indexOf('--url');
  if (iUrl !== -1 && process.argv[iUrl + 1]) {
    const ok = await verifier(process.argv[iUrl + 1].replace(/\/+$/, ''), cfg);
    process.exit(ok ? 0 : 1);
  }

  if (!verifierCompte()) process.exit(1);
  if (!relierProjet()) process.exit(1);
  pousserVariables(cfg);
  const url = deployer();
  if (!url) {
    note('Rien n’est perdu : la configuration est dans .env.local, relancez le script.');
    process.exit(1);
  }
  const ok = await verifier(url, cfg);
  process.exit(ok ? 0 : 1);
})();
