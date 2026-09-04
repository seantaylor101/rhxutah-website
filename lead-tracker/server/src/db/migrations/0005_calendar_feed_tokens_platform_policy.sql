-- 0003 forced RLS on calendar_feed_tokens and granted leadhammer_platform a SELECT
-- privilege, but never added a matching RLS *policy* for that role -- with RLS enabled
-- and forced, a role with no applicable policy sees zero rows regardless of GRANTs
-- (fail-closed). The public calendar feed route needs leadhammer_platform to resolve any
-- tenant's token, so it gets the same unrestricted-read policy as tenants/users/audit_log.
CREATE POLICY calendar_feed_tokens_platform_read ON calendar_feed_tokens FOR SELECT TO leadhammer_platform
  USING (true);
