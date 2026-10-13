/* ============================================================
   /api/baserow — relais vers l'API Baserow.

   Le jeton Baserow reste dans les variables d'environnement Vercel :
   il ne descend jamais dans le navigateur. La fonction n'est pas un
   proxy ouvert — elle n'accepte que quatre actions, sur les tables
   explicitement autorisées, et seules deux d'entre elles acceptent
   les écritures.
   ============================================================ */

const { tablesAutorisees, tablesEnEcriture, verifierAcces, lireCorps, repondre, entetesSecurite } = require('./_commun.js');

const ACTIONS = new Set(['lire', 'creer', 'modifier', 'supprimer', 'diagnostic']);

module.exports = async function handler(req, res) {
  entetesSecurite(res);

  if (req.method !== 'POST') {
    return repondre(res, 405, { erreur: 'METHODE', message: 'Utilisez POST.' });
  }

  const acces = verifierAcces(req);
  if (!acces.ok) return repondre(res, acces.statut, { erreur: acces.code, message: acces.message });

  const jeton = process.env.BASEROW_TOKEN;
  const base = (process.env.BASEROW_URL || 'https://api.baserow.io').replace(/\/$/, '');
  if (!jeton) {
    return repondre(res, 503, { erreur: 'CONFIG_MANQUANTE',
      message: "Le serveur n'est pas configuré : la variable BASEROW_TOKEN est absente." });
  }

  const corps = await lireCorps(req);
  if (corps._invalide) return repondre(res, 400, { erreur: 'JSON_INVALIDE', message: 'Corps de requête illisible.' });

  const action = String(corps.action || '');
  if (!ACTIONS.has(action)) {
    return repondre(res, 400, { erreur: 'ACTION_INCONNUE', message: 'Action « ' + action + ' » non autorisée.' });
  }

  if (action === 'diagnostic') {
    const tables = [...tablesAutorisees()];
    return repondre(res, 200, {
      message: 'Serveur configuré, ' + tables.length + ' table(s) autorisée(s).',
      tables_lecture: tables,
      tables_ecriture: [...tablesEnEcriture()],
      webhook_configure: !!process.env.N8N_WEBHOOK_URL,
    });
  }

  const table = Number(corps.table);
  if (!tablesAutorisees().has(table)) {
    return repondre(res, 403, { erreur: 'TABLE_NON_AUTORISEE',
      message: 'La table ' + (corps.table ?? '(absente)') + " n'est pas dans la liste autorisée par le serveur." });
  }
  if (action !== 'lire' && !tablesEnEcriture().has(table)) {
    return repondre(res, 403, { erreur: 'ECRITURE_INTERDITE',
      message: 'La table ' + table + ' est en lecture seule sur ce déploiement.' });
  }

  const entetes = { 'Authorization': 'Token ' + jeton, 'Content-Type': 'application/json' };
  const url = (suffixe) => base + '/api/database/rows/table/' + table + '/' + (suffixe || '') + '?user_field_names=true';

  try {
    if (action === 'lire') {
      const resultats = [];
      let page = 1, suite = true;
      while (suite && page <= 25) {
        const r = await fetch(url() + '&size=200&page=' + page, { headers: entetes });
        if (!r.ok) return repondre(res, r.status === 401 ? 502 : r.status,
          { erreur: 'BASEROW', message: messageBaserow(r.status, table, 'lecture') });
        const j = await r.json();
        resultats.push(...(j.results || []));
        suite = !!j.next; page++;
      }
      return repondre(res, 200, { resultats });
    }

    if (action === 'creer') {
      const r = await fetch(url(), { method: 'POST', headers: entetes, body: JSON.stringify(corps.champs || {}) });
      if (!r.ok) return repondre(res, r.status === 401 ? 502 : r.status,
        { erreur: 'BASEROW', message: messageBaserow(r.status, table, 'création') });
      return repondre(res, 200, { ligne: await r.json() });
    }

    const id = Number(corps.id);
    if (!Number.isInteger(id) || id <= 0) {
      return repondre(res, 400, { erreur: 'ID_INVALIDE', message: 'Identifiant de ligne absent ou invalide.' });
    }

    if (action === 'modifier') {
      const r = await fetch(url(id + '/'), { method: 'PATCH', headers: entetes, body: JSON.stringify(corps.champs || {}) });
      if (!r.ok) return repondre(res, r.status === 401 ? 502 : r.status,
        { erreur: 'BASEROW', message: messageBaserow(r.status, table, 'modification') });
      return repondre(res, 200, { ligne: await r.json() });
    }

    if (action === 'supprimer') {
      const r = await fetch(url(id + '/'), { method: 'DELETE', headers: entetes });
      if (!r.ok && r.status !== 204) return repondre(res, r.status === 401 ? 502 : r.status,
        { erreur: 'BASEROW', message: messageBaserow(r.status, table, 'suppression') });
      return repondre(res, 200, { supprime: true });
    }
  } catch (e) {
    return repondre(res, 502, { erreur: 'BASEROW_INJOIGNABLE',
      message: 'Baserow est injoignable depuis le serveur : ' + e.message });
  }
};

function messageBaserow(statut, table, operation) {
  if (statut === 401) return 'Le jeton Baserow configuré sur le serveur a été refusé.';
  if (statut === 403) return "Le jeton n'a pas le droit de " + operation + ' sur la table ' + table + '.';
  if (statut === 404) return 'Table ' + table + ' introuvable.';
  if (statut === 400) return 'Un champ envoyé ne correspond pas au schéma de la table ' + table + '.';
  return 'Baserow a répondu ' + statut + ' lors de la ' + operation + '.';
}

module.exports.messageBaserow = messageBaserow;
