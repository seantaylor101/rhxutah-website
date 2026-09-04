-- 0003 granted leadhammer_platform SELECT on calendar_feed_tokens (so the public ICS
-- feed route can resolve token -> tenant) but never granted leadhammer_app anything on
-- it, even though every tenant request (GET/PATCH /api/settings) needs to read/create
-- its own tenant's token through the app pool.
GRANT SELECT, INSERT, UPDATE ON calendar_feed_tokens TO leadhammer_app;
