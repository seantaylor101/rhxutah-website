# Lead Hammer

A multi-tenant job tracker (New Lead → Bid → Won/Lost → In Progress → Completed → Paid)
for exteriors/home-services businesses, with three role tiers:

- **`platform_admin`** — Lead Hammer (the product) onboards client businesses (tenants),
  can suspend/reactivate them, and sees basic tenant health (user counts, last login).
  Structurally cannot read any tenant's leads, contacts, warranty tickets, goals, or
  settings — enforced by Postgres Row-Level Security and a dedicated database role that
  has no grant at all on those tables (see `server/src/db/migrations/0002_rls.sql`), not
  just hidden in the UI.
- **`tenant_admin`** — a business owner. Full control of their own tenant: sells/manages
  jobs, adds/disables PM and other admin users, pushes/retrieves/reassigns jobs to PMs,
  can "view as" any of their PMs, sees every PM's goals and warranty tickets.
- **`pm`** — a project manager, scoped to one tenant. Sells and manages their own
  assigned jobs, has their own income goal, pushes a completed job back to the admin
  (the existing `progress → completed` stage move) for payment processing.

- **Server:** Node.js + Express + Postgres (`pg`), tenant-isolated by Row-Level Security
- **Client:** React (Vite build)
- **Auth:** real per-user accounts (email + bcrypt password hash), session kept in an
  httpOnly cookie
- **Data:** Postgres. Every business table carries a `tenant_id`; two Postgres roles
  (`leadhammer_app`, RLS-scoped per tenant; `leadhammer_platform`, no grant on any
  business table) are the actual database-level enforcement of the tenant/platform
  boundary described above

## Project layout

```
lead-tracker/
  server/
    src/db/              Postgres pool, migrations, migration runner
    src/auth/             sessions, passwords, users, impersonation ("view as")
    src/routes/            one file per API area
    scripts/                setup-db-roles.js, migrate-sqlite-to-postgres.js, create-platform-admin.js
  client/   React app (Vite)
  Dockerfile
  docker-compose.yml
```

## Local development

Requires Node 20+ and a local Postgres instance.

```bash
cd lead-tracker
cp .env.example server/.env   # fill in the values below
npm install --prefix server
npm install --prefix client

# one-time, per environment: create the DB + two roles, then apply the schema
createdb leadhammer_dev
DATABASE_URL=postgresql://you@localhost:5432/leadhammer_dev \
  APP_DB_PASSWORD=dev-app-pw PLATFORM_DB_PASSWORD=dev-platform-pw \
  npm --prefix server run setup-db-roles
DATABASE_URL=postgresql://you@localhost:5432/leadhammer_dev npm --prefix server run migrate

# create your own platform_admin account (no API route mints these -- see the script's
# comment for why)
npm --prefix server run create-platform-admin -- you@example.com "Your Name" a-real-password

# terminal 1
npm run dev --prefix server

# terminal 2
npm run dev --prefix client
```

Open the client dev server URL (Vite prints it, typically http://localhost:5173). It
proxies `/api` requests to the Express server on port 4000, so both need to be running.

Sign in as the platform admin you just created, use "Onboard a new client" to create
your first tenant (and its first `tenant_admin`), then sign in as that tenant admin and
use Team (in the hamburger menu) to add PMs.

### `server/.env` values

See `.env.example` at the repo root for the full list with explanations. The short
version: `SESSION_SECRET` (random), `DATABASE_URL` (DB owner, used only by
`setup-db-roles`/`migrate`), `APP_DATABASE_URL`/`PLATFORM_DATABASE_URL` (the two roles
the running app actually connects as -- same host/db as `DATABASE_URL`, different
user/password), and the usual `FORM_INTAKE_KEY`/`WEB3FORMS_ACCESS_KEY`/VAPID keys for
the public website intake form and push notifications.

## Running with Docker

```bash
docker compose up -d --build
```

`docker-compose.yml` still assumes a single local Postgres — for anything beyond local
testing, point `APP_DATABASE_URL`/`PLATFORM_DATABASE_URL`/`DATABASE_URL` at a real
Postgres instance (Render, RDS, etc.) instead of trying to containerize Postgres
alongside the app.

## Deploying to Render / production cutover

**This section matters more than it looks — it's the path from "this works on my
laptop" to "this is what rhxutah.com's Lead Hammer actually runs on."** If you're
migrating an existing single-tenant SQLite deployment (the pre-multi-tenant version of
this app) to this Postgres version, read the whole thing before running anything against
production; several steps are one-way.

**Sequencing matters**: everything through step 5 below happens against production
Postgres directly (via one-off scripts), with the *old* app still live and completely
unaffected -- it doesn't read any of these new env vars or tables. Only step 6 (merging
this branch to the branch Render deploys) actually changes what's running. Doing it in
this order means that merge is a clean code swap onto already-correct, already-verified
data, not a race to finish setup before someone hits a broken login page.

### 1. Provision Postgres

`render.yaml` now includes a `databases:` block (`rhx-lead-tracker-db`, starter plan).
Merge **just that file** (not the rest of this branch yet) to the branch your Render
Blueprint tracks, or add the database by hand as a separate resource in the Render
dashboard (**New +** → **PostgreSQL**) -- either way you end up with a Postgres instance
and its owner connection string. **This is a new paid resource in addition to the
existing web service** (roughly $6-7/month on the starter tier at time of writing --
confirm the current price in the Render dashboard before applying).

### 2. Create the two application roles

The connection string from step 1 is the database *owner* connection -- the running app
never uses it directly. From your own machine, with that connection string as
`DATABASE_URL` and two passwords you choose:

```bash
DATABASE_URL='<from Render dashboard>' \
  APP_DB_PASSWORD='<choose a strong password>' \
  PLATFORM_DB_PASSWORD='<choose a different strong password>' \
  npm --prefix lead-tracker/server run setup-db-roles
DATABASE_URL='<same>' npm --prefix lead-tracker/server run migrate
```

Construct `APP_DATABASE_URL`/`PLATFORM_DATABASE_URL` yourself: same host/port/database
name as `DATABASE_URL`, with the username/password swapped for
`leadhammer_app`/`APP_DB_PASSWORD` and `leadhammer_platform`/`PLATFORM_DB_PASSWORD`
respectively. Set all three (plus `SESSION_SECRET`, generated for you if using the
Blueprint) as env vars on the web service in the Render dashboard now -- the still-old
app ignores them, so this is a no-op until step 6.

### 3. Onboard your tenant and its PMs directly against the database

No need to wait for the new code to be live -- these scripts talk to Postgres directly:

```bash
# your own platform_admin account (Lead Hammer, the product -- not a business tenant)
DATABASE_URL='...' APP_DATABASE_URL='...' PLATFORM_DATABASE_URL='...' \
  npm --prefix lead-tracker/server run create-platform-admin -- you@example.com "Your Name" a-real-password

# your own business as the first tenant, with you as its tenant_admin
DATABASE_URL='...' APP_DATABASE_URL='...' PLATFORM_DATABASE_URL='...' \
  npm --prefix lead-tracker/server run onboard-tenant -- "RHX Utah" rhx-utah America/Denver sean@rhxutah.com Sean a-real-password
# -> prints the new tenant id; keep it for steps 4 and 5

# each real PM, so their user id exists for PM_MANAGER_MAP below
DATABASE_URL='...' APP_DATABASE_URL='...' PLATFORM_DATABASE_URL='...' \
  npm --prefix lead-tracker/server run add-user -- <tenantId> dave@rhxutah.com Dave a-real-password pm
```

If you're not hiring PMs yet, skip the `add-user` calls -- you (the tenant admin) own
every job directly until you push one to a PM.

### 4. Migrate existing SQLite data (skip if starting fresh)

If there's an existing single-tenant deployment with real leads in `leads.db`:

1. Download that file off the old deployment's persistent disk (Render's dashboard shell,
   or however you access that service's disk).
2. Run the migration script **against a local copy of the Postgres database first** to
   verify it before touching production -- see the script's own header comment
   (`scripts/migrate-sqlite-to-postgres.js`) for the full usage and exactly what it does
   and doesn't migrate (it does not copy warranty photo files themselves -- copy those
   separately into the new deployment's `UPLOADS_DIR`).
3. Once verified, run it for real, using the tenant/PM ids from step 3:
   ```bash
   SQLITE_PATH=/path/to/downloaded/leads.db \
     TARGET_TENANT_ID='<from step 3>' \
     PM_MANAGER_MAP='{"Dave":"<daves-new-user-id-from-step-3>"}' \
     DATABASE_URL='...' APP_DATABASE_URL='...' PLATFORM_DATABASE_URL='...' \
     npm --prefix lead-tracker/server run migrate:sqlite
   ```
4. Spot-check the migrated leads/contacts/warranty tickets directly in Postgres (`psql`,
   or any DB client) against the old app before relying on this being the system of
   record.

### 5. Wire up the public website intake form

Set `PUBLIC_INTAKE_TENANT_ID` (Render env var, on the web service) to your tenant's id
from step 3, and `FORM_INTAKE_KEY` to whatever secret the public site's form already
sends. Without this set, `/api/public/leads` returns 503 rather than silently dropping
leads -- and since it's just an env var, it's already safe to set now.

### 6. Go live

Merge this branch to whichever branch Render's web service tracks for auto-deploy (`main`,
typically) -- that triggers the actual production deploy. The disk at `/app/data` persists
across deploys, same as before, now holding warranty photo uploads instead of `leads.db`.

Once it's live, sign in with the email/password accounts created in step 3 -- the old
shared `OWNER_PASSCODE`/`VIEWER_PASSCODE` no longer work at all (there's no code path
left that checks them). Let everyone who used to share those two passcodes know their new
individual login before they try the old one and get confused.

## API summary

Routes are grouped by file under `server/src/routes/`. Roles shown are the
`requireAuth(...)` floor; several routes have additional in-handler checks (e.g. a PM can
only move their own assigned lead). See each route file's comments for specifics.

| Area | File | Roles | Notes |
|---|---|---|---|
| Auth | `auth.js` | public / any | login, logout, `/me`, view-as start/stop |
| Leads | `leads.js` | tenant_admin, pm | CRUD, stage moves, assign/reassign to a PM, scope-of-work |
| Contacts | `contacts.js` | tenant_admin | tenant's customer address book |
| Warranty | `warranty.js` | tenant_admin, pm | tickets, photos, PM-scoped visibility |
| Settings | `settings.js` | tenant_admin, pm (read) | tenant-wide overhead %, popups, national goal assumptions |
| Goals | `goals.js` | tenant_admin, pm | each user's own income goal; admin sees a team rollup |
| Users | `users.js` | tenant_admin | add/disable PMs and admins in your own tenant |
| Platform | `platform.js` | platform_admin | onboard/suspend/reactivate tenants, tenant health |
| Notifications / Push | `notifications.js`, `push.js` | tenant_admin, pm | in-app + web push |
| Calendar | `calendar.js` | tenant_admin, pm / public (token) | ICS export + subscribable feed |
| Activity | `activity.js` | tenant_admin, pm | merged stage-move + app-open feed |
| Public intake | `public.js` | shared secret | website lead-intake form target |
