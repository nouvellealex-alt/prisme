# Méthode de comparaison

## Ce qui est comparé

Le devis indique le sens de l’opération, la quantité de l’actif de base et le total dans la devise de cotation. À l’achat, le total correspond au montant à payer, frais compris. À la vente, il correspond au montant net à recevoir. Les frais déjà inclus peuvent être affichés dans le détail, sans être appliqués une deuxième fois.

Pour un achat, Prisme consomme les offres de vente de la moins chère à la plus chère. Pour une vente, il consomme les offres d’achat de la plus élevée à la moins élevée. La somme des prix multipliés par les quantités exécutées donne le montant de référence avant frais. Cette méthode intègre le spread et l’impact du volume sur les prix du carnet. Le taux taker configuré est appliqué à la somme. Les frais augmentent le montant payé à l’achat et réduisent le montant reçu à la vente.

À l’achat, l’économie possible est le total du devis moins le coût de référence. À la vente, c’est le produit net de référence moins le produit net du devis. Le seuil d’affichage d’une meilleure offre est de 0,25 % du total du devis. Une différence inférieure ou égale au seuil, ou un devis déjà plus favorable que la référence, donne **Bon prix**. Le calcul utilise des décimales avant l’arrondi d’affichage.

## Garde-fous

- Même actif de base, même devise et même quantité. Aucune conversion entre devises ni entre stablecoins.
- Éligibilité du marché, minimums publiés, précision de quantité et profondeur suffisante. Pour Kraken et Binance, le moteur demande jusqu’à 100 niveaux. Les filtres Binance de notionnel sont estimés à partir du carnet. Le moteur de la plateforme peut utiliser un prix de référence distinct.
- Contrôle des protections de prix connues. Kraken est modélisé avec un plafond de spread conservateur de 2,5 % sur les niveaux consommés. [Protection des ordres au marché Kraken](https://support.kraken.com/articles/201648183-market-price-protection).
- Taux taker saisi par l’utilisateur pour la référence. L’estimation suppose que les frais de référence sont appliqués dans la devise de cotation. Un taux vide bloque le verdict. Un taux nul saisi volontairement est accepté.
- Fenêtre de fraîcheur de 20 secondes à partir de la première observation locale du devis et de 12 secondes pour le carnet. Kraken et Binance utilisent l’heure de réponse HTTP comme indication de fraîcheur. Coinbase fournit l’heure du carnet. Sur Kraken, les horodatages des niveaux décrivent leurs mises à jour et ne datent pas le snapshot entier.
- Les conversions, ordres conditionnels, estimations de quantité et totaux ambigus sont écartés par la détection. Le formulaire manuel suppose un devis frais de marché au comptant, avec un total frais compris.

La référence modélise une exécution immédiate à partir d’un snapshot public. Le carnet peut bouger, la liquidité peut disparaître, et des contraintes de compte ou de territoire peuvent empêcher l’exécution. Les coûts de financement, de retrait, de transfert, de change et l’arrondi appliqué aux frais par la plateforme peuvent modifier le résultat réel. Prisme n’effectue aucun ordre, transfert ni connexion à un compte.

## Sources officielles

- Kraken documente les niveaux agrégés du carnet Spot et les tailles, précisions et états de marché dans le catalogue des paires. [Kraken Depth](https://docs.kraken.com/api-reference/market-data/get-order-book) · [Kraken AssetPairs](https://docs.kraken.com/api-reference/market-data/get-tradable-asset-pairs).
- Les pages d’assistance Kraken documentent les étapes et types d’ordres. Les taux dépendent de la plateforme, du marché et du compte. [Acheter sur Kraken](https://support.kraken.com/articles/360051144472-buying-crypto-on-kraken) · [Trader sur Kraken Pro](https://support.kraken.com/articles/how-to-buy-and-sell-on-kraken-pro) · [Barème Kraken](https://www.kraken.com/features/fee-schedule) · [Tarifs Kraken Pro](https://www.kraken.com/pro/fees).

- Binance documente les carnets, les filtres de taille et les limites de notionnel. [Carnet Binance Spot](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints) · [Filtres Binance](https://developers.binance.com/docs/binance-spot-api-docs/filters).
- Coinbase Exchange publie les données produit et les niveaux du carnet. [Produit](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-single-product) · [Carnet](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-book).

## Détection et permissions Chrome

Le script isolé s’exécute uniquement sur `app.kraken.com` et `pro.kraken.com`. Il lit le texte visible du récapitulatif lorsqu’un contexte d’achat ou de vente et des champs explicites permettent d’identifier une transaction comparable. Les pages de connexion, portefeuilles et historiques ne servent pas de sources. Le badge s’affiche uniquement lorsqu’il existe un emplacement libre. Il peut être masqué dans les paramètres.

`storage` sert aux préférences locales. Les permissions d’hôte réseau couvrent `api.kraken.com`, `data-api.binance.vision` et `api.exchange.coinbase.com`. Le service worker fait des requêtes publiques en lecture seule, sans cookies ni clés. Aucun serveur Prisme n’est nécessaire. [Scripts de contenu Chrome](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts) · [Requêtes réseau Chrome](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).
