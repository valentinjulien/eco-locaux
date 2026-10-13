/* ============================================================
   /api/generer-email — relais vers le workflow n8n W6.

   La clé d'appel du webhook reste côté serveur. La fonction borne
   aussi la taille du payload et la durée d'attente, pour qu'un
   workflow lent ne bloque pas l'interface indéfiniment.
   ============================================================ */

const { verifierAcces, lireCorps, repondre, entetesSecurite } = require('./_commun.js');

const DELAI_MS = 45000;
const TAILLE_MAX = 16000;

module.exports = async function handler(req, res) {
  entetesSecurite(res);

  if (req.method !== 'POST') {
    return repondre(res, 405, { erreur: 'METHODE', message: 'Utilisez POST.' });
  }

  const acces = verifierAcces(req);
  if (!acces.ok) return repondre(res, acces.statut, { erreur: acces.code, message: acces.message });

  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) {
    return repondre(res, 503, { erreur: 'CONFIG_MANQUANTE',
      message: "Aucun workflow de génération n'est configuré sur le serveur (variable N8N_WEBHOOK_URL)." });
  }

  const corps = await lireCorps(req);
  if (corps._invalide) return repondre(res, 400, { erreur: 'JSON_INVALIDE', message: 'Corps de requête illisible.' });

  const texte = JSON.stringify(corps);
  if (texte.length > TAILLE_MAX) {
    return repondre(res, 413, { erreur: 'PAYLOAD_TROP_GROS',
      message: 'La demande dépasse la taille autorisée.' });
  }
  if (!corps.prospect || !corps.prospect.raison_sociale) {
    return repondre(res, 400, { erreur: 'DEMANDE_INVALIDE',
      message: 'La demande ne désigne aucun prospect.' });
  }

  const entetes = { 'Content-Type': 'application/json' };
  if (process.env.N8N_WEBHOOK_KEY) entetes['X-Api-Key'] = process.env.N8N_WEBHOOK_KEY;

  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), DELAI_MS);
  try {
    const r = await fetch(url, { method: 'POST', headers: entetes, body: texte, signal: ctrl.signal });
    clearTimeout(minuteur);
    const brut = await r.text();
    let j = null;
    try { j = JSON.parse(brut); } catch (e) { j = null; }

    if (!r.ok) {
      return repondre(res, r.status === 401 || r.status === 403 ? 502 : r.status, {
        erreur: 'WORKFLOW',
        message: (j && j.message) || messageWorkflow(r.status),
        code_workflow: j && j.code ? j.code : null,
      });
    }
    if (!j || (!j.corps && !j.accroche)) {
      return repondre(res, 502, { erreur: 'REPONSE_ILLISIBLE',
        message: "Le workflow a répondu sans email exploitable. Réessayez ou rédigez le message manuellement." });
    }
    return repondre(res, 200, j);
  } catch (e) {
    clearTimeout(minuteur);
    const expire = e.name === 'AbortError';
    return repondre(res, expire ? 504 : 502, {
      erreur: expire ? 'DELAI_DEPASSE' : 'WORKFLOW_INJOIGNABLE',
      message: expire
        ? "Le workflow n'a pas répondu en 45 secondes. Le prospect reste enregistré, vous pouvez rédiger l'email manuellement."
        : 'Le workflow est injoignable depuis le serveur : ' + e.message,
    });
  }
};

function messageWorkflow(statut) {
  if (statut === 401 || statut === 403) return "La clé d'appel du workflow a été refusée. Vérifiez N8N_WEBHOOK_KEY.";
  if (statut === 404) return "L'URL du workflow est introuvable. Le workflow est-il activé dans n8n ?";
  if (statut === 503) return "L'assistant de rédaction est momentanément indisponible.";
  return 'Le workflow a répondu ' + statut + '.';
}

module.exports.messageWorkflow = messageWorkflow;
