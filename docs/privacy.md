# Confidentialité de Prisme

Dernière mise à jour le 5 novembre 2026.

Prisme compare un devis d’achat ou de vente de crypto à des estimations de marché. Le projet est maintenu dans le dépôt public nouvellealex-alt/prisme.

## Traitement dans Chrome

Sur Kraken et Kraken Pro, et sur les autres sites pour lesquels vous activez la détection, Prisme recherche dans la page un récapitulatif d’achat ou de vente reconnu. Il peut lire le sens, la paire, la quantité, le total et les frais visibles. Vous pouvez aussi saisir ces valeurs dans le popup. Le devis est traité en mémoire et sert uniquement au calcul et à l’affichage de la comparaison.

Les taux de frais, le thème, les préférences d’affichage et la référence choisie sont enregistrés dans le stockage local de Chrome. L’autorisation accordée à un site et l’enregistrement du script sur ce site sont conservés par Chrome. Vous pouvez modifier les préférences dans Prisme, retirer l’accès à un site dans les paramètres de Chrome ou désinstaller l’extension pour supprimer ses paramètres locaux.

## Requêtes externes

Prisme interroge par HTTPS les API de marché publiques de Kraken, Binance et Coinbase Exchange. La requête indique la paire ou l’identifiant public du marché demandé. Les services peuvent recevoir l’adresse IP et les métadonnées habituelles de la connexion. Prisme n’envoie ni les quantités, ni le total du devis, ni les frais personnels, ni le sens de l’opération, ni l’adresse de la page consultée. Les requêtes omettent les cookies et les informations d’authentification.

Prisme utilise ces données pour la comparaison demandée. L’extension ne comporte aucun suivi publicitaire, compte Prisme, serveur de collecte ou vente de données. Elle ne passe aucun ordre et ne demande aucune clé de portefeuille.

Les données reçues par les API sont soumises aux règles de confidentialité de leurs opérateurs. Pour signaler un problème de confidentialité sans publier votre devis ni vos informations personnelles, utilisez le dépôt du projet. [Support Prisme](https://github.com/nouvellealex-alt/prisme/issues)
