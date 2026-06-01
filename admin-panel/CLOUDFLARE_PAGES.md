# Cloudflare Pages — Admin Panel deployment

This project is deployed via the **Cloudflare Pages → GitHub** direct
integration (no GitHub Actions involved). The settings below are what the
Cloudflare dashboard needs to look like for builds to succeed against this
pnpm monorepo.

> If the build fails the very first thing to do is open the failing build
> on the Cloudflare dashboard and copy the last ~30 lines of the build log
> — that's the only authoritative source of "what went wrong".

## Why builds were failing

Root `pnpm run build` runs `typecheck` + every workspace's `build` script.
That includes the **api-server** (which calls `wrangler deploy --dry-run`,
needing Cloudflare creds at build time) and the two **Expo** apps (which
need a long list of `EXPO_PUBLIC_FIREBASE_*` environment variables and
native-only deps that don't exist on CF Pages' Linux build container).

Cloudflare Pages auto-detects pnpm workspaces and defaults its build
command to the equivalent of `pnpm install && pnpm run build`. With the
default, the admin-panel build succeeds but a sibling workspace's build
fails and the whole job is marked failed. So the admin panel never gets
deployed.

The fix is a **targeted build command** that only builds the admin panel.

## Required dashboard settings

In **dash.cloudflare.com → Workers & Pages → `voxlink-admin` (or whatever
your project is called) → Settings → Builds & deployments**:

| Field | Value |
|---|---|
| **Production branch** | `main` |
| **Build command** | `pnpm run build:admin` |
| **Build output directory** | `admin-panel/dist` |
| **Root directory (advanced)** | *leave empty* |

`pnpm run build:admin` is a new script in the **root** `package.json`
(see commit) that resolves to `pnpm --filter @workspace/admin-panel build`.
It only builds admin-panel, so the api-server / Expo builds that need
extra creds are skipped.

## Required environment variables (Production)

Add these under **Settings → Environment variables → Production**:

| Variable | Value | Why |
|---|---|---|
| `NODE_VERSION` | `22` | Vite 7 + several catalog deps need Node 20+. CF Pages defaults to 18 unless told otherwise. The repo also ships `.node-version` and `.nvmrc` files which CF Pages reads, but the env var is more explicit. |
| `PNPM_VERSION` | `10.26.1` | Matches `packageManager` in the root `package.json`. CF Pages picks up the field automatically via Corepack but pinning prevents drift. |
| `NODE_ENV` | `production` | `vite.config.ts` switches `base` from `/admin-panel/` (dev) to `/` (production) when this is set. |

(Optional) If you want **preview deployments** for non-main branches:

| Variable | Value |
|---|---|
| `NODE_VERSION` | `22` |
| `PNPM_VERSION` | `10.26.1` |
| `NODE_ENV` | `production` |

…in **Environment variables → Preview** (same names, just under Preview).

## SPA routing

`admin-panel/public/_redirects` already contains:

```
/* /index.html 200
```

so Cloudflare Pages serves the SPA's `index.html` for every unknown path
(client-side router handles the rest). No action needed — this file is
copied into `dist/` automatically by Vite.

## Local sanity check

To reproduce what Cloudflare Pages does, from the repo root:

```bash
pnpm install --frozen-lockfile
pnpm run build:admin
ls admin-panel/dist
```

If that works locally and the CF Pages build still fails, the failure is
almost always one of:

1. `NODE_VERSION` env var not set in dashboard → CF Pages used Node 18 →
   one of the catalog deps requires 20+. Set `NODE_VERSION=22`.
2. Wrong build command in dashboard (still on `pnpm run build` instead of
   `pnpm run build:admin`).
3. Wrong build output directory (must be `admin-panel/dist`, not `dist`).
4. Cached old install. Click "Retry deployment" with "Clear build cache".
