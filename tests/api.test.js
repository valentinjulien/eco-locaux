/* ============================================================
   Tests des fonctions serverless, contre un Baserow simulé.
   Vérifie le code d'accès, la liste blanche des tables, les
   écritures interdites et la remontée des erreurs.

   Exécution : npm run test:api
   ============================================================ */

const http = require('http');
const path = require('path');
const { demarrerStub, JETON_ATTENDU } = require('./stub-baserow.js');

const PORT_STUB = 7801, PORT_API = 7802, PORT_N8N = 7803;
const resultats = [];

function cas(id, titre, fn) {
  return fn().then(d => { resultats.push({ id, titre, statut: 'OK', detail: d || '' }); console.log('OK  ', id, titre, d ? '— ' + d : ''); })
    .catch(e => { resultats.push({ id, titre, statut: 'KO', detail: e.message }); console.log('KO  ', id, titre, '—', e.message); });
}
function doit(c, m) { if (!c) throw new Error(m); }

// Serveur montant les fonctions comme le fait Vercel
function demarrerApi(port) {
  const serveur = http.createServer(async (req, res) => {
    const nom = req.url.split('?')[0].replace('/api/', '');
    try {
      const handler = require(path.join(__dirname, '..', 'api', nom + '.js'));
      await handler(req, res);
    } catch (e) {
      res.statusCode = 500; res.end(JSON.stringify({ erreur: 'FONCTION', message: e.message }));
    }
  });
  return new Promise(r => serveur.listen(port, () => r(serveur)));
}

// Faux workflow n8n
function demarrerN8n(port, comportement) {
  const serveur = http.createServer((req, res) => {
    let brut = '';
    req.on('data', c => { brut += c; });
    req.on('end', () => {
      const corps = JSON.parse(brut || '{}');
      res.setHeader('Content-Type', 'application/json');
      if (comportement.cle && req.headers['x-api-key'] !== comportement.cle) {
        res.statusCode = 403; return res.end(JSON.stringify({ message: 'clé refusée' }));
      }
      if (comportement.mode === 'illisible') { res.statusCode = 200; return res.end(JSON.stringify({ rien: true })); }
      if (comportement.mode === 'lent') { return setTimeout(() => res.end(JSON.stringify({ objet: 'tard', corps: 'tard' })), 60000); }
      res.statusCode = 200;
      res.end(JSON.stringify({ statut: 'ok', objet: 'Vos fours tournent la nuit',
        corps: 'Bonjour, chez ' + (corps.prospect || {}).raison_sociale + ' …', confiance: 4, anomalies: [] }));
    });
  });
  return new Promise(r => serveur.listen(port, () => r(serveur)));
}

const appel = (port, chemin, corps, entetes) => fetch('http://localhost:' + port + chemin, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(entetes || {}) }, body: JSON.stringify(corps),
}).then(async r => ({ statut: r.status, corps: await r.json().catch(() => null) }));

(async () => {
  const stub = await demarrerStub(PORT_STUB);
  const n8n = await demarrerN8n(PORT_N8N, { mode: 'ok', cle: 'cle-n8n' });

  process.env.APP_ACCESS_CODE = 'code-de-test-long-et-aleatoire';
  process.env.BASEROW_TOKEN = JETON_ATTENDU.replace('Token ', '');
  process.env.BASEROW_URL = 'http://localhost:' + PORT_STUB;
  process.env.BASEROW_TABLES = '1148624,1148622,1148623,1148625,1148621';
  process.env.BASEROW_TABLES_ECRITURE = '1148624,1148625';
  process.env.N8N_WEBHOOK_URL = 'http://localhost:' + PORT_N8N + '/webhook/generer';
  process.env.N8N_WEBHOOK_KEY = 'cle-n8n';

  const api = await demarrerApi(PORT_API);
  const bonCode = { 'X-Code-Acces': process.env.APP_ACCESS_CODE };

  await cas('API-01', 'Sans code d’accès, la fonction refuse', async () => {
    const r = await appel(PORT_API, '/api/baserow', { action: 'lire', table: 1148624 });
    doit(r.statut === 401, 'attendu 401, obtenu ' + r.statut);
    doit(r.corps.erreur === 'CODE_REFUSE', 'code attendu CODE_REFUSE');
    return 'HTTP 401 ' + r.corps.erreur;
  });

  await cas('API-02', 'Avec un mauvais code, la fonction refuse', async () => {
    const r = await appel(PORT_API, '/api/baserow', { action: 'lire', table: 1148624 }, { 'X-Code-Acces': 'mauvais' });
    doit(r.statut === 401, 'attendu 401, obtenu ' + r.statut);
    return 'HTTP 401';
  });

  await cas('API-03', 'Lecture autorisée : les 19 prospects remontent', async () => {
    const r = await appel(PORT_API, '/api/baserow', { action: 'lire', table: 1148624 }, bonCode);
    doit(r.statut === 200, 'attendu 200, obtenu ' + r.statut);
    doit(r.corps.resultats.length === 19, 'attendu 19 lignes, obtenu ' + r.corps.resultats.length);
    return r.corps.resultats.length + ' lignes';
  });

  await cas('API-04', 'Le jeton Baserow ne figure jamais dans la réponse', async () => {
    const r = await appel(PORT_API, '/api/baserow', { action: 'lire', table: 1148624 }, bonCode);
    const texte = JSON.stringify(r.corps);
    doit(!texte.includes(process.env.BASEROW_TOKEN), 'le jeton a fuité dans la réponse');
    doit(!texte.toLowerCase().includes('authorization'), 'en-tête d’autorisation présent dans la réponse');
    return 'aucune trace du jeton';
  });

  await cas('API-05', 'Table hors liste blanche : refus', async () => {
    const r = await appel(PORT_API, '/api/baserow', { action: 'lire', table: 999999 }, bonCode);
    doit(r.statut === 403, 'attendu 403, obtenu ' + r.statut);
    doit(r.corps.erreur === 'TABLE_NON_AUTORISEE', 'erreur attendue TABLE_NON_AUTORISEE');
    return 'HTTP 403 ' + r.corps.erreur;
  });

  await cas('API-06', 'Écriture sur une table en lecture seule : refus', async () => {
    const r = await appel(PORT_API, '/api/baserow', { action: 'modifier', table: 1148622, id: 6, champs: { nom_type: 'pirate' } }, bonCode);
    doit(r.statut === 403, 'attendu 403, obtenu ' + r.statut);
    doit(r.corps.erreur === 'ECRITURE_INTERDITE', 'erreur attendue ECRITURE_INTERDITE');
    return 'HTTP 403 ' + r.corps.erreur;
  });

  await cas('API-07', 'Action inconnue : refus', async () => {
    const r = await appel(PORT_API, '/api/baserow', { action: 'vider_la_base', table: 1148624 }, bonCode);
    doit(r.statut === 400, 'attendu 400, obtenu ' + r.statut);
    return 'HTTP 400 ' + r.corps.erreur;
  });

  await cas('API-08', 'Création d’un prospect par le relais', async () => {
    const r = await appel(PORT_API, '/api/baserow', { action: 'creer', table: 1148624,
      champs: { raison_sociale: 'Boulangerie du Relais', type_commerce: [6], statut_vente: 'nouveau' } }, bonCode);
    doit(r.statut === 200, 'attendu 200, obtenu ' + r.statut);
    doit(r.corps.ligne.raison_sociale === 'Boulangerie du Relais', 'ligne non créée');
    doit(r.corps.ligne.type_commerce_nom[0].value === 'Boulangerie', 'le lien doit être résolu');
    return 'ligne ' + r.corps.ligne.id + ' créée';
  });

  await cas('API-09', 'Refus de Baserow remonté en clair', async () => {
    const r = await appel(PORT_API, '/api/baserow', { action: 'creer', table: 1148624, champs: { adresse: 'sans nom' } }, bonCode);
    doit(r.statut === 400, 'attendu 400, obtenu ' + r.statut);
    doit(/schéma/.test(r.corps.message), 'message explicite attendu, obtenu : ' + r.corps.message);
    return r.corps.message;
  });

  await cas('API-10', 'Identifiant de ligne invalide : refus avant appel', async () => {
    const r = await appel(PORT_API, '/api/baserow', { action: 'supprimer', table: 1148624, id: 'abc' }, bonCode);
    doit(r.statut === 400, 'attendu 400, obtenu ' + r.statut);
    return 'HTTP 400 ' + r.corps.erreur;
  });

  await cas('API-11', 'Diagnostic : le serveur décrit sa configuration', async () => {
    const r = await appel(PORT_API, '/api/baserow', { action: 'diagnostic' }, bonCode);
    doit(r.statut === 200, 'attendu 200, obtenu ' + r.statut);
    doit(r.corps.tables_lecture.length === 5, '5 tables attendues');
    doit(r.corps.webhook_configure === true, 'le webhook doit être signalé comme configuré');
    return r.corps.message;
  });

  await cas('API-12', 'GET refusé sur les fonctions', async () => {
    const r = await fetch('http://localhost:' + PORT_API + '/api/baserow');
    doit(r.status === 405, 'attendu 405, obtenu ' + r.status);
    return 'HTTP 405';
  });

  await cas('API-13', 'Génération : la clé du workflow reste côté serveur', async () => {
    const r = await appel(PORT_API, '/api/generer-email',
      { prospect: { raison_sociale: 'Boulangerie du Parc' }, fiche_energie: {}, parametres: {} }, bonCode);
    doit(r.statut === 200, 'attendu 200, obtenu ' + r.statut + ' ' + JSON.stringify(r.corps));
    doit(r.corps.corps.includes('Boulangerie du Parc'), 'email attendu');
    doit(!JSON.stringify(r.corps).includes('cle-n8n'), 'la clé du workflow a fuité');
    return 'email reçu, clé non exposée';
  });

  await cas('API-14', 'Génération sans prospect : refus avant appel au workflow', async () => {
    const r = await appel(PORT_API, '/api/generer-email', { parametres: {} }, bonCode);
    doit(r.statut === 400, 'attendu 400, obtenu ' + r.statut);
    return 'HTTP 400 ' + r.corps.erreur;
  });

  await cas('API-15', 'Génération : payload trop gros refusé', async () => {
    const r = await appel(PORT_API, '/api/generer-email',
      { prospect: { raison_sociale: 'X'.repeat(20000) } }, bonCode);
    doit(r.statut === 413, 'attendu 413, obtenu ' + r.statut);
    return 'HTTP 413';
  });

  await cas('API-16', 'Workflow renvoyant une réponse inexploitable', async () => {
    const n8n2 = await demarrerN8n(7804, { mode: 'illisible' });
    process.env.N8N_WEBHOOK_URL = 'http://localhost:7804/webhook/generer';
    process.env.N8N_WEBHOOK_KEY = '';
    const r = await appel(PORT_API, '/api/generer-email', { prospect: { raison_sociale: 'Test' } }, bonCode);
    n8n2.close();
    process.env.N8N_WEBHOOK_URL = 'http://localhost:' + PORT_N8N + '/webhook/generer';
    process.env.N8N_WEBHOOK_KEY = 'cle-n8n';
    doit(r.statut === 502, 'attendu 502, obtenu ' + r.statut);
    doit(/manuellement/.test(r.corps.message), 'message exploitable attendu');
    return r.corps.erreur;
  });

  await cas('API-17', 'Workflow injoignable : message clair', async () => {
    process.env.N8N_WEBHOOK_URL = 'http://localhost:7899/inexistant';
    const r = await appel(PORT_API, '/api/generer-email', { prospect: { raison_sociale: 'Test' } }, bonCode);
    process.env.N8N_WEBHOOK_URL = 'http://localhost:' + PORT_N8N + '/webhook/generer';
    doit(r.statut === 502, 'attendu 502, obtenu ' + r.statut);
    doit(r.corps.erreur === 'WORKFLOW_INJOIGNABLE', 'erreur attendue WORKFLOW_INJOIGNABLE');
    return r.corps.erreur;
  });

  await cas('API-18', 'Sans APP_ACCESS_CODE configuré, le serveur se bloque', async () => {
    const garde = process.env.APP_ACCESS_CODE;
    delete process.env.APP_ACCESS_CODE;
    const r = await appel(PORT_API, '/api/baserow', { action: 'diagnostic' }, bonCode);
    process.env.APP_ACCESS_CODE = garde;
    doit(r.statut === 503, 'attendu 503, obtenu ' + r.statut);
    doit(r.corps.erreur === 'CONFIG_MANQUANTE', 'erreur attendue CONFIG_MANQUANTE');
    return 'HTTP 503 : refus sûr plutôt qu’ouverture';
  });

  // --- Sonde de santé : elle doit renseigner l'hébergeur sans rien livrer ---

  const lire = (chemin) => fetch('http://localhost:' + PORT_API + chemin)
    .then(async r => ({ statut: r.status, corps: await r.json().catch(() => null) }));

  await cas('API-19', 'La sonde de santé répond sans code d’accès', async () => {
    const r = await lire('/api/sante');
    doit(r.statut === 200, 'attendu 200, obtenu ' + r.statut);
    doit(r.corps.mode_serveur === 'actif', 'mode_serveur attendu actif, obtenu ' + r.corps.mode_serveur);
    return 'HTTP 200 — un healthcheck n’a pas à connaître de secret';
  });

  await cas('API-20', 'La sonde ne révèle aucune valeur de variable', async () => {
    const r = await lire('/api/sante');
    const texte = JSON.stringify(r.corps);
    for (const secret of [process.env.APP_ACCESS_CODE, process.env.BASEROW_TOKEN, process.env.N8N_WEBHOOK_URL]) {
      if (secret) doit(!texte.includes(secret), 'la sonde a laissé fuir ' + secret.slice(0, 6) + '…');
    }
    for (const champ of Object.keys(r.corps.config)) {
      doit(typeof r.corps.config[champ] === 'boolean', champ + ' devrait être un booléen');
    }
    return 'que des booléens, aucune valeur';
  });

  await cas('API-21', 'Configuration incomplète : la sonde le dit', async () => {
    const garde = process.env.BASEROW_TOKEN;
    delete process.env.BASEROW_TOKEN;
    const r = await lire('/api/sante');
    process.env.BASEROW_TOKEN = garde;
    doit(r.statut === 200, 'attendu 200 en mode souple, obtenu ' + r.statut);
    doit(r.corps.statut === 'incomplet', 'statut attendu incomplet');
    doit(r.corps.manquant.includes('BASEROW_TOKEN'), 'BASEROW_TOKEN devrait figurer dans manquant');
    return 'manquant : ' + r.corps.manquant.join(', ');
  });

  await cas('API-22', 'Sonde stricte : 503 tant qu’il manque une variable', async () => {
    const garde = process.env.BASEROW_TOKEN;
    delete process.env.BASEROW_TOKEN;
    const strict = await lire('/api/sante?strict=1');
    process.env.BASEROW_TOKEN = garde;
    const complet = await lire('/api/sante?strict=1');
    doit(strict.statut === 503, 'attendu 503 sur configuration incomplète, obtenu ' + strict.statut);
    doit(complet.statut === 200, 'attendu 200 une fois complète, obtenu ' + complet.statut);
    return '503 puis 200 : le déploiement échoue au lieu de démarrer à moitié';
  });

  await cas('API-23', 'Webhook n8n déclaré sans clé : la sonde le signale', async () => {
    const garde = process.env.N8N_WEBHOOK_KEY;
    delete process.env.N8N_WEBHOOK_KEY;
    const r = await lire('/api/sante');
    if (garde !== undefined) process.env.N8N_WEBHOOK_KEY = garde;
    doit(r.corps.cle_webhook === 'absente', 'la sonde aurait dû signaler la clé absente');
    return 'une URL de webhook ouverte à tous ne passe pas inaperçue';
  });

  api.close(); stub.serveur.close(); n8n.close();
  require('fs').writeFileSync(path.join(__dirname, 'resultats-api.json'),
    JSON.stringify({ date: new Date().toISOString(), resultats }, null, 2));
  const ko = resultats.filter(r => r.statut === 'KO').length;
  console.log('\n' + (resultats.length - ko) + '/' + resultats.length + ' tests des fonctions serverless réussis');
  process.exit(ko ? 1 : 0);
})();
