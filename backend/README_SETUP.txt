THOKBAZAAR CORRECTED BACKEND

Files:
- server.js
- package.json
- db.js
- matching.js
- mailer.js
- supabase_schema.sql

SETUP:
1. Back up your current GitHub files before replacing anything.
2. In Supabase SQL Editor, run supabase_schema.sql once.
3. Replace the matching backend files in the Render service's GitHub repository.
4. Render Build Command: npm install
5. Render Start Command: npm start
6. Set Render environment variables:
   NODE_ENV=production
   JWT_SECRET=<a private random string at least 32 characters long>
   CORS_ORIGIN=https://thokbazaar.store,https://www.thokbazaar.store
   SUPABASE_URL=<your Supabase project URL>
   SUPABASE_SECRET_KEY=<your Supabase secret key>
   SITE_URL=https://thokbazaar.store\n   ADMIN_API_KEY=<a separate private admin key for viewing all buyer requirements>
7. Optional email variables:
   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM

IMPORTANT:
- Do not expose SUPABASE_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET, ADMIN_API_KEY or SMTP_PASS in frontend code.\n- GET /api/requirements requires the x-admin-key header so buyer phone numbers are not publicly exposed.
- This backend now uses Supabase, not SQLite. Existing records in the old SQLite database are NOT automatically migrated. Export/import them before removing the old database if you need to keep them.
- Your frontend must call the Render backend URL for /api endpoints. CORS alone does not set the frontend API base URL.
- The code keeps both /api/auth/login and /api/login route names, and both registration route names, but the frontend request body fields must still match the expected fields.
- Run `npm run check` before deploying if you can.
