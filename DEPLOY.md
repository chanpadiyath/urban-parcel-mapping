# Deploying (Netlify + Render, both free)

Two independent services, in this order — the backend first (the frontend
needs its URL), then the frontend, then one setting back on the backend.

## 1. Backend — Render

1. Sign in at [render.com](https://render.com) (GitHub login works).
2. **New +** → **Blueprint** → connect this GitHub repo (`chanpadiyath/urban-parcel-mapping`)
   → branch `restructure-frontend-backend` (or `main` once the PR is merged).
   Render reads [`render.yaml`](./render.yaml) at the repo root automatically —
   review the plan (one free web service) and click **Apply**.
3. Note the URL Render assigns, e.g. `https://urban-parcel-api.onrender.com`.
4. Confirm it's up: open `https://<your-url>/api/health` — should show
   `{"ok":true,...}`. First request after idle can take ~30–50s (see
   **Limits** below).

Leave `CORS_ORIGINS` and `GOOGLE_MAPS_API_KEY` alone for now — steps 2–3
below.

## 2. Frontend — Netlify

1. Sign in at [netlify.com](https://netlify.com) (GitHub login works).
2. **Add new site** → **Import an existing project** → same GitHub repo,
   same branch. Netlify reads [`netlify.toml`](./netlify.toml) automatically
   (base directory `frontend`, build `npm run build`, publish `dist`) — no
   manual settings needed.
3. Before the first deploy (or after, then redeploy): **Site configuration →
   Environment variables → Add a variable**:
   - `VITE_SIM_API` = `https://<your-render-url>/api` (from step 1.3, with `/api` appended)
4. Deploy. Note the site's URL, e.g. `https://your-site.netlify.app`.

## 3. Point the backend at the frontend (CORS)

Browsers block cross-origin requests unless the server allows them, so the
backend needs to know the frontend's exact URL:

1. Back in the Render dashboard → your service → **Environment**.
2. Set `CORS_ORIGINS` to your Netlify URL from step 2.4 (no trailing slash).
   If you'll also use a custom domain, comma-separate both:
   `https://your-site.netlify.app,https://yourdomain.com`
3. Save — Render redeploys automatically. Reload the frontend; the "Data
   sources" panel and the Land Simulation page should now show live data.

## Optional: Google Places / Geocoding

Only needed for the address-search fallback and "Nearby (Google Places)"
parcel enrichment — see
[`DATA.md`](./DATA.md#places--geocoding--real-google-maps-platform-optional).
Set `GOOGLE_MAPS_API_KEY` in Render's environment variables the same way.
Without it, those two features cleanly report "unavailable"; nothing else
is affected.

## Limits of the free tiers (be honest with yourself about these)

- **Render free web services sleep after 15 minutes of no traffic** and take
  roughly 30–50 seconds to wake on the next request. Fine for a demo you're
  actively showing; a first cold load after idle time will feel slow.
  Same reason the flood simulation's `Affected roads`/parcel state resets
  on each cold start — it's in-memory, not a database.
- **One instance only.** Don't scale this service to >1 instance — the flood
  engine's state lives in the process; multiple instances would each run
  their own, independent simulation.
- Both platforms may ask for a card on paid tiers only; the tiers used here
  historically haven't, but check current terms at signup since they change.

## Updating after this

Every push to the connected branch redeploys both sides automatically
(Netlify and Render both watch the repo). No extra steps.
