/* ============================================================
   Jeu de démonstration — extrait réel de la base Eco-Locaux
   (base 530693, lu le 12/10/2026 via l'API Baserow).
   Format identique à celui renvoyé par l'API : le mode démo
   traverse donc exactement le même mapping que le mode connecté.
   ============================================================ */

const SEL = {
  nouveau: { id: 7303303, value: 'nouveau', color: 'blue' },
  contacte: { id: 7303304, value: 'contacté', color: 'green' },
  qualifie: { id: 7303305, value: 'qualifié', color: 'cyan' },
  proposition: { id: 7303306, value: 'proposition envoyée', color: 'orange' },
  gagne: { id: 7303307, value: 'gagné', color: 'yellow' },
  perdu: { id: 7303308, value: 'perdu', color: 'red' },
  formulaire: { id: 7303309, value: 'formulaire', color: 'blue' },
  echange: { id: 7303310, value: 'échange', color: 'green' },
  autre: { id: 7303311, value: 'autre', color: 'cyan' },
};
const L = (id, value) => [{ id, value }];

// [id, raison_sociale, adresse, tel, email, statut, date_creation, dernier_contact,
//  opt_out, date_opt_out, consentement, typeId, typeNom, secteurId, secteurNom, commId, commNom]
const BRUT = [
  [1, 'Boulangerie du Coin', '12 Rue des Fleurs, 75001 Paris', '0123456789', 'contact@boulangeriecoin.fr', 'nouveau', '2023-01-15', '2023-02-01', false, null, 'formulaire', 1, 'Boutique', 1, 'Nord', 1, 'Dupont'],
  [2, 'Supermarché Soleil', '45 Avenue du Soleil, 13000 Marseille', '0234567890', 'info@soleilmarche.fr', 'contacte', '2023-03-10', '2023-04-05', false, null, 'echange', 2, 'Supermarché', 2, 'Sud', 2, 'Martin'],
  [3, 'Restaurant La Table', '78 Boulevard des Chefs, 67000 Strasbourg', '0345678901', 'reservation@latable.fr', 'qualifie', '2023-05-20', '2023-05-25', true, '2023-06-01', 'autre', 3, 'Restaurant', 3, 'Est', 3, 'Leroy'],
  [4, 'Bureau TechCorp', '101 Rue de la Technologie, 44000 Nantes', '0456789012', 'contact@techcorp.com', 'proposition', '2023-07-12', '2023-07-20', false, null, 'formulaire', 4, 'Bureau', 4, 'Ouest', 4, 'Moreau'],
  [5, 'Entrepôt LogiPlus', '200 Quai des Entreprises, 45000 Orléans', '0567890123', 'logiplus@entreprise.fr', 'gagne', '2023-09-01', '2023-09-10', false, null, 'echange', 5, 'Entrepôt', 5, 'Centre', 5, 'Rossi'],
  [6, 'Boulangerie du Parc', '12 rue du Parc, 69003 Lyon', '04 72 11 22 33', 'contact@boulangerieduparc.fr', 'contacte', '2026-07-15', '2026-08-18', false, null, 'echange', 6, 'Boulangerie', 6, 'Lyon Centre', 2, 'Martin'],
  [7, "Pressing Net'Lyon", '5 avenue Jean Jaurès, 69007 Lyon', '04 72 44 55 66', 'info@netlyon.fr', 'qualifie', '2026-06-20', '2026-08-19', false, null, 'echange', 7, 'Pressing', 6, 'Lyon Centre', 2, 'Martin'],
  [8, 'Poissonnerie La Marée', '8 place Carnot, 69002 Lyon', '04 72 77 88 99', 'lamaree@poissonnerie.fr', 'nouveau', '2026-08-20', '2026-08-20', false, null, 'autre', 9, 'Poissonnerie', 6, 'Lyon Centre', 2, 'Martin'],
  [9, 'Restaurant Le Gourmet', '20 rue Mécière, 69002 Lyon', '04 72 33 44 55', 'contact@legourmet-lyon.fr', 'proposition', '2026-05-10', '2026-08-05', false, null, 'formulaire', 3, 'Restaurant', 6, 'Lyon Centre', 2, 'Martin'],
  [10, 'Boulangerie Provence', '15 cours Julien, 13006 Marseille', '04 91 11 22 33', 'contact@boulangerieprovence.fr', 'contacte', '2026-07-01', '2026-08-06', false, null, 'echange', 6, 'Boulangerie', 7, 'Marseille Sud', 7, 'Dubois'],
  [11, 'Pressing du Vieux Port', '3 quai du Port, 13002 Marseille', '04 91 44 55 66', 'info@pressingvieuxport.fr', 'gagne', '2026-04-12', '2026-08-12', false, null, 'formulaire', 7, 'Pressing', 7, 'Marseille Sud', 7, 'Dubois'],
  [12, 'Laverie Calanques', '40 boulevard Michelet, 13008 Marseille', '04 91 77 88 99', 'contact@laveriecalanques.fr', 'nouveau', '2026-08-17', '2026-08-17', false, null, 'autre', 8, 'Laverie', 7, 'Marseille Sud', 7, 'Dubois'],
  [13, 'Boucherie Bordelaise', '22 rue Sainte-Catherine, 33000 Bordeaux', '05 56 11 22 33', 'contact@boucheriebordelaise.fr', 'qualifie', '2026-06-15', '2026-08-04', false, null, 'echange', 10, 'Boucherie', 8, 'Bordeaux Métropole', 3, 'Leroy'],
  [14, 'Pizzeria Bella', '10 place de la Victoire, 33000 Bordeaux', '05 56 44 55 66', 'hello@pizzeriabella.fr', 'contacte', '2026-07-22', '2026-08-19', false, null, 'echange', 11, 'Pizzeria', 8, 'Bordeaux Métropole', 3, 'Leroy'],
  [15, 'Restaurant Le Bordeaux', '2 place de la Comédie, 33000 Bordeaux', '05 56 33 44 55', 'contact@lebordeaux.fr', 'perdu', '2026-03-05', '2026-07-20', true, '2026-07-20', 'formulaire', 3, 'Restaurant', 8, 'Bordeaux Métropole', 3, 'Leroy'],
  [16, "Poissonnerie de l'Océan", '18 quai des Chartrons, 33000 Bordeaux', '05 56 77 88 99', 'contact@poissonnerieocean.fr', 'proposition', '2026-05-30', '2026-08-10', false, null, 'formulaire', 9, 'Poissonnerie', 8, 'Bordeaux Métropole', 3, 'Leroy'],
  [17, 'Boulangerie Saint-Antoine', '45 rue du Faubourg Saint-Antoine, 75011 Paris', '01 43 11 22 33', 'contact@boulangeriestantoine.fr', 'contacte', '2026-07-08', '2026-08-13', false, null, 'echange', 6, 'Boulangerie', 9, 'Paris Est', 4, 'Moreau'],
  [18, 'Pressing Bastille', '7 rue de la Roquette, 75011 Paris', '01 43 44 55 66', 'info@pressingbastille.fr', 'nouveau', '2026-08-19', '2026-08-19', false, null, 'autre', 7, 'Pressing', 9, 'Paris Est', 4, 'Moreau'],
  [19, 'Boucherie du Marché', '30 avenue Daumesnil, 75012 Paris', '01 43 77 88 99', 'contact@boucheriedumarche.fr', 'gagne', '2026-04-25', '2026-08-21', false, null, 'formulaire', 10, 'Boucherie', 9, 'Paris Est', 4, 'Moreau'],
];

const DEMO_PROSPECTS = BRUT.map(r => ({
  id: r[0], raison_sociale: r[1], adresse: r[2], telephone: r[3], email: r[4],
  statut_vente: SEL[r[5]], date_creation: r[6], Date_dernier_contact: r[7],
  Opt_out_prospection: r[8], Date_opt_out: r[9], Source_consentement: SEL[r[10]],
  type_commerce: L(r[11], r[12]), type_commerce_nom: L(r[11], r[12]),
  secteur: L(r[13], r[14]), secteur_nom: L(r[13], r[14]),
  commercial: L(r[15], r[16]), commercial_nom: L(r[15], r[16]),
  Interaction: [],
}));

const DEMO_TYPES = [
  [1, 'Boutique', 'Faible consommation'],
  [2, 'Supermarché', 'Modérée consommation'],
  [3, 'Restaurant', 'Consommation élevée en cuisine'],
  [4, 'Bureau', 'Consommation moyenne, climatisation'],
  [5, 'Entrepôt', 'Consommation variable selon activité'],
  [6, 'Boulangerie', 'Fours en fonctionnement continu, souvent la nuit ; vitrines réfrigérées ; climatisation du fournil. Le four est le poste le plus énergivore et rarement optimisé.'],
  [7, 'Pressing', 'Machines à vapeur, séchoirs et presses fonctionnant en continu. Forte consommation de vapeur et de chaleur ; réglages souvent perfectibles.'],
  [8, 'Laverie', "Lave-linge et sèche-linge industriels, production d'eau chaude. Cycles répétés = forte consommation électrique et thermique."],
  [9, 'Poissonnerie', 'Chambres froides et vitrines réfrigérées en continu, production de glace. Le froid est le poste dominant, souvent surdimensionné.'],
  [10, 'Boucherie', 'Chambres froides, vitrines réfrigérées, ateliers de découpe. Froid permanent, réglages et étanchéité souvent à revoir.'],
  [11, 'Pizzeria', "Fours (électriques ou à bois), hottes d'extraction, réfrigération des ingrédients. Le four et l'extraction pèsent lourd sur la facture."],
].map(r => ({ id: r[0], nom_type: r[1], specificites_energetiques: r[2] }));

const DEMO_COMMERCIAUX = [
  [1, 'Dupont', 'Claire', 'c.dupont@eco-locaux.fr'],
  [2, 'Martin', 'Julie', 'j.martin@eco-locaux.fr'],
  [3, 'Leroy', 'Karim', 'k.leroy@eco-locaux.fr'],
  [4, 'Moreau', 'Sophie', 's.moreau@eco-locaux.fr'],
  [5, 'Rossi', 'Marc', 'm.rossi@eco-locaux.fr'],
  [7, 'Dubois', 'Nadia', 'n.dubois@eco-locaux.fr'],
].map(r => ({ id: r[0], nom: r[1], prenom: r[2], email: r[3] }));

const DEMO_INTERACTIONS = [
  [101, 'EMAIL-20260818-0914', 'email', '2026-08-18', 6, "Objet : Vos fours tournent la nuit, votre facture aussi\n\nBonjour,\n\nÀ la Boulangerie du Parc, vos fours montent en température bien avant l'ouverture et vos vitrines réfrigérées ne s'arrêtent jamais : c'est là que se joue l'essentiel de votre facture.\n\nEco-Locaux accompagne les boulangeries lyonnaises sur la programmation des cuissons et le réglage du froid.\n\nAuriez-vous quinze minutes cette semaine ?", 'Envoyé'],
  [102, 'EMAIL-20260819-1102', 'email', '2026-08-19', 7, "Objet : La vapeur de votre pressing, premier poste de dépense\n\nBonjour,\n\nChez Pressing Net'Lyon, votre générateur de vapeur et vos presses tournent en continu. C'est le premier poste de dépense d'un pressing de quartier, et souvent le plus simple à régler.\n\nSeriez-vous disponible pour en parler quinze minutes ?", 'Envoyé'],
  [103, 'INT-004', 'RDV', '2026-08-05', 9, 'Visite sur site, présentation du diagnostic. Proposition envoyée dans la foulée.', 'Proposition remise'],
  [104, 'EMAIL-20260810-1540', 'email', '2026-08-10', 16, "Objet : Votre production de glace, poste invisible de la facture\n\nBonjour,\n\nÀ la Poissonnerie de l'Océan, la glace produite chaque jour et vos vitrines réfrigérées représentent l'essentiel de votre consommation.\n\nEco-Locaux travaille le dimensionnement de la production de glace et les rideaux de nuit.\n\nUn échange court cette semaine ?", 'Envoyé'],
  [105, 'INT-001', 'appel', '2026-08-18', 6, 'Premier contact téléphonique. Intéressé, demande un email de présentation.', 'À relancer'],
].map(r => ({ id: r[0], interaction: r[1], type_interaction: { value: r[2] }, date_interaction: r[3],
  prospect: L(r[4], ''), prospect_raison: L(r[4], ''), contenu: r[5], resultat: r[6], commercial: [] }));

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DEMO_PROSPECTS, DEMO_TYPES, DEMO_COMMERCIAUX, DEMO_INTERACTIONS };
}
