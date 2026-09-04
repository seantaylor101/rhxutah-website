-- Lets the platform admin see basic tenant health (last activity, user counts) without
-- touching any business table -- users is the one table leadhammer_platform already has
-- unconditional access to, so a login timestamp here is enough for a real health signal.
ALTER TABLE users ADD COLUMN last_login_at TIMESTAMPTZ;
