/* ============================================================
   Baserow simulé, pour tester la chaîne complète sans toucher à
   la vraie base. Reproduit le format de réponse réel : listes
   déroulantes en objet, liens en tableau, pagination.
   ============================================================ */

const http = require('http');
const { DEMO_PROSPECTS, DEMO_TYPES, DEMO_COMMERCIAUX, DEMO_INTERACTIONS } =
  require('../public/js/demo.js');

const JETON_ATTENDU = 'Token jeton-de-test-serveur';

function demarrerStub(port) {
  const tables = {
    1148624: JSON.parse(JSON.stringify(DEMO_PROSPECTS)),
    1148622: JSON.parse(JSON.stringify(DEMO_TYPES)),
    1148623: JSON.parse(JSON.stringify(DEMO_COMMERCIAUX)),
    1148625: JSON.parse(JSON.stringify(DEMO_INTERACTIONS)),
    1148621: [],
  };
  let prochainId = 5000;
  const journal = [];

  const serveur = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const m = u.pathname.match(/^\/api\/database\/rows\/table\/(\d+)\/(\d+)?\/?$/);
    journal.push({ methode: req.method, chemin: u.pathname, jeton: req.headers.authorization });

    const repondre = (statut, obj) => {
      res.statusCode = statut;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(obj));
    };

    if (req.headers.authorization !== JETON_ATTENDU) return repondre(401, { detail: 'Jeton invalide' });
    if (!m) return repondre(404, { detail: 'Route inconnue' });

    const table = Number(m[1]);
    const id = m[2] ? Number(m[2]) : null;
    if (!tables[table]) return repondre(404, { detail: 'Table inconnue' });

    if (req.method === 'GET') {
      return repondre(200, { count: tables[table].length, next: null, previous: null, results: tables[table] });
    }

    let brut = '';
    req.on('data', c => { brut += c; });
    req.on('end', () => {
      let corps = {};
      try { corps = JSON.parse(brut || '{}'); } catch (e) { return repondre(400, { detail: 'JSON invalide' }); }

      if (req.method === 'POST') {
        // Baserow refuse une création sans champ primaire : on reproduit ce refus
        if (table === 1148624 && !corps.raison_sociale) {
          return repondre(400, { error: 'ERROR_REQUEST_BODY_VALIDATION', detail: 'raison_sociale requis' });
        }
        const ligne = { id: ++prochainId, order: String(prochainId), ...enrichir(corps, tables) };
        tables[table].push(ligne);
        return repondre(200, ligne);
      }
      if (req.method === 'PATCH') {
        const l = tables[table].find(x => x.id === id);
        if (!l) return repondre(404, { detail: 'Ligne inconnue' });
        Object.assign(l, enrichir(corps, tables));
        return repondre(200, l);
      }
      if (req.method === 'DELETE') {
        tables[table] = tables[table].filter(x => x.id !== id);
        return repondre(204, {});
      }
      return repondre(405, { detail: 'Méthode non gérée' });
    });
  });

  return new Promise((resolve) => {
    serveur.listen(port, () => resolve({ serveur, tables: () => tables, journal }));
  });
}

// Reproduit la façon dont Baserow renvoie les champs après écriture
function enrichir(corps, tables) {
  const out = { ...corps };
  const selects = ['statut_vente', 'Source_consentement', 'type_interaction'];
  for (const s of selects) if (typeof out[s] === 'string') out[s] = { id: 0, value: out[s] };
  const liens = { type_commerce: [1148622, 'nom_type', 'type_commerce_nom'],
    commercial: [1148623, 'nom', 'commercial_nom'], secteur: [1148621, 'nom_secteur', 'secteur_nom'],
    prospect: [1148624, 'raison_sociale', 'prospect_raison'] };
  for (const [champ, [table, cle, lookup]] of Object.entries(liens)) {
    if (Array.isArray(out[champ])) {
      out[champ] = out[champ].map(id => {
        const src = (tables[table] || []).find(x => x.id === id);
        return { id, value: src ? src[cle] : '' };
      });
      out[lookup] = out[champ];
    }
  }
  return out;
}

module.exports = { demarrerStub, JETON_ATTENDU };
