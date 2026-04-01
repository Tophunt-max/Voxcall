# VoxLink — GitHub Actions Deployment Guide

## Required GitHub Secrets

Go to: **GitHub Repo → Settings → Secrets and variables → Actions → New repository secret**

| Secret | Description |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token (Workers:Edit + Pages:Edit permissions) |
| `JWT_SECRET` | JWT signing secret for the backend Worker |
| `CF_CALLS_APP_SECRET` | Cloudflare Calls App Secret (optional) |
| `VITE_API_URL` | Admin panel API URL (optional — default is the production Workers URL) |
| `EXPO_PUBLIC_API_URL` | Mobile app API URL (optional — default is the production Workers URL) |

## Workflows

### 1. Backend (`deploy-backend.yml`)
- **Trigger**: Push to `main` (files in `artifacts/api-server/**`)
- **Deploys to**: Cloudflare Workers (`voxlink-api`)
- **Also sets**: `JWT_SECRET` and `CF_CALLS_APP_SECRET` as Worker secrets via env block (never echoed in logs)

### 2. Admin Panel (`deploy-admin.yml`)
- **Trigger**: Push to `main` (files in `artifacts/admin-panel/**` or `lib/**`)
- **Deploys to**: Cloudflare Pages project: `voxlink-admin`

### 3. Mobile Web (`deploy-mobile.yml`)
- **Trigger**: Push to `main` (files in `artifacts/voxlink/**` or `lib/**`)
- **Deploys to**: Cloudflare Pages project: `voxlink-mobile`
- **Exports**: Expo web build → static site
