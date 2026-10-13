/* ============================================================
   Eco-Locaux Prospect — noyau métier
   Fonctions pures : mapping Baserow, score, filtres, KPIs,
   construction du payload IA et garde-fous sur la réponse.
   Ce fichier est testé en Node (tests_app.js) ET inliné dans
   l'application : une seule source, donc pas de divergence.
   ============================================================ */

// --- Schéma réel de la base Eco-Locaux (relevé le 12/10/2026) ---
const SCHEMA = {
  database: 530693,
  tables: { prospect: 1148624, typeCommerce: 1148622, commercial: 1148623, interaction: 1148625, secteur: 1148621 },
};

// Statuts tels qu'ils existent dans le champ single_select statut_vente
const STATUTS = ['nouveau', 'contacté', 'qualifié', 'proposition envoyée', 'gagné', 'perdu'];

const STATUT_META = {
  'nouveau':              { court: 'Nouveau',     cls: 'b-info',   marque: '○', couleur: '#1E40AF' },
  'contacté':             { court: 'Contacté',    cls: 'b-ok',     marque: '✓', couleur: '#166534' },
  'qualifié':             { court: 'Qualifié',    cls: 'b-ok',     marque: '★', couleur: '#166534' },
  'proposition envoyée':  { court: 'Proposition', cls: 'b-warn',   marque: '◆', couleur: '#92400E' },
  'gagné':                { court: 'Gagné',       cls: 'b-ok',     marque: '✓', couleur: '#166534' },
  'perdu':                { court: 'Perdu',       cls: 'b-err',    marque: '▲', couleur: '#991B1B' },
};

// Intensité énergétique par type de commerce : sert au score de priorisation.
// Reprend la hiérarchie établie au Livrable 2 (fonction calculerScore du workflow W1).
const INTENSITE = {
  'boulangerie': 35, 'pressing': 35, 'laverie': 30, 'boucherie': 30, 'poissonnerie': 30,
  'pizzeria': 30, 'restaurant': 25, 'supermarché': 25, 'entrepôt': 20, 'bureau': 15, 'boutique': 10,
};

// ------------------------------------------------------------------
// Normalisation
// ------------------------------------------------------------------
function norm(s) {
  return (s === null || s === undefined ? '' : String(s))
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Un champ single_select arrive en {id, value, color} ; un link_row en [{id, value}]
function val(x) {
  if (x === null || x === undefined) return null;
  if (Array.isArray(x)) return x.length ? (x[0].value ?? x[0]) : null;
  if (typeof x === 'object') return x.value ?? null;
  return x;
}
function ids(x) { return Array.isArray(x) ? x.map(e => (e && typeof e === 'object') ? e.id : e).filter(v => v != null) : []; }

// Ligne Baserow -> objet utilisé par l'interface
function mapProspect(row) {
  return {
    id: row.id,
    raison_sociale: row.raison_sociale || '(sans nom)',
    adresse: row.adresse || null,
    telephone: row.telephone || null,
    email: row.email || null,
    statut: val(row.statut_vente) || 'nouveau',
    date_creation: row.date_creation || null,
    date_dernier_contact: row.Date_dernier_contact || null,
    opt_out: row.Opt_out_prospection === true,
    date_opt_out: row.Date_opt_out || null,
    source_consentement: val(row.Source_consentement) || null,
    type_commerce: val(row.type_commerce_nom) || val(row.type_commerce) || null,
    type_commerce_id: ids(row.type_commerce)[0] ?? null,
    secteur: val(row.secteur_nom) || val(row.secteur) || null,
    secteur_id: ids(row.secteur)[0] ?? null,
    commercial: val(row.commercial_nom) || val(row.commercial) || null,
    commercial_id: ids(row.commercial)[0] ?? null,
    interaction_ids: ids(row.Interaction),
  };
}

function mapInteraction(row) {
  return {
    id: row.id,
    ref: row.interaction || ('INT-' + row.id),
    type: val(row.type_interaction) || 'email',
    date: row.date_interaction || null,
    contenu: row.contenu || '',
    resultat: row.resultat || null,
    prospect_id: ids(row.prospect)[0] ?? null,
    prospect: val(row.prospect_raison) || null,
    commercial_id: ids(row.commercial)[0] ?? null,
  };
}

function mapType(row) {
  return { id: row.id, nom: row.nom_type, specificites: row.specificites_energetiques || '' };
}
function mapCommercial(row) {
  return { id: row.id, nom: row.nom, prenom: row.prenom || '', email: row.email || null,
    affichage: ((row.prenom || '') + ' ' + (row.nom || '')).trim() };
}

// ------------------------------------------------------------------
// Score de priorisation, borné à 100
// 35 (intensité) + 25 (joignabilité) + 25 (avancement) + 15 (fraîcheur) = 100
// La base ne porte pas de champ score : il est calculé par l'interface
// à partir des données disponibles, avec le détail affiché pour rester
// explicable (exigence de transparence du Livrable 1C).
// ------------------------------------------------------------------
function calculerScore(p, aujourdhui) {
  const today = aujourdhui ? new Date(aujourdhui) : new Date();
  const d = {};
  d.intensite = INTENSITE[norm(p.type_commerce)] ?? 10;
  d.joignabilite = (p.telephone ? 12 : 0) + (p.email ? 13 : 0); // 25 max : l'email conditionne la génération
  const av = { 'qualifié': 25, 'proposition envoyée': 20, 'contacté': 15, 'nouveau': 10, 'gagné': 0, 'perdu': 0 };
  d.avancement = av[p.statut] ?? 0;
  let jours = null;
  if (p.date_dernier_contact) jours = Math.floor((today - new Date(p.date_dernier_contact)) / 86400000);
  d.fraicheur = jours === null ? 0 : (jours <= 14 ? 15 : jours <= 30 ? 10 : jours <= 60 ? 5 : 0);
  if (p.opt_out) return { score: 0, classe: 'C', detail: d, jours_sans_contact: jours, bloque: true };
  const score = d.intensite + d.joignabilite + d.avancement + d.fraicheur;
  return { score, classe: score >= 70 ? 'A' : score >= 45 ? 'B' : 'C', detail: d, jours_sans_contact: jours, bloque: false };
}

// Un prospect est-il relançable ? (règle RGPD du Livrable 1C)
function peutProspecter(p) {
  if (p.opt_out) return { ok: false, motif: 'Ce prospect s’est opposé à la prospection le ' + (p.date_opt_out || 'date non renseignée') + '.' };
  if (p.statut === 'perdu') return { ok: false, motif: 'Ce prospect est au statut « perdu ».' };
  if (!p.email) return { ok: false, motif: 'Aucune adresse email enregistrée pour ce prospect.' };
  return { ok: true, motif: null };
}

// ------------------------------------------------------------------
// Recherche et filtres
// ------------------------------------------------------------------
function filtrer(prospects, f) {
  f = f || {};
  const q = norm(f.q || '');
  return prospects.filter(p => {
    if (q) {
      const cible = [p.raison_sociale, p.type_commerce, p.secteur, p.commercial, p.adresse, p.email, p.telephone]
        .map(norm).join(' | ');
      // Correspondance en début de mot : « le » ne doit pas ramener « Métropole »
      const correspond = (mot) => new RegExp('(^|[^a-z0-9])' + mot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(cible);
      if (!q.split(/\s+/).filter(Boolean).every(correspond)) return false;
    }
    if (f.statut && f.statut.length && !f.statut.includes(p.statut)) return false;
    if (f.type && f.type.length && !f.type.includes(p.type_commerce)) return false;
    if (f.secteur && f.secteur.length && !f.secteur.includes(p.secteur)) return false;
    if (f.commercial && f.commercial.length && !f.commercial.includes(p.commercial)) return false;
    if (f.classe && f.classe.length && !f.classe.includes(p._score.classe)) return false;
    if (f.sans_email && p.email) return false;
    if (f.opt_out_exclu && p.opt_out) return false;
    if (f.a_relancer) {
      const j = p._score.jours_sans_contact;
      if (j === null || j < 30 || p.opt_out || ['gagné', 'perdu'].includes(p.statut)) return false;
    }
    return true;
  });
}

function trier(prospects, cle) {
  const c = [...prospects];
  if (cle === 'score') c.sort((a, b) => b._score.score - a._score.score);
  else if (cle === 'nom') c.sort((a, b) => a.raison_sociale.localeCompare(b.raison_sociale, 'fr'));
  else if (cle === 'recent') c.sort((a, b) => String(b.date_creation || '').localeCompare(String(a.date_creation || '')));
  else if (cle === 'relance') c.sort((a, b) => (b._score.jours_sans_contact ?? -1) - (a._score.jours_sans_contact ?? -1));
  return c;
}

// ------------------------------------------------------------------
// Indicateurs du tableau de bord
// ------------------------------------------------------------------
function kpis(prospects, interactions, aujourdhui) {
  const today = aujourdhui ? new Date(aujourdhui) : new Date();
  const il_y_a = (n) => new Date(today.getTime() - n * 86400000).toISOString().slice(0, 10);
  const j30 = il_y_a(30);
  const actifs = prospects.filter(p => !['gagné', 'perdu'].includes(p.statut));
  const parStatut = {};
  for (const s of STATUTS) parStatut[s] = prospects.filter(p => p.statut === s).length;
  const gagnes = parStatut['gagné'] || 0;
  const perdus = parStatut['perdu'] || 0;
  const contactes = prospects.filter(p => p.statut !== 'nouveau').length;
  const emails = (interactions || []).filter(i => i.type === 'email');
  const emails30 = emails.filter(i => i.date && i.date >= j30);
  const compte = (arr, f) => arr.reduce((m, x) => { const k = f(x) || 'Non renseigné'; m[k] = (m[k] || 0) + 1; return m; }, {});
  return {
    total: prospects.length,
    actifs: actifs.length,
    nouveaux_30j: prospects.filter(p => p.date_creation && p.date_creation >= j30).length,
    par_statut: parStatut,
    par_type: compte(prospects, p => p.type_commerce),
    par_secteur: compte(prospects, p => p.secteur),
    par_commercial: compte(prospects, p => p.commercial),
    par_classe: compte(prospects, p => p._score.classe),
    gagnes, perdus,
    taux_conversion: contactes ? Math.round(gagnes / contactes * 1000) / 10 : null,
    a_relancer: prospects.filter(p => {
      const j = p._score.jours_sans_contact;
      return j !== null && j >= 30 && !p.opt_out && !['gagné', 'perdu'].includes(p.statut);
    }).length,
    opt_out: prospects.filter(p => p.opt_out).length,
    sans_email: prospects.filter(p => !p.email).length,
    emails_generes: emails.length,
    emails_generes_30j: emails30.length,
    score_moyen: prospects.length
      ? Math.round(prospects.reduce((s, p) => s + p._score.score, 0) / prospects.length)
      : 0,
  };
}

// ------------------------------------------------------------------
// Génération de l'email : payload envoyé au workflow n8n
// ------------------------------------------------------------------
const TONS = {
  direct:      { libelle: 'Direct',       consigne: 'Ton direct et factuel. Phrases courtes. Aller droit au bénéfice chiffré.' },
  chaleureux:  { libelle: 'Chaleureux',   consigne: 'Ton chaleureux et proche, vocabulaire simple, sans familiarité excessive.' },
  institutionnel: { libelle: 'Institutionnel', consigne: 'Ton institutionnel et sobre, adapté à une structure plus grande.' },
};
const LONGUEURS = {
  courte:  { libelle: 'Courte',  consigne: 'Accroche de 40 à 60 mots.', min: 30, max: 75 },
  moyenne: { libelle: 'Moyenne', consigne: 'Accroche de 60 à 90 mots.', min: 45, max: 110 },
  longue:  { libelle: 'Longue',  consigne: 'Accroche de 90 à 130 mots, avec un exemple concret.', min: 70, max: 160 },
};
const ANGLES = {
  facture:     { libelle: 'Réduction de facture', consigne: 'Angle principal : la baisse de la facture énergétique.' },
  equipement:  { libelle: 'Équipements',          consigne: 'Angle principal : le réglage et l’entretien des équipements du métier.' },
  reglementaire:{ libelle: 'Obligations',          consigne: 'Angle principal : anticiper les obligations et aides liées à la rénovation énergétique, sans promettre d’aide précise.' },
};

function payloadGeneration(p, type, params, commercial) {
  params = params || {};
  const ton = TONS[params.ton] ? params.ton : 'chaleureux';
  const longueur = LONGUEURS[params.longueur] ? params.longueur : 'moyenne';
  const angle = ANGLES[params.angle] ? params.angle : 'facture';
  return {
    prospect: {
      id: p.id,
      raison_sociale: p.raison_sociale,
      type_commerce: p.type_commerce,
      ville: villeDepuisAdresse(p.adresse),
      statut: p.statut,
      // Minimisation RGPD : on transmet la présence des coordonnées, jamais leur valeur
      telephone_disponible: !!p.telephone,
      email_disponible: !!p.email,
      // Le drapeau d'opposition est transmis pour que le workflow refuse aussi
      // de son côté : l'interface n'est pas le seul garde-fou.
      opt_out: !!p.opt_out,
      jours_sans_contact: p._score ? p._score.jours_sans_contact : null,
    },
    fiche_energie: { type: type ? type.nom : p.type_commerce, specificites: type ? type.specificites : '' },
    parametres: {
      ton, ton_consigne: TONS[ton].consigne,
      longueur, longueur_consigne: LONGUEURS[longueur].consigne,
      angle, angle_consigne: ANGLES[angle].consigne,
      regenere: !!params.regenere,
    },
    commercial: commercial ? { id: commercial.id, nom: commercial.affichage } : null,
    demande_le: new Date().toISOString(),
  };
}

function villeDepuisAdresse(adresse) {
  if (!adresse) return null;
  const m = String(adresse).match(/\b\d{5}\s+([^,]+)$/);
  return m ? m[1].trim() : null;
}

// ------------------------------------------------------------------
// Garde-fous sur la réponse du workflow (reprend la logique du Livrable 2)
// ------------------------------------------------------------------
function validerReponseIA(reponse, contexte) {
  const anomalies = [];
  if (!reponse || typeof reponse !== 'object') return { valide: false, anomalies: [{ gravite: 'majeure', code: 'REPONSE_VIDE', detail: 'Aucune réponse exploitable' }] };
  const objet = (reponse.objet || '').trim();
  const corps = (reponse.corps || reponse.accroche || '').trim();
  if (!objet) anomalies.push({ gravite: 'majeure', code: 'OBJET_MANQUANT', detail: 'objet' });
  if (!corps) anomalies.push({ gravite: 'majeure', code: 'CORPS_MANQUANT', detail: 'corps' });
  if (anomalies.length) return { valide: false, anomalies, objet, corps };

  const texte = objet + ' ' + corps;
  const n = norm(texte);
  const mots = corps.split(/\s+/).filter(Boolean).length;
  const bornes = LONGUEURS[(contexte && contexte.longueur) || 'moyenne'];
  if (mots < bornes.min || mots > bornes.max) {
    anomalies.push({ gravite: 'mineure', code: 'LONGUEUR', detail: mots + ' mots (attendu ' + bornes.min + ' à ' + bornes.max + ')' });
  }
  for (const promesse of ['garanti', '100 %', '100%', 'sans aucun risque', 'economies certaines']) {
    if (n.includes(promesse)) anomalies.push({ gravite: 'majeure', code: 'PROMESSE_INTERDITE', detail: promesse });
  }
  const horsSujet = {
    'pressing': ['four a pain', 'petrin', 'fournil'],
    'laverie': ['petrin', 'fournil', 'solvant'],
    'boulangerie': ['solvant', 'nettoyage a sec', 'perchlo'],
    'poissonnerie': ['four a pain', 'solvant'],
    'boucherie': ['four a pain', 'solvant'],
  };
  for (const mot of (horsSujet[norm(contexte && contexte.type_commerce)] || [])) {
    if (n.includes(mot)) anomalies.push({ gravite: 'majeure', code: 'HORS_SUJET_METIER', detail: mot });
  }
  if (/(\+33|0)[1-9](\s?\d{2}){4}/.test(texte)) anomalies.push({ gravite: 'majeure', code: 'COORDONNEES_INVENTEES', detail: 'numéro de téléphone' });
  const pourcents = [...texte.matchAll(/(\d{1,3})\s?%/g)].map(m => Number(m[1]));
  if (pourcents.some(x => x > 30)) anomalies.push({ gravite: 'majeure', code: 'CHIFFRE_EXCESSIF', detail: 'pourcentage supérieur à 30 %' });
  const nom = norm(contexte && contexte.raison_sociale || '');
  const motCle = nom.split(' ').filter(m => m.length >= 4).sort((a, b) => b.length - a.length)[0];
  if (motCle && !n.includes(motCle)) anomalies.push({ gravite: 'mineure', code: 'PERSONNALISATION', detail: 'le nom du commerce n’est pas cité' });

  const majeures = anomalies.filter(a => a.gravite === 'majeure').length;
  const confiance = Math.max(1, 5 - majeures * 2 - anomalies.filter(a => a.gravite === 'mineure').length);
  return { valide: majeures === 0, anomalies, objet, corps, confiance };
}

// Référence lisible pour la ligne Interaction créée après une génération
function refInteraction(date) {
  const d = date ? new Date(date) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return 'EMAIL-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SCHEMA, STATUTS, STATUT_META, INTENSITE, TONS, LONGUEURS, ANGLES,
    norm, val, ids, mapProspect, mapInteraction, mapType, mapCommercial, calculerScore, peutProspecter,
    filtrer, trier, kpis, payloadGeneration, villeDepuisAdresse, validerReponseIA, refInteraction };
}
