-- Tenant isolation, enforced at the database layer (not just in application code).
--
-- Two Postgres roles connect to this database (created by scripts/setup-db-roles.js,
-- not here -- role creation embeds a password and doesn't belong in a versioned
-- migration):
--   leadhammer_app      -- used for every tenant_admin / pm session. Row-Level Security
--                           restricts it to whichever single tenant the current request's
--                           session set via app.tenant_id.
--   leadhammer_platform -- used only for platform_admin sessions. Granted access to
--                           tenants/users/audit_log ONLY -- no GRANT at all exists on any
--                           business table (leads, contacts, warranty, goals, settings,
--                           notifications, activity/access logs, push subscriptions), so a
--                           platform_admin request literally cannot read a tenant's
--                           proprietary data even if a future route handler tried to query
--                           it by mistake: Postgres returns a permission-denied error.
--
-- app.tenant_id is set per-request via `SELECT set_config('app.tenant_id', $1, true)`
-- inside a transaction (see db/pool.js: withTenant). If it's never set, current_setting
-- returns NULL and every RLS policy below denies all rows -- fail closed.

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS TEXT AS $$
  SELECT current_setting('app.tenant_id', true);
$$ LANGUAGE sql STABLE;

-- tenants, users, audit_log: leadhammer_app sees only its own tenant's slice;
-- leadhammer_platform sees everything (that's its whole job -- onboarding/managing
-- tenant accounts), but nothing beyond these three tables.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_app_isolation ON tenants FOR ALL TO leadhammer_app
  USING (id = current_tenant_id()) WITH CHECK (id = current_tenant_id());
CREATE POLICY tenant_platform_full ON tenants FOR ALL TO leadhammer_platform
  USING (true) WITH CHECK (true);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_app_isolation ON users FOR ALL TO leadhammer_app
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY users_platform_full ON users FOR ALL TO leadhammer_platform
  USING (true) WITH CHECK (true);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_log_app_isolation ON audit_log FOR ALL TO leadhammer_app
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY audit_log_platform_full ON audit_log FOR ALL TO leadhammer_platform
  USING (true) WITH CHECK (true);

-- Every other table: leadhammer_app only, tenant-scoped. leadhammer_platform gets no
-- policy AND no GRANT on these -- see setup-db-roles.js.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenant_settings', 'user_goals', 'contacts', 'leads', 'warranty_requests',
    'warranty_photos', 'notifications', 'activity_log', 'access_log', 'push_subscriptions'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO leadhammer_app USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t
    );
  END LOOP;
END $$;

-- warranty_photos and tenant_settings/user_goals reference tenant_id directly (added in
-- 0001), so the generic loop above covers them without a join-based policy.

GRANT SELECT, INSERT, UPDATE, DELETE ON
  tenant_settings, user_goals, contacts, leads, warranty_requests, warranty_photos,
  notifications, activity_log, access_log, push_subscriptions
TO leadhammer_app;
GRANT SELECT, INSERT, UPDATE ON tenants TO leadhammer_app;
GRANT SELECT, INSERT, UPDATE ON users TO leadhammer_app;
GRANT SELECT, INSERT ON audit_log TO leadhammer_app;

GRANT SELECT, INSERT, UPDATE ON tenants TO leadhammer_platform;
GRANT SELECT, INSERT, UPDATE ON users TO leadhammer_platform;
GRANT SELECT, INSERT ON audit_log TO leadhammer_platform;
-- Deliberately no GRANT of any kind to leadhammer_platform on tenant_settings, user_goals,
-- contacts, leads, warranty_requests, warranty_photos, notifications, activity_log,
-- access_log, or push_subscriptions.
