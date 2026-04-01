# VoxLink — Production Deployment Guide

## Architecture

| App | Deploy Target | URL |
|---|---|---|
| Backend API | Cloudflare Workers | `voxlink-api.ssunilkumarmohanta3.workers.dev` |
| Admin Panel | Cloudflare Pages | `voxlink-admin.pages.dev` |
| Mobile Web | Cloudflare Pages | `voxlink-mobile.pages.dev` |

---

## GitHub Secrets
> Settings → Secrets and variables → Actions → **Secrets tab**

These are sensitive — never hardcode in code or logs.

| Secret | Description |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token with **Workers:Edit** + **Pages:Edit** + **workflow** scope |
| `JWT_SECRET` | Strong random string (min 32 chars) for JWT signing |
| `CF_CALLS_APP_SECRET` | Cloudflare Calls App Secret for WebRTC |

---

## GitHub Variables
> Settings → Secrets and variables → Actions → **Variables tab**

These are non-sensitive config values — safe to view.

| Variable | Value |
|---|---|
| `CF_ACCOUNT_ID` | `b592b3b2a5455323a76de721a92699cd` |
| `VITE_API_URL` | `https://voxlink-api.ssunilkumarmohanta3.workers.dev` |
| `EXPO_PUBLIC_API_URL` | `https://voxlink-api.ssunilkumarmohanta3.workers.dev` |

---

## Workflows

### `deploy-backend.yml` — Cloudflare Workers
- Trigger: push to `main` touching `artifacts/api-server/**`
- Runs `wrangler deploy`
- Sets `JWT_SECRET` and `CF_CALLS_APP_SECRET` as Worker secrets (via env block, never echoed)

### `deploy-admin.yml` — Cloudflare Pages (`voxlink-admin`)
- Trigger: push to `main` touching `artifacts/admin-panel/**` or `lib/**`
- Builds with `VITE_API_URL` from GitHub Variables
- Deploys static output to Cloudflare Pages

### `deploy-mobile.yml` — Cloudflare Pages (`voxlink-mobile`)
- Trigger: push to `main` touching `artifacts/voxlink/**` or `lib/**`
- Exports Expo web build with `EXPO_PUBLIC_API_URL` from GitHub Variables
- Deploys static output to Cloudflare Pages

---

## Local Development

No `.env` files are committed. Use the `.example` files:

```bash
# Admin Panel
cp artifacts/admin-panel/.env.example artifacts/admin-panel/.env

# Mobile App
cp artifacts/voxlink/.env.example artifacts/voxlink/.env

# Backend (Wrangler local dev)
cp artifacts/api-server/.dev.vars.example artifacts/api-server/.dev.vars
```

Fill in your local values — these files are gitignored.
