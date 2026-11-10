# Thokbazaar backend

This backend is designed around the uploaded `Thokbazaar.html` marketplace: products, categories, seller accounts, buyer enquiries and buyer requirements.

## What is included
- Express REST API
- SQLite persistence (created automatically in `data/thokbazaar.sqlite`)
- Seller registration/login with bcrypt password hashing and JWT sessions
- Product listing, search/filter/sort, create/edit/delete (only the owner can edit/delete)
- Built-in categories plus custom categories
- Buyer price enquiries and buyer requirements
- Basic security headers, request rate limiting, input validation

## Run locally
Requires Node.js 20+.

1. Copy `public/Thokbazaar.html` (included) into `public/` if it is not already there.
2. Copy `.env.example` to `.env`.
3. Set `JWT_SECRET` to a random secret of at least 32 characters.
4. In this folder run:
   ```bash
   npm install
   npm run dev
   ```
5. Open http://localhost:3000/api/health to check the API.

The SQLite database is created automatically. Back it up before deploying or changing storage.

## API routes
- `GET /api/health`
- `POST /api/auth/register` `{name,email,password,businessName,city}`
- `POST /api/auth/login` `{email,password}`
- `GET /api/auth/me` (Bearer token)
- `GET /api/categories`, `POST /api/categories` (Bearer token)
- `GET /api/products?q=&cat=all&city=all&sort=new&limit=200&offset=0`
- `POST /api/products` (Bearer token)
- `PATCH /api/products/:id` (Bearer token; owner only)
- `DELETE /api/products/:id` (Bearer token; owner only)
- `POST /api/enquiries` `{productId,quantity,name,phone}`
- `GET /api/seller/enquiries` (Bearer token; seller sees their own enquiries)
- `POST /api/requirements` `{productName,quantity,unit,city,phone}`
- `GET /api/requirements`

All phone numbers are stored in the database because the original page explicitly asks sellers to call buyers. Treat these as personal data: disclose this to users, restrict database access, and set a retention policy before public launch.

## Important integration note
The uploaded HTML currently uses `claude.use('db')` and `claude.use('user')`, which are host-specific APIs and will not work on a normal web host. This package supplies a normal REST backend, but the page's existing JavaScript still needs its data calls wired to `/api/*` and a seller login/register interface before the whole marketplace is production-ready. The uploaded HTML is included unchanged as `public/Thokbazaar.html` so you can merge the API and UI deliberately without losing your design.

For deployment, use HTTPS, set `CORS_ORIGIN` to your actual site origin, keep `.env` private, add backups/monitoring, and review Indian privacy and consumer requirements before accepting real customer data.
