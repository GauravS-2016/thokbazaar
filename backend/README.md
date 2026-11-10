# Thokbazaar.store — B2B Wholesale Marketplace

This project combines the new Thokbazaar.store storefront with the existing Express/SQLite backend. The uploaded storefront is the **primary website** and is served at `/` from `public/index.html`. The previous standalone UI is replaced; the existing backend capabilities and database remain the foundation.

The app is independent of Claude, Anthropic, and other AI providers.

## Run locally

1. Install Node.js 18 or newer.
2. In this folder, run `npm install`.
3. Copy `.env.example` to `.env` and set a strong `JWT_SECRET`.
4. Run `npm start`.
5. Open `http://localhost:3000`.

## Main storefront features

- Buyer and seller registration/login (one account can do both).
- Product catalogue, category filters, search, city filter, and sorting.
- Seller product creation, editing, and deletion.
- Buyer product enquiries delivered to the product's seller.
- Buyer requirement posting and a shared requirements feed.
- Seller desk showing owned products and enquiries.
- Custom categories.

## API and data

The primary storefront uses `/api/auth/*`, `/api/products`, `/api/categories`, `/api/requirements`, `/api/enquiries`, and `/api/seller/enquiries`. The backend accepts bearer tokens from the storefront and also retains cookie-based authentication for the older API routes. Existing SQLite data tables are retained; the database module adds the extra storefront columns and tables automatically on startup.

## Deploy with GitHub + Render

GitHub stores the source. Deploy this as a Render **Web Service**, not GitHub Pages, because the application needs a Node.js server.

- Build command: `npm install`
- Start command: `npm start`
- Environment: `NODE_ENV=production`, `JWT_SECRET` (long random secret), `SITE_URL=https://thokbazaar.store`, `DB_PATH=/var/data/thokbazaar.db`
- Attach a persistent disk mounted at `/var/data` so the SQLite database survives redeployments.
- Add `thokbazaar.store` as a custom domain in Render and configure the DNS records Render provides.

Email notifications remain optional. Configure the SMTP variables in `.env.example` if needed. Never commit `.env` or credentials.

## Before launch

Test account registration/login, product create/edit/delete, buyer enquiries, requirement posting, and seller enquiry visibility on the deployed domain. Use HTTPS, a strong JWT secret, a persistent database disk, and regular backups.
