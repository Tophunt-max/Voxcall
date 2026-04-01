# VoxLink — GitHub Actions Deployment Guide

## Required GitHub Secrets

Go to: **GitHub Repo → Settings → Secrets and variables → Actions → New repository secret**

| Secret | Description |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token (Workers:Edit + Pages:Edit permissions) |
| `JWT_SECRET` | JWT signing secret for backend (e.g. `voxlink-dev-secret-key-2024-local-only`) |
| `CF_CALLS_APP_SECRET` | Cloudflare Calls App Secret (optional) |
| `VITE_API_URL` | Admin panel API URL (default: `https://voxlink-api.ssunilkumarmohanta3.workers.dev`) |
| `EXPO_PUBLIC_API_URL` | Mobile app API URL (default: `https://voxlink-api.ssunilkumarmohanta3.workers.dev`) |

## Workflows

### 1. Backend (`deploy-backend.yml`)
- **Trigger**: Push to `main` (files in `artifacts/api-server/**`)
- **Deploys to**: Cloudflare Workers (`voxlink-api`)
- **Also sets**: `JWT_SECRET` and `CF_CALLS_APP_SECRET` as Worker secrets

### 2. Admin Panel (`deploy-admin.yml`)
- **Trigger**: Push to `main` (files in `artifacts/admin-panel/**` or `lib/**`)
- **Deploys to**: Cloudflare Pages project: `voxlink-admin`
- **First deploy**: Cloudflare Pages project will be auto-created

### 3. Mobile Web (`deploy-mobile.yml`)
- **Trigger**: Push to `main` (files in `artifacts/voxlink/**` or `lib/**`)
- **Deploys to**: Cloudflare Pages project: `voxlink-mobile`
- **Exports**: Expo web build → static site

## First-Time Setup for Cloudflare Pages

Before running the workflows, create the Pages projects manually (or let the action create them):

```bash
# Admin Panel
wrangler pages project create voxlink-admin

# Mobile Web
wrangler pages project create voxlink-mobile
```
