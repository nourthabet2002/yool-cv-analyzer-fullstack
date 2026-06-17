# New features and implementation notes

## Security improvements

- Added Express backend between React and n8n.
- Added JWT authentication before CV analysis.
- Added `/login` and `/verify` routes.
- Protected `/api/upload-cv` with JWT middleware.
- Moved sensitive runtime values to backend `.env`.
- Added backend validation before forwarding files to n8n:
  - `.pdf` extension;
  - MIME type `application/pdf`;
  - maximum size 5 MB;
  - non-empty file;
  - real PDF signature `%PDF-`.
- Kept frontend validation too, so bad files are rejected early.

## Multi-CV processing

- Maximum number of CVs per session: 10.
- Frontend processes files sequentially.
- Each CV has its own tab/result state.
- A failed CV does not erase successful CV results.

## Profile classification

The workflow asks the LLM for a controlled `profileTitle`.

Supported classes include:

- Data Scientist
- Data Analyst
- Ingénieur IA
- Ingénieur Cloud / DevOps
- Développeur Frontend
- Développeur Backend
- Designer UX/UI
- Designer graphique
- Chargé de communication
- Assistant Finance
- Assistant RH
- Profil non classé

The frontend also has a fallback classifier. If n8n returns `Profil non classé`, React tries to infer a profile from extracted skills, education and summary.

## Filtering and ranking

The results panel now groups CVs by detected profile.

When the user selects a profile, the app displays a ranked list of CVs in that class.

Ranking criteria:

- skills matching the selected profile;
- richness of extracted skills;
- projects or experience keywords;
- relevant education;
- CV completeness;
- optional job criteria typed by the recruiter.

The score is explainable: the UI shows badges such as `Profil IA / Data`, `compétence(s) clé(s)`, `Projets/expérience`, `Formation pertinente`, `CV complet`, or `Offre peu couverte`.

## Job criteria

The recruiter can type criteria such as:

```text
Python, SQL, machine learning, NLP, Power BI
```

These criteria affect ranking order only. They do not change the detected profile class.

## OCR support

Docker now uses:

```text
apache/tika:latest-full
```

This image includes Tesseract OCR.

The n8n Tika request sends:

```text
X-Tika-PDFOcrStrategy: ocr_and_text_extraction
X-Tika-OCRLanguage: eng+fra
```

This allows scanned/image-based PDFs to be processed when OCR can read the document. OCR is slower than regular text extraction.

Observed local timing:

- text PDF: often around 10 to 15 seconds;
- scanned/image PDF: often 30 seconds or more.

## n8n workflow

The sanitized workflow is stored at:

```text
infra/n8n/workflows/yool-cv-analyzer-workflow.json
```

It does not contain a real API key. The OpenRouter key must be provided to the n8n container through:

```powershell
$env:OPENROUTER_API_KEY="paste-your-openrouter-key-here"
```

Google Sheets is optional and non-blocking for local testing.

Telegram is optional and disabled until credentials are configured.
