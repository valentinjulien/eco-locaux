/* ============================================================
   Tests de la logique métier (noyau core.js).
   Exécution : npm test
   ============================================================ */
const C = require('../public/js/core.js');
const D = require('../public/js/demo.js');
const fs = require('fs');

const AUJ = '2026-10-12';
const prospects = D.DEMO_PROSPECTS.map(C.mapProspect).map(p => ({ ...p, _score: C.calculerScore(p, AUJ) }));
const types = D.DEMO_TYPES.map(C.mapType);
const commerciaux = D.DEMO_COMMERCIAUX.map(C.mapCommercial);
const interactions = D.DEMO_INTERACTIONS.map(C.mapInteraction);
const par = (nom) => prospects.find(p => p.raison_sociale === nom);

const cas = [
  // --- Mapping du schéma Baserow réel
  ['TA-01', 'Mapping', 'Nombre de prospects chargés', () => prospects.length, 19],
  ['TA-02', 'Mapping', 'single_select statut_vente extrait', () => par('Boulangerie du Parc').statut, 'contacté'],
  ['TA-03', 'Mapping', 'link_row type_commerce via lookup', () => par("Pressing Net'Lyon").type_commerce, 'Pressing'],
  ['TA-04', 'Mapping', 'Identifiant de lien conservé pour les écritures', () => par("Pressing Net'Lyon").type_commerce_id, 7],
  ['TA-05', 'Mapping', 'Booléen opt-out RGPD', () => par('Restaurant Le Bordeaux').opt_out, true],
  ['TA-06', 'Mapping', 'Champ vide rendu null, jamais "undefined"', () => C.mapProspect({ id: 9, raison_sociale: 'X' }).telephone, null],
  ['TA-07', 'Mapping', 'Ligne sans raison sociale ne plante pas', () => C.mapProspect({ id: 9 }).raison_sociale, '(sans nom)'],
  ['TA-08', 'Mapping', 'Ville extraite de l’adresse', () => C.villeDepuisAdresse('12 rue du Parc, 69003 Lyon'), 'Lyon'],
  ['TA-09', 'Mapping', 'Adresse absente : pas de ville inventée', () => C.villeDepuisAdresse(null), null],

  // --- Score de priorisation
  ['TA-10', 'Score', 'Pressing qualifié récent : classe A', () => par("Pressing Net'Lyon")._score.classe, 'A'],
  ['TA-11', 'Score', 'Boutique joignable mais sans activité : bas de classe B', () => par('Boulangerie du Coin')._score.score + '/' + par('Boulangerie du Coin')._score.classe, '45/B'],
  ['TA-11b', 'Score', 'Score borné à 100 sur tout le jeu de données', () => Math.max(...prospects.map(p => p._score.score)) <= 100, true],
  ['TA-12', 'Score', 'Prospect opposé : score ramené à 0', () => par('Restaurant Le Bordeaux')._score.score, 0],
  ['TA-13', 'Score', 'Prospect opposé marqué bloqué', () => par('Restaurant Le Bordeaux')._score.bloque, true],
  ['TA-14', 'Score', 'Détail du score exposé pour explicabilité', () => Object.keys(par('Boulangerie du Parc')._score.detail).join(','), 'intensite,joignabilite,avancement,fraicheur'],
  ['TA-15', 'Score', 'Jours sans contact calculés', () => par('Boulangerie du Parc')._score.jours_sans_contact, 55],

  // --- Règle RGPD
  ['TA-16', 'RGPD', 'Génération refusée si opposition', () => C.peutProspecter(par('Restaurant Le Bordeaux')).ok, false],
  ['TA-17', 'RGPD', 'Génération refusée si statut perdu', () => C.peutProspecter({ opt_out: false, statut: 'perdu', email: 'a@b.fr' }).ok, false],
  ['TA-18', 'RGPD', 'Génération refusée sans email', () => C.peutProspecter({ opt_out: false, statut: 'nouveau', email: null }).ok, false],
  ['TA-19', 'RGPD', 'Génération autorisée dans le cas nominal', () => C.peutProspecter(par('Boulangerie du Parc')).ok, true],
  ['TA-20', 'RGPD', 'Motif du refus affichable', () => C.peutProspecter(par('Restaurant Le Bordeaux')).motif.includes('opposé'), true],

  // --- Recherche et filtres
  ['TA-21', 'Recherche', 'Recherche insensible aux accents et à la casse', () => C.filtrer(prospects, { q: 'POISSONNERIE' }).length, 2],
  ['TA-22', 'Recherche', 'Recherche sur plusieurs mots', () => C.filtrer(prospects, { q: 'pressing lyon' }).length, 1],
  ['TA-23', 'Recherche', 'Recherche sur le secteur', () => C.filtrer(prospects, { q: 'bordeaux' }).length, 4],
  ['TA-24', 'Recherche', 'Recherche sans résultat', () => C.filtrer(prospects, { q: 'zzzz' }).length, 0],
  ['TA-25', 'Filtres', 'Filtre par statut', () => C.filtrer(prospects, { statut: ['nouveau'] }).length, 4],
  ['TA-26', 'Filtres', 'Filtre combiné statut et secteur', () => C.filtrer(prospects, { statut: ['contacté'], secteur: ['Lyon Centre'] }).length, 1],
  ['TA-27', 'Filtres', 'Filtre « à relancer » : actifs sans contact depuis plus de 30 jours', () => C.filtrer(prospects, { a_relancer: true }).length, 14],
  ['TA-27b', 'Filtres', 'Filtre « à relancer » exclut gagnés, perdus et oppositions', () => C.filtrer(prospects, { a_relancer: true }).every(p => !p.opt_out && !['gagné', 'perdu'].includes(p.statut)), true],
  ['TA-28', 'Filtres', 'Filtre excluant les oppositions', () => C.filtrer(prospects, { opt_out_exclu: true }).length, 17],
  ['TA-29', 'Filtres', 'Filtre par classe de score', () => C.filtrer(prospects, { classe: ['A'] }).every(p => p._score.classe === 'A'), true],
  ['TA-30', 'Tri', 'Tri par score décroissant', () => { const t = C.trier(prospects, 'score'); return t[0]._score.score >= t[t.length - 1]._score.score; }, true],
  ['TA-31', 'Tri', 'Tri alphabétique', () => C.trier(prospects, 'nom')[0].raison_sociale, 'Boucherie Bordelaise'],

  // --- Indicateurs
  ['TA-32', 'KPI', 'Total des prospects', () => C.kpis(prospects, interactions, AUJ).total, 19],
  ['TA-33', 'KPI', 'Répartition sur les 6 statuts réels', () => Object.keys(C.kpis(prospects, interactions, AUJ).par_statut).length, 6],
  ['TA-34', 'KPI', 'Comptage des gagnés', () => C.kpis(prospects, interactions, AUJ).gagnes, 3],
  ['TA-35', 'KPI', 'Taux de conversion calculé sur les contactés', () => C.kpis(prospects, interactions, AUJ).taux_conversion, 20],
  ['TA-36', 'KPI', 'Aucune division par zéro sur base vide', () => C.kpis([], [], AUJ).taux_conversion, null],
  ['TA-37', 'KPI', 'Comptage des oppositions RGPD', () => C.kpis(prospects, interactions, AUJ).opt_out, 2],
  ['TA-38', 'KPI', 'Emails générés comptés depuis les interactions', () => C.kpis(prospects, interactions, AUJ).emails_generes, 3],

  // --- Payload de génération
  ['TA-39', 'Génération', 'Coordonnées non transmises au modèle (minimisation)', () => {
    const p = par('Boulangerie du Parc');
    const pl = C.payloadGeneration(p, types.find(t => t.nom === 'Boulangerie'), {}, commerciaux[1]);
    return JSON.stringify(pl).includes('04 72 11 22 33');
  }, false],
  ['TA-40', 'Génération', 'Présence des coordonnées signalée par un booléen', () => {
    const p = par('Boulangerie du Parc');
    return C.payloadGeneration(p, null, {}, null).prospect.telephone_disponible;
  }, true],
  ['TA-41', 'Génération', 'Fiche énergie du métier jointe au payload', () => {
    const pl = C.payloadGeneration(par("Pressing Net'Lyon"), types.find(t => t.nom === 'Pressing'), {}, null);
    return pl.fiche_energie.specificites.includes('vapeur');
  }, true],
  ['TA-42', 'Génération', 'Paramètres par défaut appliqués', () => {
    const pl = C.payloadGeneration(par('Boulangerie du Parc'), null, {}, null);
    return [pl.parametres.ton, pl.parametres.longueur, pl.parametres.angle].join('/');
  }, 'chaleureux/moyenne/facture'],
  ['TA-43', 'Génération', 'Paramètre inconnu remplacé par le défaut', () => {
    return C.payloadGeneration(par('Boulangerie du Parc'), null, { ton: 'pirate' }, null).parametres.ton;
  }, 'chaleureux'],
  ['TA-44', 'Génération', 'Régénération signalée au workflow', () => {
    return C.payloadGeneration(par('Boulangerie du Parc'), null, { regenere: true }, null).parametres.regenere;
  }, true],

  // --- Garde-fous sur la réponse
  ['TA-45', 'Garde-fous', 'Réponse conforme validée', () => C.validerReponseIA(
    { objet: 'Vos fours tournent la nuit', corps: "Bonjour, à la Boulangerie du Parc vos fours montent en température dès quatre heures du matin et vos vitrines réfrigérées ne s'arrêtent jamais : c'est là que se joue l'essentiel de votre facture d'électricité. Eco-Locaux accompagne les boulangeries lyonnaises sur la programmation des cuissons et le réglage du froid, avec un gain indicatif pouvant atteindre quinze pour cent selon les situations. Auriez-vous quinze minutes cette semaine ?" },
    { longueur: 'moyenne', type_commerce: 'Boulangerie', raison_sociale: 'Boulangerie du Parc' }).valide, true],
  ['TA-46', 'Garde-fous', 'Objet manquant bloque', () => C.validerReponseIA({ corps: 'texte' }, {}).valide, false],
  ['TA-47', 'Garde-fous', 'Réponse vide gérée sans exception', () => C.validerReponseIA(null, {}).valide, false],
  ['TA-48', 'Garde-fous', 'Promesse interdite détectée', () => C.validerReponseIA(
    { objet: 'Économies garanties', corps: 'Bonjour, économies garanties pour la Boulangerie du Parc sur vos fours et vitrines réfrigérées pendant toute la saison, avec un suivi régulier de vos consommations et un bilan mensuel détaillé.' },
    { longueur: 'moyenne', type_commerce: 'Boulangerie', raison_sociale: 'Boulangerie du Parc' })
    .anomalies.some(a => a.code === 'PROMESSE_INTERDITE'), true],
  ['TA-49', 'Garde-fous', 'Vocabulaire d’un autre métier détecté', () => C.validerReponseIA(
    { objet: 'Vos fours', corps: "Bonjour, chez Pressing Net'Lyon votre four a pain consomme énormément et nous pouvons vous aider à réduire la facture grâce à un réglage simple de vos équipements de production quotidienne." },
    { longueur: 'moyenne', type_commerce: 'Pressing', raison_sociale: "Pressing Net'Lyon" })
    .anomalies.some(a => a.code === 'HORS_SUJET_METIER'), true],
  ['TA-50', 'Garde-fous', 'Numéro de téléphone inventé détecté', () => C.validerReponseIA(
    { objet: 'Test', corps: 'Bonjour, appelez-nous au 04 78 12 34 56 pour la Boulangerie du Parc et nous reviendrons vers vous rapidement avec une proposition adaptée à vos équipements de cuisson et de froid.' },
    { longueur: 'moyenne', type_commerce: 'Boulangerie', raison_sociale: 'Boulangerie du Parc' })
    .anomalies.some(a => a.code === 'COORDONNEES_INVENTEES'), true],
  ['TA-51', 'Garde-fous', 'Pourcentage excessif détecté', () => C.validerReponseIA(
    { objet: 'Test', corps: 'Bonjour, à la Boulangerie du Parc nous réduisons votre facture de 60 % dès le premier mois grâce à un réglage de vos fours et de vos vitrines réfrigérées, sans aucun investissement de votre part.' },
    { longueur: 'moyenne', type_commerce: 'Boulangerie', raison_sociale: 'Boulangerie du Parc' })
    .anomalies.some(a => a.code === 'CHIFFRE_EXCESSIF'), true],
  ['TA-52', 'Garde-fous', 'Score de confiance abaissé par une anomalie majeure', () => C.validerReponseIA(
    { objet: 'Économies garanties', corps: 'Bonjour, économies garanties pour la Boulangerie du Parc sur vos fours et vitrines réfrigérées pendant toute la saison, avec un suivi régulier de vos consommations et un bilan mensuel détaillé.' },
    { longueur: 'moyenne', type_commerce: 'Boulangerie', raison_sociale: 'Boulangerie du Parc' }).confiance <= 3, true],
  ['TA-53', 'Garde-fous', 'Longueur hors bornes signalée sans bloquer', () => { const r = C.validerReponseIA(
    { objet: 'Court', corps: 'Bonjour Boulangerie du Parc, parlons de vos fours.' },
    { longueur: 'moyenne', type_commerce: 'Boulangerie', raison_sociale: 'Boulangerie du Parc' });
    return r.valide + '|' + r.anomalies.map(a => a.code).join(','); }, 'true|LONGUEUR'],
  ['TA-54', 'Garde-fous', 'Référence d’interaction formatée', () => C.refInteraction('2026-10-12T14:32:00').startsWith('EMAIL-20261012-'), true],
];

const resultats = cas.map(([id, module, scenario, fn, attendu]) => {
  let obtenu, statut;
  try { obtenu = fn(); statut = String(obtenu) === String(attendu) ? 'OK' : 'KO'; }
  catch (e) { obtenu = 'EXCEPTION ' + e.message; statut = 'KO'; }
  return { id, module, scenario, attendu: String(attendu), obtenu: String(obtenu), statut };
});
fs.writeFileSync(require('path').join(__dirname, 'resultats-unit.json'), JSON.stringify({ date: new Date().toISOString(), node: process.version, resultats }, null, 2));
const ko = resultats.filter(r => r.statut === 'KO');
console.log(`${resultats.length - ko.length}/${resultats.length} OK`);
ko.forEach(r => console.log('KO', r.id, r.scenario, '| attendu', r.attendu, '| obtenu', r.obtenu));
