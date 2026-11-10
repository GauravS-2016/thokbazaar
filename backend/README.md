# thokbazaar.store — Backend API

Node.js 20+ and Express REST API. This folder is deployed separately from `frontend/`.

## Run locally
1. `cd backend`
2. Copy `.env.example` to `.env`.
3. Set `JWT_SECRET` to a private random value at least 32 characters long.
4. Run `npm install` then `npm run dev`.
5. API health check: `http://localhost:3000/api/health`

Set `CORS_ORIGIN` to the exact origin hosting the frontend (for example `http://localhost:5500` during local development). Keep `.env` private.

The JSON file store uses `DATA_DIR`; use persistent storage or a managed database for production.
