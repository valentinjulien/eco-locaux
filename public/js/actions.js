/* ============================================================
   Contrôleur : écoute des événements et écritures.
   Un seul écouteur délégué sur le document, pour que le rendu
   puisse remplacer le DOM sans réattacher quoi que ce soit.
   ============================================================ */

function copier(texte) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(texte)
      .then(() => true)
      .catch(() => copierSecours(texte));
  }
  return Promise.resolve(copierSecours(texte));
}
function copierSecours(texte) {
  try {
    const z = document.createElement('textarea');
    z.value = texte; z.setAttribute('readonly', ''); z.style.position = 'fixed'; z.style.left = '-9999px';
    document.body.appendChild(z); z.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(z);
    return ok;
  } catch (e) { return false; }
}

function emailComplet(r) { return 'Objet : ' + r.objet + '\n\n' + r.corps; }

// ------------------------------------------------------------------ génération
async function lancerGeneration(regenere) {
  const p = prospectCourant();
  if (!p) return;
  const autorise = peutProspecter(p);
  if (!autorise.ok) { notifier(autorise.motif, 'erreur'); return; }

  ETAT.generation.etat = 'encours';
  ETAT.generation.edition = false;
  rendre();
  annoncer('Rédaction de l’email en cours.');

  const type = typeDe(p);
  const moi = ETAT.commerciaux.find(c => c.id === ETAT.cfg.commercialId);
  const payload = payloadGeneration(p, type, { ...ETAT.generation.params, regenere: !!regenere }, moi);

  try {
    const reponse = await appelerGeneration(ETAT.cfg, payload);
    const controle = validerReponseIA(reponse, {
      longueur: ETAT.generation.params.longueur, type_commerce: p.type_commerce, raison_sociale: p.raison_sociale });
    if (!controle.objet || !controle.corps) throw new Error('La réponse du workflow ne contient pas d’email exploitable.');
    ETAT.generation.resultat = { objet: controle.objet, corps: controle.corps, modele: reponse.modele || '', source: reponse.source };
    ETAT.generation.controle = controle;
    ETAT.generation.etat = 'pret';
    const maj = controle.anomalies.filter(a => a.gravite === 'majeure').length;
    notifier(maj ? `Email rédigé, ${maj} point${maj > 1 ? 's' : ''} à vérifier avant envoi.` : 'Email rédigé, confiance ' + controle.confiance + ' sur 5.', maj ? 'attention' : 'succes');
  } catch (e) {
    ETAT.generation.etat = 'repos';
    notifier(e.message, 'erreur');
  }
  rendre();
}

async function enregistrerEmail() {
  const p = prospectCourant();
  const g = ETAT.generation;
  if (!p || !g.resultat) return;
  const champs = {
    interaction: refInteraction(),
    type_interaction: 'email',
    date_interaction: new Date().toISOString().slice(0, 10),
    contenu: emailComplet(g.resultat),
    resultat: 'Généré, en attente d’envoi',
    prospect: [p.id],
  };
  if (ETAT.cfg.commercialId) champs.commercial = [ETAT.cfg.commercialId];
  try {
    const ligne = await ETAT.api.creer(ETAT.cfg.tables.interaction, champs);
    ETAT.interactions.push(mapInteraction({ ...ligne, prospect: [{ id: p.id, value: p.raison_sociale }] }));
    notifier('Email enregistré dans l’historique du prospect.', 'succes');
    rendre();
  } catch (e) { notifier('Enregistrement impossible : ' + e.message, 'erreur'); }
}

// ------------------------------------------------------------------ écritures prospect
async function changerStatut(id, statut) {
  const p = ETAT.prospects.find(x => x.id === id);
  if (!p) return;
  const avant = p.statut;
  try {
    await ETAT.api.modifier(ETAT.cfg.tables.prospect, id, { statut_vente: statut });
    p.statut = statut;
    Object.assign(p, recalculer(p));
    notifier(`${p.raison_sociale} : statut « ${avant} » → « ${statut} ».`, 'succes');
    // Trace l'évolution dans l'historique, comme le prévoit le modèle du Livrable 1A
    try {
      const l = await ETAT.api.creer(ETAT.cfg.tables.interaction, {
        interaction: 'STATUT-' + new Date().toISOString().slice(0, 10),
        type_interaction: 'appel', date_interaction: new Date().toISOString().slice(0, 10),
        contenu: 'Changement de statut : ' + avant + ' → ' + statut, resultat: statut, prospect: [id] });
      ETAT.interactions.push(mapInteraction({ ...l, prospect: [{ id, value: p.raison_sociale }] }));
    } catch (e) { /* la trace est secondaire : son échec ne remet pas en cause le changement */ }
    rendre();
  } catch (e) { notifier('Changement refusé : ' + e.message, 'erreur'); rendre(); }
}

async function changerDateContact(id, date) {
  const p = ETAT.prospects.find(x => x.id === id);
  if (!p) return;
  try {
    await ETAT.api.modifier(ETAT.cfg.tables.prospect, id, { Date_dernier_contact: date || null });
    p.date_dernier_contact = date || null;
    Object.assign(p, recalculer(p));
    notifier('Date du dernier contact mise à jour.', 'succes');
    rendre();
  } catch (e) { notifier('Modification refusée : ' + e.message, 'erreur'); }
}

function validerFormulaire(f) {
  const erreurs = [];
  const nom = f.raison_sociale.value.trim();
  const type = f.type_commerce_id.value;
  const email = f.email.value.trim();
  if (!nom) erreurs.push(['e-nom', 'Indiquez la raison sociale du commerce.']);
  else if (nom.length > 120) erreurs.push(['e-nom', 'La raison sociale ne doit pas dépasser 120 caractères.']);
  if (!type) erreurs.push(['e-type', 'Choisissez un métier dans la liste : il détermine la fiche énergie utilisée.']);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) erreurs.push(['e-email', 'Cette adresse email ne semble pas valide. Exemple : contact@commerce.fr']);
  return erreurs;
}

async function soumettreProspect(f) {
  for (const id of ['e-nom', 'e-type', 'e-email']) { const z = document.getElementById(id); if (z) { z.hidden = true; z.parentElement.classList.remove('err'); } }
  const erreurs = validerFormulaire(f);
  if (erreurs.length) {
    erreurs.forEach(([id, msg]) => {
      const z = document.getElementById(id);
      if (z) { z.querySelector('span:last-child').textContent = msg; z.hidden = false; z.parentElement.classList.add('err'); }
    });
    const premier = document.getElementById(erreurs[0][0]);
    if (premier) { const champ = premier.parentElement.querySelector('.control'); if (champ) champ.focus(); }
    annoncer(erreurs.length + ' champ' + (erreurs.length > 1 ? 's' : '') + ' à corriger.');
    return;
  }

  const champs = {
    raison_sociale: f.raison_sociale.value.trim(),
    adresse: f.adresse.value.trim() || null,
    telephone: f.telephone.value.trim() || null,
    email: f.email.value.trim() || null,
    statut_vente: f.statut.value,
    Date_dernier_contact: f.date_dernier_contact.value || null,
    Opt_out_prospection: f.opt_out.checked,
    type_commerce: f.type_commerce_id.value ? [Number(f.type_commerce_id.value)] : [],
    commercial: f.commercial_id.value ? [Number(f.commercial_id.value)] : [],
  };
  if (f.opt_out.checked) champs.Date_opt_out = new Date().toISOString().slice(0, 10);

  const edition = ETAT.ecran === 'editer' && ETAT.prospectId;
  try {
    if (edition) {
      const ligne = await ETAT.api.modifier(ETAT.cfg.tables.prospect, ETAT.prospectId, champs);
      const maj = recalculer(mapProspect(ligne));
      const i = ETAT.prospects.findIndex(x => x.id === ETAT.prospectId);
      if (i >= 0) ETAT.prospects[i] = maj;
      notifier('Prospect enregistré.', 'succes');
      aller('fiche', ETAT.prospectId);
    } else {
      if (!champs.date_creation) champs.date_creation = new Date().toISOString().slice(0, 10);
      const ligne = await ETAT.api.creer(ETAT.cfg.tables.prospect, champs);
      const nouveau = recalculer(mapProspect(ligne));
      ETAT.prospects.push(nouveau);
      notifier('Prospect « ' + nouveau.raison_sociale + ' » créé.', 'succes');
      aller('fiche', nouveau.id);
    }
  } catch (e) { notifier('Enregistrement impossible : ' + e.message, 'erreur'); }
}

async function supprimerProspect(id) {
  const p = ETAT.prospects.find(x => x.id === id);
  if (!p) return;
  if (!window.confirm('Supprimer définitivement « ' + p.raison_sociale + ' » ? Cette action est irréversible.')) return;
  try {
    await ETAT.api.supprimer(ETAT.cfg.tables.prospect, id);
    ETAT.prospects = ETAT.prospects.filter(x => x.id !== id);
    notifier('Prospect supprimé.', 'succes');
    aller('pipeline');
  } catch (e) { notifier('Suppression refusée : ' + e.message, 'erreur'); }
}

// ------------------------------------------------------------------ configuration
async function testerConnexion() {
  const z = document.getElementById('res-test');
  const f = document.getElementById('form-config');
  const cfg = lireFormConfig(f);
  z.textContent = 'Test en cours…';
  if (cfg.mode === 'demo') { z.textContent = 'Mode démonstration : aucune connexion à tester.'; return; }
  if (cfg.mode === 'serveur') {
    try {
      const r = await fetch('/api/baserow', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Code-Acces': cfg.codeAcces },
        body: JSON.stringify({ action: 'diagnostic' }) });
      const j = await r.json().catch(() => null);
      if (!r.ok) { z.textContent = '▲ ' + ((j && (j.message || j.erreur)) || ('Le serveur a répondu ' + r.status)); return; }
      z.textContent = '✓ ' + (j.message || 'Le serveur répond.') + (j.webhook_configure ? ' Workflow de génération configuré.' : ' Attention : aucun workflow de génération configuré côté serveur.');
      notifier('Connexion au serveur vérifiée.', 'succes');
    } catch (e) { z.textContent = '▲ Serveur injoignable : ' + e.message; }
    return;
  }
  try {
    const api = new ApiBaserow(cfg);
    const lignes = await api.lire(cfg.tables.prospect, 1);
    let msgWh = '';
    if (cfg.webhook) {
      try {
        const r = await fetch(cfg.webhook, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cfg.webhookCle ? { 'X-Api-Key': cfg.webhookCle } : {}) }, body: JSON.stringify({ test: true }) });
        msgWh = ' Webhook : réponse ' + r.status + '.';
      } catch (e) { msgWh = ' Webhook injoignable (' + e.message + ').'; }
    }
    z.textContent = '✓ Baserow répond, ' + lignes.length + ' ligne(s) lue(s) sur la table Prospect.' + msgWh;
    notifier('Connexion Baserow vérifiée.', 'succes');
  } catch (e) {
    z.textContent = '▲ ' + e.message;
    notifier('Test échoué : ' + e.message, 'erreur');
  }
}

function lireFormConfig(f) {
  return {
    ...ETAT.cfg,
    mode: f.querySelector('input[name="mode"]:checked').value,
    baserowUrl: f.baserowUrl.value.trim() || CFG_DEFAUT.baserowUrl,
    token: f.token.value.trim(),
    codeAcces: f.codeAcces.value.trim(),
    webhook: f.webhook.value.trim(),
    webhookCle: f.webhookCle.value.trim(),
    role: f.role.value,
    commercialId: Number(f.commercialId.value) || null,
    tables: {
      prospect: Number(f.t_prospect.value) || CFG_DEFAUT.tables.prospect,
      typeCommerce: Number(f.t_typeCommerce.value) || CFG_DEFAUT.tables.typeCommerce,
      commercial: Number(f.t_commercial.value) || CFG_DEFAUT.tables.commercial,
      interaction: Number(f.t_interaction.value) || CFG_DEFAUT.tables.interaction,
      secteur: ETAT.cfg.tables.secteur,
    },
  };
}

async function appliquerConfig(f) {
  const cfg = lireFormConfig(f);
  if (cfg.mode === 'connecte' && !cfg.token) { notifier('Indiquez un jeton Baserow pour le mode direct.', 'erreur'); return; }
  if (cfg.mode === 'serveur' && !servieParUnServeur()) {
    notifier("Le mode serveur demande que l'application soit servie par un serveur. Lancez « npm run dev » ou utilisez le déploiement Vercel.", 'erreur'); return;
  }
  ETAT.cfg = cfg;
  enregistrerConfig(cfg);
  ETAT.api = construireApi(cfg);
  ETAT.pret = false;
  notifier('Configuration enregistrée.', 'succes');
  await chargerDonnees();
  aller('pipeline');
}

// ------------------------------------------------------------------ écouteurs
function brancherEvenements() {
  document.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-ecran],[data-ouvrir],[data-editer],[data-supprimer],[data-gen],[data-filtre],[data-bascule],[data-tri],[data-raz],[data-vue],[data-tester],[data-oublier],[data-fermer-notif],[data-copier-hist],#t-dark,#t-lf');
    if (!el) return;
    const d = el.dataset;

    if (el.id === 't-dark' || el.id === 't-lf') {
      const cls = el.id === 't-dark' ? 'dk' : 'lf';
      const actif = !document.body.classList.contains(cls);
      document.body.classList.toggle(cls, actif);
      el.setAttribute('aria-pressed', String(actif));
      try { localStorage.setItem('ecolocaux.' + cls, actif ? '1' : '0'); } catch (e) {}
      return;
    }
    if (d.fermerNotif) { ETAT.notifications = ETAT.notifications.filter(n => String(n.id) !== d.fermerNotif); rendreNotifications(); return; }
    if (d.ecran) { ev.preventDefault(); aller(d.ecran); return; }
    if (d.ouvrir) { aller('fiche', Number(d.ouvrir)); return; }
    if (d.editer) { aller('editer', Number(d.editer)); return; }
    if (d.supprimer) { await supprimerProspect(Number(d.supprimer)); return; }
    if (d.vue) { ETAT.vue = d.vue; rendre(); return; }
    if (d.tri) { ETAT.tri = d.tri; rendre(); return; }
    if (d.raz) {
      ETAT.filtres = { q: '', statut: [], type: [], secteur: [], commercial: [], classe: [], a_relancer: false, opt_out_exclu: false, sans_email: false, mon_portefeuille: false };
      rendre(); annoncer('Filtres effacés.'); return;
    }
    if (d.bascule) { ETAT.filtres[d.bascule] = !ETAT.filtres[d.bascule]; rendre(); return; }
    if (d.filtre) {
      const liste = ETAT.filtres[d.filtre] || [];
      ETAT.filtres[d.filtre] = liste.includes(d.valeur) ? liste.filter(v => v !== d.valeur) : [...liste, d.valeur];
      rendre(); return;
    }
    if (d.copierHist) {
      const i = ETAT.interactions.find(x => x.id === Number(d.copierHist));
      if (i) { const ok = await copier(i.contenu); notifier(ok ? 'Texte copié.' : 'Copie impossible : sélectionnez le texte manuellement.', ok ? 'succes' : 'erreur'); }
      return;
    }
    if (d.tester) { await testerConnexion(); return; }
    if (d.oublier) {
      if (!window.confirm('Effacer les réglages enregistrés sur ce poste ?')) return;
      try { localStorage.removeItem(CFG_CLE); } catch (e) {}
      ETAT.cfg = chargerConfig(); ETAT.api = construireApi(ETAT.cfg);
      notifier('Réglages effacés, retour au mode démonstration.', 'succes');
      await chargerDonnees(); aller('config'); return;
    }
    if (d.gen) {
      const g = ETAT.generation;
      if (d.gen === 'lancer') return lancerGeneration(false);
      if (d.gen === 'regenerer') return lancerGeneration(true);
      if (d.gen === 'editer') { g.edition = true; rendre(); const z = document.getElementById('ed-corps'); if (z) z.focus(); return; }
      if (d.gen === 'annuler-edition') { g.edition = false; rendre(); return; }
      if (d.gen === 'valider-edition') {
        const o = document.getElementById('ed-objet'), c = document.getElementById('ed-corps');
        g.resultat = { ...g.resultat, objet: o.value.trim(), corps: c.value, modele: (g.resultat.modele || '') + ' — modifié manuellement' };
        const p = prospectCourant();
        g.controle = validerReponseIA(g.resultat, { longueur: g.params.longueur, type_commerce: p.type_commerce, raison_sociale: p.raison_sociale });
        g.edition = false;
        notifier('Modifications enregistrées.', 'succes'); rendre(); return;
      }
      if (d.gen === 'copier') {
        const ok = await copier(emailComplet(g.resultat));
        notifier(ok ? 'Email copié dans le presse-papiers.' : 'Copie impossible : sélectionnez le texte manuellement.', ok ? 'succes' : 'erreur');
        return;
      }
      if (d.gen === 'enregistrer') return enregistrerEmail();
    }
  });

  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset && el.dataset.champ === 'q') {
      ETAT.filtres.q = el.value;
      clearTimeout(ETAT._tq);
      ETAT._tq = setTimeout(() => {
        const pos = el.selectionStart; rendre();
        const neuf = document.getElementById('q');
        if (neuf) { neuf.focus(); try { neuf.setSelectionRange(pos, pos); } catch (e) {} }
      }, 220);
    }
  });

  document.addEventListener('change', async (ev) => {
    const el = ev.target;
    if (el.dataset.statut) return changerStatut(Number(el.dataset.statut), el.value);
    if (el.dataset.datecontact) return changerDateContact(Number(el.dataset.datecontact), el.value);
    if (el.dataset.param) { ETAT.generation.params[el.dataset.param] = el.value; return; }
  });

  document.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (ev.target.id === 'form-prospect') return soumettreProspect(ev.target);
    if (ev.target.id === 'form-config') return appliquerConfig(ev.target);
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      const c = ev.target.closest('.pcard[data-ouvrir]');
      if (c) { ev.preventDefault(); aller('fiche', Number(c.dataset.ouvrir)); }
    }
    if (ev.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      const q = document.getElementById('q');
      if (q) { ev.preventDefault(); q.focus(); }
    }
  });
}

// ------------------------------------------------------------------ démarrage
async function demarrer() {
  ETAT.cfg = chargerConfig();
  // Un mode impossible dans le contexte courant retombe sur la démonstration
  if (ETAT.cfg.mode === 'connecte' && !ETAT.cfg.token) ETAT.cfg.mode = 'demo';
  if (ETAT.cfg.mode === 'serveur' && !servieParUnServeur()) ETAT.cfg.mode = 'demo';
  ETAT.api = construireApi(ETAT.cfg);
  try {
    if (localStorage.getItem('ecolocaux.dk') === '1') document.body.classList.add('dk');
    if (localStorage.getItem('ecolocaux.lf') === '1') document.body.classList.add('lf');
  } catch (e) {}
  brancherEvenements();
  await chargerDonnees();
  rendre();
}
