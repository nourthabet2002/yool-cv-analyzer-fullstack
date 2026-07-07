# YOOL CV Analyzer - local setup

This guide starts the full local stack on a new PC.

## Services

- Frontend React app: http://localhost:3000
- Backend Express API: http://localhost:5000
- n8n workflow editor: http://localhost:5679
- Apache Tika Full with OCR: http://localhost:9998/tika
- PostgreSQL: localhost:5433

## Requirements

- Node.js and npm
- Docker Desktop
- An OpenRouter API key for the LLM node

## 1. Configure backend env

The repository includes `backend/.env` with local development values:

```env
PORT=5000
JWT_SECRET=dev-local-jwt-secret-change-me
CORS_ORIGIN=http://localhost:3000
N8N_WEBHOOK_URL=http://localhost:5679/webhook/upload-cv
DATABASE_URL=postgres://n8n:n8npass@localhost:5433/n8n_demo
```

For a real deployment, replace `JWT_SECRET` with a stronger private value.
`DATABASE_URL` enables non-blocking PostgreSQL persistence of successful CV analyses.

## 2. Start Docker services

From the cloned repo root:

```powershell
$env:OPENROUTER_API_KEY="paste-your-openrouter-key-here"
docker compose -f .\infra\docker-compose.yml up -d
```

This starts n8n, PostgreSQL and Apache Tika Full. Tika Full includes Tesseract OCR, so scanned/image-based PDF CVs can be processed when the scan quality is readable.
PostgreSQL is exposed on host port `5433` so the local backend can save analysis history without interfering with a local PostgreSQL installation on port `5432`.

## 3. Import n8n workflow

From the cloned repo root:

```powershell
docker cp ".\infra\n8n\workflows\yool-cv-analyzer-workflow.json" yool-cv-analyzer-fullstack-n8n-1:/tmp/workflow.json
docker exec yool-cv-analyzer-fullstack-n8n-1 n8n import:workflow --input=/tmp/workflow.json
docker exec yool-cv-analyzer-fullstack-n8n-1 n8n list:workflow
```

Copy the workflow ID printed by `list:workflow`, then publish it:

```powershell
docker exec yool-cv-analyzer-fullstack-n8n-1 n8n publish:workflow --id=<workflow-id>
docker exec yool-cv-analyzer-fullstack-n8n-1 n8n update:workflow --id=<workflow-id> --active=true
docker compose -f .\infra\docker-compose.yml restart n8n
```

Open http://localhost:5679 to inspect the workflow.

## 4. Optional integrations

PostgreSQL, Google Sheets and Telegram are separate persistence/notification paths:

- PostgreSQL stores each successful analysis in the `cv_analyses` table when `DATABASE_URL` is set.
- Google Sheets remains optional and is kept in parallel for quick external review/export.
- Telegram remains optional for notification.

- Google Sheets is `continueOnFail`, so missing credentials should not block the frontend result.
- Telegram is disabled in the workflow until valid local credentials are created.

To enable them:

1. Open the workflow in n8n.
2. Create/select Google Sheets credentials on `Append row in sheet`.
3. Create/select Telegram credentials on `Send a text message`.
4. Enable the Telegram node.
5. Publish the workflow again and restart n8n.

## 5. Start backend

From `backend`:

```powershell
npm install
npm start
```

Default test users:

```text
admin / admin123
recruiter / recruiter123
```

## 6. Start frontend

From `frontend`:

```powershell
npm install
npm start
```

Open http://localhost:3000.
The frontend can use `frontend/.env.local` if the backend URL changes:

```env
REACT_APP_BACKEND_URL=http://localhost:5000
```

## 7. Admin database page

Log in as:

```text
admin / admin123
```

Click `Admin DB` in the top bar. The page calls `/api/analyses` and shows:

- total saved analyses;
- number of detected profiles;
- latest analysis date;
- profile distribution;
- recent PostgreSQL analysis rows.

Recruiter users cannot access this endpoint.

## 8. Export PostgreSQL analyses

From `backend`, after PostgreSQL contains data:

```powershell
npm run export:analyses
```

The CSV is written to:

```text
backend/exports/cv_analyses_export.csv
```

This can be used to prepare evaluation tables for the report.

## 9. Test OCR

Use a text PDF first, then a scanned/image-based PDF. OCR is slower than direct text extraction; scanned CVs can take 30 seconds or more depending on image quality.

## Troubleshooting

If the app shows:

```text
The requested webhook "POST upload-cv" is not registered
```

the workflow is imported but not published/active. Re-run:

```powershell
docker exec yool-cv-analyzer-fullstack-n8n-1 n8n publish:workflow --id=<workflow-id>
docker exec yool-cv-analyzer-fullstack-n8n-1 n8n update:workflow --id=<workflow-id> --active=true
docker compose -f .\infra\docker-compose.yml restart n8n
```

## Stop everything

```powershell
docker compose -f .\infra\docker-compose.yml down
```

Stop frontend/backend terminals with `Ctrl+C`.
