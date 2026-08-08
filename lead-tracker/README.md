# RHX Job Board

A lead/job tracker board (New Lead → Bid → Won/Lost → In Progress → Completed → Paid), rebuilt
as a self-hosted app with a real backend instead of client-side `window.storage`.

- **Server:** Node.js + Express + SQLite (`better-sqlite3`), one API for leads + auth
- **Client:** React (Vite build), same board UI as the original component
- **Auth:** two shared passcodes (editor / viewer), verified server-side, session kept in an
  httpOnly cookie — no client can grant itself edit access the way the original demo did
- **Data:** a single SQLite file on disk (`leads.db`) — back it up like any file, no external
  database service required

## Project layout

```
lead-tracker/
  server/   Express API + SQLite
  client/   React app (Vite)
  Dockerfile
  docker-compose.yml
```

## Local development

Requires Node 20+.

```bash
cd lead-tracker
cp .env.example server/.env   # fill in SESSION_SECRET, OWNER_PASSCODE, VIEWER_PASSCODE
npm install --prefix server
npm install --prefix client

# terminal 1
npm run dev --prefix server

# terminal 2
npm run dev --prefix client
```

Open the client dev server URL (Vite prints it, typically http://localhost:5173). It proxies
`/api` requests to the Express server on port 4000, so both need to be running.

## Running with Docker (recommended for deploying)

1. Copy `.env.example` to `.env` and fill in real values:
   - `SESSION_SECRET` — generate with `openssl rand -hex 32`
   - `OWNER_PASSCODE` — shared with whoever should be able to add/edit/delete leads
   - `VIEWER_PASSCODE` — shared with anyone who should only be able to look
2. Build and run:

   ```bash
   docker compose up -d --build
   ```

3. Visit `http://<host>:4000` and sign in with one of the passcodes.

The `data/` folder (mounted as a volume) holds `leads.db`. Back that file up periodically —
it's the only copy of your data.

## Deploying to Render

A `render.yaml` Blueprint at the repo root already describes the service: Docker build from
`lead-tracker/`, a persistent 1GB disk mounted at `/app/data` (so `leads.db` survives restarts
and redeploys), and the `SESSION_SECRET`/`OWNER_PASSCODE`/`VIEWER_PASSCODE` env vars. This
requires Render's **Starter plan** ($7/mo) — the free tier doesn't support persistent disks, so
the database would get wiped on every redeploy or restart on free.

1. In the Render dashboard: **New +** → **Blueprint**.
2. Connect the `seantaylor101/rhxutah-website` GitHub repo (install the Render GitHub App if it
   asks, and grant it access to this repo).
3. Render reads `render.yaml` and shows the `rhx-lead-tracker` service it's about to create —
   confirm it.
4. It'll pause on `OWNER_PASSCODE` and `VIEWER_PASSCODE` (marked `sync: false`, so they're not
   stored in git) — fill in two different secret values. `SESSION_SECRET` is generated for you
   automatically.
5. Click **Apply**. Render builds the Docker image and deploys. First build takes a few minutes.
6. Once it's live, open the service URL and sign in with the `OWNER_PASSCODE` you set.

Any future push to the branch Render is tracking auto-redeploys. The disk persists across those
deploys — only deleting the disk itself in Render's dashboard would lose the data.

## Deploying elsewhere (Railway, Fly.io, a VPS, etc.)

All of these work the same way with this repo, since it's one Dockerfile:

1. Point the platform at this repo/folder (`lead-tracker/`) and let it build the `Dockerfile`.
2. Set the environment variables from `.env.example` (`SESSION_SECRET`, `OWNER_PASSCODE`,
   `VIEWER_PASSCODE`) in the platform's dashboard.
3. Attach a **persistent disk/volume** mounted at `/app/data` — without this, the SQLite file
   is wiped on every redeploy. (Railway: "Volumes"; Fly.io: `fly volumes create`.)
4. Deploy. The container serves both the API and the built frontend on the same port
   (`PORT`, default 4000), so there's nothing else to configure — no separate frontend host,
   no CORS setup.

## Changing passcodes

Update `OWNER_PASSCODE` / `VIEWER_PASSCODE` in your environment and restart the app. Existing
sessions stay valid until they expire (30 days) or the browser cookie is cleared — for an
immediate cutoff, also rotate `SESSION_SECRET`, which invalidates every existing session.

## API summary

| Method | Path              | Access | Purpose                                   |
|--------|-------------------|--------|--------------------------------------------|
| POST   | /api/auth/login   | public | exchange a passcode for a session cookie   |
| POST   | /api/auth/logout  | any    | clear the session cookie                   |
| GET    | /api/auth/me      | viewer | current role                               |
| GET    | /api/leads        | viewer | list leads (also sweeps paid → archive)    |
| POST   | /api/leads        | owner  | create a lead                              |
| POST   | /api/leads/:id/move | owner | move a lead to a new stage                 |
| PATCH  | /api/leads/:id    | owner  | edit name / createdAt / startDate / revenue |
| DELETE | /api/leads/:id    | owner  | delete a lead                              |
