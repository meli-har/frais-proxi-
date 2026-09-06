# Frais Proxi V5.5.1

Nouveautés :
- photos produits dans le catalogue et la liste Produits ;
- récupération automatique de la photo via Open Food Facts quand l'EAN est connu ;
- possibilité de renseigner manuellement une URL de photo ;
- saisie de plusieurs DLC et quantités en une seule fois pour une même référence ;
- regroupement des DLC sous une seule fiche produit ;
- suppression indépendante d'une DLC.

## Mise à jour
1. Exécuter `supabase-v5.5.sql` une seule fois dans Supabase SQL Editor.
2. Remplacer sur GitHub : `index.html`, `app.js`, `style.css`, `manifest.webmanifest`, `README.md`, `sw.js`.
3. Ouvrir l'application avec `?v=55` lors du premier test.

Les photos automatiques dépendent de la présence d'une photo pour l'EAN dans Open Food Facts. Si aucune photo n'est disponible, l'application affiche un emplacement neutre et l'administrateur peut renseigner une URL de photo dans la fiche catalogue.


## Correctifs V5.5.1
- Le bouton « Ajouter des DLC » reprend automatiquement le nom, l’EAN, le rayon et les notes de la référence.
- Dans Mes produits, le nom du catalogue et la photo sont utilisés même si une ancienne DLC avait été enregistrée avec l’EAN comme nom.
- Aucun nouveau SQL Supabase n’est nécessaire après la V5.5.
