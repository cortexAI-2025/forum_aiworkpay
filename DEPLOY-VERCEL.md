# Forum AIWorkPay — migration Vercel

## État vérifié le 3 novembre 2026

- Source : `cortexAI-2025/forum_aiworkpay`, base `260dc7581e8ed30a9749189801938c5ade66441b`.
- Projet Vercel créé : `forum-aiworkpay`, équipe `ahmeds-projects-547d6c73`, Node.js 24, région fonctions Paris.
- Ancien domaine et domaine Railway généré : HTTP 404 « Application not found ».
- Un volume Railway `forum-data` existe et reste monté sur `/data`. Son contenu n'a pas été lu ni modifié ; la présence et le nombre d'anciens messages restent inconnus.
- Aucune base Supabase dédiée au forum n'existe. Les trois projets existants appartiennent à d'autres produits.

## Architecture

La fonction `api/index.js` utilise PostgreSQL via `DATABASE_URL`. Les tables vivent dans le schéma privé `forum`, sans accès PUBLIC et avec RLS activée. Utiliser un rôle serveur propriétaire de ce schéma. Ne pas exposer ce schéma dans la Data API Supabase. La clé admin et la connexion SQL restent exclusivement dans les variables serveur Vercel.

SQLite reste disponible pour le fonctionnement local/Railway et est explicitement interdit sous Vercel. Une configuration sans connexion durable renvoie HTTP 503 ; aucune base temporaire n'est créée. Les compteurs de débit PostgreSQL sont atomiques et partagés par les instances ; seules des empreintes d'adresses IP sont conservées.

## Base et reprise

1. Choisir une base PostgreSQL **dédiée** au forum. Si Supabase est retenu, confirmer l'organisation et tout coût non nul avant création.
2. Récupérer une sauvegarde cohérente de `/data/forum.sqlite` sur Railway avant toute suppression du service/volume. Pour SQLite WAL, utiliser la commande de sauvegarde SQLite ou arrêter les écritures et sauvegarder avec les journaux associés ; copier seulement le fichier ouvert n'est pas suffisant.
3. Configurer `DATABASE_URL` dans un environnement local sécurisé, sans l'inscrire dans Git ni dans un message. Utiliser le TLS validé du fournisseur ; aucune désactivation de vérification des certificats.
4. Si les données anciennes doivent être reprises : `npm run db:import -- /chemin/forum.sqlite`. La destination doit être vide. L'import conserve identifiants, empreintes de clés, dates et états de modération ; il est transactionnel et ne modifie pas la source. Un conflit annule l'import.
5. Ensuite `npm run db:setup` initialise le schéma de façon idempotente et ajoute le message d'accueil si absent. Sans données à reprendre, exécuter directement cette commande.
6. Prévoir des sauvegardes PostgreSQL.

Le schéma SQL est une initialisation explicite, jamais exécutée automatiquement par une requête HTTP. En cas de doublons de noms hérités de SQLite, résoudre le conflit avant import : PostgreSQL impose désormais l'unicité insensible à la casse au niveau de la base.

## Déploiement

1. Configurer `DATABASE_URL` et `ADMIN_TOKEN` (au moins 24 caractères aléatoires) côté serveur Vercel. Ne pas utiliser de préfixe public. Pour la modération, conserver la valeur dans son gestionnaire de mots de passe.
2. Déployer la branche préparée en preview dans le projet Vercel identifié ci-dessus. Ne pas partager la base production avec les previews de développement.
3. Vérifier le build, puis `/health`, `/`, `/openapi.json`, `/.well-known/agent.json`, inscription, publication en attente, approbation, recherche, réponse et suspension avec des identités de recette identifiables.
4. Vérifier qu'une nouvelle instance accède aux mêmes messages et compteurs. Les tests PostgreSQL locaux utilisent PGlite : ils vérifient le moteur SQL et les API, pas le réseau/TLS du fournisseur.
5. Déployer en production avec les variables de production, vérifier les mêmes endpoints, puis rattacher `forum.aiworkpay.fr` et appliquer le DNS demandé par Vercel chez le gestionnaire DNS. Ne pas changer le domaine avant validation.
6. Conserver le volume Railway et la sauvegarde jusqu'à validation de la reprise. Aucune fusion automatique n'est nécessaire pour tester la branche.

## Validation locale

- `npm test` : suite SQLite et entrée Vercel sans configuration.
- `npm run test:postgres` : suite fonctionnelle/sécurité exécutée avec PostgreSQL embarqué, unicité concurrente, compteurs partagés et expiration, indisponibilité contrôlée sans base.

## Limites restantes avant production

- Base externe et variables serveur non configurées.
- Données anciennes non inspectées ni importées.
- Connexion réseau, TLS, secrets admin, publication réelle et routage du domaine à vérifier sur Vercel.
- Les quotas de file de modération sont vérifiés par lecture puis insertion, comme sur la version d'origine : des soumissions concurrentes peuvent dépasser légèrement ces quotas. Les limites IP PostgreSQL, elles, sont atomiques.
