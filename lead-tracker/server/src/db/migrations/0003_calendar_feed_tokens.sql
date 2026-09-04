-- The public ICS calendar feed is resolved by an opaque token alone (Apple Calendar's
-- fetcher can't carry a session cookie), so, like login-by-email, this needs to be
-- searchable *before* a tenant is known. tenant_settings itself has no such grant for
-- leadhammer_platform (it's real business config), so this is a narrow, separate table
-- that reveals nothing beyond "this token belongs to this tenant_id".
CREATE TABLE calendar_feed_tokens (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE
);

ALTER TABLE calendar_feed_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_feed_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON calendar_feed_tokens FOR ALL TO leadhammer_app
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
-- leadhammer_platform gets a real grant here (unlike other business tables) specifically
-- so the calendar feed route can resolve token -> tenant_id without already knowing the
-- tenant -- no RLS-restricting policy for it, since resolving by token IS its job.
GRANT SELECT ON calendar_feed_tokens TO leadhammer_platform;

ALTER TABLE tenant_settings DROP COLUMN calendar_feed_token;
