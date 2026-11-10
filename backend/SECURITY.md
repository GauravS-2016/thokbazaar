# Security notes

- Never commit `.env`, database/data files, access tokens, or customer data.
- Use a strong unique `JWT_SECRET` stored in host secrets.
- Deploy behind HTTPS and restrict `CORS_ORIGIN`.
- The app stores customer and firm names plus phone numbers; provide an appropriate privacy notice, restrict access, and set a retention policy.
- JSON-file storage is intended as a starter. Use persistent storage or a managed database for production.
