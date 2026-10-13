/* ============================================================
   /api/sante — sonde de santé.

   Elle sert au healthcheck de l'hébergeur (Coolify, Docker) et au
   dépannage : elle dit quelles variables d'environnement sont
   présentes, jamais leur valeur.

   Deux lectures possibles :
     GET /api/sante           200 tant que le processus répond
     GET /api/sante?strict=1  503 si le mode serveur est inutilisable

   La première est la bonne pour un healthcheck de conteneur : elle
   teste que le serveur est vivant. La seconde sert si vous voulez
   qu'un déploiement mal configuré échoue bruyamment plutôt que de
   se découvrir au premier clic.

   Aucun code d'accès n'est exigé : une sonde qui aurait besoin d'un
   secret ne serait pas interrogeable par l'hébergeur. En
   contrepartie, elle ne révèle que des booléens.
   ============================================================ */

const { repondre, entetesSecurite } = require('./_commun.js');

const DEBUT = Date.now();

module.exports = async function handler(req, res) {
  entetesSecurite(res);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return repondre(res, 405, { erreur: 'METHODE', message: 'Utilisez GET.' });
  }

  const present = (nom) => typeof process.env[nom] === 'string' && process.env[nom].trim() !== '';

  const config = {
    code_acces: present('APP_ACCESS_CODE'),
    jeton_baserow: present('BASEROW_TOKEN'),
    tables_baserow: present('BASEROW_TABLES'),
    tables_en_ecriture: present('BASEROW_TABLES_ECRITURE'),
    webhook_n8n: present('N8N_WEBHOOK_URL'),
    cle_webhook_n8n: present('N8N_WEBHOOK_KEY'),
  };

  // Ce qu'il faut pour que le mode serveur fonctionne de bout en bout
  const manquant = [];
  if (!config.code_acces) manquant.push('APP_ACCESS_CODE');
  if (!config.jeton_baserow) manquant.push('BASEROW_TOKEN');
  if (!config.tables_baserow) manquant.push('BASEROW_TABLES');

  const corps = {
    statut: manquant.length ? 'incomplet' : 'ok',
    mode_serveur: manquant.length ? 'inactif' : 'actif',
    manquant,
    generation_email: config.webhook_n8n ? 'configurée' : 'non configurée',
    // Sans clé, l'URL du webhook n8n est appelable par n'importe qui :
    // le signaler ici évite que cela passe inaperçu après un déploiement.
    cle_webhook: config.webhook_n8n && !config.cle_webhook_n8n ? 'absente' : null,
    config,
    node: process.version,
    actif_depuis_s: Math.round((Date.now() - DEBUT) / 1000),
  };

  const strict = /(^|[?&])strict=1(&|$)/.test(req.url || '');
  return repondre(res, strict && manquant.length ? 503 : 200, corps);
};
