# Stock biomédical — application web et PWA

Interface hébergée sur GitHub Pages ; données et fonction email sur Appwrite ; emails via Resend.

## Utilisation

- Installer depuis le bouton de la page d’accueil ou le menu du navigateur. Sur iPhone : Safari → Partager → Sur l’écran d’accueil.
- L’application installée ouvre `index.html`, avec trois accès : **Stock**, **Ajouter un consommable**, **Gestion de stock**.
- Dans Stock, **Scanner** valide la référence si elle est renseignée ; sinon il ouvre la caméra. La touche Entrée valide aussi la référence.
- La gestion affiche un tableau unique (fiches sur mobile) avec état, quantité, seuil, fournisseur, prix et actions Modifier / Supprimer / Localiser / Imprimer QR. La modification s’ouvre dans une fenêtre sans quitter la liste.
- Navigation et filtres restent accessibles pendant le défilement. Le bouton Haut permet de remonter rapidement.
- Si plusieurs fiches partagent la référence, choisir explicitement l’article et son emplacement. Les nouvelles impressions QR utilisent `BIOID:<identifiant de fiche>` ; les anciennes références restent reconnues.
- Le dernier stock consulté est enregistré sur cet appareil (sans contacts fournisseurs ni prix). Une première visite connectée et l’installation complète du service worker sont nécessaires pour consulter hors connexion. Aucune modification n’est mise en attente hors ligne.
- Après un retour du réseau, actualiser le stock. Les nouvelles versions s’activent automatiquement et les pages se mettent à jour à la prochaine navigation ou ouverture en ligne. Une saisie en cours n’est pas rechargée automatiquement ; **Mettre à jour** permet de recharger après l’avoir terminée. Hors connexion, la page demandée est conservée en cache.

## Alertes : diagnostic et déploiement

Destinataire : `biomed-pole2607@ramsaysante.fr`.

La page Gestion du stock propose **Tester l’email du pôle**, sans mouvement de stock. Le résultat distingue l’acceptation par le fournisseur d’email de la livraison effective en boîte mail. Les erreurs affichent la réponse du fournisseur et l’identifiant d’exécution Appwrite lorsqu’il est disponible. Une alerte échouée après un mouvement peut être relancée seule. La relance n’est pas automatique : une réponse perdue peut avoir masqué un email accepté.

**Le déploiement GitHub Pages ne déploie pas à lui seul la fonction Appwrite.** Dans Appwrite, la fonction `6a01cb32002e0eed267b` doit utiliser ce dépôt et un déploiement actif du dossier `functions/send_stock_alert`, point d’entrée `src/main.js`, avec un runtime Node compatible avec `fetch` et `AbortSignal.timeout` (Node 20+). Aucun paquet externe requis.

Variables Appwrite nécessaires :

- `RESEND_API_KEY` : clé Resend, exclusivement côté serveur.
- `ALERT_FROM_EMAIL` : adresse d’un domaine expéditeur vérifié dans Resend. Le repli `onboarding@resend.dev` est réservé aux tests et restreint les destinataires.

Le destinataire serveur est fixé à la boîte du pôle et ignore le champ `to` fourni par le navigateur. Le nouveau code serveur n’utilise plus `ALERT_TO_EMAIL`.

Si une exécution échoue sans message détaillé, consulter son journal dans Appwrite : déploiement actif, runtime, variables d’environnement et autorisations d’exécution. Ne jamais placer la clé Resend dans le JavaScript public.

## Limites actuelles

- Le site ne propose pas encore de connexion individuelle. Les permissions des collections et de la fonction se configurent dans Appwrite ; cette mise à jour ne les modifie pas.
- Une relecture de la quantité avant modification détecte les données déjà périmées ; elle ne remplace pas une transaction serveur. Deux écritures exactement simultanées restent à traiter avec une opération atomique côté serveur.
- Le stock et l’historique sont deux écritures distinctes. Un échec d’historique après mise à jour du stock est signalé sans proposer de refaire le mouvement.
- Les alertes automatiques partent après les mouvements qui laissent l’article en stock bas ou rupture ; il n’y a pas encore de déduplication globale ni de suivi de livraison par webhook.

## Vérification

`node --test tests/stock.test.mjs`

Tests avec services simulés : résultat d’envoi, erreurs Resend, destinataire serveur, échappement HTML, références ambiguës, pagination, cache hors ligne, fichiers PWA et sauvegarde du mouvement malgré un échec d’email/historique.
