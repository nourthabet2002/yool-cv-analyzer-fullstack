# YOOL CV Analyzer Fullstack

Application web d'analyse automatique de CV PDF.

La solution combine :

- frontend React ;
- backend Express sécurisé par JWT ;
- workflow n8n ;
- Apache Tika Full avec Tesseract OCR ;
- OpenRouter LLM pour l'extraction structurée ;
- Google Sheets optionnel ;
- Telegram optionnel.

## Fonctionnalités principales

- Authentification avant analyse.
- Validation des PDF côté frontend et backend.
- Analyse jusqu'à 10 CVs par session.
- Extraction de texte depuis PDF textuels.
- OCR pour CVs scannés ou image-only.
- Extraction JSON : nom, email, téléphone, compétences, formation, résumé, profil.
- Normalisation des profils détectés.
- Filtres par profil.
- Classement intra-profil avec score explicable.
- Critères de poste optionnels pour influencer le classement.

## Démarrage rapide

Voir [LOCAL_SETUP.md](LOCAL_SETUP.md).

## Nouveautés documentées

Voir [docs/NEW_FEATURES.md](docs/NEW_FEATURES.md).
