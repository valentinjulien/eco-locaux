/* ============================================================
   Tests de la logique du rapport hebdomadaire (W7).

   Les lignes d'entrée sont au format brut de Baserow, comme le
   nœud HTTP du workflow les reçoit : listes déroulantes en objet,
   liens en tableau.

   Exécution : npm run test:rapport
   ============================================================ */

const { rapportComplet } = require('../scripts/rapport-hebdo.js');
const { DEMO_PROSPECTS, DEMO_INTERACTIONS } = require('../public/js/demo.js');

const resultats = [];
function cas(id, titre, fn) {
  try { const d = fn(); resultats.push({ id, titre, statut: 'OK', detail: d || '' });
    console.log('OK  ', id, titre, d ? '— ' + d : ''); }
  catch (e) { resultats.push({ id, titre, statut: 'KO', detail: e.message });
    console.log('KO  ', id, titre, '—', e.message); }
}
function doit(c, m) { if (!c) throw new Error(m); }

// Mardi 13 octobre 2026. Semaine passée : lundi 5 → dimanche 11.
// Semaine en cours : lundi 12 → dimanche 18.
const AUJ = '2026-10-13';

const prospect = (o) => Object.assign({
  id: 1, raison_sociale: 'Commerce test', adresse: '1 rue des Lilas, 33000 Bordeaux',
  statut_vente: { id: 1, value: 'contacté' }, type_commerce_nom: [{ id: 1, value: 'Boulangerie' }],
  commercial_nom: [{ id: 1, value: 'Camille Roux' }], email: 'contact@test.fr',
  date_creation: '2020-01-01', Date_dernier_contact: null, Opt_out_prospection: false,
}, o);

const interaction = (o) => Object.assign({
  id: 1, type_interaction: { id: 1, value: 'appel' }, date_interaction: '2026-10-07', resultat: '',
}, o);

cas('RAP-01', 'Bornes de semaine calculées depuis un mardi', () => {
  const r = rapportComplet([], [], AUJ);
  doit(r.bornes.lundiPasse === '2026-10-05', 'lundi passé : ' + r.bornes.lundiPasse);
  doit(r.bornes.dimanchePasse === '2026-10-11', 'dimanche passé : ' + r.bornes.dimanchePasse);
  doit(r.bornes.lundiCourant === '2026-10-12', 'lundi courant : ' + r.bornes.lundiCourant);
  return '05→11 octobre, semaine à venir 12→18';
});

cas('RAP-02', 'Un prospect créé la semaine passée apparaît', () => {
  const r = rapportComplet([
    prospect({ id: 1, raison_sociale: 'Dans la semaine', date_creation: '2026-10-07' }),
    prospect({ id: 2, raison_sociale: 'Trop ancien', date_creation: '2026-10-04' }),
    prospect({ id: 3, raison_sociale: 'Cette semaine', date_creation: '2026-10-12' }),
  ], [], AUJ);
  doit(r.sections.crees.length === 1, r.sections.crees.length + ' au lieu de 1');
  doit(r.sections.crees[0].raison_sociale === 'Dans la semaine', 'mauvais prospect retenu');
  return 'bornes inclusives au bon endroit';
});

cas('RAP-03', 'Une affaire gagnée la semaine passée apparaît', () => {
  const r = rapportComplet([
    prospect({ id: 1, statut_vente: { value: 'gagné' }, Date_dernier_contact: '2026-10-08' }),
    prospect({ id: 2, statut_vente: { value: 'gagné' }, Date_dernier_contact: '2026-09-01' }),
    prospect({ id: 3, statut_vente: { value: 'qualifié' }, Date_dernier_contact: '2026-10-08' }),
  ], [], AUJ);
  doit(r.sections.gagnes.length === 1, r.sections.gagnes.length + ' au lieu de 1');
  return 'statut et date tous deux exigés';
});

cas('RAP-04', 'Relance due cette semaine : 30 jours après le dernier contact', () => {
  // 2026-09-13 + 30 j = 2026-10-13, dans la semaine du 12 au 18
  const r = rapportComplet([
    prospect({ id: 1, raison_sociale: 'Due mardi', Date_dernier_contact: '2026-09-13' }),
    prospect({ id: 2, raison_sociale: 'Due la semaine prochaine', Date_dernier_contact: '2026-09-25' }),
  ], [], AUJ);
  doit(r.sections.aRelancer.length === 1, r.sections.aRelancer.length + ' au lieu de 1');
  doit(r.sections.aRelancer[0].quand === '2026-10-13', 'date calculée : ' + r.sections.aRelancer[0].quand);
  return 'échéance au 13/10';
});

cas('RAP-05', 'Relances en retard, triées du plus ancien au plus récent', () => {
  const r = rapportComplet([
    prospect({ id: 1, raison_sociale: 'Un peu en retard', Date_dernier_contact: '2026-09-10' }),
    prospect({ id: 2, raison_sociale: 'Très en retard', Date_dernier_contact: '2026-06-01' }),
  ], [], AUJ);
  doit(r.sections.enRetard.length === 2, r.sections.enRetard.length + ' au lieu de 2');
  doit(r.sections.enRetard[0].p.raison_sociale === 'Très en retard', 'tri incorrect');
  doit(r.sections.enRetard[0].retard > r.sections.enRetard[1].retard, 'retards mal calculés');
  return 'le plus en retard en tête (' + r.sections.enRetard[0].retard + ' jours)';
});

cas('RAP-06', 'Opposition à la prospection : exclue de toute relance', () => {
  const r = rapportComplet([
    prospect({ id: 1, Date_dernier_contact: '2026-06-01', Opt_out_prospection: true }),
    prospect({ id: 2, Date_dernier_contact: '2026-09-13', Opt_out_prospection: true }),
  ], [], AUJ);
  doit(r.sections.enRetard.length === 0, 'un prospect opposé figure dans les retards');
  doit(r.sections.aRelancer.length === 0, 'un prospect opposé figure dans les relances');
  return 'règle RGPD tenue dans les deux listes';
});

cas('RAP-07', 'Gagnés et perdus ne sont jamais relancés', () => {
  const r = rapportComplet([
    prospect({ id: 1, statut_vente: { value: 'gagné' }, Date_dernier_contact: '2026-06-01' }),
    prospect({ id: 2, statut_vente: { value: 'perdu' }, Date_dernier_contact: '2026-06-01' }),
    prospect({ id: 3, statut_vente: { value: 'nouveau' }, Date_dernier_contact: '2026-06-01' }),
  ], [], AUJ);
  doit(r.sections.enRetard.length === 1, r.sections.enRetard.length + ' au lieu de 1');
  return 'seul le prospect actif reste';
});

cas('RAP-08', 'Compteurs d’activité de la semaine passée', () => {
  const r = rapportComplet([], [
    interaction({ id: 1, date_interaction: '2026-10-07', resultat: 'À relancer' }),
    interaction({ id: 2, date_interaction: '2026-10-08', resultat: '' }),
    interaction({ id: 3, date_interaction: '2026-10-08', type_interaction: { value: 'email' }, resultat: 'Envoyé' }),
    interaction({ id: 4, date_interaction: '2026-10-09', type_interaction: { value: 'email' }, resultat: 'Généré, en attente d’envoi' }),
    interaction({ id: 5, date_interaction: '2026-10-09', type_interaction: { value: 'RDV' }, resultat: 'Proposition remise' }),
    interaction({ id: 6, date_interaction: '2026-10-02', resultat: 'Hors période' }),
  ], AUJ);
  const k = r.compteurs;
  doit(k.appels === 2, 'appels : ' + k.appels);
  doit(k.appels_aboutis === 1, 'appels avec issue notée : ' + k.appels_aboutis);
  doit(k.emails_envoyes === 1, 'emails envoyés : ' + k.emails_envoyes);
  doit(k.emails_generes === 1, 'emails générés : ' + k.emails_generes);
  doit(k.rdv === 1, 'rdv : ' + k.rdv);
  return '2 appels, 1 abouti, 1 email envoyé, 1 RDV, hors période écarté';
});

cas('RAP-09', 'Sections vides : une phrase, pas un tableau vide', () => {
  const r = rapportComplet([], [], AUJ);
  doit(r.html.includes('Aucun prospect créé'), 'message manquant pour les créations');
  doit(r.html.includes('Aucune relance en retard'), 'message manquant pour les retards');
  doit(!r.html.includes('<tbody></tbody>'), 'un tableau vide a été rendu');
  return 'quatre sections vides rendues lisibles';
});

cas('RAP-10', 'Le HTML échappe ce qui vient de la base', () => {
  const r = rapportComplet([
    prospect({ id: 1, raison_sociale: '<script>alert(1)</script>', date_creation: '2026-10-07' }),
  ], [], AUJ);
  doit(!r.html.includes('<script>'), 'une balise est passée telle quelle');
  doit(r.html.includes('&lt;script&gt;'), 'le contenu échappé est absent');
  return 'injection neutralisée';
});

cas('RAP-11', 'Objet de l’email daté de la semaine écoulée', () => {
  const r = rapportComplet([], [], AUJ);
  doit(r.sujet === 'ÉCO-LOCAUX · Bilan de la semaine du 05/10/2026', 'objet : ' + r.sujet);
  return r.sujet;
});

cas('RAP-12', 'Les 19 prospects réels passent sans incident', () => {
  const r = rapportComplet(DEMO_PROSPECTS, DEMO_INTERACTIONS, AUJ);
  doit(typeof r.html === 'string' && r.html.length > 1000, 'HTML trop court');
  doit(r.sections.enRetard.length > 0, 'aucune relance en retard sur des contacts de 2023 : suspect');
  return r.sections.enRetard.length + ' relances en retard, ' + r.compteurs.prioritaires + ' prospects prioritaires';
});

cas('RAP-13', 'Un prospect sans date de dernier contact ne fait rien planter', () => {
  const r = rapportComplet([
    prospect({ id: 1, Date_dernier_contact: null }),
    prospect({ id: 2, Date_dernier_contact: undefined }),
    prospect({ id: 3, adresse: null, Date_dernier_contact: '' }),
  ], [], AUJ);
  doit(r.sections.enRetard.length === 0 && r.sections.aRelancer.length === 0, 'relance inventée sans date');
  doit(r.html.includes('Aucune relance'), 'rendu incomplet');
  return 'absence de date traitée comme « pas de relance due »';
});

require('fs').writeFileSync(require('path').join(__dirname, 'resultats-rapport.json'),
  JSON.stringify({ date: new Date().toISOString(), resultats }, null, 2));
const ko = resultats.filter(r => r.statut === 'KO').length;
console.log('\n' + (resultats.length - ko) + '/' + resultats.length + ' tests du rapport hebdomadaire réussis');
process.exit(ko ? 1 : 0);
