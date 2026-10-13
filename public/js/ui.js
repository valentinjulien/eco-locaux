/* ============================================================
   Eco-Locaux Prospect — interface
   Rendu des écrans et contrôleur. Reprend la maquette du
   Livrable 3A : mêmes couleurs, mêmes composants, mêmes règles
   d'accessibilité (cibles 44 px, labels visibles, forme + couleur
   + mot, focus visible, régions aria-live).
   ============================================================ */

const ETAT = {
  cfg: null, api: null, pret: false,
  prospects: [], types: [], commerciaux: [], interactions: [],
  filtres: { q: '', statut: [], type: [], secteur: [], commercial: [], classe: [], a_relancer: false, opt_out_exclu: false, sans_email: false },
  tri: 'score', vue: 'kanban', ecran: 'pipeline', prospectId: null,
  generation: { etat: 'repos', resultat: null, controle: null, params: { ton: 'chaleureux', longueur: 'moyenne', angle: 'facture' }, edition: false },
  notifications: [], chargement: false, erreur: null,
};

const $ = (sel, racine) => (racine || document).querySelector(sel);
const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? String(d) : x.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }); };
const jours = (n) => n === null || n === undefined ? '—' : n + ' j';

function annoncer(texte) { const z = $('#annonce'); if (z) z.textContent = texte; }

function notifier(texte, type) {
  const n = { id: Date.now() + Math.random(), texte, type: type || 'info' };
  ETAT.notifications.push(n);
  rendreNotifications();
  annoncer(texte);
  setTimeout(() => { ETAT.notifications = ETAT.notifications.filter(x => x.id !== n.id); rendreNotifications(); }, 6000);
}

function rendreNotifications() {
  const z = $('#notifs');
  const marque = { succes: '✓', erreur: '▲', info: '○', attention: '◆' };
  z.innerHTML = ETAT.notifications.map(n =>
    `<div class="toast t-${esc(n.type)}" role="status"><span class="m" aria-hidden="true">${marque[n.type] || '○'}</span><span>${esc(n.texte)}</span>
     <button type="button" class="toast-x" data-fermer-notif="${n.id}" aria-label="Fermer la notification">✕</button></div>`).join('');
}

// ------------------------------------------------------------------ chargement
async function chargerDonnees() {
  ETAT.chargement = true; ETAT.erreur = null; rendre();
  try {
    const t = ETAT.cfg.tables;
    const [pr, ty, co, it] = await Promise.all([
      ETAT.api.lire(t.prospect), ETAT.api.lire(t.typeCommerce), ETAT.api.lire(t.commercial), ETAT.api.lire(t.interaction),
    ]);
    ETAT.types = ty.map(mapType);
    ETAT.commerciaux = co.map(mapCommercial);
    ETAT.interactions = it.map(mapInteraction);
    ETAT.prospects = pr.map(mapProspect).map(p => ({ ...p, _score: calculerScore(p) }));
    ETAT.pret = true;
    annoncer(ETAT.prospects.length + ' prospects chargés.');
  } catch (e) {
    ETAT.erreur = e.message;
    notifier('Chargement impossible : ' + e.message, 'erreur');
  }
  ETAT.chargement = false; rendre();
}

function recalculer(p) { return { ...p, _score: calculerScore(p) }; }
function prospectCourant() { return ETAT.prospects.find(p => p.id === ETAT.prospectId) || null; }
function typeDe(p) { return ETAT.types.find(t => t.id === p.type_commerce_id || t.nom === p.type_commerce) || null; }
function interactionsDe(p) { return ETAT.interactions.filter(i => i.prospect_id === p.id).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))); }
function visibles() {
  let liste = ETAT.prospects;
  if (ETAT.cfg.role === 'commercial' && ETAT.cfg.commercialId) {
    const moi = ETAT.commerciaux.find(c => c.id === ETAT.cfg.commercialId);
    if (moi && ETAT.filtres.mon_portefeuille) liste = liste.filter(p => p.commercial_id === moi.id);
  }
  return trier(filtrer(liste, ETAT.filtres), ETAT.tri);
}

// ------------------------------------------------------------------ ossature
function navItem(cle, icone, libelle, pastille) {
  const on = ETAT.ecran === cle;
  return `<a href="#${cle}" class="${on ? 'on' : ''}" data-ecran="${cle}"${on ? ' aria-current="page"' : ''}>
    <span class="ic" aria-hidden="true">${icone}</span>${libelle}
    ${pastille ? `<span class="badge b-warn" style="margin-left:auto">${pastille}</span>` : ''}</a>`;
}

function rendreNav() {
  const k = kpis(ETAT.prospects, ETAT.interactions);
  const moi = ETAT.commerciaux.find(c => c.id === ETAT.cfg.commercialId);
  const init = moi ? (moi.prenom[0] || '') + (moi.nom[0] || '') : 'EL';
  return `<nav class="side" aria-label="Navigation principale">
    <div class="brand"><span class="brand-mark" aria-hidden="true">EL</span>
      <span class="brand-txt">Eco-Locaux<span class="brand-sub">Prospect</span></span></div>
    <div class="nav">
      ${navItem('pipeline', '▤', 'Pipeline')}
      ${navItem('nouveau', '＋', 'Nouveau prospect')}
      ${navItem('relances', '↻', 'Relances', k.a_relancer || '')}
      ${ETAT.cfg.role === 'manager' ? navItem('bord', '▦', 'Tableau de bord') : ''}
      ${navItem('config', '⚙', 'Configuration')}
    </div>
    <div class="side-foot"><span class="avatar" aria-hidden="true">${esc(init)}</span>
      <span>${esc(moi ? moi.affichage : 'Utilisateur')}<span class="r2" style="display:block">${ETAT.cfg.role === 'manager' ? 'Manager' : 'Commercial'} · ${ETAT.cfg.mode === 'demo' ? 'démonstration' : ETAT.cfg.mode === 'serveur' ? 'serveur' : 'direct'}</span></span></div>
  </nav>`;
}

function barreRecherche() {
  const n = visibles().length;
  return `<div class="recherche">
    <label class="sr-only" for="q">Rechercher un prospect</label>
    <input id="q" type="search" class="control" placeholder="Rechercher : nom, ville, métier, commercial…" value="${esc(ETAT.filtres.q)}" data-champ="q" autocomplete="off">
    <span class="rech-n" aria-live="polite">${n} résultat${n > 1 ? 's' : ''}</span>
  </div>`;
}

// ------------------------------------------------------------------ pipeline
function chipFiltre(cle, valeur, libelle) {
  const actif = (ETAT.filtres[cle] || []).includes(valeur);
  return `<button type="button" class="fchip-b ${actif ? 'on' : ''}" data-filtre="${cle}" data-valeur="${esc(valeur)}" aria-pressed="${actif}">
    <span class="tick" aria-hidden="true">${actif ? '✓' : ''}</span>${esc(libelle || valeur)}</button>`;
}

function rendrePipeline() {
  const liste = visibles();
  const k = kpis(ETAT.prospects, ETAT.interactions);
  const secteurs = [...new Set(ETAT.prospects.map(p => p.secteur).filter(Boolean))].sort();
  const typesNoms = [...new Set(ETAT.prospects.map(p => p.type_commerce).filter(Boolean))].sort();
  const nbFiltres = ['statut', 'type', 'secteur', 'classe'].reduce((s, c) => s + (ETAT.filtres[c] || []).length, 0)
    + (ETAT.filtres.a_relancer ? 1 : 0) + (ETAT.filtres.opt_out_exclu ? 1 : 0) + (ETAT.filtres.mon_portefeuille ? 1 : 0);

  return `<main class="content" id="contenu">
    <div class="page-h"><div><h1>Pipeline de prospection</h1>
      <p class="page-sub">${ETAT.prospects.length} prospects · ${k.actifs} actifs · ${k.a_relancer} à relancer${k.opt_out ? ' · ' + k.opt_out + ' en opposition' : ''}</p></div>
      <span class="sp"></span>
      <div class="seg seg-b" role="group" aria-label="Affichage">
        <button type="button" class="${ETAT.vue === 'kanban' ? 'on' : ''}" data-vue="kanban" aria-pressed="${ETAT.vue === 'kanban'}">Kanban</button>
        <button type="button" class="${ETAT.vue === 'tableau' ? 'on' : ''}" data-vue="tableau" aria-pressed="${ETAT.vue === 'tableau'}">Tableau</button>
      </div>
      <button type="button" class="btn btn-pri" data-ecran="nouveau"><span aria-hidden="true">＋</span> Nouveau prospect</button>
    </div>

    <div class="kpis">
      ${[['Prospects actifs', k.actifs, ''], ['À relancer', k.a_relancer, k.a_relancer ? 'warn' : ''],
         ['Emails générés', k.emails_generes, ''], ['Taux de conversion', k.taux_conversion === null ? '—' : k.taux_conversion + ' %', '']]
        .map(([l, v, c]) => `<div class="kpi"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div>${c ? `<div class="d ${c}">à traiter</div>` : ''}</div>`).join('')}
    </div>

    ${barreRecherche()}

    <details class="filtres-av"${nbFiltres ? ' open' : ''}>
      <summary><span class="sum-t">Filtres avancés</span>${nbFiltres ? `<span class="badge b-info">${nbFiltres} actif${nbFiltres > 1 ? 's' : ''}</span>` : ''}</summary>
      <div class="f-groupe"><span class="f-lab">Statut</span><div class="f-chips">${STATUTS.map(s => chipFiltre('statut', s, STATUT_META[s].marque + ' ' + STATUT_META[s].court)).join('')}</div></div>
      <div class="f-groupe"><span class="f-lab">Métier</span><div class="f-chips">${typesNoms.map(t => chipFiltre('type', t)).join('')}</div></div>
      <div class="f-groupe"><span class="f-lab">Secteur</span><div class="f-chips">${secteurs.map(s => chipFiltre('secteur', s)).join('')}</div></div>
      <div class="f-groupe"><span class="f-lab">Priorité</span><div class="f-chips">${['A', 'B', 'C'].map(c => chipFiltre('classe', c, 'Classe ' + c)).join('')}</div></div>
      <div class="f-groupe"><span class="f-lab">Raccourcis</span><div class="f-chips">
        <button type="button" class="fchip-b ${ETAT.filtres.a_relancer ? 'on' : ''}" data-bascule="a_relancer" aria-pressed="${!!ETAT.filtres.a_relancer}"><span class="tick" aria-hidden="true">${ETAT.filtres.a_relancer ? '✓' : ''}</span>Sans contact depuis 30 jours</button>
        <button type="button" class="fchip-b ${ETAT.filtres.opt_out_exclu ? 'on' : ''}" data-bascule="opt_out_exclu" aria-pressed="${!!ETAT.filtres.opt_out_exclu}"><span class="tick" aria-hidden="true">${ETAT.filtres.opt_out_exclu ? '✓' : ''}</span>Masquer les oppositions</button>
        <button type="button" class="fchip-b ${ETAT.filtres.mon_portefeuille ? 'on' : ''}" data-bascule="mon_portefeuille" aria-pressed="${!!ETAT.filtres.mon_portefeuille}"><span class="tick" aria-hidden="true">${ETAT.filtres.mon_portefeuille ? '✓' : ''}</span>Mon portefeuille</button>
        <button type="button" class="fchip-b" data-raz="1">Tout effacer</button>
      </div></div>
      <div class="f-groupe"><span class="f-lab">Trier par</span><div class="f-chips">
        ${[['score', 'Priorité'], ['relance', 'Ancienneté du contact'], ['recent', 'Création récente'], ['nom', 'Nom']]
          .map(([c, l]) => `<button type="button" class="fchip-b ${ETAT.tri === c ? 'on' : ''}" data-tri="${c}" aria-pressed="${ETAT.tri === c}"><span class="tick" aria-hidden="true">${ETAT.tri === c ? '✓' : ''}</span>${l}</button>`).join('')}
      </div></div>
    </details>

    ${liste.length === 0 ? etatVide() : (ETAT.vue === 'kanban' ? kanban(liste) : tableau(liste))}
  </main>`;
}

function etatVide() {
  return `<section class="card"><div class="card-b empty">
    <div class="ic" aria-hidden="true">○</div>
    <h2 style="font-size:18px;margin-bottom:6px">Aucun prospect ne correspond</h2>
    <p>Aucun prospect ne correspond à votre recherche ou à vos filtres. Effacez les filtres pour voir tout le portefeuille.</p>
    <button type="button" class="btn btn-sec" data-raz="1">Effacer les filtres</button>
  </div></section>`;
}

function carteProspect(p) {
  const m = STATUT_META[p.statut] || STATUT_META['nouveau'];
  const cls = p._score.classe.toLowerCase();
  return `<article class="pcard lv-${cls}" tabindex="0" role="button" data-ouvrir="${p.id}" aria-label="${esc(p.raison_sociale)}, ${esc(p.type_commerce || '')}, statut ${esc(p.statut)}, priorité ${esc(p._score.classe)}">
    <div class="nm">${esc(p.raison_sociale)}</div>
    <div class="me">${esc(p.type_commerce || 'Type non renseigné')} · ${esc(p.secteur || '—')}</div>
    <div class="ft">
      <span class="cls cls-${cls}" aria-hidden="true">${p._score.classe}</span>
      <span class="badge ${m.cls}">${m.marque} ${esc(m.court)}</span>
      ${p.opt_out ? '<span class="badge b-err">▲ Opposition</span>' : ''}
      <span class="sc">${p._score.score}/100</span>
    </div>
  </article>`;
}

function kanban(liste) {
  return `<div class="kanban">${STATUTS.map(s => {
    const col = liste.filter(p => p.statut === s);
    return `<section class="col" aria-label="Colonne ${esc(s)}, ${col.length} prospect${col.length > 1 ? 's' : ''}">
      <div class="col-h"><span class="t">${esc(STATUT_META[s].court)}</span><span class="n">${col.length}</span>
        <span class="bar" style="background:${STATUT_META[s].couleur}"></span></div>
      ${col.map(carteProspect).join('') || '<p class="col-vide">Aucun prospect</p>'}
    </section>`;
  }).join('')}</div>`;
}

function tableau(liste) {
  return `<section class="card"><table>
    <caption class="sr-only">Liste des prospects filtrés</caption>
    <thead><tr><th scope="col">Commerce</th><th scope="col">Métier</th><th scope="col">Secteur</th><th scope="col">Commercial</th>
      <th scope="col">Priorité</th><th scope="col">Statut</th><th scope="col">Dernier contact</th><th scope="col">Action</th></tr></thead>
    <tbody>${liste.map(p => {
      const m = STATUT_META[p.statut];
      return `<tr><td><span class="t-nm">${esc(p.raison_sociale)}</span><div class="t-sub">${esc(p.email || 'sans email')}</div></td>
        <td>${esc(p.type_commerce || '—')}</td><td>${esc(p.secteur || '—')}</td><td>${esc(p.commercial || '—')}</td>
        <td><span class="cls cls-${p._score.classe.toLowerCase()}" aria-hidden="true">${p._score.classe}</span> <span class="sr-only">Classe ${p._score.classe}</span> ${p._score.score}/100</td>
        <td><span class="badge ${m.cls}">${m.marque} ${esc(m.court)}</span></td>
        <td>${fmtDate(p.date_dernier_contact)}<div class="t-sub">${jours(p._score.jours_sans_contact)}</div></td>
        <td><button type="button" class="btn btn-sec btn-sm" data-ouvrir="${p.id}">Ouvrir</button></td></tr>`;
    }).join('')}</tbody></table></section>`;
}

// ------------------------------------------------------------------ relances
function rendreRelances() {
  const liste = trier(filtrer(ETAT.prospects, { a_relancer: true }), 'relance');
  return `<main class="content" id="contenu">
    <div class="page-h"><div><h1>Relances à faire</h1>
      <p class="page-sub">Prospects actifs sans contact depuis plus de 30 jours, oppositions exclues</p></div></div>
    ${liste.length === 0 ? `<section class="card"><div class="card-b empty"><div class="ic" aria-hidden="true">✓</div>
      <h2 style="font-size:18px">Aucune relance en attente</h2><p>Tous les prospects actifs ont été contactés dans les trente derniers jours.</p></div></section>`
      : tableau(liste)}
  </main>`;
}

// ------------------------------------------------------------------ fiche
function rendreFiche() {
  const p = prospectCourant();
  if (!p) return `<main class="content"><p>Prospect introuvable.</p></main>`;
  const t = typeDe(p);
  const m = STATUT_META[p.statut];
  const autorise = peutProspecter(p);
  const hist = interactionsDe(p);
  const emails = hist.filter(i => i.type === 'email');
  const d = p._score.detail;
  const lignesScore = [['Intensité énergétique du métier', d.intensite, 35], ['Joignabilité', d.joignabilite, 25],
    ['Avancement commercial', d.avancement, 25], ['Fraîcheur du contact', d.fraicheur, 15]];

  return `<main class="content" id="contenu">
    <div class="fil"><button type="button" class="btn btn-ghost btn-sm" data-ecran="pipeline">‹ Retour au pipeline</button></div>
    <div class="page-h">
      <div><h1>${esc(p.raison_sociale)}</h1>
        <p class="page-sub">${esc(p.type_commerce || 'Type non renseigné')} · ${esc(p.adresse || 'Adresse non renseignée')}</p></div>
      <span class="sp"></span>
      <span class="badge ${m.cls}" style="font-size:14px;padding:7px 14px">${m.marque} ${esc(m.court)}</span>
      <span class="badge b-neutre" style="font-size:14px;padding:7px 14px"><span class="cls cls-${p._score.classe.toLowerCase()}" style="width:20px;height:20px;font-size:11px">${p._score.classe}</span> ${p._score.score}/100</span>
      <button type="button" class="btn btn-sec btn-sm" data-editer="${p.id}">Modifier</button>
    </div>

    ${p.opt_out ? `<div class="alert" style="margin-bottom:18px"><span class="ic" aria-hidden="true">▲</span>
      <div><b>Opposition à la prospection enregistrée</b><p>Ce prospect s'est opposé à toute prospection le ${fmtDate(p.date_opt_out)}. La génération d'email est désactivée et il n'apparaît pas dans les relances.</p></div></div>` : ''}

    <div class="two">
      <div class="colL">
        <section class="card" style="margin-bottom:16px"><div class="card-h"><h2 style="font-size:16px">Coordonnées</h2></div>
          <div class="card-b" style="padding:6px 16px 12px"><dl>
            <div class="dl"><dt>Téléphone</dt><dd>${esc(p.telephone || 'Non renseigné')}</dd></div>
            <div class="dl"><dt>Email</dt><dd>${esc(p.email || 'Non renseigné')}</dd></div>
            <div class="dl"><dt>Secteur</dt><dd>${esc(p.secteur || '—')}</dd></div>
            <div class="dl"><dt>Commercial</dt><dd>${esc(p.commercial || '—')}</dd></div>
            <div class="dl"><dt>Créé le</dt><dd>${fmtDate(p.date_creation)}</dd></div>
            <div class="dl"><dt>Dernier contact</dt><dd>${fmtDate(p.date_dernier_contact)} <span class="t-sub">(${jours(p._score.jours_sans_contact)})</span></dd></div>
            <div class="dl"><dt>Consentement</dt><dd>${esc(p.source_consentement || 'Non renseigné')}</dd></div>
          </dl></div></section>

        <section class="card" style="margin-bottom:16px"><div class="card-h"><h2 style="font-size:16px">Détail de la priorité</h2></div>
          <div class="card-b">
            ${lignesScore.map(([l, v, mx]) => `<div class="score-row"><div class="lab"><span>${esc(l)}</span><b>${v} / ${mx}</b></div>
              <div class="meter"><i style="width:${Math.round(v / mx * 100)}%"></i></div></div>`).join('')}
            <p class="help" style="margin-top:10px">Score calculé par l'interface à partir des données de la fiche. Il n'est pas stocké en base.</p>
          </div></section>

        ${t ? `<section class="card"><div class="card-h"><h2 style="font-size:16px">Fiche énergie — ${esc(t.nom.toLowerCase())}</h2></div>
          <div class="card-b" style="font-size:14px">${esc(t.specificites) || 'Aucune spécificité renseignée pour ce métier.'}</div></section>` : ''}
      </div>

      <div class="colR">
        ${zoneGeneration(p, autorise)}

        <section class="card" style="margin-bottom:16px"><div class="card-h"><h2 style="font-size:16px">Statut et suivi</h2></div>
          <div class="card-b"><div class="deux-champs">
            <div class="field"><label for="st">Statut du prospect</label>
              <select class="control" id="st" data-statut="${p.id}">
                ${STATUTS.map(s => `<option value="${esc(s)}"${s === p.statut ? ' selected' : ''}>${esc(s)}</option>`).join('')}
              </select></div>
            <div class="field"><label for="dc">Date du dernier contact</label>
              <input type="date" class="control" id="dc" value="${esc(p.date_dernier_contact || '')}" data-datecontact="${p.id}">
              <p class="help">Au-delà de 30 jours, le prospect apparaît dans les relances.</p></div>
          </div></div></section>

        <section class="card"><div class="card-h"><h2 style="font-size:16px">Historique</h2>
          <span class="sp"></span><span class="badge b-info">${emails.length} email${emails.length > 1 ? 's' : ''} généré${emails.length > 1 ? 's' : ''}</span></div>
          <div class="card-b">${hist.length === 0
            ? '<p class="help">Aucune interaction enregistrée pour ce prospect.</p>'
            : `<div class="timeline">${hist.map(i => `<div class="tl"><span class="dot${i.type === 'email' ? '' : ' g'}" aria-hidden="true"></span>
                <div class="d">${fmtDate(i.date)} · ${esc(i.type)}${i.resultat ? ' · ' + esc(i.resultat) : ''}</div>
                <div class="t">${esc(i.ref)}</div>
                ${i.contenu ? `<details class="hist-d"><summary>Voir le contenu</summary><pre class="hist-pre">${esc(i.contenu)}</pre>
                  <button type="button" class="btn btn-sec btn-sm" data-copier-hist="${i.id}">Copier ce texte</button></details>` : ''}</div>`).join('')}</div>`}
          </div></section>
      </div>
    </div>
  </main>`;
}

function zoneGeneration(p, autorise) {
  const g = ETAT.generation;
  const params = `<div class="gen-params">
    ${[['ton', TONS], ['longueur', LONGUEURS], ['angle', ANGLES]].map(([cle, table]) => `
      <div class="field"><label for="g-${cle}">${cle === 'ton' ? 'Ton' : cle === 'longueur' ? 'Longueur' : 'Angle'}</label>
        <select class="control" id="g-${cle}" data-param="${cle}">
          ${Object.entries(table).map(([k, v]) => `<option value="${k}"${g.params[cle] === k ? ' selected' : ''}>${esc(v.libelle)}</option>`).join('')}
        </select></div>`).join('')}
  </div>`;

  if (!autorise.ok) {
    return `<section class="card" style="margin-bottom:16px"><div class="card-b empty">
      <div class="ic" aria-hidden="true">▲</div>
      <h2 style="font-size:18px;margin-bottom:6px">Génération indisponible</h2>
      <p>${esc(autorise.motif)}</p>
      <p class="help">Règle issue du registre de traitements : aucun email n'est rédigé ni envoyé pour un prospect opposé à la prospection.</p>
    </div></section>`;
  }

  if (g.etat === 'encours') {
    return `<section class="card" style="margin-bottom:16px" aria-busy="true"><div class="card-b">
      <b style="display:block;margin-bottom:6px">Rédaction en cours…</b>
      <p class="help" style="margin-bottom:10px">Analyse de la fiche énergie « ${esc(p.type_commerce || '')} » puis rédaction. Vous pouvez quitter cette page.</p>
      <div class="progress"><i class="anim" style="width:70%"></i></div>
    </div></section>`;
  }

  if (g.etat === 'pret' && g.resultat) {
    const c = g.controle || { anomalies: [], confiance: 3 };
    const maj = c.anomalies.filter(a => a.gravite === 'majeure');
    return `<section class="ia" style="margin-bottom:16px" aria-labelledby="ia-t">
      <div class="ia-h">
        <span class="ttl" id="ia-t"><span aria-hidden="true">✦</span> Proposition générée par l'IA</span>
        <span class="sp"></span>
        <span class="conf">Confiance ${c.confiance} sur 5
          <span class="seg5" aria-hidden="true">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= c.confiance ? 'f' : ''}"></i>`).join('')}</span></span>
        <span class="ia-note">Texte proposé par l'assistant, à relire avant envoi. Rien n'est envoyé automatiquement.</span>
      </div>
      <div class="ia-b">
        ${maj.length ? `<div class="alert" style="margin-bottom:12px"><span class="ic" aria-hidden="true">▲</span>
          <div><b>${maj.length} point${maj.length > 1 ? 's' : ''} à vérifier avant envoi</b>
          <p>${maj.map(a => esc(libelleAnomalie(a))).join(' · ')}</p></div></div>` : ''}
        ${g.edition
          ? `<div class="field"><label for="ed-objet">Objet</label><input class="control" id="ed-objet" value="${esc(g.resultat.objet)}"></div>
             <div class="field"><label for="ed-corps">Corps du message</label><textarea class="control ta" id="ed-corps" rows="12">${esc(g.resultat.corps)}</textarea></div>`
          : `<p class="ia-obj">Objet — <b>${esc(g.resultat.objet)}</b></p>
             <div class="ia-txt">${esc(g.resultat.corps).split('\n\n').map(par => `<p>${par.replace(/\n/g, '<br>')}</p>`).join('')}</div>`}
      </div>
      <div class="ia-f">
        ${g.edition
          ? `<button type="button" class="btn btn-pri" data-gen="valider-edition">Enregistrer les modifications</button>
             <button type="button" class="btn btn-ghost" data-gen="annuler-edition">Annuler</button>`
          : `<button type="button" class="btn btn-pri" data-gen="copier">Copier l'email</button>
             <button type="button" class="btn btn-sec" data-gen="editer">Modifier</button>
             <button type="button" class="btn btn-sec" data-gen="regenerer">↻ Régénérer</button>
             <button type="button" class="btn btn-sec" data-gen="enregistrer">Enregistrer dans l'historique</button>`}
        <span class="hint">${esc(g.resultat.modele || '')}${g.resultat.source === 'demo' ? ' — texte simulé, aucun appel réseau' : ''}</span>
      </div>
      <div class="ia-f" style="padding-top:0">${params}</div>
    </section>`;
  }

  return `<section class="card" style="margin-bottom:16px"><div class="card-b empty">
    <div class="ic" aria-hidden="true">✦</div>
    <h2 style="font-size:18px;margin-bottom:6px">Aucune accroche pour ce prospect</h2>
    <p>L'assistant rédige une proposition à partir de la fiche énergie « ${esc(p.type_commerce || 'métier')} » et des informations du commerce. Vous la relisez avant tout envoi.</p>
    ${params}
    <button type="button" class="btn btn-ia" data-gen="lancer"><span aria-hidden="true">✦</span> Générer l'email</button>
    <p class="help" style="margin-top:10px">${ETAT.cfg.mode === 'demo' ? 'Mode démonstration : texte simulé localement.' : 'Appel du workflow n8n.'}</p>
  </div></section>`;
}

function libelleAnomalie(a) {
  const t = {
    PROMESSE_INTERDITE: 'promesse absolue détectée', HORS_SUJET_METIER: 'vocabulaire d’un autre métier',
    COORDONNEES_INVENTEES: 'coordonnées inventées', CHIFFRE_EXCESSIF: 'pourcentage trop élevé',
    OBJET_MANQUANT: 'objet manquant', CORPS_MANQUANT: 'corps manquant', LONGUEUR: 'longueur inhabituelle',
    PERSONNALISATION: 'nom du commerce absent', REPONSE_VIDE: 'réponse vide',
  };
  return (t[a.code] || a.code) + (a.detail ? ' (' + a.detail + ')' : '');
}

// ------------------------------------------------------------------ formulaire
function rendreFormulaire() {
  const p = (ETAT.ecran === 'editer' && ETAT.prospectId) ? prospectCourant() : null;
  const edition = !!p;
  const v = (c, d) => esc(p ? (p[c] ?? '') : (d ?? ''));
  return `<main class="content" id="contenu">
    <div class="fil"><button type="button" class="btn btn-ghost btn-sm" data-ecran="${edition ? 'fiche' : 'pipeline'}">‹ Annuler</button></div>
    <div class="page-h"><div><h1>${edition ? 'Modifier le prospect' : 'Nouveau prospect'}</h1>
      <p class="page-sub">${edition ? 'Les modifications sont enregistrées dans Baserow.' : 'Le prospect est créé dans la table Prospect de Baserow.'}</p></div></div>
    <section class="card"><div class="card-b"><form class="form" id="form-prospect" novalidate>
      <div class="field"><label for="f-nom">Raison sociale <span class="req" aria-hidden="true">*</span> <span class="opt">(obligatoire)</span></label>
        <input class="control" id="f-nom" name="raison_sociale" value="${v('raison_sociale')}" required>
        <p class="err-msg" id="e-nom" hidden><span aria-hidden="true">▲</span> <span></span></p></div>
      <div class="deux-champs">
        <div class="field"><label for="f-type">Métier <span class="req" aria-hidden="true">*</span> <span class="opt">(obligatoire)</span></label>
          <select class="control" id="f-type" name="type_commerce_id" required>
            <option value="">Choisissez un métier</option>
            ${ETAT.types.map(t => `<option value="${t.id}"${p && p.type_commerce_id === t.id ? ' selected' : ''}>${esc(t.nom)}</option>`).join('')}
          </select>
          <p class="err-msg" id="e-type" hidden><span aria-hidden="true">▲</span> <span></span></p></div>
        <div class="field"><label for="f-statut">Statut</label>
          <select class="control" id="f-statut" name="statut">
            ${STATUTS.map(s => `<option value="${esc(s)}"${p && p.statut === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}
          </select></div>
      </div>
      <div class="field"><label for="f-adresse">Adresse</label>
        <input class="control" id="f-adresse" name="adresse" value="${v('adresse')}" placeholder="12 rue du Parc, 69003 Lyon">
        <p class="help">Le code postal et la ville servent à personnaliser l'email généré.</p></div>
      <div class="deux-champs">
        <div class="field"><label for="f-tel">Téléphone</label>
          <input class="control" id="f-tel" name="telephone" value="${v('telephone')}" inputmode="tel"></div>
        <div class="field"><label for="f-email">Email <span class="opt">(nécessaire pour générer un email)</span></label>
          <input class="control" id="f-email" name="email" value="${v('email')}" inputmode="email">
          <p class="err-msg" id="e-email" hidden><span aria-hidden="true">▲</span> <span></span></p></div>
      </div>
      <div class="deux-champs">
        <div class="field"><label for="f-comm">Commercial</label>
          <select class="control" id="f-comm" name="commercial_id">
            <option value="">Non affecté</option>
            ${ETAT.commerciaux.map(c => `<option value="${c.id}"${p && p.commercial_id === c.id ? ' selected' : ''}>${esc(c.affichage)}</option>`).join('')}
          </select></div>
        <div class="field"><label for="f-contact">Date du dernier contact</label>
          <input type="date" class="control" id="f-contact" name="date_dernier_contact" value="${v('date_dernier_contact')}"></div>
      </div>
      <div class="field champ-case">
        <label class="case"><input type="checkbox" id="f-optout" name="opt_out"${p && p.opt_out ? ' checked' : ''}>
          <span>Ce prospect s'est opposé à la prospection</span></label>
        <p class="help">Cocher cette case désactive définitivement la génération d'email pour ce prospect et le retire des relances.</p>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-pri">${edition ? 'Enregistrer' : 'Créer le prospect'}</button>
        <button type="button" class="btn btn-ghost" data-ecran="${edition ? 'fiche' : 'pipeline'}">Annuler</button>
        ${edition ? `<span class="sp"></span><button type="button" class="btn btn-danger" data-supprimer="${p.id}">Supprimer</button>` : ''}
      </div>
    </form></div></section>
  </main>`;
}

// ------------------------------------------------------------------ tableau de bord
function barres(donnees, couleur) {
  const max = Math.max(...Object.values(donnees), 1);
  return `<div class="bars">${Object.entries(donnees).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
    `<div class="bar-row"><span class="nm">${esc(k)}</span>
      <span class="tr"><i style="width:${Math.round(v / max * 100)}%${couleur ? ';background:' + couleur : ''}"></i></span>
      <span class="vl">${v}</span></div>`).join('')}</div>`;
}

function rendreBord() {
  const k = kpis(ETAT.prospects, ETAT.interactions);
  const entonnoir = [['Prospects', k.total], ['Contactés', k.total - (k.par_statut['nouveau'] || 0)],
    ['Qualifiés', (k.par_statut['qualifié'] || 0) + (k.par_statut['proposition envoyée'] || 0) + k.gagnes],
    ['Gagnés', k.gagnes]];
  const maxE = entonnoir[0][1] || 1;
  return `<main class="content" id="contenu">
    <div class="page-h"><div><h1>Tableau de bord</h1>
      <p class="page-sub">Vue manager · ${ETAT.prospects.length} prospects · ${ETAT.commerciaux.length} commerciaux</p></div></div>

    ${k.a_relancer > 5 ? `<div class="alert" style="margin-bottom:18px"><span class="ic" aria-hidden="true">▲</span>
      <div><b>${k.a_relancer} prospects sans contact depuis plus de 30 jours</b>
      <p>Soit ${Math.round(k.a_relancer / Math.max(k.actifs, 1) * 100)} % du portefeuille actif. Les plus anciens sont listés dans l'écran Relances.</p></div></div>` : ''}

    <div class="kpis">
      ${[['Prospects au total', k.total], ['Créés sur 30 jours', k.nouveaux_30j],
         ['Taux de conversion', k.taux_conversion === null ? '—' : k.taux_conversion + ' %'],
         ['Priorité moyenne', k.score_moyen + '/100']]
        .map(([l, v]) => `<div class="kpi"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join('')}
    </div>

    <div class="split" style="margin-bottom:20px">
      <section class="card"><div class="card-h"><h2>Répartition par statut</h2></div>
        <div class="card-b">${barres(k.par_statut)}
          <p class="legend"><span>Nombre de prospects par étape du cycle de vente.</span></p></div></section>
      <section class="card"><div class="card-h"><h2>Entonnoir de conversion</h2></div>
        <div class="card-b"><div class="funnel">${entonnoir.map(([l, v]) =>
          `<div class="fstep"><span class="bx" style="width:${Math.max(Math.round(v / maxE * 100), 8)}%">${v}</span>
            <span class="lg"><b>${esc(l)}</b><span>${maxE ? Math.round(v / maxE * 100) : 0} % du total</span></span></div>`).join('')}</div>
          <p class="legend"><span>Chaque étape indique le nombre de prospects et sa part du portefeuille.</span></p></div></section>
    </div>

    <div class="split" style="margin-bottom:20px">
      <section class="card"><div class="card-h"><h2>Activité par commercial</h2></div>
        <div class="card-b">${barres(k.par_commercial)}</div></section>
      <section class="card"><div class="card-h"><h2>Répartition par métier</h2></div>
        <div class="card-b">${barres(k.par_type, '#C2410C')}</div></section>
    </div>

    <section class="card"><div class="card-h"><h2>Qualité et conformité</h2></div>
      <div class="card-b"><div class="split">
        <div><dl>
          <div class="dl"><dt>Emails générés</dt><dd>${k.emails_generes} au total, ${k.emails_generes_30j} sur 30 jours</dd></div>
          <div class="dl"><dt>Prospects sans email</dt><dd>${k.sans_email} — génération impossible</dd></div>
          <div class="dl"><dt>Oppositions RGPD</dt><dd>${k.opt_out} prospect${k.opt_out > 1 ? 's' : ''} exclu${k.opt_out > 1 ? 's' : ''} de toute prospection</dd></div>
          <div class="dl"><dt>À relancer</dt><dd>${k.a_relancer} prospects actifs sans contact depuis 30 jours</dd></div>
        </dl></div>
        <div>${barres(k.par_classe, '#B45309')}
          <p class="legend"><span>Répartition par classe de priorité : A au-dessus de 70, B de 45 à 69, C en dessous.</span></p></div>
      </div></div></section>
  </main>`;
}

// ------------------------------------------------------------------ configuration
function rendreConfig() {
  const c = ETAT.cfg;
  return `<main class="content" id="contenu">
    <div class="page-h"><div><h1>Configuration</h1>
      <p class="page-sub">Connexion à Baserow et au workflow de génération. Les réglages restent sur ce poste.</p></div></div>
    ${ETAT.erreur && !ETAT.pret ? `<div class="alert" style="margin-bottom:18px"><span class="ic" aria-hidden="true">▲</span>
      <div><b>Le dernier chargement a échoué</b><p>${esc(ETAT.erreur)}</p>
      <p class="help">Corrigez les réglages ci-dessous, ou revenez au mode démonstration pour continuer à travailler.</p></div></div>` : ''}
    <section class="card" style="max-width:820px"><div class="card-b"><form class="form" id="form-config">
      <fieldset class="fset"><legend>Mode de fonctionnement</legend>
        <div class="radios">
          <label class="radio"><input type="radio" name="mode" value="demo"${c.mode === 'demo' ? ' checked' : ''}>
            <span><b>Démonstration</b><small>Données figées, aucun appel réseau.</small></span></label>
          <label class="radio"><input type="radio" name="mode" value="serveur"${c.mode === 'serveur' ? ' checked' : ''}>
            <span><b>Serveur</b><small>Recommandé en ligne. Le jeton reste côté serveur.</small></span></label>
          <label class="radio"><input type="radio" name="mode" value="connecte"${c.mode === 'connecte' ? ' checked' : ''}>
            <span><b>Direct</b><small>Jeton dans le navigateur. Poste personnel uniquement.</small></span></label>
        </div>
        ${!servieParUnServeur() ? '<p class="help">Le mode serveur demande que l\u2019application soit servie par un serveur (npm run dev, ou le déploiement Vercel). Ouverte par double-clic, elle ne peut utiliser que les modes Démonstration et Direct.</p>' : ''}
      </fieldset>

      <fieldset class="fset"><legend>Mode serveur</legend>
        <div class="field"><label for="c-code">Code d'accès</label>
          <input class="control" id="c-code" name="codeAcces" type="password" value="${esc(c.codeAcces)}" autocomplete="off">
          <p class="help">Doit correspondre à la variable <b>APP_ACCESS_CODE</b> définie sur Vercel. Sans lui, le serveur refuse les appels.</p></div>
      </fieldset>

      <fieldset class="fset"><legend>Mode direct — Baserow</legend>
        <div class="field"><label for="c-url">URL de l'instance</label>
          <input class="control" id="c-url" name="baserowUrl" value="${esc(c.baserowUrl)}" placeholder="https://api.baserow.io"></div>
        <div class="field"><label for="c-token">Jeton de base de données</label>
          <input class="control" id="c-token" name="token" type="password" value="${esc(c.token)}" autocomplete="off" placeholder="Créé dans Baserow : Paramètres → Jetons">
          <p class="help">Donnez-lui les droits lecture, création et modification sur les tables Prospect et Interaction, et la lecture seule sur les autres.</p></div>
        <div class="deux-champs">
          ${[['prospect', 'Table Prospect'], ['typeCommerce', 'Table TypeCommerce']].map(([k, l]) =>
            `<div class="field"><label for="c-${k}">${l}</label><input class="control" id="c-${k}" name="t_${k}" inputmode="numeric" value="${esc(c.tables[k])}"></div>`).join('')}
        </div>
        <div class="deux-champs">
          ${[['commercial', 'Table Commercial'], ['interaction', 'Table Interaction']].map(([k, l]) =>
            `<div class="field"><label for="c-${k}">${l}</label><input class="control" id="c-${k}" name="t_${k}" inputmode="numeric" value="${esc(c.tables[k])}"></div>`).join('')}
        </div>
      </fieldset>

      <fieldset class="fset"><legend>Mode direct — génération d'email (workflow n8n)</legend>
        <div class="field"><label for="c-wh">URL du webhook</label>
          <input class="control" id="c-wh" name="webhook" value="${esc(c.webhook)}" placeholder="https://votre-instance.app.n8n.cloud/webhook/eco-locaux/generer-email"></div>
        <div class="field"><label for="c-whk">Clé d'appel (en-tête X-Api-Key)</label>
          <input class="control" id="c-whk" name="webhookCle" type="password" value="${esc(c.webhookCle)}" autocomplete="off"></div>
      </fieldset>

      <fieldset class="fset"><legend>Utilisateur</legend>
        <div class="deux-champs">
          <div class="field"><label for="c-role">Rôle</label>
            <select class="control" id="c-role" name="role">
              <option value="commercial"${c.role === 'commercial' ? ' selected' : ''}>Commercial</option>
              <option value="manager"${c.role === 'manager' ? ' selected' : ''}>Manager</option>
            </select>
            <p class="help">Le tableau de bord n'est visible que par le manager.</p></div>
          <div class="field"><label for="c-moi">Je suis</label>
            <select class="control" id="c-moi" name="commercialId">
              ${ETAT.commerciaux.map(x => `<option value="${x.id}"${c.commercialId === x.id ? ' selected' : ''}>${esc(x.affichage)}</option>`).join('')}
            </select></div>
        </div>
      </fieldset>

      <div class="form-actions">
        <button type="submit" class="btn btn-pri">Enregistrer et recharger</button>
        <button type="button" class="btn btn-sec" data-tester="1">Tester la connexion</button>
        <button type="button" class="btn btn-ghost" data-oublier="1">Effacer les réglages</button>
      </div>
      <p class="help" id="res-test" aria-live="polite"></p>
    </form></div></section>
  </main>`;
}

// ------------------------------------------------------------------ rendu global
function rendre() {
  const racine = $('#app');
  const ecrans = { pipeline: rendrePipeline, fiche: rendreFiche, nouveau: rendreFormulaire,
    editer: rendreFormulaire, relances: rendreRelances, bord: rendreBord, config: rendreConfig };
  const fn = ecrans[ETAT.ecran] || rendrePipeline;
  // L'écran de configuration reste toujours accessible, même quand le
  // chargement a échoué : sans cela, une mauvaise configuration enfermait
  // l'utilisateur dans le message d'erreur (anomalie ANO-3C-01).
  const corps = ETAT.ecran === 'config'
    ? fn()
    : (ETAT.chargement && !ETAT.pret
      ? `<main class="content"><section class="card"><div class="card-b empty"><div class="ic" aria-hidden="true">○</div>
          <h2 style="font-size:18px">Chargement des données…</h2><p>Lecture de la base en cours.</p></div></section></main>`
      : (ETAT.erreur && !ETAT.pret
        ? `<main class="content"><div class="alert"><span class="ic" aria-hidden="true">▲</span>
            <div><b>Connexion impossible</b><p>${esc(ETAT.erreur)}</p>
            <button type="button" class="btn btn-sec" data-ecran="config" style="margin-top:10px">Ouvrir la configuration</button></div></div></main>`
        : fn()));
  racine.innerHTML = `<div class="app">${rendreNav()}<div class="main">
    <header class="topbar"><span class="crumb">${esc(filAriane())}</span><span class="sp"></span>
      ${ETAT.cfg.mode === 'demo' ? '<span class="badge b-info">○ Mode démonstration</span>'
        : ETAT.cfg.mode === 'serveur' ? '<span class="badge b-ok">✓ Connecté (par le serveur)</span>'
        : '<span class="badge b-warn">◆ Connecté (jeton dans le navigateur)</span>'}
      <button type="button" class="tg" id="t-dark" aria-pressed="${document.body.classList.contains('dk')}"><span class="dot" aria-hidden="true"></span>Sombre</button>
      <button type="button" class="tg" id="t-lf" aria-pressed="${document.body.classList.contains('lf')}"><span class="dot" aria-hidden="true"></span>Lecture facilitée</button>
    </header>${corps}</div></div>`;
  const focusCible = $('#contenu h1');
  if (focusCible && ETAT._focusDemande) { focusCible.setAttribute('tabindex', '-1'); focusCible.focus(); ETAT._focusDemande = false; }
}

function filAriane() {
  const p = prospectCourant();
  const noms = { pipeline: 'Pipeline', relances: 'Relances', bord: 'Tableau de bord', config: 'Configuration',
    nouveau: 'Nouveau prospect', editer: 'Modifier', fiche: p ? p.raison_sociale : 'Fiche' };
  return 'Eco-Locaux › ' + (noms[ETAT.ecran] || '');
}

function aller(ecran, id) {
  ETAT.ecran = ecran;
  if (id !== undefined) ETAT.prospectId = id;
  // Un nouveau prospect part toujours d'un formulaire vierge : sans cette
  // remise à zéro, le formulaire héritait de la fiche consultée juste avant
  // et la soumission créait un doublon (anomalie ANO-3B-01).
  if (ecran === 'nouveau') ETAT.prospectId = null;
  if (ecran !== 'fiche') ETAT.generation = { ...ETAT.generation, etat: 'repos', resultat: null, controle: null, edition: false };
  ETAT._focusDemande = true;
  rendre();
  window.scrollTo(0, 0);
}
