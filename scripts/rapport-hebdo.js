/* ============================================================
   Logique du rapport hebdomadaire Éco-Locaux.

   Ce fichier est la source de vérité du nœud « Construire le
   rapport » du workflow n8n W7 : il est testé ici, puis recopié
   dans le nœud. Il ne dépend de rien — ni de core.js, ni d'une
   bibliothèque — pour pouvoir vivre tel quel dans un nœud Code.

   Entrées : les lignes brutes de Baserow (user_field_names=true).
   Sortie  : les quatre sections, les compteurs, l'objet et le
             corps HTML de l'email.
   ============================================================ */

const JOURS_AVANT_RELANCE = 30;

// ---------- utilitaires de date, en jours pleins -------------------

function jour(d) {
  // Ramène une valeur Baserow (date ou date-heure) à 'AAAA-MM-JJ'
  if (!d) return null;
  const s = String(d);
  return s.length >= 10 ? s.slice(0, 10) : null;
}

function ajouter(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Lundi de la semaine qui contient la date donnée
function lundi(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  const j = d.getUTCDay();            // 0 = dimanche
  return ajouter(iso, j === 0 ? -6 : 1 - j);
}

function ecartJours(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

function frDate(iso) {
  if (!iso) return '—';
  const p = iso.split('-');
  return p[2] + '/' + p[1] + '/' + p[0];
}

// ---------- lecture des lignes Baserow -----------------------------

// Un single_select arrive en {id, value, color} ; un link_row en [{id, value}]
function val(x) {
  if (x === null || x === undefined) return null;
  if (Array.isArray(x)) return x.length ? (x[0] && x[0].value !== undefined ? x[0].value : x[0]) : null;
  if (typeof x === 'object') return x.value !== undefined ? x.value : null;
  return x;
}

function lireProspect(row) {
  return {
    id: row.id,
    raison_sociale: row.raison_sociale || '(sans nom)',
    ville: villeDepuisAdresse(row.adresse),
    statut: val(row.statut_vente) || 'nouveau',
    type_commerce: val(row.type_commerce_nom) || val(row.type_commerce) || '—',
    commercial: val(row.commercial_nom) || val(row.commercial) || 'non attribué',
    email: row.email || null,
    date_creation: jour(row.date_creation),
    date_dernier_contact: jour(row.Date_dernier_contact),
    opt_out: row.Opt_out_prospection === true,
  };
}

function lireInteraction(row) {
  return {
    id: row.id,
    type: (val(row.type_interaction) || '').toLowerCase(),
    date: jour(row.date_interaction),
    resultat: row.resultat || '',
  };
}

function villeDepuisAdresse(adresse) {
  if (!adresse) return '—';
  const m = String(adresse).match(/\b\d{5}\s+([^,]+)$/);
  return m ? m[1].trim() : '—';
}

// ---------- le rapport ---------------------------------------------

function construireRapport(lignesProspects, lignesInteractions, aujourdhui) {
  const auj = jour(aujourdhui) || new Date().toISOString().slice(0, 10);
  const lundiCourant = lundi(auj);
  const lundiPasse = ajouter(lundiCourant, -7);
  const dimanchePasse = ajouter(lundiCourant, -1);
  const dimancheCourant = ajouter(lundiCourant, 6);

  const prospects = (lignesProspects || []).map(lireProspect);
  const interactions = (lignesInteractions || []).map(lireInteraction);

  const dansSemainePassee = (d) => d && d >= lundiPasse && d <= dimanchePasse;

  // 1. Prospects créés la semaine passée
  const crees = prospects
    .filter(p => dansSemainePassee(p.date_creation))
    .sort((a, b) => (a.commercial + a.ville).localeCompare(b.commercial + b.ville));

  // 2. Affaires gagnées la semaine passée.
  //    La base ne date pas les changements de statut : on s'appuie sur la
  //    date du dernier contact, qui est ce qui s'en rapproche le plus.
  //    C'est une approximation, et elle est dite comme telle dans l'email.
  const gagnes = prospects
    .filter(p => p.statut === 'gagné' && dansSemainePassee(p.date_dernier_contact))
    .sort((a, b) => a.commercial.localeCompare(b.commercial));

  // Un prospect est relançable : ni gagné, ni perdu, ni opposé à la prospection
  const relancable = (p) => !p.opt_out && p.statut !== 'gagné' && p.statut !== 'perdu';
  // La base ne porte pas de date de relance : elle se déduit du dernier
  // contact, comme dans l'interface (seuil de 30 jours).
  const dateRelance = (p) => p.date_dernier_contact ? ajouter(p.date_dernier_contact, JOURS_AVANT_RELANCE) : null;

  // 3. Relances à faire dans la semaine qui commence
  const aRelancer = prospects
    .filter(p => relancable(p))
    .map(p => ({ p, quand: dateRelance(p) }))
    .filter(x => x.quand && x.quand >= lundiCourant && x.quand <= dimancheCourant)
    .sort((a, b) => a.quand.localeCompare(b.quand));

  // 4. Relances déjà en retard au lundi
  const enRetard = prospects
    .filter(p => relancable(p))
    .map(p => ({ p, quand: dateRelance(p) }))
    .filter(x => x.quand && x.quand < lundiCourant)
    .map(x => ({ ...x, retard: ecartJours(x.quand, lundiCourant) }))
    .sort((a, b) => b.retard - a.retard);

  // 5. Compteurs d'activité de la semaine passée
  const semaine = interactions.filter(i => dansSemainePassee(i.date));
  const appels = semaine.filter(i => i.type === 'appel');
  const emails = semaine.filter(i => i.type === 'email');
  const compteurs = {
    appels: appels.length,
    // « Avec réponse » : un appel dont l'issue a été notée. La base n'a pas
    // de champ dédié ; un résultat renseigné est le seul signal disponible.
    appels_aboutis: appels.filter(i => i.resultat.trim() !== '').length,
    emails_generes: emails.filter(i => /génér/i.test(i.resultat)).length,
    emails_envoyes: emails.filter(i => /envoy/i.test(i.resultat)).length,
    rdv: semaine.filter(i => i.type === 'rdv').length,
    // Remplace le « HOT_LEAD » d'Airtable, que la base ne porte pas :
    // les prospects avancés, joignables, et sans contact depuis un mois.
    prioritaires: prospects.filter(p =>
      relancable(p) && p.email &&
      (p.statut === 'qualifié' || p.statut === 'proposition envoyée') &&
      p.date_dernier_contact && ecartJours(p.date_dernier_contact, auj) >= JOURS_AVANT_RELANCE
    ).length,
  };

  return {
    bornes: { lundiPasse, dimanchePasse, lundiCourant, dimancheCourant, auj },
    sections: { crees, gagnes, aRelancer, enRetard },
    compteurs,
    sujet: 'ÉCO-LOCAUX · Bilan de la semaine du ' + frDate(lundiPasse),
    html: null,   // rempli ci-dessous
  };
}

// ---------- rendu HTML ----------------------------------------------

const C = { vert: '#3E6B22', orange: '#F28C28', encre: '#1C1917', gris: '#57534E',
  trait: '#E7E5E4', fond: '#FAFAF9' };

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function tableau(entetes, lignes, vide) {
  if (!lignes.length) {
    return '<p style="margin:8px 0 0;color:' + C.gris + ';font-style:italic">' + esc(vide) + '</p>';
  }
  const th = entetes.map(h => '<th align="left" style="padding:8px 10px;font-size:13px;color:#FFF;background:'
    + C.vert + ';font-weight:600">' + esc(h) + '</th>').join('');
  const tr = lignes.map(cols => '<tr>' + cols.map(c =>
    '<td style="padding:8px 10px;font-size:14px;border-bottom:1px solid ' + C.trait + '">' + esc(c) + '</td>'
  ).join('') + '</tr>').join('');
  return '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" '
    + 'style="border-collapse:collapse;margin-top:10px"><thead><tr>' + th + '</tr></thead><tbody>'
    + tr + '</tbody></table>';
}

function bloc(titre, contenu, note) {
  return '<h2 style="margin:28px 0 0;font-size:17px;color:' + C.encre + '">' + esc(titre) + '</h2>'
    + (note ? '<p style="margin:4px 0 0;font-size:12px;color:' + C.gris + '">' + esc(note) + '</p>' : '')
    + contenu;
}

function rendreHtml(r) {
  const b = r.bornes, s = r.sections, k = r.compteurs;

  const chiffre = (n, libelle, accent) =>
    '<td align="center" style="padding:14px 8px;border:1px solid ' + C.trait + ';background:#FFF">'
    + '<div style="font-size:26px;font-weight:700;color:' + (accent || C.vert) + '">' + n + '</div>'
    + '<div style="font-size:12px;color:' + C.gris + ';margin-top:2px">' + esc(libelle) + '</div></td>';

  const html =
    '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;background:' + C.fond
    + ';padding:24px;color:' + C.encre + '">'
    + '<div style="max-width:760px;margin:0 auto;background:#FFF;border:1px solid ' + C.trait + ';padding:28px">'
    + '<p style="margin:0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:' + C.orange + '">Éco-Locaux</p>'
    + '<h1 style="margin:6px 0 0;font-size:22px">Bilan de la semaine du ' + frDate(b.lundiPasse)
    + ' au ' + frDate(b.dimanchePasse) + '</h1>'
    + '<p style="margin:6px 0 0;font-size:13px;color:' + C.gris + '">Rapport automatique, envoyé le '
    + frDate(b.auj) + '. Semaine à venir : du ' + frDate(b.lundiCourant) + ' au ' + frDate(b.dimancheCourant) + '.</p>'

    + '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" '
    + 'style="border-collapse:collapse;margin-top:20px"><tr>'
    + chiffre(k.appels, 'appels', C.encre)
    + chiffre(k.appels_aboutis, 'avec une issue notée', C.encre)
    + chiffre(k.emails_envoyes, 'emails envoyés', C.encre)
    + chiffre(k.rdv, 'rendez-vous', C.encre)
    + chiffre(s.enRetard.length, 'relances en retard', s.enRetard.length ? '#B42318' : C.vert)
    + '</tr></table>'

    + bloc('Nouveaux prospects', tableau(
        ['Commerce', 'Ville', 'Métier', 'Commercial'],
        s.crees.map(p => [p.raison_sociale, p.ville, p.type_commerce, p.commercial]),
        'Aucun prospect créé la semaine passée.'))

    + bloc('Affaires gagnées', tableau(
        ['Commerce', 'Ville', 'Métier', 'Commercial'],
        s.gagnes.map(p => [p.raison_sociale, p.ville, p.type_commerce, p.commercial]),
        'Aucune affaire gagnée la semaine passée.'),
        'Daté à partir du dernier contact : la base ne conserve pas la date de changement de statut.')

    + bloc('À relancer cette semaine', tableau(
        ['Commercial', 'Commerce', 'Ville', 'Relance due le'],
        s.aRelancer.map(x => [x.p.commercial, x.p.raison_sociale, x.p.ville, frDate(x.quand)]),
        'Aucune relance due cette semaine.'),
        'Relance due 30 jours après le dernier contact.')

    + bloc('Relances en retard', tableau(
        ['Commercial', 'Commerce', 'Ville', 'Retard'],
        s.enRetard.map(x => [x.p.commercial, x.p.raison_sociale, x.p.ville, x.retard + ' jours']),
        'Aucune relance en retard. '))

    + '<p style="margin:26px 0 0;padding-top:14px;border-top:1px solid ' + C.trait
    + ';font-size:12px;color:' + C.gris + '">'
    + k.prioritaires + ' prospect' + (k.prioritaires > 1 ? 's' : '') + ' à traiter en priorité '
    + '(qualifiés ou avec proposition, joignables par email, sans contact depuis au moins 30 jours). '
    + 'Les prospects opposés à la prospection sont exclus de toutes les listes de relance.'
    + '</p></div></div>';

  return html;
}

function rapportComplet(lignesProspects, lignesInteractions, aujourdhui) {
  const r = construireRapport(lignesProspects, lignesInteractions, aujourdhui);
  r.html = rendreHtml(r);
  return r;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { rapportComplet, construireRapport, rendreHtml, lundi, ajouter, ecartJours, frDate };
}
