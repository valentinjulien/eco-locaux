/* ============================================================
   Couche d'accès aux données — trois modes, une seule interface.

   demo      : extrait réel figé, écritures en mémoire, aucun réseau
   serveur   : appels relayés par les fonctions Vercel (/api/…)
               → le jeton Baserow et la clé n8n restent côté serveur
   connecte  : appels directs à Baserow depuis le navigateur
               → le jeton est dans le navigateur, à réserver au poste
                 d'un commercial, jamais à un déploiement public

   Les trois traversent le même mapping (core.js) : l'interface ne
   sait pas lequel est actif.
   ============================================================ */

const CFG_CLE = 'ecolocaux.config.v2';

const CFG_DEFAUT = {
  mode: 'demo',                       // 'demo' | 'serveur' | 'connecte'
  baserowUrl: 'https://api.baserow.io',
  token: '',                          // mode connecte uniquement
  codeAcces: '',                      // mode serveur : vérifié par les fonctions Vercel
  tables: { prospect: 1148624, typeCommerce: 1148622, commercial: 1148623, interaction: 1148625, secteur: 1148621 },
  webhook: '',                        // mode connecte uniquement
  webhookCle: '',
  role: 'commercial',
  commercialId: 2,
  tempsReponseSimule: 1400,
};

function chargerConfig() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem(CFG_CLE) || '{}'); } catch (e) { c = {}; }
  return { ...CFG_DEFAUT, ...c, tables: { ...CFG_DEFAUT.tables, ...(c.tables || {}) } };
}
function enregistrerConfig(c) {
  try { localStorage.setItem(CFG_CLE, JSON.stringify(c)); return true; } catch (e) { return false; }
}

// Détecte si l'application est servie par un serveur (donc si /api/ existe)
function servieParUnServeur() {
  return typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
}

// ------------------------------------------------------------------
// Mode connecté : appels directs à Baserow
// ------------------------------------------------------------------
class ApiBaserow {
  constructor(cfg) { this.cfg = cfg; }
  get entetes() { return { 'Authorization': 'Token ' + this.cfg.token, 'Content-Type': 'application/json' }; }
  url(table, suffixe) {
    return this.cfg.baserowUrl.replace(/\/$/, '') + '/api/database/rows/table/' + table + '/' + (suffixe || '') + '?user_field_names=true';
  }
  async lire(table, taille) {
    const sortie = [];
    let page = 1, suite = true;
    while (suite && page <= 25) {
      const r = await fetch(this.url(table) + '&size=' + (taille || 200) + '&page=' + page, { headers: this.entetes });
      if (!r.ok) throw new Error(messageHttp(r.status, table));
      const j = await r.json();
      sortie.push(...(j.results || []));
      suite = !!j.next; page++;
    }
    return sortie;
  }
  async creer(table, champs) {
    const r = await fetch(this.url(table), { method: 'POST', headers: this.entetes, body: JSON.stringify(champs) });
    if (!r.ok) throw new Error(messageHttp(r.status, table, 'création'));
    return r.json();
  }
  async modifier(table, id, champs) {
    const r = await fetch(this.url(table, id + '/'), { method: 'PATCH', headers: this.entetes, body: JSON.stringify(champs) });
    if (!r.ok) throw new Error(messageHttp(r.status, table, 'modification'));
    return r.json();
  }
  async supprimer(table, id) {
    const r = await fetch(this.url(table, id + '/'), { method: 'DELETE', headers: this.entetes });
    if (!r.ok && r.status !== 204) throw new Error(messageHttp(r.status, table, 'suppression'));
    return true;
  }
}

function messageHttp(statut, table, operation) {
  const quoi = operation ? 'La ' + operation + ' a été refusée' : 'La lecture a été refusée';
  if (statut === 401) return quoi + ' : jeton Baserow refusé.';
  if (statut === 403) return quoi + " : le jeton n'a pas ce droit sur la table " + table + '.';
  if (statut === 404) return quoi + ' : table ' + table + ' introuvable.';
  if (statut === 400) return quoi + ' : un champ envoyé ne correspond pas au schéma.';
  return quoi + ' (code ' + statut + ').';
}

// ------------------------------------------------------------------
// Mode serveur : tout passe par les fonctions Vercel
// ------------------------------------------------------------------
class ApiProxy {
  constructor(cfg) { this.cfg = cfg; this.base = '/api/baserow'; }
  get entetes() {
    const e = { 'Content-Type': 'application/json' };
    if (this.cfg.codeAcces) e['X-Code-Acces'] = this.cfg.codeAcces;
    return e;
  }
  async appeler(corps) {
    const r = await fetch(this.base, { method: 'POST', headers: this.entetes, body: JSON.stringify(corps) });
    let j = null;
    try { j = await r.json(); } catch (e) { j = null; }
    if (!r.ok) {
      const m = (j && (j.message || j.erreur)) || ('Le serveur a répondu ' + r.status);
      throw new Error(m);
    }
    return j;
  }
  async lire(table) { return (await this.appeler({ action: 'lire', table })).resultats; }
  async creer(table, champs) { return (await this.appeler({ action: 'creer', table, champs })).ligne; }
  async modifier(table, id, champs) { return (await this.appeler({ action: 'modifier', table, id, champs })).ligne; }
  async supprimer(table, id) { await this.appeler({ action: 'supprimer', table, id }); return true; }
}

// ------------------------------------------------------------------
// Mode démonstration
// ------------------------------------------------------------------
class ApiDemo {
  constructor(cfg) {
    this.cfg = cfg;
    this.lignes = {
      [cfg.tables.prospect]: JSON.parse(JSON.stringify(DEMO_PROSPECTS)),
      [cfg.tables.typeCommerce]: JSON.parse(JSON.stringify(DEMO_TYPES)),
      [cfg.tables.commercial]: JSON.parse(JSON.stringify(DEMO_COMMERCIAUX)),
      [cfg.tables.interaction]: JSON.parse(JSON.stringify(DEMO_INTERACTIONS)),
      [cfg.tables.secteur]: [],
    };
    this.prochainId = 1000;
  }
  async pause(ms) { return new Promise(r => setTimeout(r, ms || 180)); }
  async lire(table) { await this.pause(); return JSON.parse(JSON.stringify(this.lignes[table] || [])); }
  async creer(table, champs) {
    await this.pause();
    const ligne = { id: ++this.prochainId, ...this._versDemo(table, champs) };
    (this.lignes[table] = this.lignes[table] || []).push(ligne);
    return ligne;
  }
  async modifier(table, id, champs) {
    await this.pause();
    const l = (this.lignes[table] || []).find(x => x.id === id);
    if (!l) throw new Error('Ligne ' + id + ' introuvable');
    Object.assign(l, this._versDemo(table, champs));
    return l;
  }
  async supprimer(table, id) {
    await this.pause();
    this.lignes[table] = (this.lignes[table] || []).filter(x => x.id !== id);
    return true;
  }
  _versDemo(table, champs) {
    const out = { ...champs };
    const selects = { statut_vente: 1, Source_consentement: 1, type_interaction: 1 };
    for (const k of Object.keys(out)) {
      if (selects[k] && typeof out[k] === 'string') out[k] = { id: 0, value: out[k] };
      if (['type_commerce', 'secteur', 'commercial', 'prospect'].includes(k) && Array.isArray(out[k])) {
        const refs = { type_commerce: this.cfg.tables.typeCommerce, secteur: this.cfg.tables.secteur,
          commercial: this.cfg.tables.commercial, prospect: this.cfg.tables.prospect };
        const champNom = { type_commerce: 'nom_type', secteur: 'nom_secteur', commercial: 'nom', prospect: 'raison_sociale' };
        out[k] = out[k].map(id => {
          const src = (this.lignes[refs[k]] || []).find(x => x.id === id);
          return { id, value: src ? src[champNom[k]] : '' };
        });
        if (k === 'type_commerce') out.type_commerce_nom = out[k];
        if (k === 'commercial') out.commercial_nom = out[k];
        if (k === 'secteur') out.secteur_nom = out[k];
        if (k === 'prospect') out.prospect_raison = out[k];
      }
    }
    return out;
  }
}

function construireApi(cfg) {
  if (cfg.mode === 'serveur') return new ApiProxy(cfg);
  if (cfg.mode === 'connecte' && cfg.token) return new ApiBaserow(cfg);
  return new ApiDemo(cfg);
}

// ------------------------------------------------------------------
// Génération de l'email
// ------------------------------------------------------------------
async function appelerGeneration(cfg, payload) {
  if (cfg.mode === 'serveur') {
    const entetes = { 'Content-Type': 'application/json' };
    if (cfg.codeAcces) entetes['X-Code-Acces'] = cfg.codeAcces;
    const r = await fetch('/api/generer-email', { method: 'POST', headers: entetes, body: JSON.stringify(payload) });
    let j = null;
    try { j = await r.json(); } catch (e) { j = null; }
    if (!r.ok) throw new Error((j && (j.message || j.erreur)) || ('Le serveur a répondu ' + r.status));
    return { ...j, source: 'n8n' };
  }

  if (cfg.mode === 'connecte' && cfg.webhook) {
    const entetes = { 'Content-Type': 'application/json' };
    if (cfg.webhookCle) entetes['X-Api-Key'] = cfg.webhookCle;
    const ctrl = new AbortController();
    const minuteur = setTimeout(() => ctrl.abort(), 45000);
    try {
      const r = await fetch(cfg.webhook, { method: 'POST', headers: entetes, body: JSON.stringify(payload), signal: ctrl.signal });
      clearTimeout(minuteur);
      if (!r.ok) throw new Error('Le workflow a répondu ' + r.status);
      const j = await r.json();
      return { ...j, source: 'n8n' };
    } catch (e) {
      clearTimeout(minuteur);
      throw new Error(e.name === 'AbortError'
        ? "Le workflow n'a pas répondu en 45 secondes."
        : 'Workflow injoignable : ' + e.message);
    }
  }

  await new Promise(r => setTimeout(r, cfg.tempsReponseSimule || 1400));
  return { ...redigerLocalement(payload), source: 'demo' };
}

// Genre grammatical par métier : une heuristique sur la voyelle initiale
// donnait « une pressing ». La table est explicite.
const GENRE = { boulangerie: 'f', laverie: 'f', poissonnerie: 'f', boucherie: 'f', pizzeria: 'f', boutique: 'f',
  pressing: 'm', restaurant: 'm', 'supermarché': 'm', bureau: 'm', 'entrepôt': 'm' };

// Rédaction locale de secours (mode démonstration) : phrases construites à
// partir de la fiche énergie. Ce n'est pas un modèle de langage, et
// l'interface l'affiche clairement comme une simulation.
function redigerLocalement(p) {
  const nom = p.prospect.raison_sociale;
  const ville = p.prospect.ville ? ' à ' + p.prospect.ville : '';
  const metier = (p.fiche_energie.type || 'commerce').toLowerCase();
  const spec = p.fiche_energie.specificites || '';
  const premierPoste = spec.split(/[.;]/)[0].trim().toLowerCase() || 'vos équipements';
  const objets = {
    facture: { boulangerie: 'Vos fours tournent la nuit, votre facture aussi', pressing: 'La vapeur, premier poste de votre facture',
      laverie: 'Vos sèche-linge pèsent plus que vous ne le pensez', poissonnerie: 'Le froid tourne 24 h sur 24, la facture aussi',
      boucherie: 'Vos chambres froides ne s’arrêtent jamais', pizzeria: 'Votre four chauffe avant le premier client',
      restaurant: 'Entre deux services, vos équipements consomment' },
    equipement: { _: 'Un réglage simple sur vos équipements' },
    reglementaire: { _: 'Anticiper vos obligations énergétiques' },
  };
  const table = objets[p.parametres.angle] || objets.facture;
  const objet = table[metier] || table._ || ('Réduire la facture énergétique de votre ' + metier);
  const ouverture = p.parametres.ton === 'institutionnel' ? 'Madame, Monsieur,' : 'Bonjour,';
  const coeur = `Chez ${nom}${ville}, un poste domine la facture : ${premierPoste}. C'est presque toujours là que se joue l'essentiel de la dépense d'un${GENRE[metier] === 'f' ? 'e' : ''} ${metier}.`;
  const valeur = p.parametres.angle === 'reglementaire'
    ? "Eco-Locaux aide les commerces de proximité à anticiper les obligations liées à la rénovation énergétique et à identifier les travaux réellement utiles."
    : p.parametres.angle === 'equipement'
      ? "Eco-Locaux intervient sur le réglage et l'entretien de ces équipements, sans remplacer votre matériel."
      : "Eco-Locaux accompagne les commerces de proximité pour réduire cette dépense, avec un gain indicatif de l'ordre de 15 % selon les situations.";
  const detail = p.parametres.longueur === 'longue'
    ? " Sur un commerce comparable au vôtre, le premier diagnostic a porté sur trois réglages seulement, sans investissement."
    : '';
  const cloture = p.parametres.ton === 'direct' ? 'Quinze minutes cette semaine pour en parler ?'
    : 'Auriez-vous quinze minutes cette semaine pour en parler ?';
  const corps = `${ouverture}\n\n${coeur}\n\n${valeur}${detail}\n\n${cloture}`;
  return { objet, corps, modele: 'simulation locale (mode démonstration)' };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CFG_CLE, CFG_DEFAUT, redigerLocalement, messageHttp, servieParUnServeur };
}
