/* ============================================================
   Utilitaires partagés par les fonctions serverless.
   Aucune dépendance : Node 18+ fournit fetch nativement.
   ============================================================ */

// Les identifiants de tables autorisés sont définis par variable
// d'environnement. Tout appel visant une autre table est refusé :
// la fonction n'est pas un proxy ouvert vers Baserow.
function tablesAutorisees() {
  const brut = process.env.BASEROW_TABLES || '';
  const ids = brut.split(',').map(s => Number(String(s).trim())).filter(n => Number.isInteger(n) && n > 0);
  return new Set(ids);
}

// Les écritures ne sont permises que sur les tables listées ici
// (Prospect et Interaction en pratique). Les tables de référence
// restent en lecture seule, même si le jeton Baserow permet plus.
function tablesEnEcriture() {
  const brut = process.env.BASEROW_TABLES_ECRITURE || '';
  const ids = brut.split(',').map(s => Number(String(s).trim())).filter(n => Number.isInteger(n) && n > 0);
  return new Set(ids);
}

// Comparaison à durée constante, pour ne pas laisser deviner le code
// caractère par caractère.
function memeSecret(a, b) {
  const x = String(a || ''), y = String(b || '');
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function verifierAcces(req) {
  const attendu = process.env.APP_ACCESS_CODE;
  if (!attendu) {
    return { ok: false, statut: 503, code: 'CONFIG_MANQUANTE',
      message: "Le serveur n'est pas configuré : la variable APP_ACCESS_CODE est absente." };
  }
  const fourni = req.headers['x-code-acces'] || req.headers['X-Code-Acces'];
  if (!memeSecret(fourni, attendu)) {
    return { ok: false, statut: 401, code: 'CODE_REFUSE',
      message: "Code d'accès refusé. Vérifiez-le dans l'écran Configuration." };
  }
  return { ok: true };
}

function lireCorps(req) {
  // Vercel fournit déjà req.body sur du JSON ; en local on lit le flux.
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let brut = '';
    req.on('data', c => { brut += c; if (brut.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(brut || '{}')); } catch (e) { resolve({ _invalide: true }); } });
    req.on('error', () => resolve({ _invalide: true }));
  });
}

function repondre(res, statut, objet) {
  res.statusCode = statut;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(objet));
}

// En-têtes de sécurité appliqués à toutes les réponses des fonctions
function entetesSecurite(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

module.exports = { tablesAutorisees, tablesEnEcriture, verifierAcces, lireCorps, repondre, entetesSecurite, memeSecret };
