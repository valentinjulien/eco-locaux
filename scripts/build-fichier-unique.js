#!/usr/bin/env node
/* ============================================================
   Produit dist/app_eco-locaux.html : l'application entière dans
   un seul fichier, ouvrable par double-clic, sans serveur.
   Utile pour une démonstration hors ligne ou pour joindre
   l'application à un dossier.
   ============================================================ */

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const PUBLIC = path.join(RACINE, 'public');
const DIST = path.join(RACINE, 'dist');

const lire = (p) => fs.readFileSync(path.join(PUBLIC, p), 'utf8');
const css = lire('styles/app.css');
const ordre = ['core.js', 'demo.js', 'api.js', 'ui.js', 'actions.js', 'main.js'];
const js = ordre.map(f => '/* ===== ' + f + ' ===== */\n' + lire('js/' + f)).join('\n\n');

const html = lire('index.html')
  .replace('<link rel="stylesheet" href="styles/app.css">', '<style>\n' + css + '\n</style>')
  .replace(/<!--[\s\S]*?-->\s*/, '')
  .replace(/<script src="js\/[a-z]+\.js"><\/script>\s*/g, '')
  .replace('</body>', '<script>\n' + js + '\n</script>\n</body>');

fs.mkdirSync(DIST, { recursive: true });
const sortie = path.join(DIST, 'app_eco-locaux.html');
fs.writeFileSync(sortie, html);

// Contrôle : le fichier ne doit plus référencer de ressource externe
const restes = html.match(/(src|href)="(?!data:|#)[^"]+"/g) || [];
console.log('dist/app_eco-locaux.html — ' + Math.round(html.length / 1024) + ' Ko');
console.log(restes.length ? 'Références externes restantes : ' + restes.join(', ') : 'Aucune référence externe : fichier autonome.');
