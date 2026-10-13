#!/usr/bin/env node
/* ============================================================
   Serveur de l'application — un seul fichier pour les deux usages.

   Il sert public/ et monte api/<nom>.js sur /api/<nom>, exactement
   comme le fait Vercel. Aucune dépendance : uniquement les modules
   de Node.

     node scripts/serveur.js --dev    développement
         rechargement à chaud des fonctions, lecture de .env.local

     node scripts/serveur.js          production
         pas de rechargement, en-têtes de sécurité, arrêt propre

   La production est le comportement par défaut : un démarrage sans
   drapeau, tel que le lancera Docker ou Coolify, ne peut pas se
   retrouver par accident en mode développement.
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');

const DEV = process.argv.includes('--dev');
const RACINE = path.join(__dirname, '..');
const PUBLIC = path.join(RACINE, 'public');
const API = path.join(RACINE, 'api');
const PORT = Number(process.env.PORT || 3000);
const HOTE = process.env.HOST || (DEV ? '127.0.0.1' : '0.0.0.0');

// En développement seulement : les variables viennent du fichier local.
// En production, elles viennent de l'environnement (Coolify, Docker, Vercel).
if (DEV) {
  const envLocal = path.join(RACINE, '.env.local');
  if (fs.existsSync(envLocal)) {
    for (const ligne of fs.readFileSync(envLocal, 'utf8').split('\n')) {
      const m = ligne.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    console.log('Variables chargées depuis .env.local');
  }
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

// Les mêmes en-têtes que ceux déclarés dans vercel.json : ils ne doivent
// pas dépendre de l'hébergeur choisi.
function entetesCommunes(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
}

const serveur = http.createServer(async (req, res) => {
  entetesCommunes(res);
  const chemin = decodeURIComponent((req.url || '/').split('?')[0]);

  if (chemin.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
    const nom = chemin.slice(5).replace(/[^a-z0-9_-]/gi, '');
    const fichier = path.join(API, nom + '.js');
    if (!nom || nom.startsWith('_') || !fs.existsSync(fichier)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ erreur: 'INTROUVABLE', message: 'Fonction /api/' + nom + ' introuvable.' }));
    }
    try {
      if (DEV) {
        delete require.cache[require.resolve(fichier)];
        delete require.cache[require.resolve(path.join(API, '_commun.js'))];
      }
      const handler = require(fichier);
      return await handler(req, res);
    } catch (e) {
      console.error('Erreur dans /api/' + nom + ' :', e);
      if (res.headersSent) return res.end();
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      // En production, le détail de l'erreur reste dans les journaux du serveur :
      // il peut contenir une URL interne ou un fragment de requête.
      return res.end(JSON.stringify({ erreur: 'FONCTION',
        message: DEV ? e.message : "La fonction a échoué. Le détail est dans les journaux du serveur." }));
    }
  }

  // Fichiers statiques, confinés à public/
  let rel = chemin === '/' ? 'index.html' : chemin.replace(/^\/+/, '');
  const cible = path.normalize(path.join(PUBLIC, rel));
  if (!cible.startsWith(PUBLIC)) { res.statusCode = 403; return res.end('Interdit'); }
  if (!fs.existsSync(cible) || fs.statSync(cible).isDirectory()) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end('<h1>404</h1><p>Page introuvable. <a href="/">Retour à l\'application</a></p>');
  }
  res.setHeader('Content-Type', TYPES[path.extname(cible).toLowerCase()] || 'application/octet-stream');
  // Les fichiers n'ont pas de nom versionné : on revalide à chaque chargement,
  // sinon un déploiement ne serait pas vu par les navigateurs déjà ouverts.
  res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(cible).pipe(res);
});

serveur.listen(PORT, HOTE, () => {
  const fonctions = fs.readdirSync(API).filter(f => f.endsWith('.js') && !f.startsWith('_'))
    .map(f => '/api/' + f.replace('.js', ''));
  if (DEV) {
    console.log('\n  Eco-Locaux Prospect — développement');
    console.log('  → http://localhost:' + PORT);
    console.log('  Fonctions : ' + fonctions.join('  '));
    console.log('  Ctrl+C pour arrêter\n');
  } else {
    console.log('Eco-Locaux Prospect — production, écoute sur ' + HOTE + ':' + PORT);
    console.log('Fonctions : ' + fonctions.join(' '));
    console.log('Sonde de santé : /api/sante');
  }
});

// Docker et Coolify arrêtent un conteneur par SIGTERM : sans cette écoute,
// Node est tué au bout du délai de grâce et les requêtes en cours sont coupées.
let arretEnCours = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    // Un second signal pendant l'arrêt veut dire « maintenant »
    if (arretEnCours) process.exit(0);
    arretEnCours = true;
    console.log('Arrêt demandé (' + signal + '), fermeture des connexions…');
    serveur.close(() => { console.log('Toutes les connexions sont fermées.'); process.exit(0); });
    // Sans cette ligne, les connexions persistantes restées ouvertes mais
    // inactives empêchent close() de rendre la main, et Docker finit par
    // tuer le processus de force au bout de son délai de grâce.
    if (typeof serveur.closeIdleConnections === 'function') serveur.closeIdleConnections();
    // Borne haute : une requête en cours a huit secondes pour se terminer,
    // ce qui reste sous le délai de grâce habituel de dix secondes.
    setTimeout(() => { console.log('Délai dépassé, arrêt forcé.'); process.exit(0); }, 8000);
  });
}
