-- Enable UUID extension if not already loaded (normally built-in)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Table: users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    device_timezone TEXT,
    fcm_token TEXT,
    briefing_enabled BOOLEAN DEFAULT true,
    push_enabled BOOLEAN DEFAULT true,
    email_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Table: google_accounts
CREATE TABLE IF NOT EXISTS google_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expires_at TIMESTAMPTZ NOT NULL,
    sync_token TEXT,
    last_synced_at TIMESTAMPTZ,
    sync_status TEXT NOT NULL DEFAULT 'healthy' CHECK (sync_status IN ('healthy', 'token_expired', 'sync_error'))
);

-- Table: recurrence_templates
CREATE TABLE IF NOT EXISTS recurrence_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    recurrence_type TEXT NOT NULL CHECK (recurrence_type IN ('daily', 'weekly', 'monthly', 'custom_interval')),
    interval_days INTEGER,
    days_of_week INTEGER[],
    day_of_month INTEGER,
    time_of_day TIME NOT NULL,
    timezone_snapshot TEXT NOT NULL,
    anchor_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Table: tasks
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recurrence_template_id UUID REFERENCES recurrence_templates(id) ON DELETE SET NULL,
    google_event_id TEXT,
    title TEXT NOT NULL,
    deadline_at TIMESTAMPTZ,
    timezone_snapshot TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index on tasks (user_id, status, deadline_at)
CREATE INDEX IF NOT EXISTS idx_tasks_user_status_deadline ON tasks (user_id, status, deadline_at);

-- Table: reminders
CREATE TABLE IF NOT EXISTS reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tier TEXT NOT NULL CHECK (tier IN ('advance', 'approaching', 'due_now')),
    trigger_at TIMESTAMPTZ NOT NULL,
    bullmq_job_id TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sent', 'cancelled')),
    sent_at TIMESTAMPTZ
);

-- Table: notification_log
CREATE TABLE IF NOT EXISTS notification_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reminder_id UUID REFERENCES reminders(id) ON DELETE SET NULL,
    channel TEXT NOT NULL CHECK (channel IN ('push', 'email')),
    notification_type TEXT NOT NULL CHECK (notification_type IN ('reminder', 'briefing', 'system_fallback')),
    delivery_status TEXT NOT NULL CHECK (delivery_status IN ('success', 'failed')),
    failure_reason TEXT,
    sent_at TIMESTAMPTZ DEFAULT now()
);
