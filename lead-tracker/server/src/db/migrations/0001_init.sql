-- Lead Hammer multi-tenant schema.
-- IDs are app-generated TEXT (crypto.randomUUID()), matching the existing codebase's
-- convention rather than DB-generated UUIDs.

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'America/Denver',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Platform admins (Lead Hammer staff) have tenant_id = NULL and can never own a row in
-- any business table below. Tenant admins and PMs always belong to exactly one tenant.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('platform_admin', 'tenant_admin', 'pm')),
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_role_tenant_shape CHECK (
    (role = 'platform_admin' AND tenant_id IS NULL) OR
    (role IN ('tenant_admin', 'pm') AND tenant_id IS NOT NULL)
  )
);
-- Email is globally unique (one login page for every role/tenant) and case-insensitive.
CREATE UNIQUE INDEX users_email_idx ON users (lower(email));
CREATE INDEX users_tenant_idx ON users (tenant_id);

-- Audit trail for platform/tenant-admin actions, in particular "view as" (impersonation)
-- start/stop, tenant onboarding, and user lifecycle events.
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_user_id TEXT REFERENCES users(id),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant_created_idx ON audit_log (tenant_id, created_at DESC);

CREATE TABLE tenant_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  overhead_percent NUMERIC NOT NULL DEFAULT 13,
  calendar_feed_token TEXT,
  popup_push_enabled BOOLEAN NOT NULL DEFAULT true,
  popup_goal_enabled BOOLEAN NOT NULL DEFAULT true,
  popup_warranty_enabled BOOLEAN NOT NULL DEFAULT true,
  popup_missing_info_enabled BOOLEAN NOT NULL DEFAULT true,
  popup_maps_enabled BOOLEAN NOT NULL DEFAULT true,
  morning_digest_sent_date TEXT,
  evening_digest_sent_date TEXT,
  last_backup_email_at TIMESTAMPTZ,
  goal_national_win_rate NUMERIC,
  goal_national_avg_job_value NUMERIC,
  goal_national_profit_margin NUMERIC
);

-- One goal record per PM (and, if a tenant admin sells jobs directly, per tenant admin
-- too) per tenant -- replaces the old single global `settings` goal fields.
CREATE TABLE user_goals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  monthly_take_home NUMERIC,
  monthly_overhead NUMERIC,
  data_source TEXT NOT NULL DEFAULT 'national' CHECK (data_source IN ('national', 'mine')),
  month_confirmed TEXT,
  month_push_sent_month TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  lead_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX contacts_tenant_name_idx ON contacts (tenant_id, lower(name));
CREATE INDEX contacts_tenant_phone_idx ON contacts (tenant_id, phone);

-- assigned_pm_id replaces the old hardcoded manager ('Sean'/'Dave') enum: NULL means the
-- tenant admin owns the job directly, set means it's been pushed to a PM.
CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assigned_pm_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('new', 'bid', 'lost', 'won', 'progress', 'completed', 'paid')),
  created_at TIMESTAMPTZ NOT NULL,
  start_date TIMESTAMPTZ,
  revenue NUMERIC,
  won_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  source TEXT,
  source_other TEXT,
  archived BOOLEAN NOT NULL DEFAULT false,
  archived_at TIMESTAMPTZ,
  job TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  bid_sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  material_cost NUMERIC,
  labor_cost NUMERIC,
  commission NUMERIC,
  report_completed_at TIMESTAMPTZ,
  last_report_reminder_at TIMESTAMPTZ,
  went_well TEXT NOT NULL DEFAULT '',
  went_wrong TEXT NOT NULL DEFAULT '',
  actual_work_days NUMERIC,
  appointment_at TIMESTAMPTZ,
  appointment_reminder_sent_at TIMESTAMPTZ,
  lost_at TIMESTAMPTZ,
  scope_of_work JSONB NOT NULL DEFAULT '[]',
  follow_ups JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX leads_tenant_archived_idx ON leads (tenant_id, archived);
CREATE INDEX leads_tenant_pm_idx ON leads (tenant_id, assigned_pm_id);
CREATE INDEX leads_tenant_stage_idx ON leads (tenant_id, stage);

CREATE TABLE warranty_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  assigned_pm_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  issue TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'reported' CHECK (stage IN ('reported', 'scheduled', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scheduled_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);
CREATE INDEX warranty_tenant_idx ON warranty_requests (tenant_id);
CREATE INDEX warranty_tenant_pm_idx ON warranty_requests (tenant_id, assigned_pm_id);

CREATE TABLE warranty_photos (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL REFERENCES warranty_requests(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'before' CHECK (type IN ('before', 'after')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX warranty_photos_request_idx ON warranty_photos (request_id);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);
CREATE INDEX notifications_tenant_created_idx ON notifications (tenant_id, created_at DESC);

CREATE TABLE activity_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('lead', 'warranty', 'assignment')),
  entity_id TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  actor_user_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX activity_log_tenant_created_idx ON activity_log (tenant_id, created_at DESC);

-- PM app-open log (was access_log keyed by role; now keyed by the actual user).
CREATE TABLE access_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX access_log_tenant_created_idx ON access_log (tenant_id, created_at DESC);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_tenant_user_idx ON push_subscriptions (tenant_id, user_id);
