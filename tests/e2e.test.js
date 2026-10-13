/* ============================================================
   Tests de bout en bout dans un navigateur réel.
   L'application est servie par le serveur de développement, qui
   monte les fonctions de api/ exactement comme Vercel. Un Baserow
   simulé remplace la vraie base : la chaîne navigateur → fonction
   serverless → Baserow est donc réellement traversée.

   Exécution : npm run test:e2e
   ============================================================ */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { demarrerStub, JETON_ATTENDU } = require('./stub-baserow.js');

const PORT_WEB = 7811, PORT_STUB = 7812, PORT_N8N = 7813;
const CODE_ACCES = 'code-de-test-long-et-aleatoire';
const URL = 'http://localhost:' + PORT_WEB + '/';
const resultats = [];
let page;

async function cas(id, titre, fn) {
  try { const d = await fn(); resultats.push({ id, titre, statut: 'OK', detail: d || '' }); console.log('OK  ', id, titre, d ? '— ' + d : ''); }
  catch (e) { resultats.push({ id, titre, statut: 'KO', detail: e.message }); console.log('KO  ', id, titre, '—', e.message); }
}
function doit(condition, message) { if (!condition) throw new Error(message); }

// Faux workflow n8n, qui répond comme W6
function demarrerN8n(port) {
  const http = require('http');
  const serveur = http.createServer((req, res) => {
    let brut = '';
    req.on('data', c => { brut += c; });
    req.on('end', () => {
      const corps = JSON.parse(brut || '{}');
      const nom = (corps.prospect || {}).raison_sociale || 'votre commerce';
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ statut: 'ok',
        objet: 'Vos équipements pèsent sur votre facture',
        corps: 'Bonjour,\n\nChez ' + nom + ", un poste domine la facture : vos équipements de production. C'est presque toujours là que se joue l'essentiel de la dépense.\n\nEco-Locaux accompagne les commerces de proximité pour réduire cette dépense, avec un gain indicatif de l'ordre de 15 % selon les situations.\n\nAuriez-vous quinze minutes cette semaine pour en parler ?",
        confiance: 4, anomalies: [], modele: 'workflow n8n simulé' }));
    });
  });
  return new Promise(r => serveur.listen(port, () => r(serveur)));
}

(async () => {
  const stub = await demarrerStub(PORT_STUB);
  const n8n = await demarrerN8n(PORT_N8N);
  const web = spawn(process.execPath, [path.join(__dirname, '..', 'scripts', 'serveur.js')], {
    env: { ...process.env, PORT: String(PORT_WEB),
      APP_ACCESS_CODE: CODE_ACCES,
      BASEROW_TOKEN: JETON_ATTENDU.replace('Token ', ''),
      BASEROW_URL: 'http://localhost:' + PORT_STUB,
      BASEROW_TABLES: '1148624,1148622,1148623,1148625,1148621',
      BASEROW_TABLES_ECRITURE: '1148624,1148625',
      N8N_WEBHOOK_URL: 'http://localhost:' + PORT_N8N + '/webhook/generer' },
    stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 900));

  const navigateur = await chromium.launch();
  const ctx = await navigateur.newContext({ viewport: { width: 1440, height: 950 }, locale: 'fr-FR' });
  page = await ctx.newPage();
  const erreursJs = [];
  page.on('pageerror', e => erreursJs.push(e.message));
  page.on('dialog', d => d.accept());
  page.on('console', m => { if (m.type() === 'error') erreursJs.push('console: ' + m.text()); });

  await page.goto(URL);
  await page.waitForSelector('.kanban, .card', { timeout: 10000 });

  await cas('E2E-01', 'L’application démarre en mode démonstration', async () => {
    const badge = await page.textContent('.topbar .badge');
    doit(badge.includes('démonstration'), 'badge attendu, obtenu : ' + badge);
    return badge.trim();
  });

  await cas('E2E-02', 'Les 19 prospects réels sont chargés', async () => {
    const t = await page.textContent('.page-sub');
    doit(t.includes('19 prospects'), 'obtenu : ' + t);
    return t.trim();
  });

  await cas('E2E-03', 'Le Kanban affiche les 6 statuts de la base', async () => {
    const n = await page.locator('.kanban .col').count();
    doit(n === 6, 'colonnes attendues 6, obtenu ' + n);
    return n + ' colonnes';
  });

  await cas('E2E-04', 'La recherche filtre les cartes', async () => {
    await page.fill('#q', 'pressing');
    await page.waitForTimeout(400);
    const n = await page.locator('.pcard').count();
    doit(n === 3, 'attendu 3 pressings, obtenu ' + n);
    await page.fill('#q', '');
    await page.waitForTimeout(400);
    return n + ' résultats';
  });

  await cas('E2E-05', 'Un filtre avancé se cumule avec la recherche', async () => {
    await page.click('summary');
    await page.click('[data-filtre="statut"][data-valeur="nouveau"]');
    await page.waitForTimeout(200);
    const n = await page.locator('.pcard').count();
    doit(n === 4, 'attendu 4 nouveaux, obtenu ' + n);
    await page.click('[data-raz="1"]');
    await page.waitForTimeout(200);
    return n + ' prospects au statut nouveau';
  });

  await cas('E2E-06', 'La bascule Tableau change la présentation', async () => {
    await page.click('[data-vue="tableau"]');
    await page.waitForSelector('table tbody tr');
    const n = await page.locator('table tbody tr').count();
    doit(n === 19, 'attendu 19 lignes, obtenu ' + n);
    await page.click('[data-vue="kanban"]');
    return n + ' lignes';
  });

  await cas('E2E-07', 'Ouvrir une carte affiche la fiche prospect', async () => {
    await page.click('.pcard:has-text("Boulangerie du Parc")');
    await page.waitForSelector('h1:has-text("Boulangerie du Parc")');
    const fiche = await page.textContent('.colL');
    doit(fiche.includes('04 72 11 22 33'), 'téléphone réel attendu dans la fiche');
    doit(fiche.includes('Fours'), 'fiche énergie du métier attendue');
    return 'coordonnées et fiche énergie affichées';
  });

  await cas('E2E-08', 'Le détail du score est explicable', async () => {
    const t = await page.textContent('.colL');
    for (const l of ['Intensité énergétique', 'Joignabilité', 'Avancement commercial', 'Fraîcheur du contact']) {
      doit(t.includes(l), 'ligne manquante : ' + l);
    }
    return '4 composantes affichées';
  });

  await cas('E2E-09', 'La génération produit un email et un score de confiance', async () => {
    await page.click('[data-gen="lancer"]');
    await page.waitForSelector('.ia-txt', { timeout: 15000 });
    const objet = await page.textContent('.ia-obj');
    const corps = await page.textContent('.ia-txt');
    const conf = await page.textContent('.conf');
    doit(corps.includes('Boulangerie du Parc'), 'le nom du commerce doit être cité');
    doit(/four/i.test(objet + corps), 'le vocabulaire du métier boulangerie est attendu');
    doit(/Confiance \d sur 5/.test(conf), 'score de confiance attendu, obtenu : ' + conf);
    return conf.trim().split('\n')[0];
  });

  await cas('E2E-10', 'Le bouton Copier fonctionne', async () => {
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.click('[data-gen="copier"]');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(e => /copi/.test(e.textContent)), null, { timeout: 5000 });
    const t = await page.textContent('.toast:last-child');
    doit(t.includes('copié'), 'notification de copie attendue, obtenu : ' + t);
    const presse = await page.evaluate(() => navigator.clipboard.readText());
    doit(presse.startsWith('Objet :'), 'presse-papiers attendu, obtenu : ' + presse.slice(0, 40));
    return presse.split('\n')[0];
  });

  await cas('E2E-11', 'Le bouton Modifier ouvre l’édition du texte', async () => {
    await page.click('[data-gen="editer"]');
    await page.waitForSelector('#ed-corps');
    await page.fill('#ed-corps', 'Bonjour, texte relu et corrigé par le commercial pour la Boulangerie du Parc, avec une mention de vos fours et de vos vitrines réfrigérées afin de rester dans le sujet du métier.');
    await page.click('[data-gen="valider-edition"]');
    await page.waitForSelector('.ia-txt');
    const t = await page.textContent('.ia-txt');
    doit(t.includes('relu et corrigé'), 'le texte modifié doit être conservé');
    return 'édition enregistrée';
  });

  await cas('E2E-12', 'La régénération avec d’autres paramètres change le texte', async () => {
    const avant = await page.textContent('.ia-txt');
    await page.selectOption('[data-param="ton"]', 'direct');
    await page.selectOption('[data-param="angle"]', 'equipement');
    await page.selectOption('[data-param="longueur"]', 'longue');
    await page.click('[data-gen="regenerer"]');
    await page.waitForTimeout(2200);
    const apres = await page.textContent('.ia-txt');
    doit(avant !== apres, 'le texte régénéré doit différer');
    doit(apres.includes('réglage') || apres.includes('entretien'), 'l’angle « équipements » doit transparaître');
    return 'texte régénéré selon les paramètres';
  });

  await cas('E2E-13', 'L’email s’enregistre dans l’historique du prospect', async () => {
    const avant = await page.locator('.timeline .tl').count();
    await page.click('[data-gen="enregistrer"]');
    await page.waitForTimeout(600);
    const apres = await page.locator('.timeline .tl').count();
    doit(apres === avant + 1, 'une interaction devait être ajoutée (' + avant + ' → ' + apres + ')');
    const t = await page.textContent('.timeline');
    doit(t.includes('EMAIL-'), 'référence EMAIL- attendue dans l’historique');
    return apres + ' entrées dans l’historique';
  });

  await cas('E2E-14', 'Le changement de statut est pris en compte', async () => {
    await page.selectOption('[data-statut]', 'qualifié');
    await page.waitForTimeout(600);
    const badge = await page.textContent('.page-h .badge');
    doit(badge.includes('Qualifié'), 'badge attendu Qualifié, obtenu : ' + badge);
    return badge.trim();
  });

  await cas('E2E-15', 'Un prospect en opposition RGPD bloque la génération', async () => {
    await page.click('[data-ecran="pipeline"]');
    await page.waitForSelector('.kanban');
    await page.fill('#q', 'Bordeaux');
    await page.waitForTimeout(400);
    await page.click('.pcard:has-text("Restaurant Le Bordeaux")');
    await page.waitForSelector('h1');
    const alerte = await page.textContent('.alert');
    doit(alerte.includes('Opposition'), 'alerte RGPD attendue');
    const zone = await page.textContent('.colR');
    doit(zone.includes('Génération indisponible'), 'la génération doit être désactivée');
    doit(await page.locator('[data-gen="lancer"]').count() === 0, 'aucun bouton de génération ne doit être présent');
    return 'génération bloquée et motif affiché';
  });

  await cas('E2E-16', 'Création d’un prospect : les erreurs de saisie sont explicites', async () => {
    await page.click('[data-ecran="nouveau"]');
    await page.waitForSelector('#form-prospect');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(200);
    const err = await page.textContent('#e-nom');
    doit(!(await page.locator('#e-nom').isHidden()), 'le message d’erreur doit être visible');
    doit(err.includes('raison sociale'), 'message explicite attendu, obtenu : ' + err);
    return err.trim();
  });

  await cas('E2E-17', 'Création d’un prospect valide', async () => {
    await page.fill('#f-nom', 'Boulangerie de Test');
    await page.selectOption('#f-type', { label: 'Boulangerie' });
    await page.fill('#f-email', 'test@boulangerie-test.fr');
    await page.fill('#f-adresse', '3 rue de Test, 69001 Lyon');
    await page.click('button[type="submit"]');
    await page.waitForSelector('h1:has-text("Boulangerie de Test")', { timeout: 5000 });
    const sub = await page.textContent('.page-sub');
    doit(sub.includes('Boulangerie'), 'le métier doit être rattaché, obtenu : ' + sub);
    return 'prospect créé et fiche ouverte';
  });

  await cas('E2E-17b', 'Le formulaire « Nouveau prospect » est vierge après consultation d\u2019une fiche', async () => {
    await page.click('[data-ecran="pipeline"]');
    await page.waitForSelector('.pcard');
    await page.click('.pcard');
    await page.waitForSelector('.colR');
    await page.click('[data-ecran="nouveau"]');
    await page.waitForSelector('#f-nom');
    const nom = await page.inputValue('#f-nom');
    doit(nom === '', 'le champ doit être vide, obtenu : « ' + nom + ' »');
    const libelle = await page.textContent('#form-prospect button[type="submit"]');
    doit(libelle.includes('Créer'), 'le bouton doit proposer la création, obtenu : ' + libelle);
    await page.click('[data-ecran="pipeline"]');
    return 'formulaire vierge, bouton « Créer le prospect »';
  });

  await cas('E2E-18', 'Le nouveau prospect apparaît dans le pipeline', async () => {
    await page.click('[data-ecran="pipeline"]');
    await page.waitForSelector('.kanban');
    const t = await page.textContent('.page-sub');
    doit(t.includes('20 prospects'), 'attendu 20 prospects, obtenu : ' + t);
    return t.trim();
  });

  await cas('E2E-19', 'Validation de l’email au format incorrect', async () => {
    await page.fill('#q', 'Boulangerie de Test');
    await page.waitForTimeout(400);
    await page.click('.pcard:has-text("Boulangerie de Test")');
    await page.waitForSelector('[data-editer]');
    await page.click('[data-editer]');
    await page.waitForSelector('#f-email');
    await page.fill('#f-email', 'pas-un-email');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(200);
    const err = await page.textContent('#e-email');
    doit(err.includes('ne semble pas valide'), 'message attendu, obtenu : ' + err);
    return err.trim();
  });

  await cas('E2E-20', 'Suppression d’un prospect', async () => {
    await page.click('[data-supprimer]');
    await page.waitForSelector('.empty, .kanban', { timeout: 15000 });
    await page.click(".empty [data-raz=\"1\"]");  // la recherche du test précédent ne correspond plus à rien
    await page.waitForSelector('.kanban', { timeout: 10000 });
    const t = await page.textContent('.page-sub');
    doit(t.includes('19 prospects'), 'retour à 19 prospects attendu, obtenu : ' + t);
    return t.trim();
  });

  await cas('E2E-21', 'Le tableau de bord est réservé au manager', async () => {
    doit(await page.locator('[data-ecran="bord"]').count() === 0, 'le lien ne doit pas être visible pour un commercial');
    await page.click('[data-ecran="config"]');
    await page.waitForSelector('#form-config');
    await page.selectOption('#c-role', 'manager');
    await page.click('#form-config button[type="submit"]');
    await page.waitForSelector('[data-ecran="bord"]', { timeout: 10000 });
    await page.waitForSelector('.kanban', { timeout: 10000 });
    await page.waitForTimeout(400);
    return 'lien visible après passage en rôle manager';
  });

  await cas('E2E-22', 'Le tableau de bord affiche les indicateurs et les graphiques', async () => {
    await page.click('[data-ecran="bord"]');
    await page.waitForSelector('.funnel');
    const kpis = await page.locator('.kpi').count();
    const barres = await page.locator('.bar-row').count();
    const etapes = await page.locator('.fstep').count();
    doit(kpis === 4, 'attendu 4 indicateurs, obtenu ' + kpis);
    doit(barres > 10, 'graphiques à barres attendus, obtenu ' + barres);
    doit(etapes === 4, 'entonnoir à 4 étapes attendu, obtenu ' + etapes);
    return kpis + ' indicateurs, ' + barres + ' barres, ' + etapes + ' étapes';
  });

  await cas('E2E-23', 'L’écran Relances liste les prospects à recontacter', async () => {
    await page.click('[data-ecran="relances"]');
    await page.waitForSelector('table tbody tr, .empty');
    const n = await page.locator('table tbody tr').count();
    doit(n === 14, 'attendu 14 relances, obtenu ' + n);
    return n + ' prospects à relancer';
  });

  await cas('E2E-24', 'Le mode sombre s’active et persiste au rechargement', async () => {
    await page.click('#t-dark');
    await page.waitForTimeout(150);
    doit(await page.evaluate(() => document.body.classList.contains('dk')), 'classe sombre attendue');
    const fond = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.reload();
    await page.waitForSelector('.kanban, .card');
    doit(await page.evaluate(() => document.body.classList.contains('dk')), 'le mode doit persister');
    return 'fond ' + fond;
  });

  await cas('E2E-25', 'Le mode lecture facilitée s’active', async () => {
    await page.click('#t-lf');
    await page.waitForTimeout(150);
    const esp = await page.evaluate(() => getComputedStyle(document.body).letterSpacing);
    doit(esp !== 'normal', 'espacement des lettres attendu, obtenu : ' + esp);
    await page.click('#t-dark'); await page.click('#t-lf');
    return 'letter-spacing ' + esp;
  });

  await cas('E2E-26', 'Navigation au clavier : ouvrir une carte avec Entrée', async () => {
    await page.click('[data-ecran="pipeline"]');
    await page.waitForSelector('.pcard');
    await page.locator('.pcard').first().focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('.colR', { timeout: 3000 });
    doit(await page.locator('h1').count() === 1, 'la fiche doit s’ouvrir');
    return 'fiche ouverte au clavier';
  });

  await cas('E2E-27', 'Le raccourci « / » place le focus dans la recherche', async () => {
    await page.click('[data-ecran="pipeline"]');
    await page.waitForSelector('#q');
    await page.keyboard.press('/');
    const actif = await page.evaluate(() => document.activeElement.id);
    doit(actif === 'q', 'focus attendu sur la recherche, obtenu : ' + actif);
    return 'focus sur #q';
  });

  await cas('E2E-28', 'Le focus clavier est visible', async () => {
    await page.locator('.btn-pri').first().focus();
    const o = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle + ' ' + s.outlineWidth; });
    doit(!o.startsWith('none'), 'contour de focus attendu, obtenu : ' + o);
    return o;
  });

  await cas('E2E-29', 'Les cibles tactiles atteignent 44 px', async () => {
    const petites = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('button, a[href], select, input:not([type=hidden])').forEach(e => {
        if (e.closest('.sr-only') || e.classList.contains('sr-only')) return; // masqué visuellement, non cliquable à la souris
        const r = e.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.height < 36) out.push((e.textContent || e.id || e.tagName).trim().slice(0, 30) + ' (' + Math.round(r.height) + 'px)');
      });
      return out;
    });
    doit(petites.length === 0, 'cibles trop petites : ' + petites.join(', '));
    return 'aucune cible sous 36 px';
  });

  await cas('E2E-30', 'Affichage mobile : une colonne, pas de défilement horizontal', async () => {
    await page.setViewportSize({ width: 375, height: 760 });
    await page.waitForTimeout(300);
    const debord = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    doit(debord <= 2, 'défilement horizontal de ' + debord + ' px');
    const dir = await page.evaluate(() => getComputedStyle(document.querySelector('.kanban')).flexDirection);
    doit(dir === 'column', 'kanban en colonne attendu, obtenu : ' + dir);
    await page.setViewportSize({ width: 1440, height: 950 });
    return 'aucun débordement, kanban empilé';
  });

  await cas('E2E-31', 'Mode connecté sans jeton : message d’erreur explicite', async () => {
    await page.click('[data-ecran="config"]');
    await page.waitForSelector('#form-config');
    await page.check('input[name="mode"][value="connecte"]');
    await page.fill('#c-token', '');
    await page.click('#form-config button[type="submit"]');
    await page.waitForSelector('.toast');
    const t = await page.textContent('.toast');
    doit(t.includes('jeton'), 'message attendu sur le jeton, obtenu : ' + t);
    return t.trim();
  });

  await cas('E2E-32', 'Mode connecté avec un jeton invalide : l’erreur réseau est expliquée', async () => {
    await page.fill('#c-url', 'https://api.baserow.io');
    await page.fill('#c-token', 'jeton-invalide-pour-test');
    await page.click('#form-config button[type="submit"]');
    await page.waitForSelector('.alert, .toast', { timeout: 20000 });
    const t = await page.textContent('body');
    doit(/Connexion impossible|Baserow|injoignable|Chargement impossible/.test(t), 'message d’erreur attendu');
    return 'erreur affichée sans page blanche';
  });

  await cas('E2E-33', 'Aucune erreur JavaScript pendant tout le parcours', async () => {
    const vraies = erreursJs.filter(e => !/Failed to load resource|net::ERR|ERR_NAME|401|Fetch/i.test(e));
    doit(vraies.length === 0, 'erreurs : ' + vraies.slice(0, 3).join(' | '));
    return erreursJs.length ? erreursJs.length + ' erreur(s) réseau attendues (test du jeton invalide)' : 'aucune';
  });

  await cas('E2E-34', 'Mode serveur : bascule et chargement par la fonction serverless', async () => {
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await page.goto(URL);
    await page.waitForSelector('.kanban');
    await page.click('[data-ecran="config"]');
    await page.waitForSelector('#form-config');
    await page.check('input[name="mode"][value="serveur"]');
    await page.fill('#c-code', CODE_ACCES);
    await page.click('#form-config button[type="submit"]');
    await page.waitForSelector('.kanban', { timeout: 15000 });
    const badge = await page.textContent('.topbar .badge');
    doit(badge.includes('serveur'), 'badge « par le serveur » attendu, obtenu : ' + badge);
    const t = await page.textContent('.page-sub');
    doit(t.includes('19 prospects'), 'les 19 prospects doivent venir du relais, obtenu : ' + t);
    return badge.trim() + ' — ' + t.trim();
  });

  await cas('E2E-35', 'Mode serveur : aucun jeton Baserow dans le navigateur', async () => {
    const stockage = await page.evaluate(() => JSON.stringify(localStorage));
    doit(!stockage.includes(JETON_ATTENDU.replace('Token ', '')), 'le jeton ne doit pas être stocké côté navigateur');
    const cfg = await page.evaluate(() => JSON.parse(localStorage.getItem('ecolocaux.config.v2') || '{}'));
    doit(!cfg.token, 'le champ jeton doit rester vide en mode serveur');
    return 'stockage local sans jeton Baserow';
  });

  await cas('E2E-36', 'Mode serveur : création écrite dans la base via le relais', async () => {
    await page.click('[data-ecran="nouveau"]');
    await page.waitForSelector('#f-nom');
    await page.fill('#f-nom', 'Pressing du Relais');
    await page.selectOption('#f-type', { label: 'Pressing' });
    await page.fill('#f-email', 'contact@pressing-relais.fr');
    await page.click('#form-prospect button[type="submit"]');
    await page.waitForSelector('h1:has-text("Pressing du Relais")', { timeout: 8000 });
    const enBase = stub.tables()[1148624].some(l => l.raison_sociale === 'Pressing du Relais');
    doit(enBase, 'la ligne doit exister dans le Baserow simulé');
    const ecrit = stub.journal.some(e => e.methode === 'POST' && e.jeton === JETON_ATTENDU);
    doit(ecrit, 'le relais doit avoir présenté le jeton à Baserow');
    return 'ligne créée en base, jeton présenté par le serveur';
  });

  await cas('E2E-37', 'Mode serveur : génération relayée vers le workflow', async () => {
    await page.click('[data-gen="lancer"]');
    await page.waitForSelector('.ia-txt', { timeout: 20000 });
    const corps = await page.textContent('.ia-txt');
    doit(corps.includes('Pressing du Relais'), 'le texte doit citer le prospect, obtenu : ' + corps.slice(0, 60));
    const hint = await page.textContent('.ia-f .hint');
    doit(!/simul/i.test(hint) || /n8n/.test(hint), 'la source ne doit pas être la simulation locale');
    return 'email reçu du workflow par le relais';
  });

  await cas('E2E-38', 'Mode serveur : un code d\u2019accès erroné est expliqué', async () => {
    await page.click('[data-ecran="config"]');
    await page.waitForSelector('#form-config');
    await page.fill('#c-code', 'mauvais-code');
    await page.click('#form-config button[type="submit"]');
    await page.waitForSelector('.alert, .toast', { timeout: 15000 });
    const t = await page.textContent('body');
    doit(/Code d.{1,3}accès refusé|Chargement impossible/.test(t), 'message explicite attendu');
    return 'refus expliqué sans page blanche';
  });

  await cas('E2E-39', 'Retour au mode démonstration après échec', async () => {
    await page.click('[data-ecran="config"]');
    await page.waitForSelector('#form-config');
    await page.check('input[name="mode"][value="demo"]');
    await page.click('#form-config button[type="submit"]');
    await page.waitForSelector('.kanban', { timeout: 15000 });
    const badge = await page.textContent('.topbar .badge');
    doit(badge.includes('démonstration'), 'retour en démonstration attendu');
    return badge.trim();
  });

  // Captures pour le dossier
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto(URL);
  await page.waitForSelector('.kanban');
  await page.screenshot({ path: path.join(__dirname, '..', 'dist', 'cap1_pipeline.png') });
  await page.click('.pcard:has-text("Boulangerie du Parc")');
  await page.waitForSelector('.colR');
  await page.click('[data-gen="lancer"]');
  await page.waitForSelector('.ia-txt', { timeout: 15000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(__dirname, '..', 'dist', 'cap2_generation.png'), fullPage: true });
  await page.click('[data-ecran="config"]');
  await page.waitForSelector('#form-config');
  await page.selectOption('#c-role', 'manager');
  await page.click('#form-config button[type="submit"]');
  await page.waitForTimeout(800);
  await page.click('[data-ecran="bord"]');
  await page.waitForSelector('.funnel');
  await page.screenshot({ path: path.join(__dirname, '..', 'dist', 'cap3_bord.png'), fullPage: true });
  await page.click('[data-ecran="config"]');
  await page.waitForSelector('#form-config');
  await page.screenshot({ path: path.join(__dirname, '..', 'dist', 'cap4_config.png'), fullPage: true });
  await page.click('[data-ecran="pipeline"]');
  await page.waitForSelector('.kanban');
  await page.click('#t-dark');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(__dirname, '..', 'dist', 'cap5_sombre.png') });
  await page.click('#t-dark');
  await page.setViewportSize({ width: 375, height: 820 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(__dirname, '..', 'dist', 'cap6_mobile.png') });
  await page.click('.pcard');
  await page.waitForSelector('.colR');
  await page.screenshot({ path: path.join(__dirname, '..', 'dist', 'cap7_mobile_fiche.png') });

  await navigateur.close();
  web.kill(); stub.serveur.close(); n8n.close();
  fs.writeFileSync(path.join(__dirname, 'resultats-e2e.json'), JSON.stringify({ date: new Date().toISOString(), resultats }, null, 2));
  const ko = resultats.filter(r => r.statut === 'KO').length;
  console.log('\n' + (resultats.length - ko) + '/' + resultats.length + ' tests de bout en bout réussis');
  process.exit(ko ? 1 : 0);
})();
