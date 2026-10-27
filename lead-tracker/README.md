# Lead Hammer

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

## House measuring (step 1: wall map + photo capture)

Open a lead → **Measure house**. Code lives in `client/src/measure/`, `server/src/routes/measure.js`,
`server/src/measure/`, and `shared/houseGeometry.js` (geometry used by both sides, so the phone
can sort photos onto walls offline with the same math the server uses).

1. **Wall map.** The address is looked up through Google: the building outline (squared up),
   the side with the front entrance, and roof pitch from the Solar API. The outline is the
   *roof edge* seen from above, so walls are drawn inset by the overhang (default 16", adjustable).
   Corners can be dragged, added, or squared up by hand.
2. **Walk-around.** Like HOVER: 8 guided shots — one centered on each side and one off each outside
   corner — shown as a 3×3 grid (front at the bottom). The camera steps through them in walking
   order, marks where to stand on the mini-map (`slotTargets` in `shared/houseGeometry.js`), and
   lets any shot be skipped, retaken, or uploaded instead. A guided shot's wall comes from its slot,
   so it never needs checking. Extras are optional and assigned by sensors as below.
3. **Capture.** An in-app camera that saves, with every photo, the phone's GPS, compass
   heading, tilt, and lens. Each photo is auto-assigned to a wall by casting a few hundred
   sight lines jittered by the phone's own reported GPS/compass accuracy and counting which wall
   they hit first. Photos under 70% confidence go in a **Check these** list; tapping a wall on the
   camera's mini-map locks the next shots to it (the fix for tight side yards, where GPS error is
   wider than the yard). Back-to-back shots of the same wall share a `sweepId` so the measurement
   engine can stitch overlapping shots.
4. **Offline.** Every photo is written to IndexedDB the moment it's taken and deleted there only
   after the server confirms it. Uploads retry on their own with backoff; each photo carries an
   id made on the phone, so a retried upload is never saved twice. The last wall map is cached on
   the phone too. Caveat: the app itself still needs signal to *open* — start the measure screen
   before walking into a dead zone.

5. **Create report.** `server/src/measure/report.js` runs in the background: Claude (`claude-opus-5-5`,
   `server/src/measure/vision.js`) marks up each photo with structured output — every visible wall's
   four corners at base and eave, gable peak, cladding regions, and each window/door's corners, in
   pixels. It never estimates sizes. `shared/facadeGeometry.js` does the measuring: from a wall's four
   corners and the camera's focal length it recovers the wall's true width-to-height ratio (Zhang & He
   rectangle method), scales it by the satellite wall width, and maps everything else on the wall
   through the resulting homography. Heights are weighted toward square-on views (angled views are
   far more sensitive to lens error); openings and materials come from the single best view so
   nothing is counted twice. Markups are cached per photo + wall list, so a re-run only pays for what
   changed. Needs `ANTHROPIC_API_KEY`; roughly $0.50–1.50 per house at list price.

6. **Levels — automatic.** On lookup (and before a report, for houses set up earlier) the server
   reads Google's roof height map (Solar API `dataLayers`: DSM + roof mask, `server/src/measure/dsm.js`)
   and `shared/levels.js` finds the levels on its own: roof at two-story height whose edges are the
   house's outer eaves or a step down onto a lower roof is the second story (`upperOutline`, blue on
   the wall map); a tall one-story ridge slopes smoothly into the rest of the roof and is ignored. The
   rooftop's own edge also replaces Google's building outline when they agree closely (fixes an
   outline that came out too big). Hand edits are never overwritten except by "Redo automatically".
   The photos check the result: a ground wall measured at 14 ft+ that the map called one story (or
   under 12 ft called two) is flagged in the report and its photo height used. Drawing the upper
   story by hand (`suggestUpperOutline` as a start) is only a fallback. `buildHouseModel` splits walls: stretches where the upper story
   sits flush on a ground wall become two-story walls from the ground; the rest of the upper outline
   becomes upper walls that start on top of the lower roof (with their set-back). Claude is told each
   wall's level; upper walls are measured from the roof up, and only counted if a photo shows them.
   A 3D view (`House3D.jsx`, three.js loaded on demand) shows the levels, heights, gables, openings
   and roofs to compare with the house.
7. **Checks.** Duplicate photos (same content hash) are refused; photos under 1600 px are flagged LOW.
   Openings that can't be right (a garage door off the ground, a 14 ft window, past the wall's edge)
   are shown but not deducted; doors near the base are snapped to it; double-marked openings drop.
   Each wall in a photo gets a second, zoomed-in markup pass.
8. **Benchmark.** `shared/benchmarks/house-a-hover.json` holds HOVER's numbers for benchmark house A (no address or owner kept).
   `node shared/benchmarks/run.mjs <measurement.json from Export> [report.json]` scores a wall map /
   report against it. It's a yardstick for tuning — never an adjustment applied to measurements.

Setup: one Google Maps Platform key in `GOOGLE_MAPS_API_KEY` with **Geocoding API**, **Solar
API**, and **Maps Static API** enabled. The height map is Google's "Solar API Data Layers" SKU — one
call per lookup; 1,000 a month free, about $0.075 each after that (check Google's pricing page). Without it the satellite lookup is off, but photos can
still be shot and get sorted once the map exists. Building outlines come from the Geocoding API's
`extra_computations=BUILDING_AND_ENTRANCES` option (a preview feature at time of writing).

Tests for the geometry: `node --test shared/*.test.js server/src/measure/*.test.js` (from `lead-tracker/`).

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
| POST   | /api/leads/:id/move | owner (viewer may move progress→completed) | move a lead to a new stage |
| PATCH  | /api/leads/:id    | owner  | edit name / createdAt / startDate / revenue / address / etc. |
| PUT    | /api/leads/:id/scope-of-work | owner | replace the won-job scope-of-work checklist |
| PATCH  | /api/leads/:id/scope-of-work | viewer | check/uncheck one checklist item           |
| PATCH  | /api/leads/:id/job-details | viewer (instructions + adding/removing pick-ups are owner-only) | job profile: instructions, materials ordered per sub/PM, pick-ups, special equipment |
| POST   | /api/settings/material-suppliers | viewer | permanently add a new supplier to the materials-ordered picker |
| POST   | /api/leads/:id/media | viewer | upload job-profile photos/videos (multipart `media`, 100MB/file) |
| DELETE | /api/leads/:id/media/:mediaId | owner | delete one job-profile photo/video |
| PUT    | /api/leads/:id/media/:mediaId/measure | viewer | replace a photo's ruler calibration + measurement lines |
| POST   | /api/leads/:id/share | owner | create/regenerate a public no-login share link for a job |
| DELETE | /api/leads/:id/share | owner | turn off a job's share link |
| GET    | /api/share/:token | public | a share link's job instructions, photo/video references, and special equipment |
| POST   | /api/leads/:id/payees | owner | add a sub/PM being paid on this job |
| PATCH  | /api/leads/:id/payees/:payeeId | owner | edit a payee's name/role/agreed amount/instructions |
| DELETE | /api/leads/:id/payees/:payeeId | owner | remove a payee |
| GET    | /api/leads/:id/payees/:payeeId/pdf | owner | a one-page PDF for that sub/PM: customer, address, their agreed amount, their instructions, every job photo |
| POST   | /api/leads/:id/payees/:payeeId/payments | owner | record a payment (amount, method, date required) |
| DELETE | /api/leads/:id/payees/:payeeId/payments/:paymentId | owner | remove a logged payment |
| DELETE | /api/leads/:id    | owner  | delete a lead                              |
| GET    | /api/measure/lead/:leadId | viewer | measuring project, derived walls, and photos for a lead |
| POST   | /api/measure/lead/:leadId/lookup | viewer | address → Google building outline, front side, roof pitch |
| PUT    | /api/measure/lead/:leadId/outline | viewer | edit roof outline / overhang / front side |
| GET    | /api/measure/lead/:leadId/satellite.jpg | viewer | proxied satellite image (keeps the API key server-side) |
| POST   | /api/measure/lead/:leadId/photos | viewer | upload one measuring photo + its sensor readings (idempotent by `clientId`) |
| PATCH  | /api/measure/photos/:id | viewer | pin a photo to a wall, or `wallId: null` for automatic |
| DELETE | /api/measure/photos/:id | owner | delete a measuring photo |
| POST   | /api/measure/lead/:leadId/roof | viewer | re-read Google's roof planes (heights, extents) |
| POST   | /api/measure/lead/:leadId/levels | viewer | find levels + outline from the height map again (`reset: true` replaces hand edits) |
| GET    | /api/measure/lead/:leadId/upper-suggestion | viewer | starting upper-story outline from the roof planes |
| POST   | /api/measure/lead/:leadId/report | viewer | start a measurement report (background) |
| GET    | /api/measure/lead/:leadId/report | viewer | latest report: status, progress, result |
| GET    | /api/measure/lead/:leadId/export.zip | viewer | photos + measurement.json in one zip |
| GET    | /api/activity/log | viewer | lead/warranty stage-move history            |
| GET    | /api/activity/access | owner | project-manager (viewer) app-open history |
