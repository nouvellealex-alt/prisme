# Brief produit · Prisme

**Prompt de conception.** Construire une extension qui répond en quelques secondes à la question « combien me coûte vraiment cette transaction et que coûterait-elle sur le marché que j’ai choisi ? ». Partir d’un devis final, détecté si le récapitulatif est reconnu ou saisi manuellement. Comparer le même sens, le même actif, la même quantité et la même devise. Montrer le total du devis, le montant estimé au carnet, les frais de la référence et l’écart. Donner la priorité à un état indisponible clair lorsque les données ne permettent pas une comparaison honnête.

| Problème | Réponse produit |
| --- | --- |
| Le prix affiché et le montant débité peuvent différer | Comparer le total final du devis, frais et spread inclus dans le prix affiché |
| Un carnet bouge et le premier prix ne suffit pas pour une grosse quantité | Parcourir les niveaux disponibles et faire expirer le résultat |
| Le taux de frais dépend du compte, de la paire et de l’ordre | Enregistrer un taux taker explicite par référence, sans taux inventé |
| EUR, USD et USDT ne sont pas interchangeables | Chercher la paire exacte et afficher son indisponibilité si elle manque |
| Une estimation Spot et un paiement par carte ont des coûts différents | Détailler la référence et isoler les coûts externes que le carnet ne mesure pas |
| Les interfaces de devis changent selon le site et le compte | Garder la détection prudente et offrir la saisie manuelle pour toute plateforme |
