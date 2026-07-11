# Security Notes

## ⚠️ ACTION REQUIRED: Rotate the previously hardcoded admin credentials

Earlier versions of `api-server/seed.sql` committed a real admin account:

- a real admin **email address**,
- the admin **password in a plaintext comment**, and
- a **weak, unsalted SHA-256 password hash**.

Those values are still recoverable from **git history** even though the current
`seed.sql` uses placeholders. If a production/staging database was ever seeded
with that file, the `admin-001` account is compromised. You must:

1. **Change the admin password now.** Log in and set a new strong, random
   password (this re-hashes it with the current PBKDF2 scheme in
   `api-server/src/lib/hash.ts`), or update the `admin-001` row's
   `password_hash` directly in D1 with a freshly generated PBKDF2 hash.
2. **Change the admin email** if the leaked address is sensitive.
3. Treat the old password as public and never reuse it anywhere.

Server-side token revocation (`users.token_invalidated_at`) means changing the
password also invalidates any tokens issued to the old admin session.

## Secret management

- All runtime secrets (`JWT_SECRET`, `AGORA_APP_CERTIFICATE`,
  `FIREBASE_SERVICE_ACCOUNT`, gateway webhook secrets, `RESEND_API_KEY`, etc.)
  are set as Cloudflare Worker secrets — never hardcoded. See
  `api-server/.dev.vars.example` and `.github/workflows/deploy-backend.yml`.
- `.env`, `.dev.vars`, `google-services.json`, and `GoogleService-Info.plist`
  are gitignored. Only `*.example` placeholder files are committed.
- Never commit a real `password_hash`, API key, or connection string.

## Security controls already in place

- Passwords: PBKDF2 (100k iterations, salted) with constant-time verification.
- Auth: JWT with server-side revocation, 30-day refresh ceiling, per-request
  ban/status re-check.
- Payments: every gateway webhook verifies its signature with constant-time
  comparison; coins are credited via an atomic compare-and-set (no double
  credit); pricing is computed server-side.
- Uploads: server-side MIME + magic-byte validation, size limits.
- Access control: ownership checks on all user/call/chat routes; admin routes
  gated by role (read from the DB, not the token) + per-admin rate limiting.
- Public file serving blocks path traversal and KYC/identity documents.
- Security response headers (nosniff, X-Frame-Options, HSTS, CSP) are set on
  every API response.

## Recent security hardening (audit 2025-07)

The following issues were identified and fixed in a 5-point security audit
(based on Gitleaks, Bearer, ECC Production Audit, Trail of Bits, ECC Security
Review methodologies):

| # | Issue | Fix |
|---|-------|-----|
| 1 | Admin panel logout did not invalidate token server-side | `auth.tsx` now calls `POST /api/auth/logout` before clearing localStorage |
| 2 | Email PII leaked into Workers Logs when RESEND_API_KEY was missing | Recipient email redacted in `email.ts` log output |
| 3 | CORS ran with broad dev patterns when `CORS_ALLOWED_ORIGINS` unset in prod | Startup warning logged; operators must set the env var for production |
| 4 | Mobile apps stored tokens in unencrypted AsyncStorage | Added `secureStorage.ts` wrapper using expo-secure-store (Keychain/Keystore) |
| 5 | No explicit documentation of security posture for new contributors | This section added; controls enumerated above |

### Known limitations (tracked, not yet fixed)

- **Admin panel token in localStorage** — vulnerable to XSS on the admin
  origin. Long-term fix: migrate to httpOnly + Secure + SameSite=Strict cookie
  set by the API server. Requires a backend cookie-session endpoint.
- **Mobile SecureStore adoption** — the `secureStorage.ts` wrapper is available
  but callers in `services/api.ts` still use the legacy `setItem`/`getItem`.
  A follow-up PR should swap AUTH_TOKEN / REFRESH_TOKEN reads/writes to
  `secureSet`/`secureGet`/`secureRemove`.
- **CORS dev patterns** — when `CORS_ALLOWED_ORIGINS` is not set, `*.pages.dev`
  and `*.replit.dev` are allowed. For production deployments, always set the
  env var to an explicit comma-separated allowlist of frontend domains.
