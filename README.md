# Frais Proxi V4.2

Version synchronisée avec Supabase pour **Proxi - Monéteau**.

- Code magasin : `582941`
- Produits/DLC partagés entre les téléphones
- Scanner code-barres conservé
- Synchronisation automatique toutes les 8 secondes + au retour dans l'app
- URL Supabase et clé publiable intégrées (aucune clé secrète)

## Important dans Supabase
Authentication > Sign In / Providers > **Allow anonymous sign-ins = ON**.

Pour éviter une erreur de séquence lors de l'ajout de produits, exécuter une fois dans SQL Editor :

```sql
grant usage, select on all sequences in schema public to authenticated;
alter table public.produits add column if not exists retire_at timestamptz;
```
