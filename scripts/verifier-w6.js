#!/usr/bin/env node
/* ============================================================
   Vérifie le workflow n8n W6 de génération d'email.

   À lancer depuis votre poste, qui atteint votre instance n8n :

     node scripts/verifier-w6.js <url-du-webhook> [cle-x-api-key]

   ou en renseignant .env.local (N8N_WEBHOOK_URL, N8N_WEBHOOK_KEY) :

     npm run verifier:w6

   Le script envoie une demande réaliste, contrôle la réponse avec
   les mêmes garde-fous que l'application, puis teste deux cas
   d'erreur. Il dit quoi corriger plutôt que « ça ne marche pas ».
   ============================================================ */

const path = require('path');
const fs = require('fs');
const { validerReponseIA } = require('../public/js/core.js');

// --- Lecture des paramètres ---------------------------------------
const racine = path.join(__dirname, '..');
const envLocal = path.join(racine, '.env.local');
if (fs.existsSync(envLocal)) {
  for (const ligne of fs.readFileSync(envLocal, 'utf8').split('\n')) {
    const m = ligne.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const URL_W6 = process.argv[2] || process.env.N8N_WEBHOOK_URL || '';
const CLE = process.argv[3] || process.env.N8N_WEBHOOK_KEY || '';

const C = { ok: '\x1b[32m', ko: '\x1b[31m', att: '\x1b[33m', gris: '\x1b[90m', gras: '\x1b[1m', z: '\x1b[0m' };
const ligne = (s) => console.log(s);
const titre = (s) => ligne('\n' + C.gras + s + C.z);
const bon = (s) => ligne('  ' + C.ok + '✓' + C.z + ' ' + s);
const mauvais = (s) => ligne('  ' + C.ko + '✗' + C.z + ' ' + s);
const alerte = (s) => ligne('  ' + C.att + '!' + C.z + ' ' + s);
const note = (s) => ligne('    ' + C.gris + s + C.z);

if (!URL_W6) {
  console.error("\nIndiquez l'URL du webhook W6 :\n" +
    '  node scripts/verifier-w6.js https://votre-instance.app.n8n.cloud/webhook/eco-locaux/generer-email [cle]\n' +
    "\nCette URL s'obtient dans n8n en ouvrant le nœud « Webhook – Générer un email » du workflow W6," +
    "\npuis en copiant l'URL de production (le workflow doit être actif).\n");
  process.exit(2);
}

// --- Contrôle de forme de l'URL -----------------------------------
titre("1. L'URL fournie");
ligne('  ' + URL_W6);
let avertissementUrl = false;
if (/\/mcp(-server|-test)?(\/|$)/.test(URL_W6)) {
  alerte("Cette URL ressemble à celle d'un nœud « MCP Server Trigger », pas à celle d'un nœud « Webhook ».");
  note("Le MCP Server Trigger expose vos workflows à un agent IA ; il ne répond pas au format attendu ici.");
  note("L'application a besoin de l'URL du nœud Webhook du workflow W6, de la forme :");
  note("https://votre-instance.app.n8n.cloud/webhook/eco-locaux/generer-email");
  avertissementUrl = true;
} else if (/\/webhook-test\//.test(URL_W6)) {
  alerte("C'est l'URL de TEST : elle ne répond qu'après un clic sur « Listen for test event », une seule fois.");
  note("Pour un usage durable, activez le workflow et utilisez l'URL de production (/webhook/...).");
  avertissementUrl = true;
} else if (/\/webhook\//.test(URL_W6)) {
  bon("Forme attendue : URL de production d'un nœud Webhook.");
} else {
  alerte("Forme inhabituelle. Vérifiez que c'est bien l'URL d'un nœud Webhook de n8n.");
  avertissementUrl = true;
}
ligne('  Clé X-Api-Key : ' + (CLE ? 'fournie' : C.gris + 'absente' + C.z));

// --- Demande réaliste ---------------------------------------------
const DEMANDE = {
  prospect: {
    id: 6, raison_sociale: 'Boulangerie du Parc', type_commerce: 'Boulangerie', ville: 'Lyon',
    statut: 'contacté', telephone_disponible: true, email_disponible: true, opt_out: false,
    jours_sans_contact: 55,
  },
  fiche_energie: {
    type: 'Boulangerie',
    specificites: "Fours en fonctionnement continu, souvent la nuit ; vitrines réfrigérées ; climatisation du fournil. Le four est le poste le plus énergivore et rarement optimisé.",
  },
  parametres: {
    ton: 'chaleureux', ton_consigne: 'Ton chaleureux et proche, vocabulaire simple, sans familiarité excessive.',
    longueur: 'moyenne', longueur_consigne: 'Accroche de 60 à 90 mots.',
    angle: 'facture', angle_consigne: 'Angle principal : la baisse de la facture énergétique.',
    regenere: false,
  },
  commercial: { id: 2, nom: 'Julie Martin' },
  demande_le: new Date().toISOString(),
};

function entetes(cle) {
  const e = { 'Content-Type': 'application/json' };
  if (cle) e['X-Api-Key'] = cle;
  return e;
}

async function envoyer(corps, cle, delai) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), delai || 60000);
  const debut = Date.now();
  try {
    const r = await fetch(URL_W6, { method: 'POST', headers: entetes(cle), body: JSON.stringify(corps), signal: ctrl.signal });
    clearTimeout(t);
    const brut = await r.text();
    let json = null;
    try { json = JSON.parse(brut); } catch (e) { /* laissé à null */ }
    return { statut: r.status, json, brut, duree: Date.now() - debut };
  } catch (e) {
    clearTimeout(t);
    return { erreur: e.name === 'AbortError' ? 'delai' : e.message, duree: Date.now() - debut };
  }
}

(async () => {
  let echecs = 0, avertissements = avertissementUrl ? 1 : 0;

  // --- 2. Appel nominal -------------------------------------------
  titre('2. Appel nominal (Boulangerie du Parc)');
  const r = await envoyer(DEMANDE, CLE);

  if (r.erreur === 'delai') {
    mauvais("Aucune réponse en 60 secondes.");
    note("Le workflow est-il actif ? Le modèle répond-il ? Regardez l'onglet Executions de n8n.");
    echecs++;
  } else if (r.erreur) {
    mauvais('Impossible de joindre le workflow : ' + r.erreur);
    note("Vérifiez l'URL, et que votre poste atteint bien votre instance n8n.");
    echecs++;
  } else {
    ligne('  Réponse en ' + (r.duree / 1000).toFixed(1) + ' s — HTTP ' + r.statut);

    if (r.statut === 404) {
      mauvais("404 : aucun workflow n'écoute sur cette URL.");
      note("Cause la plus fréquente : le workflow n'est pas activé. Activez-le, puis reprenez l'URL de production.");
      echecs++;
    } else if (r.statut === 401 || r.statut === 403) {
      mauvais(r.statut + " : l'appel a été refusé.");
      note(CLE ? "La clé fournie ne correspond pas à celle du credential du nœud Webhook."
              : "Le nœud Webhook attend une authentification : passez la clé en deuxième argument.");
      echecs++;
    } else if (r.statut >= 500) {
      mauvais(r.statut + ' : le workflow a échoué pendant son exécution.');
      note("Ouvrez l'onglet Executions de n8n : le nœud en erreur y est surligné.");
      if (r.json && r.json.message) note('Message renvoyé : ' + r.json.message);
      echecs++;
    } else if (!r.json) {
      mauvais("La réponse n'est pas du JSON.");
      note('Début de la réponse : ' + JSON.stringify(r.brut.slice(0, 120)));
      note("Le nœud « Respond to Webhook » doit répondre en JSON, et le Webhook être en mode « Using Respond to Webhook node ».");
      echecs++;
    } else {
      bon('Réponse JSON reçue.');

      // --- 3. Forme de la réponse ---------------------------------
      titre('3. Forme de la réponse');
      const objet = r.json.objet, corps = r.json.corps || r.json.accroche;
      if (!objet) { mauvais("Champ « objet » absent."); echecs++; } else bon('objet : ' + JSON.stringify(objet));
      if (!corps) { mauvais("Champ « corps » absent — l'application ne peut rien afficher."); echecs++; }
      else bon('corps : ' + corps.split(/\s+/).length + ' mots');
      if (typeof r.json.confiance === 'number') bon('confiance estimée par le modèle : ' + r.json.confiance + ' sur 1');
      else alerte("Pas de champ « confiance » : l'application calculera le sien, sur 5.");
      const ctrlW6 = r.json.controle;
      if (ctrlW6 && Array.isArray(ctrlW6.anomalies)) {
        bon(ctrlW6.anomalies.length + ' anomalie(s) mineure(s) signalée(s) par le workflow'
          + (ctrlW6.mots ? ' — ' + ctrlW6.mots + ' mots, cible ' + ctrlW6.longueur_attendue : ''));
      } else {
        alerte("Pas de bloc « controle » : le workflow ne dit pas s'il a vérifié son texte.");
      }

      // --- 4. Garde-fous ------------------------------------------
      if (corps) {
        titre("4. Contrôle du texte (garde-fous de l'application)");
        const ctrl = validerReponseIA({ objet: objet || '', corps }, {
          longueur: 'moyenne', type_commerce: 'Boulangerie', raison_sociale: 'Boulangerie du Parc' });
        const maj = ctrl.anomalies.filter(a => a.gravite === 'majeure');
        const min = ctrl.anomalies.filter(a => a.gravite === 'mineure');
        if (!ctrl.anomalies.length) bon('Aucune anomalie. Score de confiance calculé : 5 sur 5.');
        else {
          for (const a of maj) { mauvais('Anomalie majeure : ' + a.code + (a.detail ? ' (' + a.detail + ')' : '')); }
          for (const a of min) { alerte('Anomalie mineure : ' + a.code + (a.detail ? ' (' + a.detail + ')' : '')); }
          ligne('  Score de confiance calculé : ' + ctrl.confiance + ' sur 5');
          if (maj.length) { echecs++; note("Une anomalie majeure signifie que le prompt du workflow doit être resserré."); }
          else avertissements++;
        }
        titre("5. Texte reçu");
        ligne(C.gris + '  Objet : ' + objet + C.z);
        for (const l of corps.split('\n')) ligne(C.gris + '  ' + l + C.z);
      }
    }
  }

  // --- 6. Cas d'erreur --------------------------------------------
  titre("6. Comportement en cas de demande invalide");
  const vide = await envoyer({ parametres: {} }, CLE, 30000);
  if (vide.erreur) { alerte('Pas de réponse : ' + vide.erreur); avertissements++; }
  else if (vide.statut === 400) bon('400 renvoyé sur une demande sans prospect : le workflow valide son entrée.');
  else { alerte('HTTP ' + vide.statut + ' sur une demande sans prospect (400 attendu).'); avertissements++;
    note("Le nœud « Valider la demande » du workflow W6 est-il bien branché ?"); }

  // --- 7. Garde-fou RGPD côté workflow ----------------------------
  // L'interface bloque déjà la génération sur un prospect en opposition.
  // Ce test vérifie que le workflow refuse aussi de son côté : si un jour
  // un autre appelant oublie ce contrôle, la règle doit tenir quand même.
  titre("7. Opposition à la prospection refusée côté workflow");
  const oppose = JSON.parse(JSON.stringify(DEMANDE));
  oppose.prospect.opt_out = true;
  const rgpd = await envoyer(oppose, CLE, 30000);
  if (rgpd.erreur) { alerte('Pas de réponse : ' + rgpd.erreur); avertissements++; }
  else if (rgpd.statut === 400) {
    bon("400 renvoyé sur un prospect en opposition : aucun email n'est rédigé.");
    const e = rgpd.json && rgpd.json.erreurs;
    if (Array.isArray(e) && e.length) ligne('  Motif renvoyé : ' + e.join(' · '));
  } else {
    mauvais('HTTP ' + rgpd.statut + " sur un prospect en opposition : le workflow a accepté de rédiger.");
    note("Le nœud « Valider la demande » doit refuser dès que prospect.opt_out vaut true, avant tout appel au modèle.");
    echecs++;
  }

  titre("8. Authentification du webhook");
  if (CLE) {
    const mauvaiseCle = await envoyer(DEMANDE, 'cle-volontairement-fausse', 30000);
    if (mauvaiseCle.erreur) { alerte('Pas de réponse au test de clé : ' + mauvaiseCle.erreur); }
    else if (mauvaiseCle.statut === 401 || mauvaiseCle.statut === 403) bon('Une clé erronée est refusée (' + mauvaiseCle.statut + ').');
    else { mauvais('Une clé erronée a été acceptée (HTTP ' + mauvaiseCle.statut + ').');
      note("Activez l'authentification « Header Auth » sur le nœud Webhook : sans elle, l'URL est ouverte à tous."); echecs++; }
  } else {
    alerte("Aucune clé testée : si le webhook n'exige rien, son URL est appelable par n'importe qui.");
    avertissements++;
  }

  // --- Verdict ----------------------------------------------------
  titre('Verdict');
  if (echecs === 0 && avertissements === 0) {
    ligne('  ' + C.ok + 'Le workflow W6 répond correctement.' + C.z);
    ligne("  Reportez cette URL dans N8N_WEBHOOK_URL sur Vercel, puis passez l'application en mode Serveur.");
  } else if (echecs === 0) {
    ligne('  ' + C.att + avertissements + ' point(s) de vigilance, aucun blocage.' + C.z);
    ligne("  L'application fonctionnera, mais relisez les points ci-dessus avant la mise en service.");
  } else {
    ligne('  ' + C.ko + echecs + ' problème(s) à corriger' + C.z + (avertissements ? ', ' + avertissements + ' point(s) de vigilance.' : '.'));
    ligne("  L'application ne pourra pas générer d'email tant qu'ils ne sont pas réglés.");
  }
  ligne('');
  process.exit(echecs ? 1 : 0);
})();
